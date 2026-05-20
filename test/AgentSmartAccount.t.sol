// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../contracts/registry/AgentRegistry.sol";
import { IntentManager } from "../contracts/intents/IntentManager.sol";
import { BatchExecutor } from "../contracts/executor/BatchExecutor.sol";
import { MockERC20 } from "../contracts/mocks/MockERC20.sol";
import { MockEntryPoint } from "../contracts/mocks/MockEntryPoint.sol";
import { AgentSmartAccount } from "../contracts/account/AgentSmartAccount.sol";
import { AgentSmartAccountFactory } from "../contracts/account/AgentSmartAccountFactory.sol";
import { PackedUserOperation } from "../contracts/account/interfaces/PackedUserOperation.sol";

interface Vm {
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 privateKey) external returns (address);
}

contract ERC4337AgentSubmitter {
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

contract AgentSmartAccountTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant OWNER_KEY = 0xA11CE;

    AgentRegistry private registry;
    IntentManager private manager;
    BatchExecutor private executor;
    MockERC20 private token;
    MockEntryPoint private entryPoint;
    AgentSmartAccountFactory private factory;
    AgentSmartAccount private account;
    ERC4337AgentSubmitter private agent;

    function setUp() public {
        address owner = vm.addr(OWNER_KEY);

        entryPoint = new MockEntryPoint();
        factory = new AgentSmartAccountFactory(address(entryPoint));
        account = factory.createAccount(owner, keccak256("owner-account"));

        registry = new AgentRegistry();
        manager = new IntentManager(registry);
        executor = new BatchExecutor(manager);
        token = new MockERC20("Mock USDC", "mUSDC", 6);
        agent = new ERC4337AgentSubmitter();

        manager.setCoordinator(address(executor));
        executor.setCoordinator(address(account));
    }

    function testFactoryPredictsAndCreatesDeterministicAccount() public {
        MockEntryPoint localEntryPoint = new MockEntryPoint();
        AgentSmartAccountFactory localFactory =
            new AgentSmartAccountFactory(address(localEntryPoint));
        address owner = vm.addr(OWNER_KEY);
        bytes32 salt = keccak256("deterministic");

        address predicted = localFactory.getAddress(owner, salt);
        AgentSmartAccount created = localFactory.createAccount(owner, salt);
        AgentSmartAccount createdAgain = localFactory.createAccount(owner, salt);

        require(address(created) == predicted, "predicted address mismatch");
        require(address(createdAgain) == predicted, "repeat create mismatch");
        require(created.owner() == owner, "owner mismatch");
    }

    function testEntryPointExecutesBatchThroughSmartAccount() public {
        setUp();

        bytes32 agentId = _registerAgent(address(account));
        bytes32 intentId = keccak256("erc4337-intent");
        address recipient = address(0xCAFE);

        agent.submit(manager, intentId, agentId, keccak256("payload"), 100);
        token.mint(address(executor), 100);

        BatchExecutor.ExecutionCall[] memory calls = new BatchExecutor.ExecutionCall[](1);
        calls[0] = BatchExecutor.ExecutionCall({
            intentId: intentId,
            target: address(token),
            value: 0,
            data: abi.encodeWithSelector(MockERC20.transfer.selector, recipient, 100)
        });

        bytes memory batchData =
            abi.encodeWithSelector(BatchExecutor.executeBatch.selector, keccak256("batch"), calls);

        PackedUserOperation memory userOp = _signedUserOp(address(account), account.nonce());
        entryPoint.handleOp(userOp, address(executor), 0, batchData);

        require(token.balanceOf(recipient) == 100, "recipient balance mismatch");
        require(
            manager.getIntentStatus(intentId) == IntentManager.IntentStatus.Executed,
            "intent not executed"
        );
        require(account.nonce() == 1, "nonce not incremented");
    }

    function testInvalidSignatureDoesNotExecute() public {
        setUp();

        PackedUserOperation memory userOp = _signedUserOp(address(account), account.nonce());
        userOp.signature = hex"01";

        bool reverted;
        try entryPoint.handleOp(userOp, address(token), 0, "") {}
        catch {
            reverted = true;
        }

        require(reverted, "invalid signature accepted");
        require(account.nonce() == 0, "nonce changed");
    }

    function _registerAgent(address smartAccount) private returns (bytes32) {
        AgentRegistry.AgentPolicy memory policy = AgentRegistry.AgentPolicy({
            allowTransfer: true,
            allowSwap: false,
            allowRebalance: false,
            allowScheduled: false,
            maxAmountPerTx: 1_000,
            dailyLimit: 10_000
        });

        return registry.registerAgent(address(agent), smartAccount, policy, "");
    }

    function _signedUserOp(address sender, uint256 nonce)
        private
        returns (PackedUserOperation memory userOp)
    {
        userOp.sender = sender;
        userOp.nonce = nonce;
        userOp.initCode = "";
        userOp.callData = "";
        userOp.accountGasLimits = bytes32(0);
        userOp.preVerificationGas = 0;
        userOp.gasFees = bytes32(0);
        userOp.paymasterAndData = "";

        bytes32 userOpHash = account.getUserOpHash(userOp);
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);
        userOp.signature = abi.encodePacked(r, s, v);
    }
}
