// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SimpleECDSA } from "../account/libs/SimpleECDSA.sol";

contract SignedIntentEscrow {
    using SimpleECDSA for bytes32;

    string public constant NAME = "AAP Intent Protocol";
    string public constant VERSION = "1";

    bytes32 public constant SIGNED_CALL_TYPEHASH = keccak256(
        "SignedCall(address owner,address target,uint256 value,bytes32 dataHash,uint256 runAt,uint256 deadline,bytes32 nonce)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    mapping(address => uint256) public balances;
    mapping(bytes32 => bool) public usedNonces;

    event Deposited(address indexed owner, address indexed sender, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event SignedCallExecuted(
        address indexed owner,
        address indexed relayer,
        address indexed target,
        uint256 value,
        bytes32 nonce,
        bytes result
    );
    event SignedCallBatchExecuted(address indexed relayer, uint256 size);

    error InvalidOwner();
    error InvalidTarget();
    error InvalidAmount();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error NotDue();
    error SignatureExpired();
    error InsufficientEscrowBalance();
    error DataHashMismatch();
    error ExecutionFailed(bytes result);
    error ArrayLengthMismatch();

    struct SignedCall {
        address owner;
        address target;
        uint256 value;
        bytes32 dataHash;
        uint256 runAt;
        uint256 deadline;
        bytes32 nonce;
    }

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    receive() external payable {
        depositFor(msg.sender);
    }

    function depositFor(address owner) public payable {
        if (owner == address(0)) revert InvalidOwner();
        if (msg.value == 0) revert InvalidAmount();

        balances[owner] += msg.value;
        emit Deposited(owner, msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientEscrowBalance();

        balances[msg.sender] -= amount;
        (bool success, bytes memory result) = payable(msg.sender).call{ value: amount }("");
        if (!success) revert ExecutionFailed(result);

        emit Withdrawn(msg.sender, amount);
    }

    function executeSignedCall(SignedCall calldata call_, bytes calldata data, bytes calldata signature)
        external
        returns (bytes memory result)
    {
        return _executeSignedCall(call_, data, signature);
    }

    function executeBatchSignedCalls(
        SignedCall[] calldata calls,
        bytes[] calldata data,
        bytes[] calldata signatures
    ) external returns (bytes[] memory results) {
        if (calls.length != data.length || calls.length != signatures.length) {
            revert ArrayLengthMismatch();
        }

        results = new bytes[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            results[i] = _executeSignedCall(calls[i], data[i], signatures[i]);
        }

        emit SignedCallBatchExecuted(msg.sender, calls.length);
    }

    function digestFor(SignedCall calldata call_) public view returns (bytes32) {
        return _digest(_structHash(call_));
    }

    function _digest(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _structHash(SignedCall calldata call_) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SIGNED_CALL_TYPEHASH,
                call_.owner,
                call_.target,
                call_.value,
                call_.dataHash,
                call_.runAt,
                call_.deadline,
                call_.nonce
            )
        );
    }

    function _executeSignedCall(
        SignedCall calldata call_,
        bytes calldata data,
        bytes calldata signature
    ) private returns (bytes memory result) {
        if (call_.owner == address(0)) revert InvalidOwner();
        if (call_.target == address(0)) revert InvalidTarget();
        if (usedNonces[call_.nonce]) revert NonceAlreadyUsed();
        if (block.timestamp < call_.runAt) revert NotDue();
        if (block.timestamp > call_.deadline) revert SignatureExpired();
        if (keccak256(data) != call_.dataHash) revert DataHashMismatch();

        bytes32 digest = digestFor(call_);
        if (SimpleECDSA.recover(digest, signature) != call_.owner) revert InvalidSignature();
        if (balances[call_.owner] < call_.value) revert InsufficientEscrowBalance();

        usedNonces[call_.nonce] = true;
        balances[call_.owner] -= call_.value;

        (bool success, bytes memory callResult) = call_.target.call{ value: call_.value }(data);
        if (!success) revert ExecutionFailed(callResult);

        emit SignedCallExecuted(
            call_.owner,
            msg.sender,
            call_.target,
            call_.value,
            call_.nonce,
            callResult
        );
        return callResult;
    }
}
