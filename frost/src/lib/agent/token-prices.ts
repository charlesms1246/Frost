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

/** One OHLC candle; `time` is unix SECONDS (what lightweight-charts expects). */
export type Candle = { time: number; open: number; high: number; low: number; close: number };

/** Symbols that have an OHLC chart (the volatile majors; stables are flat). */
export const CHARTABLE = ["ETH", "WBTC", "LINK", "DAI"] as const;

/**
 * Fetch OHLC candles for `symbol` over the last `days` (CoinGecko's keyless
 * `coins/{id}/ohlc`: 1 → ~30-min candles, 7 → ~4-hour, 30 → ~4-day). Throws on a
 * failed response; returns [] for an unknown symbol.
 */
export async function fetchOhlc(symbol: string, days: number, fetchImpl?: PriceFetch): Promise<Candle[]> {
  const f: PriceFetch = fetchImpl ?? ((url) => fetch(url) as unknown as ReturnType<PriceFetch>);
  const id = COINGECKO_IDS[symbol];
  if (!id) return [];
  const res = await f(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`);
  if (!res.ok) throw new Error(`ohlc ${res.status}`);
  const rows = (await res.json()) as [number, number, number, number, number][];
  return rows.map(([t, o, h, l, c]) => ({ time: Math.floor(t / 1000), open: o, high: h, low: l, close: c }));
}
