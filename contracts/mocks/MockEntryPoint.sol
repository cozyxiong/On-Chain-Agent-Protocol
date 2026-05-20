// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentSmartAccount } from "../account/AgentSmartAccount.sol";
import { PackedUserOperation } from "../account/interfaces/PackedUserOperation.sol";

contract MockEntryPoint {
    event UserOperationHandled(address indexed sender, bytes32 indexed userOpHash);

    error UserOperationValidationFailed();

    function handleOp(
        PackedUserOperation calldata userOp,
        address target,
        uint256 value,
        bytes calldata data
    ) external {
        AgentSmartAccount account = AgentSmartAccount(payable(userOp.sender));
        bytes32 userOpHash = account.getUserOpHash(userOp);

        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);
        if (validationData != 0) revert UserOperationValidationFailed();

        account.executeFromEntryPoint(target, value, data);
        emit UserOperationHandled(userOp.sender, userOpHash);
    }
}
