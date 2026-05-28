// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Settlement, IERC20} from "../src/Settlement.sol";
import {IMandate} from "../src/interfaces/IMandate.sol";
import {MockMandate} from "./mocks/MockMandate.sol";
import {MockRevocation} from "./mocks/MockRevocation.sol";
import {MockProviderRegistry} from "./mocks/MockProviderRegistry.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @title Settlement tests against mocked dependencies.
/// @notice Targets contract-architecture.md invariants:
///         I-04 (revocation grace), I-05 (nonce uniqueness),
///         I-09 (provider whitelist), I-12 (global nonce set / cross-provider replay).
contract SettlementTest is Test {
    MockUSDC internal usdc;
    MockMandate internal mandateMock;
    MockRevocation internal revocationMock;
    MockProviderRegistry internal registryMock;
    Settlement internal settlement;

    uint256 internal holderPk = uint256(keccak256("frost.settlement.test.holder"));
    address internal holder;
    address internal provider = address(0xBABE);
    address internal providerB = address(0xC0DE);
    bytes32 internal constant MANDATE_ID = bytes32(uint256(0x1234));

    function setUp() public {
        usdc = new MockUSDC();
        mandateMock = new MockMandate();
        revocationMock = new MockRevocation();
        registryMock = new MockProviderRegistry();
        settlement = new Settlement(IERC20(address(usdc)), mandateMock, revocationMock, registryMock);

        holder = vm.addr(holderPk);

        mandateMock.setMandate(MANDATE_ID, address(this), holder, false, 0);
        mandateMock.setNextReason(IMandate.InvalidReason.OK);
        registryMock.setApproved(provider, true);
        registryMock.setApproved(providerB, true);
        usdc.mint(holder, 1_000_000_000); // 1000 USDC
    }

    // ------------------------------------------------------------------
    // Signature helpers
    // ------------------------------------------------------------------

    function _signAuth(uint256 pk, address prov, uint256 amount, bytes32 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 typeHash = keccak256(
            "PaymentAuthorization(bytes32 mandateId,address provider,uint256 amount,bytes32 paymentNonce)"
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, MANDATE_ID, prov, amount, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", settlement.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------
    // Happy path
    // ------------------------------------------------------------------

    function test_Settle_HappyPath_TransfersAndMarksNonce() public {
        bytes32 nonce = keccak256("nonce-1");
        bytes memory sig = _signAuth(holderPk, provider, 1_000_000, nonce);

        vm.expectEmit(true, true, false, true, address(settlement));
        emit Settlement.SettlementCompleted(MANDATE_ID, provider, 1_000_000, nonce, block.number);

        settlement.settle(MANDATE_ID, provider, 1_000_000, nonce, sig);

        assertTrue(settlement.spentNonces(nonce));
        assertEq(usdc.balanceOf(holder), 999_000_000);
        assertEq(usdc.balanceOf(provider), 1_000_000);
        assertEq(mandateMock.validateCallCount(), 1);
    }

    // ------------------------------------------------------------------
    // I-05: nonce replay
    // ------------------------------------------------------------------

    function test_I05_NonceReplay_Rejected() public {
        bytes32 nonce = keccak256("nonce-replay");
        bytes memory sig = _signAuth(holderPk, provider, 100, nonce);

        settlement.settle(MANDATE_ID, provider, 100, nonce, sig);

        vm.expectRevert(abi.encodeWithSelector(Settlement.NonceAlreadySpent.selector, nonce));
        settlement.settle(MANDATE_ID, provider, 100, nonce, sig);
    }

    // ------------------------------------------------------------------
    // I-12: cross-provider replay (§6.4 — the signed digest binds provider)
    // ------------------------------------------------------------------

    function test_I12_SignatureBoundToProvider_RejectsCrossProviderReplay() public {
        bytes32 nonce = keccak256("nonce-providerA");
        bytes memory sig = _signAuth(holderPk, provider, 100, nonce);

        // Same signature, different provider. Should fail signature check.
        vm.expectRevert(Settlement.InvalidSignature.selector);
        settlement.settle(MANDATE_ID, providerB, 100, nonce, sig);
    }

    // ------------------------------------------------------------------
    // I-09: provider whitelist
    // ------------------------------------------------------------------

    function test_I09_RegistryRejection() public {
        address rogue = address(0xDEAD);
        bytes32 nonce = keccak256("nonce-rogue");
        bytes memory sig = _signAuth(holderPk, rogue, 100, nonce);

        vm.expectRevert(abi.encodeWithSelector(Settlement.ProviderNotApproved.selector, rogue));
        settlement.settle(MANDATE_ID, rogue, 100, nonce, sig);
    }

    // ------------------------------------------------------------------
    // I-04: revocation grace window
    // ------------------------------------------------------------------

    function test_I04_RevokedInsideGrace_StillSettles() public {
        // Revoke at current block. Settle on the same block — well inside grace.
        revocationMock.setRevoked(MANDATE_ID, uint64(block.number));

        bytes32 nonce = keccak256("nonce-grace");
        bytes memory sig = _signAuth(holderPk, provider, 50, nonce);
        settlement.settle(MANDATE_ID, provider, 50, nonce, sig);

        assertEq(usdc.balanceOf(provider), 50);
    }

    function test_I04_RevokedPastGrace_Rejected() public {
        uint64 revokedAt = uint64(block.number);
        revocationMock.setRevoked(MANDATE_ID, revokedAt);

        // Roll past the grace window (REVOCATION_LATENCY_BLOCKS = 30).
        vm.roll(block.number + 31);

        bytes32 nonce = keccak256("nonce-past-grace");
        bytes memory sig = _signAuth(holderPk, provider, 50, nonce);

        vm.expectRevert(
            abi.encodeWithSelector(Settlement.MandateRevokedPastGrace.selector, revokedAt, block.number)
        );
        settlement.settle(MANDATE_ID, provider, 50, nonce, sig);
    }

    function test_I04_AncestorRevokedPastGrace_Rejected() public {
        // Even if the leaf is fine, an ancestor revocation past grace must reject.
        uint64 revokedAt = uint64(block.number);
        revocationMock.setAncestorRevoked(MANDATE_ID, revokedAt);
        vm.roll(block.number + 31);

        bytes32 nonce = keccak256("nonce-ancestor");
        bytes memory sig = _signAuth(holderPk, provider, 50, nonce);
        vm.expectRevert(
            abi.encodeWithSelector(Settlement.MandateRevokedPastGrace.selector, revokedAt, block.number)
        );
        settlement.settle(MANDATE_ID, provider, 50, nonce, sig);
    }

    // ------------------------------------------------------------------
    // Mandate-side rejection bubbles up with the right reason code
    // ------------------------------------------------------------------

    function test_MandateRejection_BubblesReason() public {
        mandateMock.setNextReason(IMandate.InvalidReason.SpendCapTotalExceeded);

        bytes32 nonce = keccak256("nonce-cap");
        bytes memory sig = _signAuth(holderPk, provider, 100, nonce);

        vm.expectRevert(
            abi.encodeWithSelector(
                Settlement.MandateAuthorizationFailed.selector,
                IMandate.InvalidReason.SpendCapTotalExceeded
            )
        );
        settlement.settle(MANDATE_ID, provider, 100, nonce, sig);
    }

    // ------------------------------------------------------------------
    // USDC transfer failure → revert; nonce NOT marked spent
    // ------------------------------------------------------------------

    function test_TransferFailure_RevertsAndNonceNotMarked() public {
        usdc.setFailNextTransfer(true);

        bytes32 nonce = keccak256("nonce-transferfail");
        bytes memory sig = _signAuth(holderPk, provider, 100, nonce);

        vm.expectRevert(Settlement.UsdcTransferFailed.selector);
        settlement.settle(MANDATE_ID, provider, 100, nonce, sig);

        assertFalse(settlement.spentNonces(nonce));
    }

    // ------------------------------------------------------------------
    // Signature rejection paths
    // ------------------------------------------------------------------

    function test_WrongSigner_Rejected() public {
        uint256 wrongPk = uint256(keccak256("not-the-holder"));
        bytes32 nonce = keccak256("nonce-wrong-signer");
        bytes memory sig = _signAuth(wrongPk, provider, 100, nonce);

        vm.expectRevert(Settlement.InvalidSignature.selector);
        settlement.settle(MANDATE_ID, provider, 100, nonce, sig);
    }

    function test_BadSigLength_Rejected() public {
        bytes32 nonce = keccak256("nonce-badlen");
        bytes memory sig = hex"deadbeef";
        vm.expectRevert(Settlement.InvalidSignature.selector);
        settlement.settle(MANDATE_ID, provider, 100, nonce, sig);
    }

    function test_ZeroAmount_Rejected() public {
        bytes32 nonce = keccak256("nonce-zero");
        bytes memory sig = _signAuth(holderPk, provider, 0, nonce);
        vm.expectRevert(Settlement.ZeroAmount.selector);
        settlement.settle(MANDATE_ID, provider, 0, nonce, sig);
    }

    function test_UnknownMandate_Rejected() public {
        bytes32 unknown = bytes32(uint256(0xDEADBEEF));
        bytes32 nonce = keccak256("nonce-unknown");
        // Need a digest computed against `unknown`, not MANDATE_ID. Build the
        // signature first; expectRevert must be the cheat call immediately
        // preceding the call under test (it does not survive intervening
        // external calls like domainSeparator()).
        bytes32 typeHash = keccak256(
            "PaymentAuthorization(bytes32 mandateId,address provider,uint256 amount,bytes32 paymentNonce)"
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, unknown, provider, uint256(100), nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", settlement.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(abi.encodeWithSelector(Settlement.MandateUnknown.selector, unknown));
        settlement.settle(unknown, provider, 100, nonce, sig);
    }

    // ------------------------------------------------------------------
    // Pre-flight helper
    // ------------------------------------------------------------------

    function test_GetRevocationStatus_BeforeAndAfterGrace() public {
        (bool revoked, uint64 atBlock) = settlement.getRevocationStatus(MANDATE_ID);
        assertFalse(revoked);
        assertEq(uint256(atBlock), 0);

        revocationMock.setRevoked(MANDATE_ID, uint64(block.number));
        (revoked, atBlock) = settlement.getRevocationStatus(MANDATE_ID);
        assertFalse(revoked, "inside grace");

        vm.roll(block.number + 31);
        (revoked,) = settlement.getRevocationStatus(MANDATE_ID);
        assertTrue(revoked, "past grace");
    }
}
