import {
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import type { BlockTag, MonitorCondition } from "../monitor.js";
import { QUOTER_V2_ABI } from "../../pricer/sources/uniswap-v3.js";

/**
 * A price-threshold condition for the monitor — the canonical T-23 example
 * ("fire if ETH/USDC drops below $2,800"), built on Uniswap v3 QuoterV2. It quotes
 * a fixed `amountIn` at a given block and compares the resulting `amountOut` to a
 * threshold.
 *
 * The monitor pins this read to a block that is already N confirmations deep, which
 * is the T-23 defense against single-block tip manipulation. Pushing the *condition
 * itself* toward a TWAP window (rather than a spot quote) is the complementary
 * compilation-side mitigation (§T-23, mitigation 1) and a richer condition source;
 * this spot-threshold source is the minimal concrete condition that exercises the
 * gate end-to-end.
 */
export interface PriceThresholdOptions {
  /** QuoterV2 contract address on the target chain. */
  quoter: Address;
  tokenIn: Address;
  tokenOut: Address;
  /** Input amount in `tokenIn` base units. */
  amountIn: bigint;
  /** Pool fee tier (500 / 3000 / 10000). */
  fee: number;
  /** Threshold in `tokenOut` base units, compared against the quoted `amountOut`. */
  threshold: bigint;
  /** `below` ⇒ fire when amountOut < threshold (price fell); `above` ⇒ amountOut > threshold. */
  direction: "below" | "above";
  /** Override the condition label; defaults to `price-<direction>-<threshold>`. */
  name?: string;
}

export function priceThresholdCondition(opts: PriceThresholdOptions): MonitorCondition {
  const name = opts.name ?? `price-${opts.direction}-${opts.threshold}`;
  return {
    name,
    buildCalls(block: BlockTag) {
      const data = encodeFunctionData({
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [
          {
            tokenIn: opts.tokenIn,
            tokenOut: opts.tokenOut,
            amountIn: opts.amountIn,
            fee: opts.fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      // Pinned to the monitor's confirmed block — NOT "latest" — so the evaluation
      // reflects N-confirmed state (T-23).
      return [{ method: "eth_call", params: [{ to: opts.quoter, data }, block] }];
    },
    evaluate(results): boolean {
      const raw = results[0]?.result;
      if (raw === undefined) {
        throw new Error("price-threshold: missing quoter result");
      }
      const decoded = decodeFunctionResult({
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        data: raw as Hex,
      }) as unknown as readonly [bigint, bigint, number, bigint];
      const amountOut = decoded[0];
      return opts.direction === "below"
        ? amountOut < opts.threshold
        : amountOut > opts.threshold;
    },
  };
}
