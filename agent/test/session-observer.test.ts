import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { InferenceTransport } from "../src/inference/openrouter.js";
import { Planner } from "../src/planner/planner.js";
import { defaultCaveatEncoder } from "../src/translate/caveat-encoder.js";
import { nonceCounter, type SubMandateIssuer, type TranslateDeps } from "../src/translate/translate.js";
import type { SessionContext } from "../src/orchestrate/enrich.js";
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/orchestrate/deployment.js";
import {
  Session,
  type SessionConfig,
  type SessionState,
  type SessionEvent,
  type SubAgentRunner,
} from "../src/session/session.js";
import type { TaskSpec } from "../src/types.js";

const HOLDER = ("0x" + "22".repeat(20)) as Address;
const PROVIDER = BASE_SEPOLIA_DEPLOYMENT.approvedProviders[0]!;

function transport(text: string): InferenceTransport {
  return { async complete() { return { text, model: "test-model", id: "gen-1" }; } };
}

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
  return { issue, encodeCaveats: defaultCaveatEncoder, provisionHolder: async () => HOLDER, nextNonce: nonceCounter(1n) };
}

function session(planText: string, issue: SubMandateIssuer, observer: (e: SessionEvent) => void, runners?: SessionConfig["runners"]): Session {
  const config: SessionConfig = {
    planner: new Planner({ transport: transport(planText), model: "test-model" }),
    context: ctx(),
    translate: deps(issue),
    observer,
  };
  if (runners) config.runners = runners;
  return new Session(config, freshState());
}

describe("Session observer (live event spine)", () => {
  it("emits the full lifecycle in order for a 2-agent cycle", async () => {
    const events: SessionEvent[] = [];
    const runner: SubAgentRunner = async ({ outcome }) => ({ role: outcome.role, ran: true, detail: "ok" });
    const s = session(TWO_AGENTS, okIssuer(), (e) => events.push(e), { executor: runner, comms: runner });

    await s.runCycle({ kind: "session-start" });

    expect(events.map((e) => e.type)).toEqual([
      "cycle-start",
      "plan-decided",
      "sub-mandate",
      "sub-mandate",
      "state-advanced",
      "sub-agent-dispatched",
      "sub-agent-result",
      "sub-agent-dispatched",
      "sub-agent-result",
      "cycle-complete",
    ]);

    const planned = events.find((e) => e.type === "plan-decided");
    expect(planned).toMatchObject({
      escalateToHITL: false,
      approved: [
        { index: 0, role: "executor", spendCapTotal: 10_000_000n },
        { index: 1, role: "comms", spendCapTotal: 1_000_000n },
      ],
    });

    const issued = events.filter((e) => e.type === "sub-mandate");
    expect(issued.every((e) => e.type === "sub-mandate" && e.status === "issued" && !!e.mandateId)).toBe(true);

    const advanced = events.find((e) => e.type === "state-advanced");
    expect(advanced).toMatchObject({ subMandateCount: 2, aggregateSubMandateBudget: 11_000_000n, bucketAvailable: 8 });

    // dispatched then result, mandateId ties them together.
    const dispatched = events.filter((e) => e.type === "sub-agent-dispatched");
    const results = events.filter((e) => e.type === "sub-agent-result");
    expect(dispatched).toHaveLength(2);
    expect(results.every((r) => r.type === "sub-agent-result" && r.ran)).toBe(true);

    const complete = events.at(-1);
    expect(complete).toMatchObject({ type: "cycle-complete", escalateToHITL: false });
    expect(complete?.type === "cycle-complete" && complete.spawnedSubMandateIds).toHaveLength(2);
  });

  it("emits cycle-start, plan-decided, escalated, cycle-complete on an escalation (no issuance)", async () => {
    const events: SessionEvent[] = [];
    const escalate = JSON.stringify({ escalate: true, escalateReason: "workflow out of scope", candidates: [] });
    const s = session(escalate, okIssuer(), (e) => events.push(e));

    await s.runCycle({ kind: "session-start" });

    expect(events.map((e) => e.type)).toEqual(["cycle-start", "plan-decided", "escalated", "cycle-complete"]);
    const esc = events.find((e) => e.type === "escalated");
    expect(esc).toMatchObject({ reason: "workflow out of scope" });
    expect(events.some((e) => e.type === "sub-mandate")).toBe(false);
  });

  it("a throwing observer never breaks the cycle", async () => {
    const s = session(TWO_AGENTS, okIssuer(), () => { throw new Error("ui blew up"); });
    const res = await s.runCycle({ kind: "session-start" });
    expect(res.escalateToHITL).toBe(false);
    expect(res.spawnedSubMandateIds).toHaveLength(2);
  });
});
