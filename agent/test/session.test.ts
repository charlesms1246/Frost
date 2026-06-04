import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { InferenceTransport } from "../src/inference/openrouter.js";
import { Planner } from "../src/planner/planner.js";
import { defaultCaveatEncoder } from "../src/translate/caveat-encoder.js";
import { nonceCounter, type SubMandateIssuer, type TranslateDeps } from "../src/translate/translate.js";
import type { SessionContext } from "../src/orchestrate/enrich.js";
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/orchestrate/deployment.js";
import { Session, type SessionConfig, type SessionState, type SubAgentRunner } from "../src/session/session.js";
import type { TaskSpec } from "../src/types.js";

const HOLDER = ("0x" + "22".repeat(20)) as Address;
const PROVIDER = BASE_SEPOLIA_DEPLOYMENT.approvedProviders[0]!;

function transport(text: string): InferenceTransport {
  return { async complete() { return { text, model: "test-model", id: "gen-1" }; } };
}

/** Two candidates: an executor and a comms agent, both within bounds. */
const TWO_AGENTS = JSON.stringify({
  escalate: false,
  candidates: [
    { role: "executor", capabilities: ["CAP_ONCHAIN_EXECUTION"], spendCapTotal: "10000000", estimatedTokenCost: "0", reasoning: "swap" },
    { role: "comms", capabilities: ["CAP_COMMS_POST"], spendCapTotal: "1000000", estimatedTokenCost: "0", reasoning: "report" },
  ],
});

function ctx(): SessionContext {
  return {
    expiryUnixSeconds: 1_900_000_000n,
    providerWhitelist: [PROVIDER],
    callableSurface: BASE_SEPOLIA_DEPLOYMENT.callableSurface,
    commsTemplate: { text: "tx ${hash}", variables: [{ name: "hash", source: "txhash" }] },
  };
}

function spec(): TaskSpec {
  return {
    sessionId: ("0x" + "aa".repeat(32)) as Hex,
    rootMandateId: ("0x" + "bb".repeat(32)) as Hex,
    description: "compare and execute the best swap, then report",
    redelegationBounds: { maxSubMandates: 6, maxAggregateBudget: 50_000_000n },
  };
}

function freshState(): SessionState {
  return {
    spec: spec(),
    redelegation: { subMandateCount: 0, aggregateSubMandateBudget: 0n },
    bucket: { available: 10, capacity: 10 },
  };
}

function okIssuer(): SubMandateIssuer {
  return async ({ nonce }) => ({
    mandateId: `0x${nonce.toString(16).padStart(64, "0")}` as Hex,
    txHash: ("0x" + "11".repeat(32)) as Hex,
  });
}

function deps(issue: SubMandateIssuer): Omit<TranslateDeps, "enrich"> {
  return {
    issue,
    encodeCaveats: defaultCaveatEncoder,
    provisionHolder: async () => HOLDER,
    nextNonce: nonceCounter(1n),
  };
}

function session(planText: string, issue: SubMandateIssuer, runners?: SessionConfig["runners"], state = freshState()): Session {
  const config: SessionConfig = {
    planner: new Planner({ transport: transport(planText), model: "test-model" }),
    context: ctx(),
    translate: deps(issue),
  };
  if (runners) config.runners = runners;
  return new Session(config, state);
}

describe("Session.runCycle", () => {
  it("plans, issues, dispatches to runners, and advances authority state", async () => {
    const ran: string[] = [];
    const mk = (label: string): SubAgentRunner => async ({ outcome }) => {
      ran.push(outcome.role);
      return { role: outcome.role, ran: true, detail: label };
    };
    const s = session(TWO_AGENTS, okIssuer(), { executor: mk("submitted"), comms: mk("posted") });

    const res = await s.runCycle({ kind: "session-start" });

    expect(res.escalateToHITL).toBe(false);
    expect(res.outcomes.map((o) => o.status)).toEqual(["issued", "issued"]);
    expect(res.spawnedSubMandateIds).toHaveLength(2);
    expect(res.runOutcomes.map((r) => r.ran)).toEqual([true, true]);
    expect(res.runOutcomes.map((r) => r.detail)).toEqual(["submitted", "posted"]);
    expect(ran).toEqual(["executor", "comms"]);

    // State advanced by what was issued: 2 sub-mandates, $11 budget, 2 tokens spent.
    expect(s.authority.redelegation.subMandateCount).toBe(2);
    expect(s.authority.redelegation.aggregateSubMandateBudget).toBe(11_000_000n);
    expect(s.authority.bucket.available).toBe(8);
  });

  it("accumulates authority state across cycles", async () => {
    const s = session(TWO_AGENTS, okIssuer(), {});
    await s.runCycle({ kind: "session-start" });
    await s.runCycle({ kind: "condition-fired" });
    expect(s.authority.redelegation.subMandateCount).toBe(4);
    expect(s.authority.redelegation.aggregateSubMandateBudget).toBe(22_000_000n);
    expect(s.authority.bucket.available).toBe(6);
  });

  it("escalates without issuing or mutating state when the planner escalates", async () => {
    const escalate = JSON.stringify({ escalate: true, escalateReason: "workflow out of scope", candidates: [] });
    const s = session(escalate, okIssuer(), {});
    const res = await s.runCycle({ kind: "session-start" });
    expect(res.escalateToHITL).toBe(true);
    expect(res.hitlReason).toMatch(/out of scope/);
    expect(res.outcomes).toEqual([]);
    expect(s.authority.redelegation.subMandateCount).toBe(0);
    expect(s.authority.bucket.available).toBe(10);
  });

  it("advances state only for issued sub-mandates when one issuance fails", async () => {
    let calls = 0;
    const flaky: SubMandateIssuer = async ({ nonce }) => {
      calls += 1;
      if (calls === 2) throw new Error("nonce clash");
      return { mandateId: `0x${nonce.toString(16).padStart(64, "0")}` as Hex, txHash: ("0x" + "11".repeat(32)) as Hex };
    };
    const ran: string[] = [];
    const runner: SubAgentRunner = async ({ outcome }) => { ran.push(outcome.role); return { role: outcome.role, ran: true }; };
    const s = session(TWO_AGENTS, flaky, { executor: runner, comms: runner });

    const res = await s.runCycle({ kind: "session-start" });
    expect(res.outcomes.map((o) => o.status)).toEqual(["issued", "failed"]);
    // Only the issued (executor, $10) advanced; the failed comms did not.
    expect(s.authority.redelegation.subMandateCount).toBe(1);
    expect(s.authority.redelegation.aggregateSubMandateBudget).toBe(10_000_000n);
    expect(s.authority.bucket.available).toBe(9);
    // Only the issued agent was dispatched.
    expect(ran).toEqual(["executor"]);
  });

  it("records an issued agent as undispatched when no runner is supplied", async () => {
    const s = session(TWO_AGENTS, okIssuer()); // no runners
    const res = await s.runCycle({ kind: "session-start" });
    expect(res.outcomes.map((o) => o.status)).toEqual(["issued", "issued"]);
    expect(res.runOutcomes.every((r) => r.ran === false)).toBe(true);
    expect(res.runOutcomes.every((r) => r.detail === "no runner for behavior")).toBe(true);
  });
});
