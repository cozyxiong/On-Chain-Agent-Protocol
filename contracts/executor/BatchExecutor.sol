// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IntentManager } from "../intents/IntentManager.sol";

contract BatchExecutor {
    struct ExecutionCall {
        bytes32 intentId;
        address target;
        uint256 value;
        bytes data;
    }

    IntentManager public immutable intentManager;
    address public owner;
    address public coordinator;

    event CoordinatorUpdated(address indexed coordinator);
    event BatchStarted(bytes32 indexed batchId, uint256 callCount);
    event BatchIntentResult(
        bytes32 indexed batchId,
        bytes32 indexed intentId,
        address indexed target,
        bool success,
        bytes result
    );
    event BatchCompleted(bytes32 indexed batchId, uint256 successCount, uint256 failureCount);

    error NotOwner();
    error NotCoordinator();
    error InvalidTarget();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert NotCoordinator();
        _;
    }

    constructor(IntentManager intentManager_) {
        intentManager = intentManager_;
        owner = msg.sender;
        coordinator = msg.sender;
    }

    receive() external payable {}

    function setCoordinator(address coordinator_) external onlyOwner {
        coordinator = coordinator_;
        emit CoordinatorUpdated(coordinator_);
    }

    function executeBatch(bytes32 batchId, ExecutionCall[] calldata calls)
        external
        payable
        onlyCoordinator
        returns (uint256 successCount, uint256 failureCount)
    {
        emit BatchStarted(batchId, calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            ExecutionCall calldata executionCall = calls[i];

            if (executionCall.target == address(0)) {
                failureCount++;
                emit BatchIntentResult(
                    batchId, executionCall.intentId, executionCall.target, false, ""
                );
                continue;
            }

            try intentManager.markBatched(executionCall.intentId) {
                (bool success, bytes memory result) =
                    executionCall.target.call{ value: executionCall.value }(executionCall.data);

                if (success) {
                    intentManager.markExecuted(executionCall.intentId);
                    successCount++;
                } else {
                    intentManager.markFailed(executionCall.intentId);
                    failureCount++;
                }

                emit BatchIntentResult(
                    batchId, executionCall.intentId, executionCall.target, success, result
                );
            } catch (bytes memory reason) {
                failureCount++;
                emit BatchIntentResult(
                    batchId, executionCall.intentId, executionCall.target, false, reason
                );
            }
        }

        emit BatchCompleted(batchId, successCount, failureCount);
    }
}
