// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../contracts/registry/AgentRegistry.sol";
import { IntentManager } from "../contracts/intents/IntentManager.sol";
import { BatchExecutor } from "../contracts/executor/BatchExecutor.sol";

contract ExecuteSepoliaIntents {
    event NativeIntentExecuted(
        string label,
        bytes32 indexed intentId,
        address indexed recipient,
        uint256 amount
    );

    function run() external {
        VmLike vm = VmLike(address(uint160(uint256(keccak256("hevm cheat code")))));
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        bytes32 agentId = vm.envBytes32("SMOKE_AGENT_ID");
        address intentManagerAddress = vm.envAddress("INTENT_MANAGER_ADDRESS");
        address batchExecutorAddress = vm.envAddress("BATCH_EXECUTOR_ADDRESS");
        address recipient = vm.envOr("SMOKE_RECIPIENT", vm.addr(privateKey));
        uint256 transferAmount = vm.envOr("SMOKE_TRANSFER_AMOUNT_WEI", uint256(0.00001 ether));
        uint256 scheduledAmount = vm.envOr("SMOKE_SCHEDULED_AMOUNT_WEI", uint256(0.00001 ether));

        IntentManager intentManager = IntentManager(intentManagerAddress);
        BatchExecutor batchExecutor = BatchExecutor(payable(batchExecutorAddress));

        vm.startBroadcast(privateKey);

        payable(batchExecutorAddress).transfer(transferAmount + scheduledAmount);

        _createAndExecuteNativeIntent(
            intentManager,
            batchExecutor,
            agentId,
            AgentRegistry.IntentType.Transfer,
            "transfer",
            recipient,
            transferAmount
        );

        _createAndExecuteNativeIntent(
            intentManager,
            batchExecutor,
            agentId,
            AgentRegistry.IntentType.Scheduled,
            "scheduled",
            recipient,
            scheduledAmount
        );

        vm.stopBroadcast();
    }

    function _createAndExecuteNativeIntent(
        IntentManager intentManager,
        BatchExecutor batchExecutor,
        bytes32 agentId,
        AgentRegistry.IntentType intentType,
        string memory label,
        address recipient,
        uint256 amount
    ) private {
        bytes32 intentId = keccak256(abi.encodePacked(label, block.timestamp, recipient, amount));
        intentManager.createIntent(intentId, agentId, intentType, keccak256(bytes(label)), amount);

        BatchExecutor.ExecutionCall[] memory calls = new BatchExecutor.ExecutionCall[](1);
        calls[0] = BatchExecutor.ExecutionCall({
            intentId: intentId,
            target: recipient,
            value: amount,
            data: ""
        });

        batchExecutor.executeBatch(keccak256(abi.encodePacked("batch", intentId)), calls);
        emit NativeIntentExecuted(label, intentId, recipient, amount);
    }
}

interface VmLike {
    function envUint(string calldata key) external returns (uint256);
    function envBytes32(string calldata key) external returns (bytes32);
    function envAddress(string calldata key) external returns (address);
    function envOr(string calldata key, address defaultValue) external returns (address);
    function envOr(string calldata key, uint256 defaultValue) external returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}
