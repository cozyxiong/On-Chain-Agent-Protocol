// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SignedIntentEscrow } from "../contracts/settlement/SignedIntentEscrow.sol";

contract DeploySignedIntentEscrow {
    event SignedIntentEscrowDeployed(address indexed escrow, uint256 chainId);

    function run() external returns (address escrow) {
        VmLike vm = VmLike(address(uint160(uint256(keccak256("hevm cheat code")))));
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        SignedIntentEscrow signedIntentEscrow = new SignedIntentEscrow();
        vm.stopBroadcast();

        escrow = address(signedIntentEscrow);
        emit SignedIntentEscrowDeployed(escrow, block.chainid);
    }
}

interface VmLike {
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}
