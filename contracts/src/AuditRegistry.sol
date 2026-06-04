// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title AuditRegistry — on-chain anchor for Frost session audit commitments.
/// @notice Stores a one-time Merkle root per session (contract-architecture.md §10.8,
///         Threat Model T-17). The full audit trail lives off-chain; this contract
///         holds only the 32-byte root + metadata, so any post-hoc edit to the log
///         produces a root that no longer matches what was committed — the log is
///         tamper-evident without being stored on-chain.
///
///         MVP commitment service: free (only gas; no x402 settlement, no provider).
///         The §10.8 "settle the root through a paid ProviderRegistry endpoint" path is
///         the future, charged version — it is intentionally NOT required here, so the
///         closing-shot anchor does not depend on the still-placeholder Venice provider
///         addresses or the x402 settlement loop.
///
///         Two entry points:
///         - commit(): committer == msg.sender. The Frost session key submits directly.
///         - commitWithSig(): the user's wallet co-signs an EIP-712 AuditCommit and any
///           relayer submits; the committer is recovered from the signature. The typed
///           data matches web/app/connect/commit (the wallet-bridge co-sign page):
///           domain {name:"Frost", version:"0.1.0", chainId} (no verifyingContract) and
///           AuditCommit(bytes32 sessionId,bytes32 auditRoot,uint64 sessionEnd).
contract AuditRegistry {
    struct Commitment {
        bytes32 merkleRoot;
        address committer;
        uint64 sessionEnd;
        uint64 committedAt;
    }

    /// @notice One commitment per session id. `committedAt == 0` means "not yet committed".
    mapping(bytes32 sessionId => Commitment) public commitments;

    // EIP-712 — matches the wallet-bridge co-sign page's domain (no verifyingContract).
    bytes32 internal constant _EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 internal constant _AUDIT_COMMIT_TYPEHASH =
        keccak256("AuditCommit(bytes32 sessionId,bytes32 auditRoot,uint64 sessionEnd)");
    bytes32 internal constant _NAME_HASH = keccak256(bytes("Frost"));
    bytes32 internal constant _VERSION_HASH = keccak256(bytes("0.1.0"));

    error AlreadyCommitted(bytes32 sessionId);
    error ZeroRoot();
    error ZeroSession();
    error InvalidSignature();

    event AuditCommitted(
        bytes32 indexed sessionId,
        bytes32 indexed merkleRoot,
        address indexed committer,
        uint64 sessionEnd,
        uint64 committedAt
    );

    /// @notice Anchor a session's Merkle root; the caller is recorded as committer.
    function commit(bytes32 sessionId, bytes32 merkleRoot, uint64 sessionEnd) external {
        _record(sessionId, merkleRoot, msg.sender, sessionEnd);
    }

    /// @notice Anchor a root co-signed by the session owner. Any relayer may submit;
    ///         the committer is the EIP-712 signer. Lets the user's MetaMask (via the
    ///         wallet bridge) authorize the commitment while a session key pays gas.
    function commitWithSig(
        bytes32 sessionId,
        bytes32 merkleRoot,
        uint64 sessionEnd,
        bytes calldata signature
    ) external {
        bytes32 digest = _hashAuditCommit(sessionId, merkleRoot, sessionEnd);
        address signer = _recover(digest, signature);
        if (signer == address(0)) revert InvalidSignature();
        _record(sessionId, merkleRoot, signer, sessionEnd);
    }

    /// @notice Convenience view: has this session been committed?
    function isCommitted(bytes32 sessionId) external view returns (bool) {
        return commitments[sessionId].committedAt != 0;
    }

    function _record(bytes32 sessionId, bytes32 merkleRoot, address committer, uint64 sessionEnd) internal {
        if (sessionId == bytes32(0)) revert ZeroSession();
        if (merkleRoot == bytes32(0)) revert ZeroRoot();
        if (commitments[sessionId].committedAt != 0) revert AlreadyCommitted(sessionId);

        uint64 ts = uint64(block.timestamp);
        commitments[sessionId] =
            Commitment({merkleRoot: merkleRoot, committer: committer, sessionEnd: sessionEnd, committedAt: ts});
        emit AuditCommitted(sessionId, merkleRoot, committer, sessionEnd, ts);
    }

    // ---------------------------------------------------------------------
    // EIP-712
    // ---------------------------------------------------------------------

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(_EIP712_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid));
    }

    function _hashAuditCommit(bytes32 sessionId, bytes32 auditRoot, uint64 sessionEnd)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(_AUDIT_COMMIT_TYPEHASH, sessionId, auditRoot, sessionEnd));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @dev ECDSA recover with low-s malleability check and v normalization. Mirrors
    ///      Settlement._recover so signature handling is identical across the system.
    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 0x20))
            v := byte(0, calldataload(add(sig.offset, 0x40)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
