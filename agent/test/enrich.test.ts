import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { CAVEAT_TYPE, type Caveat } from "@frost/sdk";
import type { CallableSurfaceEntry } from "@frost/sdk";
import { enrichDecision, makeEnricher, type SessionContext } from "../src/orchestrate/enrich.js";
import { defaultCaveatEncoder } from "../src/translate/caveat-encoder.js";
import { nonceCounter, translatePlan, type SubMandateIssuer } from "../src/translate/translate.js";
import type { PlanResult, SpawnDecision } from "../src/types.js";
import type { CommsTemplate } from "../src/compile/types.js";

const EXPIRY = 1_900_000_000n;
const VENICE = ("0x" + "11".repeat(20)) as Address;
const ROUTER: CallableSurfaceEntry = {
  target: ("0x" + "22".repeat(20)) as Address,
  selector: "0x12345678" as Hex,
  maxValue: 5_000_000n,
};

// `commsTemplate: null` omits it entirely (exactOptionalPropertyTypes forbids
// passing `undefined`); omitting the key uses the default template.
function ctx(
  o: {
    providerWhitelist?: Address[];
    callableSurface?: CallableSurfaceEntry[];
    commsTemplate?: CommsTemplate | null;
  } = {},
): SessionContext {
  const base: SessionContext = {
    expiryUnixSeconds: EXPIRY,
    providerWhitelist: o.providerWhitelist ?? [VENICE],
    callableSurface: o.callableSurface ?? [ROUTER],
  };
  if (o.commsTemplate !== null) {
    base.commsTemplate =
      o.commsTemplate ?? { text: "Best: ${rate}", variables: [{ name: "rate", source: "numeric" }] };
  }
  return base;
}

function decision(role: string, capabilities: string[]): SpawnDecision {
  return {
    role,
    proposedCaveats: { capabilities, spendCapTotal: 1_000_000n },
    estimatedTokenCost: 0n,
    reasoning: "",
    decision: "spawned",
  };
}

describe("enrichDecision — capability-driven structural caveats", () => {
  it("stamps TTL_EXPIRY on every role", () => {
    const r = enrichDecision(decision("pricer", ["CAP_RPC_READ"]), ctx());
    expect(r.proposedCaveats.ttlExpiry).toBe(EXPIRY);
  });

  it("attaches CALLABLE_SURFACE only to on-chain executors", () => {
    const exec = enrichDecision(decision("executor", ["CAP_ONCHAIN_EXECUTION"]), ctx());
    expect(exec.proposedCaveats.callableSurface).toEqual([ROUTER]);

    const pricer = enrichDecision(decision("pricer", ["CAP_RPC_READ"]), ctx());
    expect(pricer.proposedCaveats.callableSurface).toBeUndefined();
  });

  it("attaches PROVIDER_WHITELIST to paid-provider roles, not to executors", () => {
    const pricer = enrichDecision(decision("pricer", ["CAP_RPC_READ"]), ctx());
    expect(pricer.proposedCaveats.providerWhitelist).toEqual([VENICE]);

    const exec = enrichDecision(decision("executor", ["CAP_ONCHAIN_EXECUTION"]), ctx());
    expect(exec.proposedCaveats.providerWhitelist).toBeUndefined();
  });

  it("attaches the signed COMMS_TEMPLATE to comms roles", () => {
    const comms = enrichDecision(decision("comms", ["CAP_COMMS_POST"]), ctx());
    expect(comms.proposedCaveats.commsTemplate?.text).toBe("Best: ${rate}");
  });

  it("does not let an LLM-supplied structural value survive (runtime is authoritative)", () => {
    const d = decision("executor", ["CAP_ONCHAIN_EXECUTION"]);
    // Simulate a decision that somehow already carries a (rogue) surface.
    d.proposedCaveats.callableSurface = [
      { target: ("0x" + "99".repeat(20)) as Address, selector: "0xdeadbeef" as Hex, maxValue: 1n },
    ];
    const r = enrichDecision(d, ctx());
    expect(r.proposedCaveats.callableSurface).toEqual([ROUTER]); // overwritten with the session's
  });

  it("throws on a role whose required structural caveat the session lacks", () => {
    expect(() =>
      enrichDecision(decision("comms", ["CAP_COMMS_POST"]), ctx({ commsTemplate: null })),
    ).toThrow(/comms template/);
    expect(() =>
      enrichDecision(decision("executor", ["CAP_ONCHAIN_EXECUTION"]), ctx({ callableSurface: [] })),
    ).toThrow(/callable surface/);
    expect(() =>
      enrichDecision(decision("pricer", ["CAP_RPC_READ"]), ctx({ providerWhitelist: [] })),
    ).toThrow(/approved providers/);
  });

  it("is pure — does not mutate the input decision", () => {
    const d = decision("executor", ["CAP_ONCHAIN_EXECUTION"]);
    enrichDecision(d, ctx());
    expect(d.proposedCaveats.ttlExpiry).toBeUndefined();
    expect(d.proposedCaveats.callableSurface).toBeUndefined();
  });
});

