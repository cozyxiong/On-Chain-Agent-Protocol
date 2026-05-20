// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../contracts/registry/AgentRegistry.sol";
import { IntentManager } from "../contracts/intents/IntentManager.sol";

contract AgentSubmitter {
    function submit(
        IntentManager manager,
        bytes32 intentId,
        bytes32 agentId,
        AgentRegistry.IntentType intentType,
        bytes32 payloadHash,
        uint256 amount
    ) external {
        manager.createIntent(intentId, agentId, intentType, payloadHash, amount);
    }
}

contract IntentManagerTest {
    AgentRegistry private registry;
    IntentManager private manager;
    AgentSubmitter private agent;

    function setUp() public {
        registry = new AgentRegistry();
        manager = new IntentManager(registry);
        agent = new AgentSubmitter();
    }

    function testRegisteredAgentCanCreateIntent() public {
        setUp();

        bytes32 agentId = _registerAgent(true, false);
        bytes32 intentId = keccak256("intent-1");

        agent.submit(
            manager,
            intentId,
            agentId,
            AgentRegistry.IntentType.Transfer,
            keccak256("payload"),
            10
        );

        IntentManager.IntentRecord memory record = manager.getIntent(intentId);

        require(record.agentId == agentId, "agent id mismatch");
        require(record.submitter == address(agent), "submitter mismatch");
        require(record.status == IntentManager.IntentStatus.Queued, "status mismatch");
    }

    function testDuplicateIntentIsRejected() public {
        setUp();

        bytes32 agentId = _registerAgent(true, false);
        bytes32 intentId = keccak256("intent-1");

        agent.submit(
            manager,
            intentId,
            agentId,
            AgentRegistry.IntentType.Transfer,
            keccak256("payload"),
            10
        );

        bool reverted;
        try agent.submit(
            manager,
            intentId,
            agentId,
            AgentRegistry.IntentType.Transfer,
            keccak256("payload"),
            10
        ) {} catch {
            reverted = true;
        }

        require(reverted, "duplicate intent accepted");
    }

    function testUnauthorizedAgentCannotCreateIntent() public {
        setUp();

        bytes32 agentId = _registerAgent(true, false);
        AgentSubmitter unknownAgent = new AgentSubmitter();

        bool reverted;
        try unknownAgent.submit(
            manager,
            keccak256("intent-1"),
            agentId,
            AgentRegistry.IntentType.Transfer,
            keccak256("payload"),
            10
        ) {} catch {
            reverted = true;
        }

        require(reverted, "unknown agent submitted intent");
    }

    function _registerAgent(bool allowTransfer, bool allowSwap) private returns (bytes32) {
        AgentRegistry.AgentPolicy memory policy = AgentRegistry.AgentPolicy({
            allowTransfer: allowTransfer,
            allowSwap: allowSwap,
            allowRebalance: false,
            allowScheduled: false,
            maxAmountPerTx: 100,
            dailyLimit: 1_000
        });

        return registry.registerAgent(address(agent), address(0xB0B), policy, "");
    }
}
