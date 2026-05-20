// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SignedIntentEscrow } from "../contracts/settlement/SignedIntentEscrow.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
}

contract SignedIntentEscrowRecipient {
    event Received(address sender, uint256 value);

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }
}

contract SignedIntentEscrowTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    SignedIntentEscrow internal escrow;
    SignedIntentEscrowRecipient internal recipient;

    uint256 internal ownerKey = 0xA11CE;
    address internal owner;
    address internal relayer = address(0xB0B);

    function setUp() public {
        escrow = new SignedIntentEscrow();
        recipient = new SignedIntentEscrowRecipient();
        owner = vm.addr(ownerKey);
        vm.deal(owner, 10 ether);
    }

    function testExecutesSignedCallAfterRunAt() public {
        vm.prank(owner);
        escrow.depositFor{ value: 1 ether }(owner);

        SignedIntentEscrow.SignedCall memory call_ = _call(block.timestamp + 10, bytes32("n1"));
        bytes memory signature = _sign(call_);

        vm.warp(block.timestamp + 10);
        vm.prank(relayer);
        escrow.executeSignedCall(call_, "", signature);

        assert(address(recipient).balance == 0.1 ether);
        assert(escrow.balances(owner) == 0.9 ether);
    }

    function testRejectsEarlyExecution() public {
        vm.prank(owner);
        escrow.depositFor{ value: 1 ether }(owner);

        SignedIntentEscrow.SignedCall memory call_ = _call(block.timestamp + 10, bytes32("n2"));
        bytes memory signature = _sign(call_);

        vm.expectRevert(SignedIntentEscrow.NotDue.selector);
        escrow.executeSignedCall(call_, "", signature);
    }

    function testRejectsReplay() public {
        vm.prank(owner);
        escrow.depositFor{ value: 1 ether }(owner);

        SignedIntentEscrow.SignedCall memory call_ = _call(block.timestamp, bytes32("n3"));
        bytes memory signature = _sign(call_);

        escrow.executeSignedCall(call_, "", signature);

        vm.expectRevert(SignedIntentEscrow.NonceAlreadyUsed.selector);
        escrow.executeSignedCall(call_, "", signature);
    }

    function testExecutesBatchSignedCalls() public {
        vm.prank(owner);
        escrow.depositFor{ value: 1 ether }(owner);

        SignedIntentEscrow.SignedCall[] memory calls = new SignedIntentEscrow.SignedCall[](2);
        bytes[] memory data = new bytes[](2);
        bytes[] memory signatures = new bytes[](2);

        calls[0] = _call(block.timestamp, bytes32("b1"));
        calls[1] = _call(block.timestamp, bytes32("b2"));
        data[0] = "";
        data[1] = "";
        signatures[0] = _sign(calls[0]);
        signatures[1] = _sign(calls[1]);

        escrow.executeBatchSignedCalls(calls, data, signatures);

        assert(address(recipient).balance == 0.2 ether);
        assert(escrow.balances(owner) == 0.8 ether);
    }

    function _call(uint256 runAt, bytes32 nonce)
        internal
        view
        returns (SignedIntentEscrow.SignedCall memory)
    {
        return SignedIntentEscrow.SignedCall({
            owner: owner,
            target: address(recipient),
            value: 0.1 ether,
            dataHash: keccak256(""),
            runAt: runAt,
            deadline: runAt + 1 hours,
            nonce: nonce
        });
    }

    function _sign(SignedIntentEscrow.SignedCall memory call_) internal returns (bytes memory) {
        bytes32 digest = escrow.digestFor(call_);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
