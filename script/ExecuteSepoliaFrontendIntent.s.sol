// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../contracts/registry/AgentRegistry.sol";
import { IntentManager } from "../contracts/intents/IntentManager.sol";
import { BatchExecutor } from "../contracts/executor/BatchExecutor.sol";

contract ExecuteSepoliaFrontendIntent {
    address internal constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 internal constant PERMIT_AMOUNT = type(uint160).max;
    uint48 internal constant PERMIT_EXPIRATION = type(uint48).max;

    event FrontendIntentExecuted(string kind, bytes32 indexed primaryIntentId);

    function run() external {
        VmLike vm = VmLike(address(uint160(uint256(keccak256("hevm cheat code")))));

        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        bytes32 agentId = vm.envBytes32("SMOKE_AGENT_ID");
        address intentManagerAddress = vm.envAddress("INTENT_MANAGER_ADDRESS");
        address batchExecutorAddress = vm.envAddress("BATCH_EXECUTOR_ADDRESS");
        string memory kind = vm.envString("FRONTEND_INTENT_KIND");

        IntentManager intentManager = IntentManager(intentManagerAddress);
        BatchExecutor batchExecutor = BatchExecutor(payable(batchExecutorAddress));

        vm.startBroadcast(privateKey);

        if (_eq(kind, "transfer")) {
            _executeNative(
                vm,
                intentManager,
                batchExecutor,
                agentId,
                batchExecutorAddress,
                AgentRegistry.IntentType.Transfer,
                "frontend-transfer"
            );
        } else if (_eq(kind, "scheduled")) {
            _executeNative(
                vm,
                intentManager,
                batchExecutor,
                agentId,
                batchExecutorAddress,
                AgentRegistry.IntentType.Scheduled,
                "frontend-scheduled"
            );
        } else if (_eq(kind, "swap")) {
            _executeSwapLike(
                vm,
                intentManager,
                batchExecutor,
                agentId,
                batchExecutorAddress,
                AgentRegistry.IntentType.Swap,
                "frontend-swap"
            );
        } else if (_eq(kind, "rebalance")) {
            _executeSwapLike(
                vm,
                intentManager,
                batchExecutor,
                agentId,
                batchExecutorAddress,
                AgentRegistry.IntentType.Rebalance,
                "frontend-rebalance"
            );
        } else {
            revert("unsupported frontend intent kind");
        }

        vm.stopBroadcast();
    }

    function _executeNative(
        VmLike vm,
        IntentManager intentManager,
        BatchExecutor batchExecutor,
        bytes32 agentId,
        address batchExecutorAddress,
        AgentRegistry.IntentType intentType,
        string memory label
    ) private {
        address recipient = vm.envOr("SMOKE_RECIPIENT", vm.addr(vm.envUint("PRIVATE_KEY")));
        uint256 amount = vm.envOr("SMOKE_FRONTEND_NATIVE_AMOUNT_WEI", uint256(0.000005 ether));
        payable(batchExecutorAddress).transfer(amount);

        bytes32 intentId = keccak256(abi.encodePacked(label, block.timestamp, recipient, amount));
        intentManager.createIntent(intentId, agentId, intentType, keccak256(bytes(label)), amount);

        BatchExecutor.ExecutionCall[] memory calls = new BatchExecutor.ExecutionCall[](1);
        calls[0] = BatchExecutor.ExecutionCall({
            intentId: intentId,
            target: recipient,
            value: amount,
            data: ""
        });

        batchExecutor.executeBatch(keccak256(abi.encodePacked(label, "batch", intentId)), calls);
        emit FrontendIntentExecuted(label, intentId);
    }

    function _executeSwapLike(
        VmLike vm,
        IntentManager intentManager,
        BatchExecutor batchExecutor,
        bytes32 agentId,
        address batchExecutorAddress,
        AgentRegistry.IntentType intentType,
        string memory label
    ) private {
        address router = vm.envAddress("UNISWAP_SWAP_TARGET");
        bytes memory swapData = vm.envBytes("UNISWAP_SWAP_DATA");
        uint256 amount = vm.envOr("SMOKE_FRONTEND_SWAP_AMOUNT_WEI", uint256(0.000001 ether));

        payable(batchExecutorAddress).transfer(amount);

        bytes32 depositIntent = keccak256(abi.encodePacked(label, "deposit", block.timestamp));
        bytes32 tokenApproveIntent = keccak256(abi.encodePacked(label, "token-approve", block.timestamp));
        bytes32 permitApproveIntent = keccak256(abi.encodePacked(label, "permit-approve", block.timestamp));
        bytes32 swapIntent = keccak256(abi.encodePacked(label, "swap", block.timestamp));

        intentManager.createIntent(depositIntent, agentId, intentType, keccak256("deposit"), amount);
        intentManager.createIntent(tokenApproveIntent, agentId, intentType, keccak256("approve"), amount);
        intentManager.createIntent(permitApproveIntent, agentId, intentType, keccak256("permit2"), amount);
        intentManager.createIntent(swapIntent, agentId, intentType, keccak256(bytes(label)), amount);

        BatchExecutor.ExecutionCall[] memory calls = new BatchExecutor.ExecutionCall[](4);
        calls[0] = BatchExecutor.ExecutionCall({
            intentId: depositIntent,
            target: WETH,
            value: amount,
            data: abi.encodeWithSignature("deposit()")
        });
        calls[1] = BatchExecutor.ExecutionCall({
            intentId: tokenApproveIntent,
            target: WETH,
            value: 0,
            data: abi.encodeWithSelector(IERC20Like.approve.selector, PERMIT2, amount)
        });
        calls[2] = BatchExecutor.ExecutionCall({
            intentId: permitApproveIntent,
            target: PERMIT2,
            value: 0,
            data: abi.encodeWithSelector(IPermit2Like.approve.selector, WETH, router, PERMIT_AMOUNT, PERMIT_EXPIRATION)
        });
        calls[3] = BatchExecutor.ExecutionCall({
            intentId: swapIntent,
            target: router,
            value: 0,
            data: swapData
        });

        batchExecutor.executeBatch(keccak256(abi.encodePacked(label, "batch", swapIntent)), calls);
        emit FrontendIntentExecuted(label, swapIntent);
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPermit2Like {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface VmLike {
    function envUint(string calldata key) external returns (uint256);
    function envBytes32(string calldata key) external returns (bytes32);
    function envAddress(string calldata key) external returns (address);
    function envBytes(string calldata key) external returns (bytes memory);
    function envString(string calldata key) external returns (string memory);
    function envOr(string calldata key, address defaultValue) external returns (address);
    function envOr(string calldata key, uint256 defaultValue) external returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}
