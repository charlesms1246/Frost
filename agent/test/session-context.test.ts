import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { CAVEAT_TYPE, type CallableSurfaceEntry } from "@frost/sdk";
import {
  sessionContextFrom,
  type DeploymentConfig,
} from "../src/orchestrate/session-context.js";
import { makeEnricher } from "../src/orchestrate/enrich.js";
import { defaultCaveatEncoder } from "../src/translate/caveat-encoder.js";
import type { CompiledSpec } from "../src/compile/types.js";
import type { SpawnDecision } from "../src/types.js";

const VENICE = ("0x" + "11".repeat(20)) as Address;
const ROUTER: CallableSurfaceEntry = {
  target: ("0x" + "22".repeat(20)) as Address,
  selector: "0x12345678" as Hex,
  maxValue: 5_000_000n,
};

function spec(overrides: Partial<CompiledSpec> = {}): CompiledSpec {
  return {
    description: "compare and report",
    spendCapTotal: 50_000_000n,
    hitlThreshold: 5_000_000n,
    slippageBps: 50,
    expiryUnixSeconds: 1_900_000_000n,
    redelegationBounds: { maxSubMandates: 6, maxAggregateBudget: 50_000_000n },
    rateLimit: { capacity: 30, refillRatePerSec: 1 },
    ...overrides,
  };
}

const config: DeploymentConfig = {
  approvedProviders: [VENICE],
  callableSurface: [ROUTER],
};

describe("sessionContextFrom", () => {
  it("maps the signed spec's expiry + the deployment config", () => {
    const ctx = sessionContextFrom(spec(), config);
    expect(ctx.expiryUnixSeconds).toBe(1_900_000_000n);
    expect(ctx.providerWhitelist).toEqual([VENICE]);
    expect(ctx.callableSurface).toEqual([ROUTER]);
    expect(ctx.commsTemplate).toBeUndefined();
  });

  it("carries the comms template only when the session has one", () => {
    const withComms = sessionContextFrom(
      spec({ commsTemplate: { text: "Best: ${rate}", variables: [{ name: "rate", source: "numeric" }] } }),
      config,
    );
    expect(withComms.commsTemplate?.text).toBe("Best: ${rate}");
  });

  it("composes spec → context → enricher → encoded comms caveat end-to-end", () => {
    const ctx = sessionContextFrom(
      spec({ commsTemplate: { text: "hi ${x}", variables: [{ name: "x", source: "numeric" }] } }),
      config,
    );
    const enrich = makeEnricher(ctx);

    const commsDecision: SpawnDecision = {
      role: "comms",
      proposedCaveats: { capabilities: ["CAP_COMMS_POST"], spendCapTotal: 1_000_000n },
      estimatedTokenCost: 0n,
      reasoning: "",
      decision: "spawned",
    };

    const caveats = defaultCaveatEncoder(enrich(commsDecision));
    const types = caveats.map((c) => c.caveatType);
    expect(types).toContain(CAVEAT_TYPE.COMMS_TEMPLATE);
    expect(types).toContain(CAVEAT_TYPE.TTL_EXPIRY);
  });
});
