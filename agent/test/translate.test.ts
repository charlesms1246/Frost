import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { PlanResult, SpawnDecision } from "../src/types.js";
import {
  nonceCounter,
  translatePlan,
  type SubMandateIssuer,
} from "../src/translate/translate.js";

const SESSION_ID = ("0x" + "11".repeat(32)) as Hex;
const PARENT = ("0x" + "22".repeat(32)) as Hex;

function decision(role: string): SpawnDecision {
  return {
    role,
    proposedCaveats: { capabilities: ["CAP_RPC_READ"], spendCapTotal: 1_000_000n },
    estimatedTokenCost: 100_000n,
    reasoning: `spawn ${role}`,
    decision: "spawned",
  };
}

function planWith(approved: SpawnDecision[], escalate = false): PlanResult {
  return {
    approved,
    escalateToHITL: escalate,
    entry: {
      timestamp: 1,
      sessionId: SESSION_ID,
      parentMandateId: PARENT,
      triggerEvent: { kind: "condition-fired" },
      candidatesConsidered: approved,
      spawnedSubMandateIds: [],
      promptTemplate: "frost-planner-v1",
      modelUsed: "test-model",
      inferenceCallId: "gen-1",
    },
  };
}

/** Records every issuance and returns a deterministic mandateId from the nonce. */
function captureIssuer(): {
  issue: SubMandateIssuer;
  calls: Array<{ parentMandateId: Hex; holder: Address; nonce: bigint }>;
} {
  const calls: Array<{ parentMandateId: Hex; holder: Address; nonce: bigint }> = [];
  const issue: SubMandateIssuer = async (p) => {
    calls.push({ parentMandateId: p.parentMandateId, holder: p.holder, nonce: p.nonce });
    return {
      mandateId: ("0x" + p.nonce.toString(16).padStart(64, "0")) as Hex,
      txHash: ("0x" + "ab".repeat(32)) as Hex,
    };
  };
  return { issue, calls };
}

const holderFor = (role: string): Address =>
  ("0x" + Buffer.from(role).toString("hex").padEnd(40, "0").slice(0, 40)) as Address;

const deps = (issue: SubMandateIssuer) => ({
  issue,
  encodeCaveats: () => [],
  provisionHolder: async (d: SpawnDecision) => holderFor(d.role),
  nextNonce: nonceCounter(0n),
});

describe("translatePlan", () => {
  it("issues every approved decision in order and fills the audit entry", async () => {
    const { issue, calls } = captureIssuer();
    const plan = planWith([
      decision("pricer-uniswap"),
      decision("pricer-1inch"),
      decision("pricer-paraswap"),
    ]);

    const result = await translatePlan(plan, deps(issue));

    expect(result.outcomes.map((o) => o.status)).toEqual([
      "issued",
      "issued",
      "issued",
    ]);
    // Nonces handed out monotonically, parent threaded through.
    expect(calls.map((c) => c.nonce)).toEqual([0n, 1n, 2n]);
    expect(calls.every((c) => c.parentMandateId === PARENT)).toBe(true);
    // spawnedSubMandateIds collected and written back into the §10.7 entry.
    expect(result.spawnedSubMandateIds).toHaveLength(3);
    expect(result.entry.spawnedSubMandateIds).toEqual(result.spawnedSubMandateIds);
  });

  it("threads the provisioned holder into issuance and the outcome", async () => {
    const { issue, calls } = captureIssuer();
    const plan = planWith([decision("comms")]);

    const result = await translatePlan(plan, deps(issue));

    expect(calls[0]?.holder).toBe(holderFor("comms"));
    expect(result.outcomes[0]?.holder).toBe(holderFor("comms"));
    expect(result.outcomes[0]?.mandateId).toBe(result.spawnedSubMandateIds[0]);
  });

  it("records a failed spawn and continues with the rest", async () => {
    let n = 0;
    const issue: SubMandateIssuer = async (p) => {
      n += 1;
      if (n === 2) throw new Error("aggregate budget exceeded on-chain");
      return {
        mandateId: ("0x" + p.nonce.toString(16).padStart(64, "0")) as Hex,
        txHash: ("0x" + "cd".repeat(32)) as Hex,
      };
    };
    const plan = planWith([decision("a"), decision("b"), decision("c")]);

    const result = await translatePlan(plan, deps(issue));

    expect(result.outcomes.map((o) => o.status)).toEqual([
      "issued",
      "failed",
      "issued",
    ]);
    expect(result.outcomes[1]?.error).toMatch(/aggregate budget exceeded/);
    // The failed one contributes no mandateId.
    expect(result.spawnedSubMandateIds).toHaveLength(2);
    expect(result.entry.spawnedSubMandateIds).toHaveLength(2);
  });

  it("issues nothing when the plan escalated (approved is empty)", async () => {
    const { issue, calls } = captureIssuer();
    const plan = planWith([], true);

    const result = await translatePlan(plan, deps(issue));

    expect(calls).toHaveLength(0);
    expect(result.outcomes).toHaveLength(0);
    expect(result.spawnedSubMandateIds).toEqual([]);
    expect(result.entry.spawnedSubMandateIds).toEqual([]);
  });

  it("surfaces a holder-provisioning failure as a failed outcome", async () => {
    const { issue } = captureIssuer();
    const plan = planWith([decision("a"), decision("executor")]);

    const result = await translatePlan(plan, {
      issue,
      encodeCaveats: () => [],
      provisionHolder: async (d) => {
        if (d.role === "executor") throw new Error("1Shot wallet provisioning failed");
        return holderFor(d.role);
      },
      nextNonce: nonceCounter(0n),
    });

    expect(result.outcomes[0]?.status).toBe("issued");
    expect(result.outcomes[1]?.status).toBe("failed");
    expect(result.outcomes[1]?.error).toMatch(/provisioning failed/);
    expect(result.spawnedSubMandateIds).toHaveLength(1);
  });
});

describe("nonceCounter", () => {
  it("returns a monotonic sequence from the start value", () => {
    const next = nonceCounter(5n);
    expect([next(), next(), next()]).toEqual([5n, 6n, 7n]);
  });
});
