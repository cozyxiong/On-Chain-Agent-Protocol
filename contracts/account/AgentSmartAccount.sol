// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAccount } from "./interfaces/IAccount.sol";
import { PackedUserOperation } from "./interfaces/PackedUserOperation.sol";
import { SimpleECDSA } from "./libs/SimpleECDSA.sol";

contract AgentSmartAccount is IAccount {
    using SimpleECDSA for bytes32;

    address public immutable entryPoint;
    address public owner;
    uint256 public nonce;
    bool private initialized;

    struct AgentPermission {
        bool active;
        address target;
        uint256 maxValue;
        uint48 validUntil;
    }

    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    mapping(address => AgentPermission) public agentPermissions;
    mapping(address => mapping(address => AgentPermission)) public agentTargetPermissions;
    mapping(address => bool) public revokedAgents;
    mapping(address => mapping(address => bool)) public revokedAgentTargets;

    event AccountInitialized(address indexed owner, address indexed entryPoint);
    event Executed(address indexed target, uint256 value, bytes data, bytes result);
    event OwnerChanged(address indexed previousOwner, address indexed newOwner);
    event AgentAuthorized(
        address indexed agent,
        address indexed target,
        uint256 maxValue,
        uint48 validUntil
    );
    event AgentRevoked(address indexed agent);
    event AgentExecuted(address indexed agent, address indexed target, uint256 value, bytes result);
    event AgentBatchExecuted(address indexed agent, uint256 size);

    error AlreadyInitialized();
    error InvalidOwner();
    error NotOwner();
    error NotEntryPoint();
    error InvalidSender();
    error InvalidNonce();
    error InvalidTarget();
    error ExecutionFailed(bytes result);
    error InvalidAgent();
    error AgentNotAuthorized();
    error AgentPermissionExpired();
    error TargetNotAllowed();
    error ValueExceedsPermission();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) revert NotEntryPoint();
        _;
    }

    constructor(address entryPoint_) {
        entryPoint = entryPoint_;
    }

    receive() external payable {}

    function initialize(address owner_) external {
        if (initialized) revert AlreadyInitialized();
        if (owner_ == address(0)) revert InvalidOwner();

        initialized = true;
        owner = owner_;

        emit AccountInitialized(owner_, entryPoint);
    }

    function execute(address target, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (bytes memory result)
    {
        result = _execute(target, value, data);
    }

    function executeFromEntryPoint(address target, uint256 value, bytes calldata data)
        external
        onlyEntryPoint
        returns (bytes memory result)
    {
        result = _execute(target, value, data);
    }

    function authorizeAgent(address agent, address target, uint256 maxValue, uint48 validUntil)
        external
        onlyOwner
    {
        if (agent == address(0)) revert InvalidAgent();
        if (validUntil <= block.timestamp) revert AgentPermissionExpired();

        revokedAgents[agent] = false;
        agentPermissions[agent] = AgentPermission({
            active: true,
            target: target,
            maxValue: maxValue,
            validUntil: validUntil
        });
        if (target != address(0)) {
            revokedAgentTargets[agent][target] = false;
            agentTargetPermissions[agent][target] = AgentPermission({
                active: true,
                target: target,
                maxValue: maxValue,
                validUntil: validUntil
            });
        }

        emit AgentAuthorized(agent, target, maxValue, validUntil);
    }

    function revokeAgent(address agent) external onlyOwner {
        delete agentPermissions[agent];
        revokedAgents[agent] = true;
        emit AgentRevoked(agent);
    }

    function revokeAgentTarget(address agent, address target) external onlyOwner {
        delete agentTargetPermissions[agent][target];
        revokedAgentTargets[agent][target] = true;
        emit AgentRevoked(agent);
    }

    function executeAgentCall(address target, uint256 value, bytes calldata data)
        external
        returns (bytes memory result)
    {
        _validateAgentPermission(msg.sender, target, value);

        result = _execute(target, value, data);
        emit AgentExecuted(msg.sender, target, value, result);
    }

    function executeBatchAgentCalls(Call[] calldata calls)
        external
        returns (bytes[] memory results)
    {
        results = new bytes[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            _validateAgentPermission(msg.sender, calls[i].target, calls[i].value);
            results[i] = _execute(calls[i].target, calls[i].value, calls[i].data);
            emit AgentExecuted(msg.sender, calls[i].target, calls[i].value, results[i]);
        }

        emit AgentBatchExecuted(msg.sender, calls.length);
    }

    function changeOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnerChanged(previousOwner, newOwner);
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        if (userOp.sender != address(this)) revert InvalidSender();
        if (userOp.nonce != nonce) revert InvalidNonce();

        bytes32 digest = userOpHash.toEthSignedMessageHash();
        address recovered = SimpleECDSA.recover(digest, userOp.signature);
        validationData = recovered == owner ? 0 : 1;

        if (validationData == 0) {
            nonce++;
        }

        if (missingAccountFunds > 0) {
            (bool paid,) = payable(msg.sender).call{ value: missingAccountFunds }("");
            paid;
        }
    }

    function getUserOpHash(PackedUserOperation calldata userOp) external view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(this),
                block.chainid,
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                userOp.preVerificationGas,
                userOp.gasFees,
                keccak256(userOp.paymasterAndData)
            )
        );
    }

    function _execute(address target, uint256 value, bytes calldata data)
        private
        returns (bytes memory result)
    {
        if (target == address(0)) revert InvalidTarget();
        (bool success, bytes memory callResult) = target.call{ value: value }(data);
        if (!success) revert ExecutionFailed(callResult);

        emit Executed(target, value, data, callResult);
        return callResult;
    }

    function _validateAgentPermission(address agent, address target, uint256 value) private view {
        if (revokedAgents[agent]) revert AgentNotAuthorized();
        if (revokedAgentTargets[agent][target]) revert TargetNotAllowed();

        AgentPermission memory permission = agentTargetPermissions[agent][target];
        if (!permission.active) {
            permission = agentPermissions[agent];
        }

        if (!permission.active) revert AgentNotAuthorized();
        if (permission.validUntil < block.timestamp) revert AgentPermissionExpired();
        if (permission.target != address(0) && permission.target != target) revert TargetNotAllowed();
        if (value > permission.maxValue) revert ValueExceedsPermission();
    }
}
