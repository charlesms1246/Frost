// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRevocation} from "../../src/interfaces/IRevocation.sol";

contract MockRevocation is IRevocation {
    mapping(bytes32 => uint64) public revoked;
    mapping(bytes32 => uint64) public ancestorRevoked;

    function setRevoked(bytes32 mandateId, uint64 atBlock) external {
        revoked[mandateId] = atBlock;
    }

    function setAncestorRevoked(bytes32 mandateId, uint64 atBlock) external {
        ancestorRevoked[mandateId] = atBlock;
    }

    function revokedAtBlock(bytes32 mandateId) external view override returns (uint64) {
        return revoked[mandateId];
    }

    function isRevoked(bytes32 mandateId) external view override returns (bool) {
        return revoked[mandateId] != 0;
    }

    function isAncestorRevoked(bytes32 mandateId) external view override returns (bool) {
        return ancestorRevoked[mandateId] != 0 || revoked[mandateId] != 0;
    }

    function nearestRevokedAtBlock(bytes32 mandateId) external view override returns (uint64) {
        uint64 self = revoked[mandateId];
        uint64 anc = ancestorRevoked[mandateId];
        if (self == 0) return anc;
        if (anc == 0) return self;
        return self < anc ? self : anc;
    }
}
