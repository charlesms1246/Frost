import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { paraswapQuote, type AggregatorFetch } from "../src/pricer/sources/paraswap.js";

const WETH = "0x4200000000000000000000000000000000000006" as Address;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;

const REQ = {
  tokenIn: WETH,
  tokenOut: USDC,
  amountIn: 10n ** 18n,
  srcDecimals: 18,
  destDecimals: 6,
  chainId: 8453,
};

function fetchOf(body: string, ok = true, status = 200): { fn: AggregatorFetch; urls: string[] } {
  const urls: string[] = [];
  const fn: AggregatorFetch = async (url) => {
    urls.push(url);
    return { ok, status, async text() { return body; } };
  };
  return { fn, urls };
}

describe("paraswapQuote (aggregator source)", () => {
  it("parses priceRoute.destAmount into a bigint", async () => {
    const { fn } = fetchOf(JSON.stringify({ priceRoute: { destAmount: "1656899789" } }));
    const out = await paraswapQuote(REQ, { fetchImpl: fn });
    expect(out).toBe(1656899789n);
  });

  it("builds a SELL price query with both decimals and the chain id", async () => {
    const { fn, urls } = fetchOf(JSON.stringify({ priceRoute: { destAmount: "1" } }));
    await paraswapQuote(REQ, { fetchImpl: fn, baseUrl: "https://api.paraswap.io/" });
    const url = urls[0]!;
    expect(url).toContain("https://api.paraswap.io/prices?");
    expect(url).toContain(`srcToken=${WETH}`);
    expect(url).toContain(`destToken=${USDC}`);
    expect(url).toContain("amount=1000000000000000000");
    expect(url).toContain("srcDecimals=18");
    expect(url).toContain("destDecimals=6");
    expect(url).toContain("side=SELL");
    expect(url).toContain("network=8453");
  });

  it("throws on a non-OK HTTP status", async () => {
    const { fn } = fetchOf("rate limited", false, 429);
    await expect(paraswapQuote(REQ, { fetchImpl: fn })).rejects.toThrow(/429/);
  });

  it("throws when the response has no destAmount", async () => {
    const { fn } = fetchOf(JSON.stringify({ error: "No routes found" }));
    await expect(paraswapQuote(REQ, { fetchImpl: fn })).rejects.toThrow(/destAmount/);
  });

  it("throws on invalid JSON", async () => {
    const { fn } = fetchOf("<html>maintenance</html>");
    await expect(paraswapQuote(REQ, { fetchImpl: fn })).rejects.toThrow(/invalid JSON/);
  });
});
