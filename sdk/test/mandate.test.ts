import { describe, it, expect, beforeEach } from "vitest";
import {
  anvilAccount,
  impersonate,
  walletForImpersonated,
  publicClient,
  walletFor,
  snapshot,
  revertTo,
} from "./fixtures.js";
import { FROST_BASE_SEPOLIA } from "../src/addresses.js";
import * as mandate from "../src/mandate.js";
import * as revocation from "../src/revocation.js";
import {
  spendCapTotal,
  spendCapPerCall,
  capabilityWhitelist,
  providerWhitelist,
  capRedelegate,
  CAPABILITY,
} from "../src/caveats/index.js";
import type { Hex } from "viem";

/**
 * End-to-end mandate flow on a forked Base Sepolia. Uses the deployed
 * Mandate contract; issues a root mandate, then a sub-mandate, then revokes.
 *
 * The deployer is the project's spike wallet (admin of the deployment),
 * but for the mandate-issuance path itself we use anvil's pre-funded
 * accounts — anyone can issue a root mandate to themselves.
 */
describe("mandate flow against forked deployment", () => {
  const issuer = anvilAccount(0);
  const subHolder = anvilAccount(1);
  const provider = "0x34BED22FA0950b1ff69B61E549D7509e34F85D5b" as const; // seeded Venice placeholder
  let snap: Hex;

  beforeEach(async () => {
    snap = await snapshot();
  });

  // Revert between tests so nonces stay fresh.
  // (afterEach in vitest runs after the test body; revert via snapshot keeps state clean.)
  it("issueMandate: round-trip — view + stored caveats match what we issued", async () => {
    const pc = publicClient();
    const wallet = walletFor(issuer);

    const caveats = [
      capabilityWhitelist([CAPABILITY.INFERENCE_CALL, CAPABILITY.REDELEGATE]),
      spendCapTotal(1_000_000_000n),
      spendCapPerCall(500_000_000n),
      providerWhitelist([provider]),
      capRedelegate({ maxSubMandates: 10, maxAggregateBudget: 2n ** 120n }),
    ];

    const { mandateId } = await mandate.issueMandate(wallet, pc, FROST_BASE_SEPOLIA, {
      holder: issuer.address,
      caveats,
      nonce: 1n,
    });

    expect(mandateId).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const view = await mandate.getMandate(pc, FROST_BASE_SEPOLIA, mandateId);
    expect(view.issuer.toLowerCase()).toBe(issuer.address.toLowerCase());
    expect(view.holder.toLowerCase()).toBe(issuer.address.toLowerCase());
    expect(view.parentMandateId).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );
    expect(view.revoked).toBe(false);
    expect(view.cumulativeSpend).toBe(0n);

    const stored = await mandate.getCaveats(pc, FROST_BASE_SEPOLIA, mandateId);
    expect(stored.length).toBe(caveats.length);
    // All requested caveats should be stored (root-mandate path: no intersection).
    const storedTypes = stored.map((c) => c.caveatType).sort();
    const requestedTypes = caveats.map((c) => c.caveatType).sort();
    expect(storedTypes).toEqual(requestedTypes);

    await revertTo(snap);
  });

  it("issueSubMandate: caller-must-be-parent-holder; sub inherits intersection", async () => {
    const pc = publicClient();
    const wallet = walletFor(issuer);

    // Root: issuer issues to themselves so they can issue a sub directly.
    const root = await mandate.issueMandate(wallet, pc, FROST_BASE_SEPOLIA, {
      holder: issuer.address,
      caveats: [
        capabilityWhitelist([CAPABILITY.INFERENCE_CALL, CAPABILITY.REDELEGATE]),
        spendCapTotal(1_000_000_000n),
        providerWhitelist([provider]),
        capRedelegate({ maxSubMandates: 10, maxAggregateBudget: 2n ** 120n }),
      ],
      nonce: 100n,
    });

    // Sub: issuer (parent holder) issues to subHolder. Request a narrower
    // spend cap; everything else should inherit through intersection.
    const sub = await mandate.issueSubMandate(wallet, pc, FROST_BASE_SEPOLIA, {
      parentMandateId: root.mandateId,
      holder: subHolder.address,
      caveats: [
        capabilityWhitelist([CAPABILITY.INFERENCE_CALL]), // narrowed
        spendCapTotal(100_000_000n),                       // narrowed
      ],
      nonce: 101n,
    });

    const subView = await mandate.getMandate(pc, FROST_BASE_SEPOLIA, sub.mandateId);
    expect(subView.parentMandateId).toBe(root.mandateId);
    expect(subView.holder.toLowerCase()).toBe(subHolder.address.toLowerCase());

    const subCaveats = await mandate.getCaveats(pc, FROST_BASE_SEPOLIA, sub.mandateId);
    // Sub should carry: CAPABILITY_WHITELIST, SPEND_CAP_TOTAL (narrowed),
    // PROVIDER_WHITELIST (inherited), CAP_REDELEGATE (inherited).
    const typeSet = new Set(subCaveats.map((c) => c.caveatType));
    expect(typeSet.size).toBe(4);

    await revertTo(snap);
  });

  it("revoke: parent issuer revokes the root, sub sees ancestor revoked", async () => {
    const pc = publicClient();
    const wallet = walletFor(issuer);

    const root = await mandate.issueMandate(wallet, pc, FROST_BASE_SEPOLIA, {
      holder: issuer.address,
      caveats: [
        capabilityWhitelist([CAPABILITY.INFERENCE_CALL, CAPABILITY.REDELEGATE]),
        spendCapTotal(1_000_000_000n),
        capRedelegate({ maxSubMandates: 10, maxAggregateBudget: 2n ** 120n }),
      ],
      nonce: 200n,
    });

    const sub = await mandate.issueSubMandate(wallet, pc, FROST_BASE_SEPOLIA, {
      parentMandateId: root.mandateId,
      holder: subHolder.address,
      caveats: [
        capabilityWhitelist([CAPABILITY.INFERENCE_CALL]),
        spendCapTotal(50_000_000n),
      ],
      nonce: 201n,
    });

    expect(await revocation.isAncestorRevoked(pc, FROST_BASE_SEPOLIA, sub.mandateId)).toBe(false);

    await revocation.revoke(wallet, pc, FROST_BASE_SEPOLIA, root.mandateId);

    expect(await revocation.isRevoked(pc, FROST_BASE_SEPOLIA, root.mandateId)).toBe(true);
    expect(await revocation.isAncestorRevoked(pc, FROST_BASE_SEPOLIA, sub.mandateId)).toBe(true);

    // The Mandate view's `revoked` flag mirrors the ancestor walk.
    const subView = await mandate.getMandate(pc, FROST_BASE_SEPOLIA, sub.mandateId);
    expect(subView.revoked).toBe(true);

    await revertTo(snap);
  });
});
