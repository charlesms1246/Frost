import { describe, it, expect } from "vitest";
import { anvilAccount, publicClient, walletFor } from "./fixtures.js";
import { FROST_BASE_SEPOLIA } from "../src/addresses.js";
import * as refillable from "../src/refillable.js";
import * as mandate from "../src/mandate.js";
import { spendCapTotal, capabilityWhitelist, CAPABILITY } from "../src/caveats/index.js";

/**
 * No `beforeEach` snapshot/revert here — each test uses a distinct user
 * account and a distinct user nonce so state doesn't collide across tests.
 * Simpler than relying on anvil snapshot semantics across forked state.
 */
describe("refillable mandate flow", () => {
  it("createRefillableMandate: round-trip — policy + active mandate exist", async () => {
    const pc = publicClient();
    const user = anvilAccount(4);
    const holder = anvilAccount(5);
    const wallet = walletFor(user);

    const perRefill = 100_000_000n;
    const caveats = [
      // Order matters less; both required-set members must be present.
      capabilityWhitelist([CAPABILITY.INFERENCE_CALL]),
      spendCapTotal(perRefill), // contract enforces this == perRefillAmount
    ];

    const { parentAuthId, activeMandateId } = await refillable.createRefillableMandate(
      wallet,
      pc,
      FROST_BASE_SEPOLIA,
      {
        holder: holder.address,
        activeMandateCaveats: caveats,
        terms: {
          totalCap: perRefill * 5n,
          perRefillAmount: perRefill,
          refillThreshold: 10_000_000n,
          minRefillInterval: 60n,
        },
        userNonce: 500n,
      }
    );

    expect(parentAuthId).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(activeMandateId).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const policy = await refillable.getRefillStatus(pc, FROST_BASE_SEPOLIA, parentAuthId);
    expect(policy.user.toLowerCase()).toBe(user.address.toLowerCase());
    expect(policy.holder.toLowerCase()).toBe(holder.address.toLowerCase());
    expect(policy.totalCap).toBe(perRefill * 5n);
    expect(policy.perRefillAmount).toBe(perRefill);
    expect(policy.totalRefilled).toBe(perRefill); // initial issuance counts
    expect(policy.activeMandateId).toBe(activeMandateId);
    expect(policy.revoked).toBe(false);

    // The active mandate's issuer should be the RefillableMandate contract.
    const activeView = await mandate.getMandate(pc, FROST_BASE_SEPOLIA, activeMandateId);
    expect(activeView.issuer.toLowerCase()).toBe(
      FROST_BASE_SEPOLIA.refillableMandate.toLowerCase()
    );
    expect(activeView.holder.toLowerCase()).toBe(holder.address.toLowerCase());

  });

  it("revokeRefillPolicy: stops future refills, leaves active mandate alone", async () => {
    const pc = publicClient();
    const user = anvilAccount(6);
    const holder = anvilAccount(7);
    const wallet = walletFor(user);

    const perRefill = 50_000_000n;
    const { parentAuthId, activeMandateId } = await refillable.createRefillableMandate(
      wallet,
      pc,
      FROST_BASE_SEPOLIA,
      {
        holder: holder.address,
        activeMandateCaveats: [
          capabilityWhitelist([CAPABILITY.INFERENCE_CALL]),
          spendCapTotal(perRefill),
        ],
        terms: {
          totalCap: perRefill * 3n,
          perRefillAmount: perRefill,
          refillThreshold: 5_000_000n,
          minRefillInterval: 0n,
        },
        userNonce: 600n,
      }
    );

    await refillable.revokeRefillPolicy(wallet, pc, FROST_BASE_SEPOLIA, parentAuthId);
    const policy = await refillable.getRefillStatus(pc, FROST_BASE_SEPOLIA, parentAuthId);
    expect(policy.revoked).toBe(true);

    // Active mandate is unaffected by policy revocation (spec §4.4 — only
    // future refills are halted; the holder must revoke the active mandate
    // separately if they want immediate stop).
    const activeView = await mandate.getMandate(pc, FROST_BASE_SEPOLIA, activeMandateId);
    expect(activeView.revoked).toBe(false);

  });
});
