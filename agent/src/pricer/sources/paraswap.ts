import type { Address } from "viem";

/**
 * Paraswap (Velora) aggregator quote source — a SECOND, genuinely different price
 * source for the pricer beyond the on-chain Uniswap v3 QuoterV2 (closes IG-01: the
 * cross-source comparison was previously Uniswap-only).
 *
 * Unlike the on-chain {@link QuoteSource}s (which fit the Venice JSON-RPC batch), an
 * aggregator routes off-chain across many venues and is queried over plain HTTPS, so
 * it is its own async client rather than a batched source — the pricer runner spawns
 * it as a DISTINCT sub-agent ("one per DEX/source"). Keyless and read-only.
 */

export interface AggregatorQuoteRequest {
  tokenIn: Address;
  tokenOut: Address;
  /** Input amount in tokenIn base units. */
  amountIn: bigint;
  /** tokenIn / tokenOut decimals (Paraswap requires both). */
  srcDecimals: number;
  destDecimals: number;
  /** EVM chain id (Base mainnet = 8453). */
  chainId: number;
}

/** GET-only fetch seam (no request body) so the source is testable without a network. */
export type AggregatorFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ParaswapQuoteOptions {
  /** API base; default `https://api.paraswap.io`. */
  baseUrl?: string;
  /** Injected fetch; defaults to the global `fetch`. */
  fetchImpl?: AggregatorFetch;
}

/** Human-facing source label. */
export const PARASWAP_SOURCE = "paraswap";

/**
 * Fetch a SELL quote (`amountIn` of tokenIn → tokenOut) from Paraswap and return the
 * output amount in tokenOut base units. Throws on transport / HTTP / parse failure so
 * the caller records a failed source rather than reporting a silent wrong number.
 */
export async function paraswapQuote(
  req: AggregatorQuoteRequest,
  opts: ParaswapQuoteOptions = {},
): Promise<bigint> {
  const base = (opts.baseUrl ?? "https://api.paraswap.io").replace(/\/$/, "");
  const f: AggregatorFetch = opts.fetchImpl ?? ((url) => fetch(url));
  const qs = new URLSearchParams({
    srcToken: req.tokenIn,
    destToken: req.tokenOut,
    amount: req.amountIn.toString(),
    srcDecimals: String(req.srcDecimals),
    destDecimals: String(req.destDecimals),
    side: "SELL",
    network: String(req.chainId),
  });
  const res = await f(`${base}/prices?${qs.toString()}`);
  if (!res.ok) throw new Error(`paraswap HTTP ${res.status}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    throw new Error("paraswap: invalid JSON");
  }
  const dest = (parsed as { priceRoute?: { destAmount?: unknown } })?.priceRoute?.destAmount;
  if (typeof dest !== "string" || !/^\d+$/.test(dest)) {
    throw new Error("paraswap: missing priceRoute.destAmount");
  }
  return BigInt(dest);
}
