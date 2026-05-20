// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentSmartAccount } from "../contracts/account/AgentSmartAccount.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";

contract AgentAuthorizationActor {
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

contract AgentAuthorizationTest {
    AgentSmartAccount private account;
    AgentAuthorizationActor private agent;
    MockERC20 private token;

    address private constant ENTRY_POINT = address(0xEeeeeE);
    address private constant RECIPIENT = address(0xBEEF);

    function setUp() public {
        account = new AgentSmartAccount(ENTRY_POINT);
        account.initialize(address(this));
        agent = new AgentAuthorizationActor();
        token = new MockERC20("Mock USDC", "mUSDC", 6);
        token.mint(address(account), 1_000);
    }

    function testAuthorizedAgentCanExecuteAllowedTarget() public {
        setUp();

        account.authorizeAgent(address(agent), address(token), 0, uint48(block.timestamp + 1 days));

        agent.execute(
            account,
            address(token),
            0,
            abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT, 100)
        );

        require(token.balanceOf(RECIPIENT) == 100, "recipient did not receive tokens");
    }

    function testUnauthorizedAgentCannotExecute() public {
        setUp();

        bool reverted;
        try agent.execute(
            account,
            address(token),
            0,
            abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT, 100)
        ) {} catch {
            reverted = true;
        }

        require(reverted, "unauthorized agent executed");
    }

    function testAuthorizedAgentCannotCallDifferentTarget() public {
        setUp();

        account.authorizeAgent(address(agent), address(token), 0, uint48(block.timestamp + 1 days));

        bool reverted;
        try agent.execute(account, address(0xCAFE), 0, "") {} catch {
            reverted = true;
        }

        require(reverted, "agent called disallowed target");
    }

    function testRevokedAgentTargetCannotFallBackToAgentPermission() public {
        setUp();

        account.authorizeAgent(address(agent), address(token), 0, uint48(block.timestamp + 1 days));
        account.revokeAgentTarget(address(agent), address(token));

        bool reverted;
        try agent.execute(
            account,
            address(token),
            0,
            abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT, 100)
        ) {} catch {
            reverted = true;
        }

        require(reverted, "revoked target still executed");
    }

    function testRevokedAgentCannotExecute() public {
        setUp();

        account.authorizeAgent(address(agent), address(token), 0, uint48(block.timestamp + 1 days));
        account.revokeAgent(address(agent));

        bool reverted;
        try agent.execute(
            account,
            address(token),
            0,
            abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT, 100)
        ) {} catch {
            reverted = true;
        }

        require(reverted, "revoked agent executed");
    }

    function testAgentValueLimitIsEnforced() public {
        setUp();

        account.authorizeAgent(address(agent), RECIPIENT, 1, uint48(block.timestamp + 1 days));

        bool reverted;
        try agent.execute(account, RECIPIENT, 2, "") {} catch {
            reverted = true;
        }

        require(reverted, "agent exceeded value limit");
    }

    function testAuthorizedAgentCanExecuteBatchCalls() public {
        setUp();

        account.authorizeAgent(address(agent), address(token), 0, uint48(block.timestamp + 1 days));

        AgentSmartAccount.Call[] memory calls = new AgentSmartAccount.Call[](2);
        calls[0] = AgentSmartAccount.Call({
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT, 100)
        });
        calls[1] = AgentSmartAccount.Call({
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT, 200)
        });

        agent.executeBatch(account, calls);

        require(token.balanceOf(RECIPIENT) == 300, "recipient did not receive batched tokens");
    }

    function testWildcardAgentCanExecuteMultipleTargetsWithinValueLimit() public {
        setUp();

        account.authorizeAgent(address(agent), address(0), 1 ether, uint48(block.timestamp + 1 days));

        AgentSmartAccount.Call[] memory calls = new AgentSmartAccount.Call[](2);
        calls[0] = AgentSmartAccount.Call({
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(MockERC20.transfer.selector, RECIPIENT, 100)
        });
        calls[1] = AgentSmartAccount.Call({
            target: address(0xCAFE),
            value: 0,
            data: ""
        });

        agent.executeBatch(account, calls);

        require(token.balanceOf(RECIPIENT) == 100, "recipient did not receive wildcard token transfer");
    }
}
