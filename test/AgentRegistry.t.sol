// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../contracts/registry/AgentRegistry.sol";

contract AgentRegistryTest {
    AgentRegistry private registry;

    address private constant AGENT = address(0xA11CE);
    address private constant SMART_ACCOUNT = address(0xB0B);

    function testRegisterAgentStoresOwnerAndPolicy() public {
        registry = new AgentRegistry();

        AgentRegistry.AgentPolicy memory policy = AgentRegistry.AgentPolicy({
            allowTransfer: true,
            allowSwap: false,
            allowRebalance: false,
            allowScheduled: true,
            maxAmountPerTx: 100 ether,
            dailyLimit: 1_000 ether
        });

        bytes32 agentId = registry.registerAgent(AGENT, SMART_ACCOUNT, policy, "ipfs://agent");

        AgentRegistry.Agent memory agent = registry.getAgent(agentId);
        AgentRegistry.AgentPolicy memory storedPolicy = registry.getPolicy(agentId);

        require(agent.owner == address(this), "owner mismatch");
        require(agent.agent == AGENT, "agent mismatch");
        require(agent.smartAccount == SMART_ACCOUNT, "smart account mismatch");
        require(agent.active, "agent inactive");
        require(storedPolicy.allowTransfer, "transfer disabled");
        require(storedPolicy.allowScheduled, "scheduled disabled");
        require(storedPolicy.maxAmountPerTx == 100 ether, "max amount mismatch");
    }

    function testDeactivateAgentBlocksExecution() public {
        registry = new AgentRegistry();

        AgentRegistry.AgentPolicy memory policy = AgentRegistry.AgentPolicy({
            allowTransfer: true,
            allowSwap: false,
            allowRebalance: false,
            allowScheduled: false,
            maxAmountPerTx: 100,
            dailyLimit: 1_000
        });

        bytes32 agentId = registry.registerAgent(AGENT, SMART_ACCOUNT, policy, "");
        registry.deactivateAgent(agentId);

        bool reverted;
        try registry.canExecute(agentId, AgentRegistry.IntentType.Transfer, 1) returns (bool) {}
        catch {
            reverted = true;
        }

        require(reverted, "inactive agent can execute");
    }

    function testPolicyRejectsDisallowedIntentType() public {
        registry = new AgentRegistry();

        AgentRegistry.AgentPolicy memory policy = AgentRegistry.AgentPolicy({
            allowTransfer: true,
            allowSwap: false,
            allowRebalance: false,
            allowScheduled: false,
            maxAmountPerTx: 100,
            dailyLimit: 1_000
        });

        bytes32 agentId = registry.registerAgent(AGENT, SMART_ACCOUNT, policy, "");

        bool reverted;
        try registry.canExecute(agentId, AgentRegistry.IntentType.Swap, 1) returns (bool) {}
        catch {
            reverted = true;
        }

        require(reverted, "disallowed swap accepted");
    }
}
