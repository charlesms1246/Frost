import { describe, expect, it } from "vitest";
import { encodeFunctionResult, type Address, type Hex } from "viem";
import { priceThresholdCondition } from "../src/monitor/conditions/price-threshold.js";
import { QUOTER_V2_ABI } from "../src/pricer/sources/uniswap-v3.js";
import { Monitor } from "../src/monitor/monitor.js";
import type { RpcCall, RpcResult, RpcTransport } from "../src/pricer/venice-rpc.js";

const QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as Address;
const WETH = "0x4200000000000000000000000000000000000006" as Address;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;

/** Encode a valid QuoterV2 `quoteExactInputSingle` return with the given amountOut. */
function quoterResult(amountOut: bigint): Hex {
  return encodeFunctionResult({
    abi: QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    result: [amountOut, 0n, 0, 0n] as never,
  });
}

function condition(direction: "below" | "above", threshold: bigint) {
  return priceThresholdCondition({
    quoter: QUOTER,
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: 10n ** 18n,
    fee: 500,
    threshold,
    direction,
  });
}

describe("priceThresholdCondition", () => {
  it("pins the eth_call to the supplied block and targets the quoter", () => {
    const calls = condition("below", 2_800_000_000n).buildCalls("0x61");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("eth_call");
    const [tx, block] = call.params as [{ to: Address; data: Hex }, string];
    expect(tx.to).toBe(QUOTER);
    expect(block).toBe("0x61");
  });

  it("`below` fires when amountOut is under the threshold, not at or above it", () => {
    const cond = condition("below", 2_800_000_000n);
    expect(cond.evaluate([{ result: quoterResult(2_799_000_000n) }])).toBe(true);
    expect(cond.evaluate([{ result: quoterResult(2_800_000_000n) }])).toBe(false);
    expect(cond.evaluate([{ result: quoterResult(2_801_000_000n) }])).toBe(false);
  });

  it("`above` fires when amountOut is over the threshold", () => {
    const cond = condition("above", 3_000_000_000n);
    expect(cond.evaluate([{ result: quoterResult(3_000_000_001n) }])).toBe(true);
    expect(cond.evaluate([{ result: quoterResult(3_000_000_000n) }])).toBe(false);
  });

  it("throws (→ monitor error) when the quoter result is missing", () => {
    expect(() => condition("below", 1n).evaluate([{}])).toThrow(/missing quoter result/);
  });

  it("composes with the Monitor: head → confirmed quote → fired", async () => {
    const rpc: RpcTransport = {
      async batch(calls: RpcCall[]): Promise<RpcResult[]> {
        if (calls[0]?.method === "eth_blockNumber") return [{ result: "0x64" as Hex }]; // 100
        return [{ result: quoterResult(2_700_000_000n) }]; // below 2,800
      },
    };
    const res = await new Monitor(rpc).check(condition("below", 2_800_000_000n));
    expect(res.status).toBe("fired");
    if (res.status === "fired") expect(res.confirmedBlock).toBe(97n);
  });
});
