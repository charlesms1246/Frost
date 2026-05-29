import type { Hex } from "viem";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CAPABILITY,
  capRedelegate,
  capabilityWhitelist,
  mandate,
  spendCapTotal,
  FROST_BASE_SEPOLIA,
} from "@frost/sdk";
import type { InferenceTransport } from "../src/inference/openrouter.js";
import { Planner, type PlanInput } from "../src/planner/planner.js";
import {
  defaultCaveatEncoder,
  InMemoryKeyStore,
  makeSdkIssuer,
  nonceCounter,
  translatePlan,
  WalletProvisioner,
} from "../src/index.js";
import { anvilAccount, fund, publicClient, walletFor } from "./fixtures.js";

/**
 * The end-to-end chain path: a deterministic (mocked-LLM) planning cycle whose
 * approved decisions are issued as REAL sub-mandates on a forked Base Sepolia
 * deployment. Proves Planner → translatePlan → makeSdkIssuer → on-chain
 * issueSubMandate composes correctly. The LLM is mocked so the test is
 * deterministic; everything below the planner is real.
 */

/** A canned planner response: three pricers, each within bounds. */
function mockPlanTransport(): InferenceTransport {
  const body = JSON.stringify({
    escalate: false,
    candidates: [
      makeCandidate("pricer-uniswap"),
      makeCandidate("pricer-1inch"),
      makeCandidate("pricer-paraswap"),
    ],
  });
  return {
    complete: async () => ({ text: body, model: "mock/integration", id: "gen-int-1" }),
  };
}

function makeCandidate(role: string) {
  return {
    role,
    capabilities: [CAPABILITY.RPC_READ],
    spendCapTotal: "1000000",
    estimatedTokenCost: "100000",
    reasoning: `fetch a quote from ${role}`,
  };
}

describe("spawn flow against forked deployment", () => {
  const masterAgent = anvilAccount(0); // holds the root mandate, signs issuance
  let rootMandateId: Hex;

  beforeAll(async () => {
    await fund(masterAgent.address);
    const pc = publicClient();
    const wallet = walletFor(masterAgent);

    // Root mandate the user signed: master agent may redelegate, with a broad
    // capability set so each pricer's RPC_READ intersects non-empty.
    const root = await mandate.issueMandate(wallet, pc, FROST_BASE_SEPOLIA, {
      holder: masterAgent.address,
      caveats: [
        capabilityWhitelist([
          CAPABILITY.INFERENCE_CALL,
          CAPABILITY.REDELEGATE,
          CAPABILITY.RPC_READ,
        ]),
        spendCapTotal(1_000_000_000n),
        capRedelegate({ maxSubMandates: 10, maxAggregateBudget: 2n ** 120n }),
      ],
      nonce: 1n,
    });
    rootMandateId = root.mandateId;
  });

  it("plans then issues real sub-mandates under the root", async () => {
    const pc = publicClient();
    const wallet = walletFor(masterAgent);

    const input: PlanInput = {
      spec: {
        sessionId: ("0x" + "aa".repeat(32)) as Hex,
        rootMandateId,
        description: "compare Base DEX routes for an ETH→USDC swap",
        redelegationBounds: { maxSubMandates: 10, maxAggregateBudget: 2n ** 120n },
      },
      trigger: { kind: "condition-fired" },
      bounds: { maxSubMandates: 10, maxAggregateBudget: 2n ** 120n },
      state: { subMandateCount: 0, aggregateSubMandateBudget: 0n },
      bucket: { available: 33, capacity: 33 },
    };

    // 1. Plan (mocked LLM, real guard).
    const planner = new Planner({ transport: mockPlanTransport(), model: "mock/integration" });
    const plan = await planner.plan(input);
    expect(plan.escalateToHITL).toBe(false);
    expect(plan.approved).toHaveLength(3);

    // 2. Translate → issue on-chain, using the real WalletProvisioner to mint a
    //    fresh EOA holder per pricer (keys in an in-memory store for the test).
    const provisioner = new WalletProvisioner({
      keyStore: new InMemoryKeyStore(),
      sessionId: "integration",
    });
    const result = await translatePlan(plan, {
      issue: makeSdkIssuer(wallet, pc, FROST_BASE_SEPOLIA),
      encodeCaveats: defaultCaveatEncoder,
      provisionHolder: provisioner.provisionHolder,
      nextNonce: nonceCounter(1000n),
    });

    // 3. Every spawn issued; audit entry filled with the real mandate IDs.
    expect(result.outcomes.map((o) => o.status)).toEqual(["issued", "issued", "issued"]);
    expect(result.spawnedSubMandateIds).toHaveLength(3);
    expect(result.entry.spawnedSubMandateIds).toEqual(result.spawnedSubMandateIds);

    // 4. Each sub-mandate exists on-chain, parented to the root, held by the
    //    EOA the provisioner minted (and whose signer it can recover), not revoked.
    for (const outcome of result.outcomes) {
      expect(outcome.mandateId).toMatch(/^0x[0-9a-f]{64}$/i);
      const view = await mandate.getMandate(pc, FROST_BASE_SEPOLIA, outcome.mandateId!);
      expect(view.parentMandateId).toBe(rootMandateId);
      expect(view.holder.toLowerCase()).toBe(outcome.holder!.toLowerCase());
      expect(view.revoked).toBe(false);

      // The on-chain holder is a real provisioned EOA we hold the key for.
      const signer = await provisioner.signerFor(outcome.holder!);
      expect(signer.address.toLowerCase()).toBe(view.holder.toLowerCase());

      // The contract intersected our requested caveats against the parent —
      // the sub carries at least the capability + spend-cap we asked for.
      const stored = await mandate.getCaveats(pc, FROST_BASE_SEPOLIA, outcome.mandateId!);
      expect(stored.length).toBeGreaterThanOrEqual(2);
    }
  });
});
