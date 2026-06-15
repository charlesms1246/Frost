/**
 * Live USD spot prices for the major EVM tokens shown on the Runtime dashboard's
 * "Markets" card. Uses CoinGecko's keyless, CORS-enabled `simple/price` endpoint —
 * a read-only convenience feed (NOT the pricer agents' on-chain Uniswap quotes, which
 * drive execution). `fetch` is injectable so the mapping is unit-testable offline.
 */
export type TokenPrice = { symbol: string; usd: number };

export type PriceFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Display symbol → CoinGecko id. Order here is the display order on the card. */
const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  USDC: "usd-coin",
  USDT: "tether",
  WBTC: "wrapped-bitcoin",
  DAI: "dai",
  LINK: "chainlink",
};

export const MAJOR_TOKENS = Object.keys(COINGECKO_IDS);

/**
 * Fetch USD prices for `symbols` (defaults to the major set). Returns one entry per
 * requested symbol that resolved; throws on a failed HTTP response so the caller can
 * surface a single error state.
 */
export async function fetchTokenPrices(
  symbols: string[] = MAJOR_TOKENS,
  fetchImpl?: PriceFetch,
): Promise<TokenPrice[]> {
  const f: PriceFetch = fetchImpl ?? ((url) => fetch(url) as unknown as ReturnType<PriceFetch>);
  const ids = symbols.map((s) => COINGECKO_IDS[s]).filter(Boolean);
  if (ids.length === 0) return [];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  const res = await f(url);
  if (!res.ok) throw new Error(`price feed ${res.status}`);
  const data = (await res.json()) as Record<string, { usd?: number }>;
  return symbols
    .map((sym) => {
      const id = COINGECKO_IDS[sym];
      const usd = id ? data[id]?.usd : undefined;
      return typeof usd === "number" ? { symbol: sym, usd } : undefined;
    })
    .filter((p): p is TokenPrice => p !== undefined);
}

/** Compact USD formatter: $1,234.56 / $0.9998. */
export function fmtUsd(n: number): string {
  const max = n >= 1 ? 2 : 4;
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: max });
}
