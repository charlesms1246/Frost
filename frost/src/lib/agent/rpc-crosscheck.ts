import { createPublicClient, http, type Address } from "viem";
import { quoteBestSepoliaRoute, type EthCall } from "./sepolia-quote";

/**
 * Secondary-RPC cross-check for the executor's high-value pre-trade read (T-34c).
 *
 * The executor's `amountOutMinimum` floor is derived from a live Base Sepolia quote.
 * Reading that from a SINGLE provider is a trust dependency — a lying/stale RPC could
 * hand back a low-balled quote, producing a loose floor that invites a sandwich. So we
 * quote the swap across SEVERAL independent RPCs and only trust a floor that a quorum
 * corroborates (within a tolerance); otherwise the caller falls back to safe params.
 *
 * (Pricer/monitor read Venice on Base MAINNET; this cross-check is the Base SEPOLIA
 * read on the execution path, so it diversifies the single-RPC dependency where the
 * load-bearing settlement floor is actually set.)
 */

/**
 * Independent Base Sepolia HTTP RPCs to corroborate across. The `wss://` PublicNode
 * endpoint is intentionally omitted — WebSocket is for subscriptions (`eth_subscribe`),
 * not the HTTP `eth_call` used here.
 */
export const BASE_SEPOLIA_RPCS = [
  "https://base-sepolia-rpc.publicnode.com",
  "https://base-testnet.api.pocket.network",
  "https://base-sepolia.drpc.org",
  "https://sepolia.base.org",
];

/** Builds an {@link EthCall} bound to one RPC URL. Injectable for tests. */
export type EthCallFor = (rpcUrl: string) => EthCall;

const viemEthCallFor: EthCallFor = (url) => {
  const client = createPublicClient({ transport: http(url) });
  return async (to, data) => ((await client.call({ to, data })).data ?? "0x") as `0x${string}`;
};

export interface CrossCheckedRoute {
  fee: number;
  /** Conservative output: the SMALLEST amountOut in the agreeing cluster (tightest honest floor). */
  amountOut: bigint;
  /** amountOut · (1 − slippage). */
  amountOutMinimum: bigint;
  /** True when ≥ `minAgree` providers agreed within `toleranceBps`. */
  corroborated: boolean;
  /** Providers in the agreeing cluster / providers that returned a quote at all. */
  agree: number;
  responded: number;
  total: number;
  /** Max−min spread across responding providers, in bps of the median. */
  spreadBps: number;
  providers: { url: string; amountOut?: string; error?: string }[];
}

type OkQuote = { url: string; fee: number; amountOut: bigint };
type QuoteOutcome = OkQuote | { url: string; error: string };

export interface CrossCheckParams {
  tokenIn: Address;
  tokenOut: Address;
  amountInWei: bigint;
  slippageBps: number;
  rpcUrls?: string[];
  /** Providers that must agree within tolerance to corroborate. Default 2. */
  minAgree?: number;
  /** Agreement band around the median, in bps. Default 100 (1%). */
  toleranceBps?: number;
  quoter?: Address;
  /** Test injection; defaults to viem public clients per URL. */
  callFor?: EthCallFor;
}

/**
 * Quote the swap on each RPC, cluster the results around the median within
 * `toleranceBps`, and return a corroborated route when ≥ `minAgree` providers fall in
 * that cluster. The floor uses the cluster's MIN (conservative). `corroborated: false`
 * (too few responses, or no quorum) tells the caller to fall back to safe params.
 */
export async function crossCheckedSepoliaQuote(p: CrossCheckParams): Promise<CrossCheckedRoute> {
  const rpcUrls = p.rpcUrls ?? BASE_SEPOLIA_RPCS;
  const callFor = p.callFor ?? viemEthCallFor;
  const minAgree = p.minAgree ?? 2;
  const toleranceBps = p.toleranceBps ?? 100;

  const quotes = await Promise.all(
    rpcUrls.map(async (url): Promise<QuoteOutcome> => {
      try {
        const r = await quoteBestSepoliaRoute({
          rpcUrl: url,
          tokenIn: p.tokenIn,
          tokenOut: p.tokenOut,
          amountInWei: p.amountInWei,
          slippageBps: p.slippageBps,
          ...(p.quoter ? { quoter: p.quoter } : {}),
          ethCall: callFor(url),
        });
        return r && r.amountOut > 0n
          ? { url, fee: r.fee, amountOut: r.amountOut }
          : { url, error: "no pool / zero quote" };
      } catch (e) {
        return { url, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  const ok = quotes.filter((q): q is OkQuote => "amountOut" in q && q.amountOut > 0n);
  const providers = quotes.map((q) =>
    "amountOut" in q ? { url: q.url, amountOut: q.amountOut.toString() } : { url: q.url, error: q.error },
  );
  const base: Omit<CrossCheckedRoute, "fee" | "amountOut" | "amountOutMinimum" | "corroborated" | "agree" | "spreadBps"> = {
    responded: ok.length,
    total: rpcUrls.length,
    providers,
  };

  if (ok.length < minAgree) {
    return { fee: 0, amountOut: 0n, amountOutMinimum: 0n, corroborated: false, agree: ok.length, spreadBps: 0, ...base };
  }

  const amounts = ok.map((q) => q.amountOut).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const median = amounts[Math.floor(amounts.length / 2)] ?? 0n;
  const lo = (median * BigInt(10_000 - toleranceBps)) / 10_000n;
  const hi = (median * BigInt(10_000 + toleranceBps)) / 10_000n;
  const cluster = ok.filter((q) => q.amountOut >= lo && q.amountOut <= hi);

  const min = amounts[0] ?? 0n;
  const max = amounts[amounts.length - 1] ?? 0n;
  const spreadBps = median === 0n ? 0 : Number(((max - min) * 10_000n) / median);

  // Conservative floor: smallest amountOut in the agreeing cluster (no bare index access).
  const clusterMin = cluster.reduce<bigint | null>((m, q) => (m === null || q.amountOut < m ? q.amountOut : m), null) ?? 0n;
  const slippage = BigInt(Math.max(0, Math.min(10_000, Math.round(p.slippageBps))));
  return {
    fee: cluster[0]?.fee ?? 0,
    amountOut: clusterMin,
    amountOutMinimum: (clusterMin * (10_000n - slippage)) / 10_000n,
    corroborated: cluster.length >= minAgree,
    agree: cluster.length,
    spreadBps,
    ...base,
  };
}