describe("makeEnricher composed through translatePlan", () => {
  function planWith(...decisions: SpawnDecision[]): PlanResult {
    return {
      approved: decisions,
      escalateToHITL: false,
      entry: {
        timestamp: 1,
        sessionId: ("0x" + "00".repeat(32)) as Hex,
        parentMandateId: ("0x" + "33".repeat(32)) as Hex,
        triggerEvent: { kind: "session-start" },
        candidatesConsidered: [],
        spawnedSubMandateIds: [],
        promptTemplate: "frost-planner-v1",
        modelUsed: "m",
        inferenceCallId: "i",
      },
    };
  }

  it("issues an executor with the session's CALLABLE_SURFACE + TTL caveats", async () => {
    const seen: Array<readonly Caveat[]> = [];
    const issue: SubMandateIssuer = async (p) => {
      seen.push(p.caveats);
      return { mandateId: ("0x" + "aa".repeat(32)) as Hex, txHash: ("0x" + "bb".repeat(32)) as Hex };
    };

    const result = await translatePlan(planWith(decision("executor", ["CAP_ONCHAIN_EXECUTION"])), {
      issue,
      encodeCaveats: defaultCaveatEncoder,
      provisionHolder: async () => ("0x" + "44".repeat(20)) as Address,
      nextNonce: nonceCounter(0n),
      enrich: makeEnricher(ctx()),
    });

    expect(result.outcomes[0]?.status).toBe("issued");
    const types = seen[0]!.map((c) => c.caveatType);
    expect(types).toContain(CAVEAT_TYPE.CALLABLE_SURFACE);
    expect(types).toContain(CAVEAT_TYPE.TTL_EXPIRY);
  });

  it("fails only the misconfigured spawn, leaving the rest issued (§10.5)", async () => {
    const issue: SubMandateIssuer = async () => ({
      mandateId: ("0x" + "aa".repeat(32)) as Hex,
      txHash: ("0x" + "bb".repeat(32)) as Hex,
    });

    // comms role, but the session has no comms template → that spawn fails;
    // the pricer alongside it still issues.
    const result = await translatePlan(
      planWith(
        decision("pricer", ["CAP_RPC_READ"]),
        decision("comms", ["CAP_COMMS_POST"]),
      ),
      {
        issue,
        encodeCaveats: defaultCaveatEncoder,
        provisionHolder: async () => ("0x" + "44".repeat(20)) as Address,
        nextNonce: nonceCounter(0n),
        enrich: makeEnricher(ctx({ commsTemplate: null })),
      },
    );

    expect(result.outcomes.find((o) => o.role === "pricer")?.status).toBe("issued");
    const comms = result.outcomes.find((o) => o.role === "comms");
    expect(comms?.status).toBe("failed");
    expect(comms?.error).toMatch(/comms template/);
    expect(result.spawnedSubMandateIds).toHaveLength(1);
  });
});
