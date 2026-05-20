// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentSmartAccountFactory } from "../contracts/account/AgentSmartAccountFactory.sol";

contract DeploySmartAccountFactory {
    address internal constant SEPOLIA_ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    event SmartAccountFactoryDeployed(address indexed factory, address indexed entryPoint, uint256 chainId);

    function run() external returns (address factory) {
        VmLike vm = VmLike(address(uint160(uint256(keccak256("hevm cheat code")))));
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address entryPoint = vm.envOr("ENTRYPOINT_ADDRESS", SEPOLIA_ENTRY_POINT);

        vm.startBroadcast(deployerPrivateKey);
        AgentSmartAccountFactory smartAccountFactory = new AgentSmartAccountFactory(entryPoint);
        vm.stopBroadcast();

        factory = address(smartAccountFactory);
        emit SmartAccountFactoryDeployed(factory, entryPoint, block.chainid);
    }
}

interface VmLike {
    function envUint(string calldata key) external returns (uint256);
    function envOr(string calldata key, address defaultValue) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}
