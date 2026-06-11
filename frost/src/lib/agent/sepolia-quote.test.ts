import { describe, expect, it } from "vitest";
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { quoteBestSepoliaRoute, type EthCall } from "./sepolia-quote";

const WETH = "0x4200000000000000000000000000000000000006" as Address;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

/** Encode a QuoterV2 quoteExactInputSingle return (amountOut + 3 trailing values). */
const quoteReturn = (amountOut: bigint): Hex =>
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }],
    [amountOut, 0n, 0, 0n],
  );

const REQ = {
  rpcUrl: "http://sepolia.test",
  tokenIn: WETH,
  tokenOut: USDC,
  amountInWei: 1_000_000_000_000_000n, // 0.001 WETH
  slippageBps: 50, // 0.50%
};

describe("quoteBestSepoliaRoute (closed-loop pre-trade quote)", () => {
  it("picks the highest-output fee tier and applies slippage to the floor", async () => {
    // tier 500 → 1.500000 USDC, tier 3000 → 1.600000 USDC → 3000 wins.
    const byTier: Record<number, bigint> = {};
    const ethCall: EthCall = async (_to, data) => {
      // The fee is the 4th tuple word; decode is overkill — infer by call order instead.
      const n = Object.keys(byTier).length;
      byTier[n] = 0n;
      return quoteReturn(n === 0 ? 1_500_000n : 1_600_000n);
    };
    const route = await quoteBestSepoliaRoute({ ...REQ, ethCall });
    expect(route).not.toBeNull();
    expect(route!.fee).toBe(3000);
    expect(route!.amountOut).toBe(1_600_000n);
    // 1_600_000 * (10000-50)/10000 = 1_592_000
    expect(route!.amountOutMinimum).toBe(1_592_000n);
  });

  it("skips a tier that reverts and still returns the other", async () => {
    let call = 0;
    const ethCall: EthCall = async () => {
      call += 1;
      if (call === 1) throw new Error("execution reverted: no pool");
      return quoteReturn(1_650_000n);
    };
    const route = await quoteBestSepoliaRoute({ ...REQ, ethCall });
    expect(route?.amountOut).toBe(1_650_000n);
  });

  it("returns null when every tier fails (caller falls back to proven params)", async () => {
    const ethCall: EthCall = async () => { throw new Error("rpc down"); };
    expect(await quoteBestSepoliaRoute({ ...REQ, ethCall })).toBeNull();
  });

  it("ignores a zero-output quote", async () => {
    const ethCall: EthCall = async () => quoteReturn(0n);
    expect(await quoteBestSepoliaRoute({ ...REQ, ethCall, feeTiers: [3000] })).toBeNull();
  });
});
