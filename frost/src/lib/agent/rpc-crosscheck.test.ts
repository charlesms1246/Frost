import { describe, expect, it } from "vitest";
import { encodeAbiParameters, type Address, type Hex } from "viem";
import { crossCheckedSepoliaQuote, type EthCallFor } from "./rpc-crosscheck";

const WETH = "0x4200000000000000000000000000000000000006" as Address;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const quoteReturn = (amountOut: bigint): Hex =>
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }],
    [amountOut, 0n, 0, 0n],
  );

/** Map each RPC url → the amountOut it reports (same for every fee tier it's asked). */
function callForMap(byUrl: Record<string, bigint | "error">): EthCallFor {
  return (url) => async () => {
    const v = byUrl[url];
    if (v === undefined || v === "error") throw new Error(`rpc ${url} down`);
    return quoteReturn(v);
  };
}

const REQ = {
  tokenIn: WETH,
  tokenOut: USDC,
  amountInWei: 1_000_000_000_000_000n,
  slippageBps: 50, // 0.50%
};

describe("crossCheckedSepoliaQuote (T-34c secondary-RPC cross-check)", () => {
  const rpcUrls = ["https://a", "https://b", "https://c"];

  it("corroborates when a quorum agrees, using the conservative cluster minimum", async () => {
    // a/b agree ~1.65, c slightly lower but within 1% → all cluster; min = 1_640_000.
    const callFor = callForMap({ "https://a": 1_650_000n, "https://b": 1_648_000n, "https://c": 1_640_000n });
    const r = await crossCheckedSepoliaQuote({ ...REQ, rpcUrls, callFor });
    expect(r.corroborated).toBe(true);
    expect(r.agree).toBe(3);
    expect(r.amountOut).toBe(1_640_000n); // smallest in the cluster
    expect(r.amountOutMinimum).toBe((1_640_000n * 9_950n) / 10_000n);
  });

  it("excludes an outlier RPC but still corroborates on the remaining quorum", async () => {
    // c is a wild outlier (low-ball, ~24% below) → outside tolerance, dropped; a/b agree.
    const callFor = callForMap({ "https://a": 1_650_000n, "https://b": 1_652_000n, "https://c": 1_250_000n });
    const r = await crossCheckedSepoliaQuote({ ...REQ, rpcUrls, callFor, toleranceBps: 100 });
    expect(r.corroborated).toBe(true);
    expect(r.agree).toBe(2);
    expect(r.amountOut).toBe(1_650_000n); // min of the agreeing cluster (a,b), not the outlier
  });

  it("is NOT corroborated when too few providers respond", async () => {
    const callFor = callForMap({ "https://a": 1_650_000n, "https://b": "error", "https://c": "error" });
    const r = await crossCheckedSepoliaQuote({ ...REQ, rpcUrls, callFor, minAgree: 2 });
    expect(r.corroborated).toBe(false);
    expect(r.responded).toBe(1);
    expect(r.amountOutMinimum).toBe(0n); // caller falls back to safe params
  });

  it("is NOT corroborated when providers disagree beyond tolerance (no quorum cluster)", async () => {
    // Three mutually-far values → no 2 within 1% of the median → no quorum.
    const callFor = callForMap({ "https://a": 1_000_000n, "https://b": 1_500_000n, "https://c": 2_000_000n });
    const r = await crossCheckedSepoliaQuote({ ...REQ, rpcUrls, callFor, toleranceBps: 100, minAgree: 2 });
    expect(r.corroborated).toBe(false);
    expect(r.spreadBps).toBeGreaterThan(100);
  });
});
