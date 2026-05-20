// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../contracts/registry/AgentRegistry.sol";
import { IntentManager } from "../contracts/intents/IntentManager.sol";
import { BatchExecutor } from "../contracts/executor/BatchExecutor.sol";

contract ExecuteSepoliaRebalanceOnly {
    address internal constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 internal constant PERMIT_AMOUNT = type(uint160).max;
    uint48 internal constant PERMIT_EXPIRATION = type(uint48).max;

    event RebalanceExecuted(bytes32 indexed swapIntentId, uint256 usdcBefore, uint256 usdcAfter);

    function run() external {
        VmLike vm = VmLike(address(uint160(uint256(keccak256("hevm cheat code")))));
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        bytes32 agentId = vm.envBytes32("SMOKE_AGENT_ID");
        address intentManagerAddress = vm.envAddress("INTENT_MANAGER_ADDRESS");
        address batchExecutorAddress = vm.envAddress("BATCH_EXECUTOR_ADDRESS");
        address router = vm.envAddress("UNISWAP_SWAP_TARGET");
        bytes memory swapData = vm.envBytes("UNISWAP_SWAP_DATA");
        uint256 amount = vm.envOr("SMOKE_SWAP_AMOUNT_WEI", uint256(0.000001 ether));

        IntentManager intentManager = IntentManager(intentManagerAddress);
        BatchExecutor batchExecutor = BatchExecutor(payable(batchExecutorAddress));

        vm.startBroadcast(privateKey);
        payable(batchExecutorAddress).transfer(amount);

        bytes32 depositIntent = keccak256(abi.encodePacked("rebalance-only-deposit", block.timestamp));
        bytes32 tokenApproveIntent =
            keccak256(abi.encodePacked("rebalance-only-token-approve", block.timestamp));
        bytes32 permitApproveIntent =
            keccak256(abi.encodePacked("rebalance-only-permit-approve", block.timestamp));
        bytes32 swapIntent = keccak256(abi.encodePacked("rebalance-only-swap", block.timestamp));

        intentManager.createIntent(
            depositIntent, agentId, AgentRegistry.IntentType.Rebalance, keccak256("deposit"), amount
        );
        intentManager.createIntent(
            tokenApproveIntent, agentId, AgentRegistry.IntentType.Rebalance, keccak256("approve"), amount
        );
        intentManager.createIntent(
            permitApproveIntent, agentId, AgentRegistry.IntentType.Rebalance, keccak256("permit2"), amount
        );
        intentManager.createIntent(
            swapIntent, agentId, AgentRegistry.IntentType.Rebalance, keccak256("rebalance"), amount
        );

        uint256 usdcBefore = IERC20Like(USDC).balanceOf(batchExecutorAddress);

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
            data: abi.encodeWithSelector(
                IPermit2Like.approve.selector, WETH, router, PERMIT_AMOUNT, PERMIT_EXPIRATION
            )
        });
        calls[3] = BatchExecutor.ExecutionCall({
            intentId: swapIntent,
            target: router,
            value: 0,
            data: swapData
        });

        batchExecutor.executeBatch(keccak256(abi.encodePacked("rebalance-only", block.timestamp)), calls);

        uint256 usdcAfter = IERC20Like(USDC).balanceOf(batchExecutorAddress);
        vm.stopBroadcast();

        emit RebalanceExecuted(swapIntent, usdcBefore, usdcAfter);
    }
}

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPermit2Like {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface VmLike {
    function envUint(string calldata key) external returns (uint256);
    function envBytes32(string calldata key) external returns (bytes32);
    function envAddress(string calldata key) external returns (address);
    function envBytes(string calldata key) external returns (bytes memory);
    function envOr(string calldata key, uint256 defaultValue) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}
