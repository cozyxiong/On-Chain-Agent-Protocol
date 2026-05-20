// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../contracts/registry/AgentRegistry.sol";
import { AgentSmartAccountFactory } from "../contracts/account/AgentSmartAccountFactory.sol";

contract SmokeSepolia {
    event SmokeCompleted(bytes32 indexed agentId, address indexed smartAccount, address indexed agent);

    function run() external returns (bytes32 agentId, address smartAccount) {
        VmLike vm = VmLike(address(uint160(uint256(keccak256("hevm cheat code")))));

        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY");
        address registryAddress = vm.envAddress("AGENT_REGISTRY_ADDRESS");
        address factoryAddress = vm.envAddress("SMART_ACCOUNT_FACTORY_ADDRESS");
        address agent = vm.envOr("SMOKE_AGENT_ADDRESS", vm.addr(ownerPrivateKey));
        bytes32 salt = vm.envOr("SMOKE_ACCOUNT_SALT", bytes32(uint256(1)));

        vm.startBroadcast(ownerPrivateKey);

        AgentSmartAccountFactory factory = AgentSmartAccountFactory(factoryAddress);
        smartAccount = address(factory.createAccount(vm.addr(ownerPrivateKey), salt));

        AgentRegistry registry = AgentRegistry(registryAddress);
        AgentRegistry.AgentPolicy memory policy = AgentRegistry.AgentPolicy({
            allowTransfer: true,
            allowSwap: true,
            allowRebalance: true,
            allowScheduled: true,
            maxAmountPerTx: 1 ether,
            dailyLimit: 10 ether
        });

        agentId = registry.registerAgent(agent, smartAccount, policy, "demo-agent");

        vm.stopBroadcast();

        emit SmokeCompleted(agentId, smartAccount, agent);
    }
}

interface VmLike {
    function envUint(string calldata key) external returns (uint256);
    function envAddress(string calldata key) external returns (address);
    function envOr(string calldata key, address defaultValue) external returns (address);
    function envOr(string calldata key, bytes32 defaultValue) external returns (bytes32);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}
