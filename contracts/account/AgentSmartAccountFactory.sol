// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentSmartAccount } from "./AgentSmartAccount.sol";

contract AgentSmartAccountFactory {
    address public immutable entryPoint;

    event AccountCreated(address indexed account, address indexed owner, bytes32 indexed salt);

    error AccountInitializationFailed();

    constructor(address entryPoint_) {
        entryPoint = entryPoint_;
    }

    function createAccount(address owner, bytes32 salt) external returns (AgentSmartAccount account) {
        address predicted = getAddress(owner, salt);
        if (predicted.code.length > 0) {
            return AgentSmartAccount(payable(predicted));
        }

        bytes32 finalSalt = _finalSalt(owner, salt);
        account = new AgentSmartAccount{ salt: finalSalt }(entryPoint);

        try account.initialize(owner) {}
        catch {
            revert AccountInitializationFailed();
        }

        emit AccountCreated(address(account), owner, salt);
    }

    function getAddress(address owner, bytes32 salt) public view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(AgentSmartAccount).creationCode,
            abi.encode(entryPoint)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), _finalSalt(owner, salt), keccak256(bytecode))
        );
        return address(uint160(uint256(hash)));
    }

    function _finalSalt(address owner, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }
}
