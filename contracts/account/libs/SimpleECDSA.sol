// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library SimpleECDSA {
    error InvalidSignatureLength();
    error InvalidSignatureS();
    error InvalidSignatureV();

    uint256 private constant SECP256K1N_DIV_2 =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function recover(bytes32 digest, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignatureLength();

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        if (uint256(s) > SECP256K1N_DIV_2) revert InvalidSignatureS();
        if (v != 27 && v != 28) revert InvalidSignatureV();

        return ecrecover(digest, v, r, s);
    }
}
