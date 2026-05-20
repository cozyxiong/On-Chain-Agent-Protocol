// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../contracts/registry/AgentRegistry.sol";
import { IntentManager } from "../contracts/intents/IntentManager.sol";
import { BatchExecutor } from "../contracts/executor/BatchExecutor.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

contract BatchAgentSubmitter {
    function submit(
        IntentManager manager,
        bytes32 intentId,
        bytes32 agentId,
        bytes32 payloadHash,
        uint256 amount
    ) external {
        manager.createIntent(
            intentId, agentId, AgentRegistry.IntentType.Transfer, payloadHash, amount
        );
    }
}

contract BatchExecutorTest {
    AgentRegistry private registry;
    IntentManager private manager;
    BatchExecutor private executor;
    MockERC20 private token;
    BatchAgentSubmitter private agent;

    address private constant RECIPIENT_ONE = address(0x1111);
    address private constant RECIPIENT_TWO = address(0x2222);

    function setUp() public {
        registry = new AgentRegistry();
        manager = new IntentManager(registry);
        executor = new BatchExecutor(manager);
        token = new MockERC20("Mock USDC", "mUSDC", 6);
        agent = new BatchAgentSubmitter();

        manager.setCoordinator(address(executor));
    }

    function testBatchExecutesMultipleTransferIntents() public {
        setUp();

        bytes32 agentId = _registerAgent();
        bytes32 intentOne = keccak256("intent-1");
        bytes32 intentTwo = keccak256("intent-2");

        agent.submit(manager, intentOne, agentId, keccak256("payload-1"), 100);
        agent.submit(manager, intentTwo, agentId, keccak256("payload-2"), 200);

        token.mint(address(executor), 300);

        BatchExecutor.ExecutionCall[] memory calls = new BatchExecutor.ExecutionCall[](2);
        calls[0] = BatchExecutor.ExecutionCall({
            intentId: intentOne,
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT_ONE, 100)
        });
        calls[1] = BatchExecutor.ExecutionCall({
            intentId: intentTwo,
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT_TWO, 200)
        });

        (uint256 successCount, uint256 failureCount) =
            executor.executeBatch(keccak256("batch-1"), calls);

        require(successCount == 2, "success count mismatch");
        require(failureCount == 0, "failure count mismatch");
        require(token.balanceOf(RECIPIENT_ONE) == 100, "recipient one balance mismatch");
        require(token.balanceOf(RECIPIENT_TWO) == 200, "recipient two balance mismatch");
        require(
            manager.getIntentStatus(intentOne) == IntentManager.IntentStatus.Executed,
            "intent one not executed"
        );
        require(
            manager.getIntentStatus(intentTwo) == IntentManager.IntentStatus.Executed,
            "intent two not executed"
        );
    }

    function testBatchRecordsFailedCallWithoutRevertingWholeBatch() public {
        setUp();

        bytes32 agentId = _registerAgent();
        bytes32 intentOne = keccak256("intent-1");
        bytes32 intentTwo = keccak256("intent-2");

        agent.submit(manager, intentOne, agentId, keccak256("payload-1"), 100);
        agent.submit(manager, intentTwo, agentId, keccak256("payload-2"), 200);

        token.mint(address(executor), 100);

        BatchExecutor.ExecutionCall[] memory calls = new BatchExecutor.ExecutionCall[](2);
        calls[0] = BatchExecutor.ExecutionCall({
            intentId: intentOne,
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT_ONE, 100)
        });
        calls[1] = BatchExecutor.ExecutionCall({
            intentId: intentTwo,
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT_TWO, 200)
        });

        (uint256 successCount, uint256 failureCount) =
            executor.executeBatch(keccak256("batch-1"), calls);

        require(successCount == 1, "success count mismatch");
        require(failureCount == 1, "failure count mismatch");
        require(
            manager.getIntentStatus(intentOne) == IntentManager.IntentStatus.Executed,
            "intent one not executed"
        );
        require(
            manager.getIntentStatus(intentTwo) == IntentManager.IntentStatus.Failed,
            "intent two not failed"
        );
    }

    function _registerAgent() private returns (bytes32) {
        AgentRegistry.AgentPolicy memory policy = AgentRegistry.AgentPolicy({
            allowTransfer: true,
            allowSwap: false,
            allowRebalance: false,
            allowScheduled: false,
            maxAmountPerTx: 1_000,
            dailyLimit: 10_000
        });

        return registry.registerAgent(address(agent), address(0xB0B), policy, "");
    }
}
