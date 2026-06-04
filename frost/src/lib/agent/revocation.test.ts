import { describe, expect, it } from "vitest";
import { InMemoryKeyStore, type CompiledSpec, type SubMandateIssuer } from "@frost/agent/browser";
import { createEmbeddedSession, type WebFetch } from "./session";
import { eoaProvisioner, simulatedIssuer } from "./holders";
import { revocableIssuer } from "./revocation";

/**
 * Revocation cascade (demo moment 3): once spawning authority is revoked, the issuer
 * refuses every spawn, so the cycle's outcomes are all `failed` and nothing is issued —
 * exactly what the contract enforces on-chain when the parent loses CAP_REDELEGATE.
 */

describe("revocableIssuer", () => {
  const inner: SubMandateIssuer = async ({ nonce }) => ({
    mandateId: `0x${nonce.toString(16).padStart(64, "0")}` as `0x${string}`,
    txHash: ("0x" + "11".repeat(32)) as `0x${string}`,
  });

  it("passes through to the inner issuer while not revoked", async () => {
    const issue = revocableIssuer(inner, () => false);
    const out = await issue({ parentMandateId: ("0x" + "bb".repeat(32)) as `0x${string}`, holder: ("0x" + "22".repeat(20)) as `0x${string}`, caveats: [], nonce: 1n });
    expect(out.mandateId).toMatch(/^0x0+1$/);
  });

  it("throws (refuses to spawn) once revoked", async () => {
    let revoked = false;
    const issue = revocableIssuer(inner, () => revoked);
    revoked = true;
    await expect(
      issue({ parentMandateId: ("0x" + "bb".repeat(32)) as `0x${string}`, holder: ("0x" + "22".repeat(20)) as `0x${string}`, caveats: [], nonce: 1n }),
    ).rejects.toThrow(/spawning authority revoked/);
  });
});

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

const TWO_AGENTS = JSON.stringify({
  escalate: false,
  candidates: [
    { role: "pricer-uniswap", capabilities: ["CAP_RPC_READ"], spendCapTotal: "0", estimatedTokenCost: "0", reasoning: "quote" },
    { role: "comms", capabilities: ["CAP_COMMS_POST"], spendCapTotal: "1000000", estimatedTokenCost: "0", reasoning: "report" },
  ],
});

function planFetch(): WebFetch {
  return async (url) => {
    if (url.includes("openrouter.ai")) {
      const body = JSON.stringify({ id: "g1", model: "test-model", choices: [{ message: { content: TWO_AGENTS } }] });
      return { ok: true, status: 200, async text() { return body; } };
    }
    throw new Error(`unexpected fetch to ${url}`);
  };
}

describe("createEmbeddedSession with a revoked issuer", () => {
  it("fails every spawn and issues nothing (the cascade)", async () => {
    const { session } = createEmbeddedSession({
      spec: spec(),
      sessionId: ("0x" + "aa".repeat(32)) as `0x${string}`,
      rootMandateId: ("0x" + "bb".repeat(32)) as `0x${string}`,
      openRouterApiKey: "or-key",
      model: "test-model",
      veniceApiKey: "venice-key",
      issue: revocableIssuer(simulatedIssuer(), () => true), // revoked
      provisionHolder: eoaProvisioner(new InMemoryKeyStore()),
      fetchImpl: planFetch(),
    });

    const res = await session.runCycle({ kind: "condition-fired" });
    expect(res.escalateToHITL).toBe(false);
    expect(res.outcomes.length).toBe(2);
    expect(res.outcomes.every((o) => o.status === "failed")).toBe(true);
    expect(res.spawnedSubMandateIds).toHaveLength(0);
    // No sub-mandates issued ⇒ authority state did not advance.
    expect(session.authority.redelegation.subMandateCount).toBe(0);
  });
});
