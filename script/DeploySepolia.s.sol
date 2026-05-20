// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../contracts/registry/AgentRegistry.sol";
import { IntentManager } from "../contracts/intents/IntentManager.sol";
import { BatchExecutor } from "../contracts/executor/BatchExecutor.sol";
import { AgentSmartAccountFactory } from "../contracts/account/AgentSmartAccountFactory.sol";
import { SignedIntentEscrow } from "../contracts/settlement/SignedIntentEscrow.sol";

contract DeploySepolia {
    address internal constant SEPOLIA_ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    struct Deployment {
        address registry;
        address intentManager;
        address batchExecutor;
        address smartAccountFactory;
        address signedIntentEscrow;
        address entryPoint;
        uint256 chainId;
    }

    event DeploymentCompleted(
        address indexed registry,
        address indexed intentManager,
        address indexed batchExecutor,
        address smartAccountFactory,
        address signedIntentEscrow,
        address entryPoint,
        uint256 chainId
    );

    function run() external returns (Deployment memory deployment) {
        VmLike vm = VmLike(address(uint160(uint256(keccak256("hevm cheat code")))));
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address entryPoint = vm.envOr("ENTRYPOINT_ADDRESS", SEPOLIA_ENTRY_POINT);

        vm.startBroadcast(deployerPrivateKey);

        AgentRegistry registry = new AgentRegistry();
        IntentManager intentManager = new IntentManager(registry);
        BatchExecutor batchExecutor = new BatchExecutor(intentManager);
        AgentSmartAccountFactory smartAccountFactory = new AgentSmartAccountFactory(entryPoint);
        SignedIntentEscrow signedIntentEscrow = new SignedIntentEscrow();

        intentManager.setCoordinator(address(batchExecutor));

        vm.stopBroadcast();

        deployment = Deployment({
            registry: address(registry),
            intentManager: address(intentManager),
            batchExecutor: address(batchExecutor),
            smartAccountFactory: address(smartAccountFactory),
            signedIntentEscrow: address(signedIntentEscrow),
            entryPoint: entryPoint,
            chainId: block.chainid
        });

        emit DeploymentCompleted(
            deployment.registry,
            deployment.intentManager,
            deployment.batchExecutor,
            deployment.smartAccountFactory,
            deployment.signedIntentEscrow,
            deployment.entryPoint,
            deployment.chainId
        );
    }
}

interface VmLike {
    function envUint(string calldata key) external returns (uint256);
    function envOr(string calldata key, address defaultValue) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}
