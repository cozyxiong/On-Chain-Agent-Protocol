// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentSmartAccount } from "../contracts/account/AgentSmartAccount.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

interface Vm {
    function pauseGasMetering() external;
    function resumeGasMetering() external;
}

contract AgentGasBenchmarkActor {
    function execute(
        AgentSmartAccount account,
        address target,
        uint256 value,
        bytes calldata data
    ) external returns (bytes memory) {
        return account.executeAgentCall(target, value, data);
    }

    function executeBatch(AgentSmartAccount account, AgentSmartAccount.Call[] calldata calls)
        external
        returns (bytes[] memory)
    {
        return account.executeBatchAgentCalls(calls);
    }
}

contract AgentGasBenchmarkTest {
    uint256 private constant INTENT_COUNT = 5;
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    AgentSmartAccount private account;
    AgentGasBenchmarkActor private agent;
    MockERC20 private token;

    address private constant ENTRY_POINT = address(0xEeeeeE);
    address private constant RECIPIENT = address(0xBEEF);

    function setUp() public {
        account = new AgentSmartAccount(ENTRY_POINT);
        account.initialize(address(this));
        agent = new AgentGasBenchmarkActor();
        token = new MockERC20("Benchmark USDC", "bUSDC", 6);
        token.mint(address(account), 1_000_000);
        account.authorizeAgent(address(agent), address(token), 0, uint48(block.timestamp + 1 days));
    }

    function testBenchmarkNonBatchedAgentTransfers() public {
        vm.resumeGasMetering();
        for (uint256 i = 0; i < INTENT_COUNT; i++) {
            agent.execute(
                account,
                address(token),
                0,
                abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT, 10)
            );
        }
        vm.pauseGasMetering();

        require(token.balanceOf(RECIPIENT) == INTENT_COUNT * 10, "non-batched transfer failed");
    }

    function testBenchmarkBatchedAgentTransfers() public {
        vm.pauseGasMetering();
        AgentSmartAccount.Call[] memory calls = new AgentSmartAccount.Call[](INTENT_COUNT);
        for (uint256 i = 0; i < INTENT_COUNT; i++) {
            calls[i] = AgentSmartAccount.Call({
                target: address(token),
                value: 0,
                data: abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT, 10)
            });
        }

        vm.resumeGasMetering();
        agent.executeBatch(account, calls);
        vm.pauseGasMetering();

        require(token.balanceOf(RECIPIENT) == INTENT_COUNT * 10, "batched transfer failed");
    }
}
