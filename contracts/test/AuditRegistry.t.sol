// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AuditRegistry} from "../src/AuditRegistry.sol";

/// @title AuditRegistry tests — §10.8 on-chain audit-root anchor.
/// @notice Covers the direct commit, the EIP-712 co-signed commit, single-commit
///         immutability, zero-value guards, and the recorded metadata + event.
contract AuditRegistryTest is Test {
    AuditRegistry internal reg;

    uint256 internal ownerPk = uint256(keccak256("frost.audit.test.owner"));
    address internal owner;

    bytes32 internal sessionId = keccak256("session-1");
    bytes32 internal root = keccak256("merkle-root-1");
    uint64 internal sessionEnd = 1_700_000_000;

    event AuditCommitted(
        bytes32 indexed sessionId,
        bytes32 indexed merkleRoot,
        address indexed committer,
        uint64 sessionEnd,
        uint64 committedAt
    );

    function setUp() public {
        reg = new AuditRegistry();
        owner = vm.addr(ownerPk);
    }

    function _signCommit(uint256 pk, bytes32 sid, bytes32 r, uint64 end) internal view returns (bytes memory) {
        bytes32 typeHash = keccak256("AuditCommit(bytes32 sessionId,bytes32 auditRoot,uint64 sessionEnd)");
        bytes32 structHash = keccak256(abi.encode(typeHash, sid, r, end));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", reg.domainSeparator(), structHash));
        (uint8 v, bytes32 sr, bytes32 ss) = vm.sign(pk, digest);
        return abi.encodePacked(sr, ss, v);
    }

    // ------------------------------------------------------------------
    // Direct commit
    // ------------------------------------------------------------------

    function test_Commit_StoresAndEmits() public {
        vm.expectEmit(true, true, true, true, address(reg));
        emit AuditCommitted(sessionId, root, address(this), sessionEnd, uint64(block.timestamp));
        reg.commit(sessionId, root, sessionEnd);

        (bytes32 mr, address committer, uint64 end, uint64 at) = reg.commitments(sessionId);
        assertEq(mr, root);
        assertEq(committer, address(this));
        assertEq(end, sessionEnd);
        assertEq(at, uint64(block.timestamp));
        assertTrue(reg.isCommitted(sessionId));
    }

    function test_Commit_Twice_Reverts() public {
        reg.commit(sessionId, root, sessionEnd);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.AlreadyCommitted.selector, sessionId));
        reg.commit(sessionId, keccak256("different-root"), sessionEnd);
    }

    function test_Commit_ZeroRoot_Reverts() public {
        vm.expectRevert(AuditRegistry.ZeroRoot.selector);
        reg.commit(sessionId, bytes32(0), sessionEnd);
    }

    function test_Commit_ZeroSession_Reverts() public {
        vm.expectRevert(AuditRegistry.ZeroSession.selector);
        reg.commit(bytes32(0), root, sessionEnd);
    }

    function test_NotCommitted_DefaultsFalse() public view {
        assertFalse(reg.isCommitted(keccak256("never")));
    }

    // ------------------------------------------------------------------
    // Co-signed commit (EIP-712)
    // ------------------------------------------------------------------

    function test_CommitWithSig_RecordsSignerAsCommitter() public {
        bytes memory sig = _signCommit(ownerPk, sessionId, root, sessionEnd);

        vm.expectEmit(true, true, true, true, address(reg));
        emit AuditCommitted(sessionId, root, owner, sessionEnd, uint64(block.timestamp));
        // A different account relays the tx; committer must be the signer, not the sender.
        vm.prank(address(0xBEEF));
        reg.commitWithSig(sessionId, root, sessionEnd, sig);

        (, address committer,,) = reg.commitments(sessionId);
        assertEq(committer, owner);
    }

    function test_CommitWithSig_TamperedRoot_RecoversDifferentSigner() public {
        // A signature over `root` does not authorize a different root: the recovered
        // signer differs from the owner (it is some other address, never reverts here
        // because any valid-shape sig recovers *some* address) — so the commitment is
        // attributed to that wrong address, not the owner. Assert it is NOT the owner.
        bytes memory sig = _signCommit(ownerPk, sessionId, root, sessionEnd);
        reg.commitWithSig(sessionId, keccak256("tampered"), sessionEnd, sig);
        (, address committer,,) = reg.commitments(sessionId);
        assertTrue(committer != owner);
    }

    function test_CommitWithSig_BadSignatureLength_Reverts() public {
        vm.expectRevert(AuditRegistry.InvalidSignature.selector);
        reg.commitWithSig(sessionId, root, sessionEnd, hex"1234");
    }

    function test_CommitWithSig_Twice_Reverts() public {
        bytes memory sig = _signCommit(ownerPk, sessionId, root, sessionEnd);
        reg.commitWithSig(sessionId, root, sessionEnd, sig);
        vm.expectRevert(abi.encodeWithSelector(AuditRegistry.AlreadyCommitted.selector, sessionId));
        reg.commitWithSig(sessionId, root, sessionEnd, sig);
    }
}
