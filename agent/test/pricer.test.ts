import {
  encodeFunctionResult,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { Pricer, type QuoteSource } from "../src/pricer/pricer.js";
import type { RpcCall, RpcResult, RpcTransport } from "../src/pricer/venice-rpc.js";
import { uniswapV3Source } from "../src/pricer/sources/uniswap-v3.js";

const TOKEN_IN = ("0x" + "11".repeat(20)) as Address;
const TOKEN_OUT = ("0x" + "22".repeat(20)) as Address;
const QUOTER = ("0x" + "33".repeat(20)) as Address;
const REQ = { tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: 1_000_000n };

/** Mock transport: returns canned results, records every batch call for assertions. */
function mockRpc(results: RpcResult[]): RpcTransport & { calls: RpcCall[][] } {
  const calls: RpcCall[][] = [];
  return {
    calls,
    async batch(c: RpcCall[]) {
      calls.push(c);
      return results;
    },
  };
}

/** Trivial source: the result hex IS the amountOut (BigInt-decoded). */
function fakeSource(name: string): QuoteSource {
  return {
    name,
    buildCall: () => ({ method: "eth_call", params: [] }),
    decode: (hex) => BigInt(hex),
  };
}

describe("Pricer", () => {
  it("sends exactly ONE batch regardless of source count (spike 2)", async () => {
    const rpc = mockRpc([
      { result: toHex(100n) },
      { result: toHex(200n) },
      { result: toHex(150n) },
    ]);
    const sources = [fakeSource("a"), fakeSource("b"), fakeSource("c")];
    await new Pricer(rpc).quote(REQ, sources);

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0]).toHaveLength(3);
  });

  it("normalizes and ranks quotes, picking the largest amountOut as best", async () => {
    const rpc = mockRpc([{ result: toHex(100n) }, { result: toHex(200n) }, { result: toHex(150n) }]);
    const res = await new Pricer(rpc).quote(REQ, [
      fakeSource("a"),
      fakeSource("b"),
      fakeSource("c"),
    ]);

    expect(res.quotes.map((q) => q.source)).toEqual(["b", "c", "a"]);
    expect(res.best).toEqual({ source: "b", amountOut: 200n });
    expect(res.failed).toHaveLength(0);
  });

  it("records per-source failures (RPC error, empty, undecodable) without aborting", async () => {
    const throwing: QuoteSource = {
      name: "thrower",
      buildCall: () => ({ method: "eth_call", params: [] }),
      decode: () => {
        throw new Error("bad decode");
      },
    };
    const rpc = mockRpc([
      { error: { code: -32000, message: "execution reverted" } }, // reverted
      { result: toHex(500n) }, // ok
      {}, // empty result
      { result: toHex(999n) }, // valid hex, but `thrower` rejects it
    ]);
    const res = await new Pricer(rpc).quote(REQ, [
      fakeSource("reverted"),
      fakeSource("ok"),
      fakeSource("empty"),
      throwing,
    ]);

    expect(res.best).toEqual({ source: "ok", amountOut: 500n });
    expect(res.failed.map((f) => f.source).sort()).toEqual(["empty", "reverted", "thrower"]);
    expect(res.failed.find((f) => f.source === "reverted")?.error).toMatch(/reverted/);
  });

  it("returns an empty result for no sources (and makes no RPC call)", async () => {
    const rpc = mockRpc([]);
    const res = await new Pricer(rpc).quote(REQ, []);
    expect(res).toEqual({ quotes: [], failed: [], best: null });
    expect(rpc.calls).toHaveLength(0);
  });
});

describe("uniswapV3Source", () => {
  const QUOTER_V2_OUTPUT_ABI: Abi = [
    {
      type: "function",
      name: "quoteExactInputSingle",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "params",
          type: "tuple",
          components: [
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "amountIn", type: "uint256" },
            { name: "fee", type: "uint24" },
            { name: "sqrtPriceLimitX96", type: "uint160" },
          ],
        },
      ],
      outputs: [
        { name: "amountOut", type: "uint256" },
        { name: "sqrtPriceX96After", type: "uint160" },
        { name: "initializedTicksCrossed", type: "uint32" },
        { name: "gasEstimate", type: "uint256" },
      ],
    },
  ];

  it("builds an eth_call to the quoter and decodes amountOut", () => {
    const source = uniswapV3Source({ quoter: QUOTER, fee: 500 });
    expect(source.name).toBe("uniswap-v3-500");

    const call = source.buildCall(REQ);
    expect(call.method).toBe("eth_call");
    const params = call.params as [{ to: Address; data: Hex }, string];
    expect(params[0].to).toBe(QUOTER);
    expect(params[0].data.startsWith("0x")).toBe(true);
    expect(params[1]).toBe("latest");

    const canned = encodeFunctionResult({
      abi: QUOTER_V2_OUTPUT_ABI,
      functionName: "quoteExactInputSingle",
      result: [1_234_567n, 0n, 0, 0n],
    });
    expect(source.decode(canned)).toBe(1_234_567n);
  });

  it("composes with Pricer to pick the best fee tier in one batch", async () => {
    const tiers = [500, 3000, 10000].map((fee) => uniswapV3Source({ quoter: QUOTER, fee }));
    const out = (n: bigint): Hex =>
      encodeFunctionResult({
        abi: QUOTER_V2_OUTPUT_ABI,
        functionName: "quoteExactInputSingle",
        result: [n, 0n, 0, 0n],
      });
    const rpc = mockRpc([{ result: out(900n) }, { result: out(1_000n) }, { result: out(800n) }]);
    const spy = vi.spyOn(rpc, "batch");

    const res = await new Pricer(rpc).quote(REQ, tiers);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.best).toEqual({ source: "uniswap-v3-3000", amountOut: 1_000n });
  });
});
