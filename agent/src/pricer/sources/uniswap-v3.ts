import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import type { QuoteSource } from "../pricer.js";

/**
 * Uniswap v3 quote source via the QuoterV2 contract (`quoteExactInputSingle`).
 *
 * QuoterV2 simulates a swap and returns the output amount; it is called read-only
 * with `eth_call` even though the ABI marks it nonpayable. One source instance
 * quotes one fee tier — spawn several (500 / 3000 / 10000) to compare routes
 * inside a single pricer's batch.
 *
 * The QuoterV2 address is REQUIRED (no magic default) so a wrong constant can
 * never silently ship. Base mainnet QuoterV2 is commonly
 * `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` — verify on BaseScan before use.
 */

export const QUOTER_V2_ABI: Abi = [
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

export interface UniswapV3SourceOptions {
  /** QuoterV2 contract address on the target chain. */
  quoter: Address;
  /** Pool fee tier in hundredths of a bip: 500 = 0.05%, 3000 = 0.30%, 10000 = 1%. */
  fee: number;
  /** Override the source label; defaults to `uniswap-v3-<fee>`. */
  name?: string;
}

export function uniswapV3Source(opts: UniswapV3SourceOptions): QuoteSource {
  const name = opts.name ?? `uniswap-v3-${opts.fee}`;
  return {
    name,
    buildCall(req) {
      const data = encodeFunctionData({
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [
          {
            tokenIn: req.tokenIn,
            tokenOut: req.tokenOut,
            amountIn: req.amountIn,
            fee: opts.fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      return { method: "eth_call", params: [{ to: opts.quoter, data }, "latest"] };
    },
    decode(result: Hex): bigint {
      const decoded = decodeFunctionResult({
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        data: result,
      }) as unknown as readonly [bigint, bigint, number, bigint];
      return decoded[0];
    },
  };
}
