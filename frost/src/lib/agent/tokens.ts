import type { Address } from "viem";

/**
 * Curated EVM token registry used to turn the token SYMBOLS named in a compiled
 * workflow ("compare WETH, DAI and LINK with USDC") into concrete addresses the
 * runtime can actually quote + swap. Comparison reads run on Base MAINNET (real
 * liquidity, like the pricer); USDC is the quote currency.
 *
 * The execution leg runs on Base Sepolia and only a subset has a swappable route +
 * registered 1Shot method there; tokens without one fall back to a simulated swap
 * (the runtime surfaces which). Keeping the map curated (not user-supplied) preserves
 * the "the LLM never invents on-chain addresses" invariant — symbols resolve here.
 */
export type TokenRef = {
  symbol: string;
  /** Base MAINNET address (used for the comparison quotes). */
  address: Address;
  decimals: number;
  /** A public info page for the token (used in the social post link). */
  link: string;
};

export const QUOTE_SYMBOL = "USDC";

/** Base MAINNET token list (addresses verified on basescan). */
export const BASE_TOKENS: Record<string, TokenRef> = {
  WETH: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18, link: "https://basescan.org/token/0x4200000000000000000000000000000000000006" },
  USDC: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, link: "https://basescan.org/token/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  USDT: { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6, link: "https://basescan.org/token/0xfde4c96c8593536e31f229ea8f37b2ada2699bb2" },
  DAI: { symbol: "DAI", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, link: "https://basescan.org/token/0x50c5725949a6f0c72e6c4a641f24049a917db0cb" },
  LINK: { symbol: "LINK", address: "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196", decimals: 18, link: "https://basescan.org/token/0x88fb150bdc53a65fe94dea0c9ba0a6daf8c6e196" },
  CBBTC: { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, link: "https://basescan.org/token/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" },
  AERO: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18, link: "https://basescan.org/token/0x940181a94a35a4569e4529a3cdfb74e38fd98631" },
};

/** Accept common aliases (ETH→WETH, WBTC/BTC→cbBTC on Base). */
const ALIASES: Record<string, string> = {
  ETH: "WETH",
  WRAPPEDETHER: "WETH",
  USDCOIN: "USDC",
  TETHER: "USDT",
  CHAINLINK: "LINK",
  WBTC: "CBBTC",
  BTC: "CBBTC",
  CBBTC: "CBBTC",
};

function canonical(sym: string): string | undefined {
  const k = sym.toUpperCase().replace(/[^A-Z]/g, "");
  if (BASE_TOKENS[k]) return k;
  return ALIASES[k];
}

/**
 * Extract the distinct, known token symbols named in `text`, in first-seen order,
 * EXCLUDING the quote currency (USDC). E.g. "compare WETH, DAI and LINK with USDC" →
 * [WETH, DAI, LINK]. Unknown symbols are ignored.
 */
export function resolveTokenSymbols(text: string): TokenRef[] {
  const out: TokenRef[] = [];
  const seen = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/\b[A-Z]{2,6}\b/g)) {
    const key = canonical(m[0]);
    if (!key || key === "USDC" || seen.has(key)) continue;
    seen.add(key);
    out.push(BASE_TOKENS[key]!);
  }
  return out;
}

export const tokenBySymbol = (symbol: string): TokenRef | undefined => {
  const key = canonical(symbol);
  return key ? BASE_TOKENS[key] : undefined;
};
