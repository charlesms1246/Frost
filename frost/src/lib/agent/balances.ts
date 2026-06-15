import {
  createPublicClient,
  http,
  erc20Abi,
  formatEther,
  formatUnits,
  type Address,
} from "viem";

/**
 * Read-side balance fetch for the Wallet page (the user's sign-in account + the
 * agent's custodial signing wallet). Plain Base Sepolia `eth_getBalance` +
 * `balanceOf` reads over `config.rpcUrl` — no chain writes, no keys.
 *
 * Token addresses are the canonical Base Sepolia deployments (distinct from the
 * Base MAINNET addresses the pricer/master-tools use for live DEX quotes).
 */
export const BASE_SEPOLIA_WETH = "0x4200000000000000000000000000000000000006" as Address;
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

export interface WalletBalances {
  /** Native ETH, in wei. */
  ethWei: bigint;
  /** USDC (6 decimals), base units. */
  usdcUnits: bigint;
  /** WETH (18 decimals), wei. */
  wethWei: bigint;
}

/** Trim a decimal string to at most `dp` fraction digits without rounding artifacts. */
function trim(value: string, dp: number): string {
  if (!value.includes(".")) return value;
  const [whole, frac] = value.split(".");
  const cut = frac.slice(0, dp).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

export const fmtEth = (wei: bigint) => trim(formatEther(wei), 5);
export const fmtWeth = (wei: bigint) => trim(formatEther(wei), 5);
export const fmtUsdc = (units: bigint) => trim(formatUnits(units, 6), 2);

/**
 * Fetch ETH / USDC / WETH for `address` on Base Sepolia. Reads run concurrently;
 * any individual failure throws (the caller surfaces a single error state).
 */
export async function fetchBalances(rpcUrl: string, address: Address): Promise<WalletBalances> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const erc20 = (token: Address) =>
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] });

  const [ethWei, usdcUnits, wethWei] = await Promise.all([
    client.getBalance({ address }),
    erc20(BASE_SEPOLIA_USDC),
    erc20(BASE_SEPOLIA_WETH),
  ]);

  return { ethWei, usdcUnits, wethWei };
}
