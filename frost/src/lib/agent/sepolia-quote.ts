import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  type Abi,
  type Address,
  type Hex,
} from "viem";

/**
 * Live pre-trade quote on the EXECUTION chain (Base Sepolia) for the executor's
 * actual swap — the closed-loop replacement for the hardcoded `fee` / `amountOutMinimum`
 * demo params.
 *
 * Why a SEPARATE quote from the comparison pricers: the pricer sub-agents quote Base
 * MAINNET (real liquidity + Paraswap) to compare venues, but the demo swap executes on
 * Base SEPOLIA, whose pool prices are unrelated to mainnet. A mainnet-derived
 * `amountOutMinimum` would make the Sepolia tx revert. So the executor quotes the pool
 * it will actually trade against, picks the best fee tier, and sets a slippage-bounded
 * floor from that — a real, safe closed loop. On any failure the caller falls back to
 * the proven params, so the live swap is never broken.
 */

// Uniswap v3 QuoterV2 on Base Sepolia (chain 84532).
export const BASE_SEPOLIA_QUOTER_V2 = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27" as Address;

const QUOTER_V2_ABI: Abi = [
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

/** Raw `eth_call` seam (to, data) → result hex. Injectable for tests; defaults to viem over `rpcUrl`. */
export type EthCall = (to: Address, data: Hex) => Promise<Hex>;

export interface SepoliaQuoteParams {
  rpcUrl: string;
  tokenIn: Address;
  tokenOut: Address;
  amountInWei: bigint;
  /** Signed slippage tolerance (bps) used to derive the on-chain minimum-out floor. */
  slippageBps: number;
  /** Fee tiers to compare; defaults to [500, 3000] (3000 is the proven-liquid Sepolia pool). */
  feeTiers?: number[];
  quoter?: Address;
  /** Test injection; defaults to a viem public client over `rpcUrl`. */
  ethCall?: EthCall;
}

export interface QuotedRoute {
  /** Winning fee tier (hundredths of a bip). */
  fee: number;
  /** Quoted output for `amountInWei` (tokenOut base units). */
  amountOut: bigint;
  /** Slippage-bounded floor: amountOut · (1 − slippage). */
  amountOutMinimum: bigint;
}

function defaultEthCall(rpcUrl: string): EthCall {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return async (to, data) => {
    const res = await client.call({ to, data });
    return (res.data ?? "0x") as Hex;
  };
}

/**
 * Quote the swap across the fee tiers and return the best (highest amountOut) route
 * with a slippage-bounded minimum-out. Returns `null` when EVERY tier fails to quote
 * (no pool / RPC error) so the caller can fall back to the proven static params.
 */
export async function quoteBestSepoliaRoute(p: SepoliaQuoteParams): Promise<QuotedRoute | null> {
  const quoter = p.quoter ?? BASE_SEPOLIA_QUOTER_V2;
  const tiers = p.feeTiers ?? [500, 3000];
  const call = p.ethCall ?? defaultEthCall(p.rpcUrl);
  const slippage = BigInt(Math.max(0, Math.min(10_000, Math.round(p.slippageBps))));

  let best: QuotedRoute | null = null;
  for (const fee of tiers) {
    try {
      const data = encodeFunctionData({
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: p.tokenIn, tokenOut: p.tokenOut, amountIn: p.amountInWei, fee, sqrtPriceLimitX96: 0n }],
      });
      const result = await call(quoter, data);
      if (!result || result === "0x") continue;
      const decoded = decodeFunctionResult({
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        data: result,
      }) as unknown as readonly [bigint, bigint, number, bigint];
      const amountOut = decoded[0];
      if (amountOut <= 0n) continue;
      if (!best || amountOut > best.amountOut) {
        best = { fee, amountOut, amountOutMinimum: (amountOut * (10_000n - slippage)) / 10_000n };
      }
    } catch {
      // No pool at this tier / RPC hiccup — skip; another tier may still quote.
    }
  }
  return best;
}
