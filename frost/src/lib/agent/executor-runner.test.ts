import { describe, expect, it } from "vitest";
import {
  sessionContextFrom,
  BASE_SEPOLIA_DEPLOYMENT,
  BASE_SEPOLIA_SWAP_ROUTER_02,
  type CompiledSpec,
  type OneShotFetch,
} from "@frost/agent/browser";
import { makeExecutorRunner, makeSimulatedExecutorRunner } from "./executor-runner";
import { vi } from "vitest";

/**
 * The executor runner end-to-end with 1Shot mocked: it runs the §10.3 preflight
 * against the session's CALLABLE_SURFACE and submits through the fetch-based 1Shot
 * REST relay — no live write.
 */

const spec: CompiledSpec = {
  description: "swap WETH→USDC at the best rate",
  spendCapTotal: 50_000_000n,
  hitlThreshold: 5_000_000n,
  slippageBps: 50,
  expiryUnixSeconds: 1_900_000_000n,
  redelegationBounds: { maxSubMandates: 6, maxAggregateBudget: 50_000_000n },
  rateLimit: { capacity: 10, refillRatePerSec: 1 },
};

const context = sessionContextFrom(spec, BASE_SEPOLIA_DEPLOYMENT);

const EXACT_INPUT_SINGLE = "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))";

/** A 1Shot fetch that answers /token then /execute. */
function oneShotFetch(tx: { id: string; status: string; transactionHash: string | null }): OneShotFetch {
  return async (url) => {
    if (url.endsWith("/token")) {
      return { ok: true, status: 200, statusText: "OK", async json() { return { access_token: "t", expires_in: 3600 }; } };
    }
    return { ok: true, status: 200, statusText: "OK", async json() { return tx; } };
  };
}

function runner(overrides: { target?: `0x${string}`; notionalUsdc?: bigint } = {}) {
  return makeExecutorRunner({
    oneShot: { apiKey: "k", apiSecret: "s", walletId: "w-1", fetchImpl: oneShotFetch({ id: "tx-1", status: "Submitted", transactionHash: "0x" + "cd".repeat(32) }) },
    contractMethodId: "m-swap",
    swap: {
      target: overrides.target ?? BASE_SEPOLIA_SWAP_ROUTER_02,
      signature: EXACT_INPUT_SINGLE,
      notionalUsdc: overrides.notionalUsdc ?? 1_000_000n, // $1, under the $5 HITL
      params: { amountIn: "1000000000000000000" },
      slippageBps: 30,
    },
    context,
    spec,
  });
}

const outcome = { role: "executor", status: "issued" as const, mandateId: ("0x" + "ab".repeat(32)) as `0x${string}` };

describe("makeExecutorRunner", () => {
  it("preflights against CALLABLE_SURFACE and submits via 1Shot", async () => {
    const res = await runner()({ behavior: "executor", outcome });
    expect(res.ran).toBe(true);
    expect(res.detail).toMatch(/submitted tx-1 \(Submitted\)/);
  });

  it("rejects (does not submit) a target outside the call surface", async () => {
    const res = await runner({ target: ("0x" + "99".repeat(20)) as `0x${string}` })({ behavior: "executor", outcome });
    expect(res.ran).toBe(false);
    expect(res.detail).toMatch(/not in CALLABLE_SURFACE/);
  });

  it("pauses for HITL when the value exceeds the signed threshold", async () => {
    // $6 notional > $5 HITL_THRESHOLD ⇒ hitl, never submitted.
    const res = await runner({ notionalUsdc: 6_000_000n })({ behavior: "executor", outcome });
    expect(res.ran).toBe(false);
    expect(res.detail).toMatch(/exceeds HITL threshold/);
  });
});

describe("makeSimulatedExecutorRunner (HITL demo)", () => {
  it("submits the simulated swap after the gate approves", async () => {
    const requestApproval = vi.fn().mockResolvedValue(true);
    const r = makeSimulatedExecutorRunner({ context, spec, notionalUsdc: 12_000_000n, requestApproval });
    const res = await r({ behavior: "executor", outcome });
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requestApproval.mock.calls[0]![0]).toMatchObject({ notionalUsdc: 12_000_000n });
    expect(res.ran).toBe(true);
    expect(res.detail).toMatch(/simulated swap sim-1 \(\$12\.00\)/);
  });

  it("does not submit when the gate is declined", async () => {
    const r = makeSimulatedExecutorRunner({ context, spec, notionalUsdc: 12_000_000n, requestApproval: async () => false });
    const res = await r({ behavior: "executor", outcome });
    expect(res.ran).toBe(false);
    expect(res.detail).toMatch(/human declined/);
  });

  it("submits without the gate for a sub-threshold notional", async () => {
    const requestApproval = vi.fn().mockResolvedValue(true);
    const r = makeSimulatedExecutorRunner({ context, spec, notionalUsdc: 1_000_000n, requestApproval });
    const res = await r({ behavior: "executor", outcome });
    expect(requestApproval).not.toHaveBeenCalled();
    expect(res.ran).toBe(true);
  });
});
