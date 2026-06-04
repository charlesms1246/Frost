import { describe, expect, it } from "vitest";
import {
  InMemoryKeyStore,
  SwitchingInferenceTransport,
  type CompiledSpec,
  type InferenceTransport,
} from "@frost/agent/browser";
import { createEmbeddedSession } from "./session";
import { eoaProvisioner, simulatedIssuer } from "./holders";

/**
 * Wiring test for the shared thinking transport: the dashboard builds ONE transport
 * (a Venice→OpenRouter switcher) and hands it to both the compiler and the session so
 * the Venice call budget spans compile + planning. Here we assert `createEmbeddedSession`
 * honors an injected `inferenceTransport` (no OpenRouter network) and surfaces a
 * `SwitchingInferenceTransport` as `inferenceSwitch` for the UI kill switch.
 */

function spec(): CompiledSpec {
  return {
    description: "compare quotes and report",
    spendCapTotal: 50_000_000n,
    hitlThreshold: 5_000_000n,
    slippageBps: 50,
    expiryUnixSeconds: 1_900_000_000n,
    redelegationBounds: { maxSubMandates: 6, maxAggregateBudget: 50_000_000n },
    rateLimit: { capacity: 10, refillRatePerSec: 1 },
    commsTemplate: { text: "tx ${hash}", variables: [{ name: "hash", source: "txhash" }] },
  };
}

function stub(text: string): InferenceTransport & { calls: number } {
  const t = {
    calls: 0,
    async complete() {
      t.calls += 1;
      return { text, model: "stub", id: "g1" };
    },
  };
  return t;
}

const ESCALATE = JSON.stringify({ escalate: true, escalateReason: "out of scope", candidates: [] });

function embedWith(transport: InferenceTransport) {
  return createEmbeddedSession({
    spec: spec(),
    sessionId: ("0x" + "aa".repeat(32)) as `0x${string}`,
    rootMandateId: ("0x" + "bb".repeat(32)) as `0x${string}`,
    openRouterApiKey: "unused-when-injected",
    model: "stub",
    veniceApiKey: "venice-key",
    inferenceTransport: transport,
    issue: simulatedIssuer(),
    provisionHolder: eoaProvisioner(new InMemoryKeyStore()),
    fetchImpl: async (url) => {
      throw new Error(`no network expected in this test: ${url}`);
    },
  });
}

describe("createEmbeddedSession — injected thinking transport", () => {
  it("plans through the injected transport with no OpenRouter network call", async () => {
    const t = stub(ESCALATE);
    const { session, inferenceSwitch } = embedWith(t);
    expect(inferenceSwitch).toBeUndefined(); // a plain transport is not a switcher

    const res = await session.runCycle({ kind: "session-start" });
    expect(t.calls).toBe(1);
    expect(res.escalateToHITL).toBe(true);
  });

  it("surfaces a SwitchingInferenceTransport as inferenceSwitch and routes the first call to Venice", async () => {
    const primary = stub(ESCALATE);
    const fallback = stub(ESCALATE);
    const sw = new SwitchingInferenceTransport({ primary, fallback, primaryCallBudget: 1 });

    const { session, inferenceSwitch } = embedWith(sw);
    expect(inferenceSwitch).toBe(sw);

    await session.runCycle({ kind: "session-start" });
    expect(primary.calls).toBe(1); // planning routed to Venice (within budget)
    expect(fallback.calls).toBe(0);
    expect(inferenceSwitch?.state.primaryCallsUsed).toBe(1);
  });
});
