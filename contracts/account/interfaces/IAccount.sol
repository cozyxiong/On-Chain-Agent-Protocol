// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { PackedUserOperation } from "./PackedUserOperation.sol";

interface IAccount {
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);
}
