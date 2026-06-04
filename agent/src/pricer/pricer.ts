import type { Address, Hex } from "viem";
import type { RpcCall, RpcResult, RpcTransport } from "./venice-rpc.js";

/**
 * Pricer sub-agent runtime: fetch quotes from one or more on-chain sources for a
 * single (tokenIn → tokenOut, amountIn) request, in ONE batched RPC round-trip,
 * then normalize and rank them.
 *
 * The planner spawns a pricer per DEX; each pricer compares its own routes (e.g.
 * Uniswap v3 fee tiers) here and reports its best, and the master compares across
 * pricers. The single-batch contract is load-bearing: spike 2 showed a JSON-RPC
 * batch counts as one Venice request, so however many sources are passed, exactly
 * one {@link RpcTransport.batch} call is made.
 *
 * All sources must quote the SAME (tokenIn → tokenOut, amountIn), so their
 * `amountOut` values are directly comparable — "normalization" here is just that
 * shared denomination, and "best" is the largest `amountOut`.
 */

export interface QuoteRequest {
  tokenIn: Address;
  tokenOut: Address;
  /** Input amount in tokenIn base units. */
  amountIn: bigint;
}

/**
 * A quote venue. `buildCall` turns the request into one JSON-RPC call (typically
 * an `eth_call` to a quoter contract); `decode` turns that call's raw result into
 * an `amountOut` in tokenOut base units. A source that cannot quote should throw
 * in `decode` — the pricer records it as a failed source, not a crash.
 */
export interface QuoteSource {
  name: string;
  buildCall(req: QuoteRequest): RpcCall;
  decode(result: Hex): bigint;
}

export interface Quote {
  source: string;
  amountOut: bigint;
}

export interface FailedQuote {
  source: string;
  error: string;
}

export interface QuoteResult {
  /** Successful quotes, sorted best (largest amountOut) first. */
  quotes: Quote[];
  /** Sources that errored (RPC error or undecodable result). */
  failed: FailedQuote[];
  /** The best quote, or `null` when every source failed. */
  best: Quote | null;
}

export class Pricer {
  constructor(private readonly rpc: RpcTransport) {}

  async quote(req: QuoteRequest, sources: QuoteSource[]): Promise<QuoteResult> {
    if (sources.length === 0) return { quotes: [], failed: [], best: null };

    const calls = sources.map((s) => s.buildCall(req));
    // The single batched round-trip — N sources, 1 Venice request (spike 2).
    const results = await this.rpc.batch(calls);

    const quotes: Quote[] = [];
    const failed: FailedQuote[] = [];

    sources.forEach((source, i) => {
      const r: RpcResult | undefined = results[i];
      if (!r || r.error) {
        failed.push({ source: source.name, error: r?.error?.message ?? "no result" });
        return;
      }
      if (r.result === undefined) {
        failed.push({ source: source.name, error: "empty result" });
        return;
      }
      try {
        const amountOut = source.decode(r.result);
        quotes.push({ source: source.name, amountOut });
      } catch (err) {
        failed.push({
          source: source.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    quotes.sort((a, b) => (a.amountOut < b.amountOut ? 1 : a.amountOut > b.amountOut ? -1 : 0));
    return { quotes, failed, best: quotes[0] ?? null };
  }
}
