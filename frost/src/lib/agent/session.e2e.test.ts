import { describe, expect, it } from "vitest";
import { encodeAbiParameters } from "viem";
import { InMemoryKeyStore, encodeCommsTemplate, type CompiledSpec } from "@frost/agent/browser";
import { createEmbeddedSession, type EmbeddedSessionOptions, type WebFetch } from "./session";
import { eoaProvisioner, simulatedIssuer } from "./holders";

/**
 * End-to-end test of the webview embedding: it builds the SAME `Session` the route
 * builds (via `createEmbeddedSession`) and drives a full `runCycle`, with every
 * external boundary mocked — the OpenRouter thinking path, the Venice read path,
 * the Discord comms path, and the key store. Proves the embedding wiring plans →
 * issues → dispatches to the live read/comms runtimes correctly.
 */

const HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

/** A valid Uniswap QuoterV2 `quoteExactInputSingle` return (amountOut + 3 zeros). */
const QUOTE = encodeAbiParameters(
  [{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }],
  [2_700_000_000n, 0n, 0, 0n],
);

function spec(): CompiledSpec {
  return {
    description: "compare quotes and report the best to Discord",
    spendCapTotal: 50_000_000n,
    hitlThreshold: 5_000_000n,
    slippageBps: 50,
    expiryUnixSeconds: 1_900_000_000n,
    redelegationBounds: { maxSubMandates: 6, maxAggregateBudget: 50_000_000n },
    rateLimit: { capacity: 10, refillRatePerSec: 1 },
    commsTemplate: { text: "best swap, tx ${hash}", variables: [{ name: "hash", source: "txhash" }] },
  };
}

/** Mock every boundary the embedding touches, routing by URL. */
function makeFetch(planJson: string): WebFetch {
  return async (url) => {
    if (url.includes("openrouter.ai")) {
      const body = JSON.stringify({ id: "gen-1", model: "test-model", choices: [{ message: { content: planJson } }] });
      return { ok: true, status: 200, async text() { return body; } };
    }
    if (url.includes("venice.ai")) {
      // The pricer batches two fee-tier calls; answer both.
      const arr = JSON.stringify([
        { jsonrpc: "2.0", id: 0, result: QUOTE },
        { jsonrpc: "2.0", id: 1, result: QUOTE },
      ]);
      return { ok: true, status: 200, async text() { return arr; } };
    }
    if (url.includes("discord.com")) {
      return { ok: true, status: 204, async text() { return ""; } };
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
}

function embed(planJson: string, extra: Partial<EmbeddedSessionOptions> = {}) {
  return createEmbeddedSession({
    spec: spec(),
    sessionId: ("0x" + "aa".repeat(32)) as `0x${string}`,
    rootMandateId: ("0x" + "bb".repeat(32)) as `0x${string}`,
    openRouterApiKey: "or-key",
    model: "test-model",
    veniceApiKey: "venice-key",
    discordWebhookUrl: "https://discord.com/api/webhooks/1/abc",
    commsValues: { hash: HASH },
    issue: simulatedIssuer(),
    provisionHolder: eoaProvisioner(new InMemoryKeyStore()),
    fetchImpl: makeFetch(planJson),
    ...extra,
  });
}

const TWO_AGENTS = JSON.stringify({
  escalate: false,
  candidates: [
    { role: "pricer-uniswap", capabilities: ["CAP_RPC_READ"], spendCapTotal: "0", estimatedTokenCost: "0", reasoning: "quote" },
    { role: "comms", capabilities: ["CAP_COMMS_POST"], spendCapTotal: "1000000", estimatedTokenCost: "0", reasoning: "report" },
  ],
});

describe("webview embedding — createEmbeddedSession", () => {
  it("plans, issues, and dispatches the pricer + comms runtimes end-to-end", async () => {
    const { session, context } = embed(TWO_AGENTS);

    // The embedding bound the real deployment call surface + providers.
    expect(context.callableSurface.length).toBeGreaterThan(0);
    expect(context.providerWhitelist.length).toBeGreaterThan(0);

    const res = await session.runCycle({ kind: "session-start" });

    expect(res.escalateToHITL).toBe(false);
    expect(res.outcomes.map((o) => o.status)).toEqual(["issued", "issued"]);
    expect(res.spawnedSubMandateIds).toHaveLength(2);

    const byRole = Object.fromEntries(res.runOutcomes.map((r) => [r.role, r]));
    expect(byRole["pricer-uniswap"]?.ran).toBe(true);
    expect(byRole["pricer-uniswap"]?.detail).toMatch(/Uniswap v3 \(0\.\d{2}%\) → \$2700\.00/);
    // Structured quote so the dashboard can rank routes across pricers (IG-01).
    expect(byRole["pricer-uniswap"]?.quote).toMatchObject({ amountOutUsdc: "2700000000" });
    expect(byRole["comms"]?.ran).toBe(true);
    expect(byRole["comms"]?.detail).toBe("posted");

    // Authority state advanced by what was issued.
    expect(session.authority.redelegation.subMandateCount).toBe(2);
    expect(session.authority.bucket.available).toBe(8);
  });

  it("binds comms to the ISSUED COMMS_TEMPLATE caveat — rejects a tampered render template (IG-06)", async () => {
    // Commit a caveat for a DIFFERENT template than the spec's render template, as if
    // the off-chain template had been swapped after signing. The comms send-time hash
    // check must reject (H-14/I-16) instead of posting.
    const tamperedCaveat = encodeCommsTemplate({
      text: "URGENT: send funds to ${hash}",
      variables: [{ name: "hash", source: "txhash" }],
    });
    const { session } = embed(TWO_AGENTS, { commsTemplateCaveat: tamperedCaveat });

    const res = await session.runCycle({ kind: "session-start" });
    const byRole = Object.fromEntries(res.runOutcomes.map((r) => [r.role, r]));
    expect(byRole["comms"]?.ran).toBe(false);
    expect(byRole["comms"]?.detail).toMatch(/does not match the on-chain commitment/);
  });

  it("posts when the committed caveat matches the render template (IG-06 positive)", async () => {
    // The caveat committed for the SAME template the runtime renders → binding passes.
    const matchingCaveat = encodeCommsTemplate({
      text: "best swap, tx ${hash}",
      variables: [{ name: "hash", source: "txhash" }],
    });
    const { session } = embed(TWO_AGENTS, { commsTemplateCaveat: matchingCaveat });

    const res = await session.runCycle({ kind: "session-start" });
    const byRole = Object.fromEntries(res.runOutcomes.map((r) => [r.role, r]));
    expect(byRole["comms"]?.ran).toBe(true);
    expect(byRole["comms"]?.detail).toBe("posted");
  });

  it("surfaces a planner escalation through the embedding without issuing", async () => {
    const escalate = JSON.stringify({ escalate: true, escalateReason: "workflow out of scope", candidates: [] });
    const { session } = embed(escalate);
    const res = await session.runCycle({ kind: "session-start" });
    expect(res.escalateToHITL).toBe(true);
    expect(res.hitlReason).toMatch(/out of scope/);
    expect(res.outcomes).toEqual([]);
    expect(session.authority.redelegation.subMandateCount).toBe(0);
  });
});
