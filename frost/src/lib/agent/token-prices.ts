/**
 * Live USD spot prices for the major EVM tokens shown on the Runtime dashboard's
 * "Markets" card. Uses CoinGecko's keyless, CORS-enabled `simple/price` endpoint —
 * a read-only convenience feed (NOT the pricer agents' on-chain Uniswap quotes, which
 * drive execution). `fetch` is injectable so the mapping is unit-testable offline.
 */
export type TokenPrice = { symbol: string; usd: number };

export type PriceFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> }>;

/**
 * Fetch through CoinGecko's keyless public API, which rate-limits hard (HTTP 429 after
 * ~2 rapid calls per IP). Retry a 429 a few times with backoff (honoring `Retry-After`)
 * so a transient burst — toggling the chart symbol/timeframe, or the 60s Markets poll —
 * recovers instead of surfacing "Couldn't load market data".
 */
async function fetchWithRetry(
  f: PriceFetch,
  url: string,
  retries = 3,
): Promise<Awaited<ReturnType<PriceFetch>>> {
  let res = await f(url);
  for (let attempt = 0; attempt < retries && res.status === 429; attempt++) {
    const retryAfter = Number(res.headers?.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await f(url);
  }
  return res;
}

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
  const res = await fetchWithRetry(f, url);
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

/** Short-TTL OHLC cache keyed by `symbol:days`. Toggling the chart symbol/timeframe
 * (and toggling back) reuses a recent fetch instead of hammering the keyless rate limit. */
const OHLC_CACHE_TTL_MS = 60_000;
const ohlcCache = new Map<string, { at: number; candles: Candle[] }>();

/**
 * Fetch OHLC candles for `symbol` over the last `days` (CoinGecko's keyless
 * `coins/{id}/ohlc`: 1 → ~30-min candles, 7 → ~4-hour, 30 → ~4-day). Throws on a
 * failed response; returns [] for an unknown symbol. Cached for 60s per symbol+days
 * and 429-retried (see {@link fetchWithRetry}) so the chart survives rate limits.
 */
export async function fetchOhlc(symbol: string, days: number, fetchImpl?: PriceFetch): Promise<Candle[]> {
  const f: PriceFetch = fetchImpl ?? ((url) => fetch(url) as unknown as ReturnType<PriceFetch>);
  const id = COINGECKO_IDS[symbol];
  if (!id) return [];
  const key = `${symbol}:${days}`;
  const hit = ohlcCache.get(key);
  if (hit && Date.now() - hit.at < OHLC_CACHE_TTL_MS) return hit.candles;
  const res = await fetchWithRetry(f, `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`);
  if (!res.ok) throw new Error(`ohlc ${res.status}`);
  const rows = (await res.json()) as [number, number, number, number, number][];
  const candles = rows.map(([t, o, h, l, c]) => ({ time: Math.floor(t / 1000), open: o, high: h, low: l, close: c }));
  ohlcCache.set(key, { at: Date.now(), candles });
  return candles;
}
