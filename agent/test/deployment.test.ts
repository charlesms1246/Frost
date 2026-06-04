import { describe, expect, it } from "vitest";
import { CAVEAT_TYPE, decodeCallableSurface } from "@frost/sdk";
import {
  BASE_SEPOLIA_DEPLOYMENT,
  BASE_SEPOLIA_SWAP_ROUTER_02,
  DEFAULT_PER_CALL_CAP_USDC,
  deploymentConfigFor,
  surfaceFrom,
} from "../src/orchestrate/deployment.js";
import { sessionContextFrom } from "../src/orchestrate/session-context.js";
import { makeEnricher } from "../src/orchestrate/enrich.js";
import { defaultCaveatEncoder } from "../src/translate/caveat-encoder.js";
import type { CompiledSpec } from "../src/compile/types.js";
import type { SpawnDecision } from "../src/types.js";

function spec(overrides: Partial<CompiledSpec> = {}): CompiledSpec {
  return {
    description: "swap WETH for USDC at the best rate",
    spendCapTotal: 50_000_000n,
    hitlThreshold: 5_000_000n,
    slippageBps: 50,
    expiryUnixSeconds: 1_900_000_000n,
    redelegationBounds: { maxSubMandates: 6, maxAggregateBudget: 50_000_000n },
    rateLimit: { capacity: 30, refillRatePerSec: 1 },
    ...overrides,
  };
}

const executorDecision: SpawnDecision = {
  role: "executor",
  proposedCaveats: { capabilities: ["CAP_ONCHAIN_EXECUTION"], spendCapTotal: 10_000_000n },
  estimatedTokenCost: 0n,
  reasoning: "",
  decision: "spawned",
};

describe("deployment config", () => {
  it("derives the canonical Uniswap SwapRouter02 selectors from signatures (H-15 guard)", () => {
    // toFunctionSelector(signature) must reproduce the well-known 4-byte selectors;
    // a typo in our signature strings would change these.
    const surface = BASE_SEPOLIA_DEPLOYMENT.callableSurface;
    const selectors = surface.map((e) => e.selector);
    expect(selectors).toContain("0x04e45aaf"); // exactInputSingle(...)
    expect(selectors).toContain("0xb858183f"); // exactInput(...)
  });

  it("targets the Base Sepolia router with the deployment per-call ceiling", () => {
    for (const e of BASE_SEPOLIA_DEPLOYMENT.callableSurface) {
      expect(e.target).toBe(BASE_SEPOLIA_SWAP_ROUTER_02);
      expect(e.maxValue).toBe(DEFAULT_PER_CALL_CAP_USDC);
    }
  });

  it("seeds the three on-chain-approved settlement providers", () => {
    expect(BASE_SEPOLIA_DEPLOYMENT.approvedProviders).toEqual([
      "0x34BED22FA0950b1ff69B61E549D7509e34F85D5b",
      "0x759FEf5547F90C8Aaa34835595A269F3a7D7B892",
      "0xd93A30882E42E7b77f15f8e3f899c695C1f46353",
    ]);
  });

  it("surfaceFrom carries target + maxValue and derives the selector", () => {
    const [entry] = surfaceFrom([
      { target: BASE_SEPOLIA_SWAP_ROUTER_02, signature: "exactInput((bytes,address,uint256,uint256))", maxValue: 7n },
    ]);
    expect(entry).toEqual({
      target: BASE_SEPOLIA_SWAP_ROUTER_02,
      selector: "0xb858183f",
      maxValue: 7n,
    });
  });

  it("resolves Base Sepolia by chain id and rejects others", () => {
    expect(deploymentConfigFor(84532)).toBe(BASE_SEPOLIA_DEPLOYMENT);
    expect(() => deploymentConfigFor(8453)).toThrow(/no deployment config/);
  });

  it("flows real config → context → enricher → encoded CALLABLE_SURFACE, byte-tied (I-16)", () => {
    const ctx = sessionContextFrom(spec(), BASE_SEPOLIA_DEPLOYMENT);
    const enriched = makeEnricher(ctx)(executorDecision);

    const caveats = defaultCaveatEncoder(enriched);
    const surfaceCaveat = caveats.find((c) => c.caveatType === CAVEAT_TYPE.CALLABLE_SURFACE);
    expect(surfaceCaveat).toBeDefined();

    // Decoding the signed bytes back must reproduce exactly the deployment surface —
    // proving the executor is authorized against the same (target, selector, maxValue)
    // triples we configured, with no drift through encoding.
    const decoded = decodeCallableSurface(surfaceCaveat!);
    expect(decoded.map((e) => ({ ...e }))).toEqual(BASE_SEPOLIA_DEPLOYMENT.callableSurface);
  });
});
