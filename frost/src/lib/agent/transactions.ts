import { formatEther, formatUnits } from "viem";

/**
 * Recent on-chain history for the Wallet page — both the user's sign-in account
 * (the delegator whose authority the agents redeem) and the agent's signing wallet.
 * Reads Base Sepolia via the Etherscan-v2 multichain API (`chainid=84532`): a
 * normal-transaction list (`txlist`) plus an ERC-20 transfer list (`tokentx`), merged
 * into one asset-movement feed. Read-only, no keys signed.
 *
 * Needs an Etherscan/BaseScan API key (Setup → Advanced, or the demo `.env`); the v2
 * API rejects keyless calls. `fetch` is injectable so the mapping is unit-testable.
 */
export const BASE_SEPOLIA_CHAIN_ID = 84532;
const SCAN_TX = "https://sepolia.basescan.org/tx/";

export type TxFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type WalletTx = {
  hash: string;
  /** Unix seconds. */
  timeStamp: number;
  from: string;
  to: string;
  /** Movement relative to the queried wallet. */
  direction: "in" | "out" | "self";
  /** Human value + asset, e.g. "0.012 ETH" or "5.00 USDC". */
  amount: string;
  /** Method / movement label: "Transfer", a decoded function name, or "Contract call". */
  kind: string;
  /** BaseScan (Sepolia) transaction link. */
  link: string;
};

type RawTx = {
  hash?: string;
  timeStamp?: string;
  from?: string;
  to?: string;
  value?: string;
  functionName?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
};

type ScanResponse = { status?: string; message?: string; result?: unknown };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The Etherscan free tier caps requests/sec (this key: 3/sec). The Wallet page fires
// up to 4 calls at once (txlist + tokentx × 2 wallets), so funnel EVERY explorer call
// through a serial queue spaced ≥ MIN_GAP_MS — at most ~2-3 starts per second.
const MIN_GAP_MS = 400;
let queue: Promise<unknown> = Promise.resolve();
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn);
  queue = result.then(
    () => sleep(MIN_GAP_MS),
    () => sleep(MIN_GAP_MS),
  );
  return result;
}

function directionOf(address: string, from?: string, to?: string): WalletTx["direction"] {
  const a = address.toLowerCase();
  const f = (from ?? "").toLowerCase();
  const t = (to ?? "").toLowerCase();
  if (f === a && t === a) return "self";
  return f === a ? "out" : "in";
}

/** "swapExactTokensForTokens(address,...)" → "swapExactTokensForTokens". */
function prettyMethod(functionName?: string, value?: string): string {
  const name = functionName?.split("(")[0]?.trim();
  if (name) return name;
  return value && value !== "0" ? "Transfer" : "Contract call";
}

async function fetchList(f: TxFetch, url: string): Promise<RawTx[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await throttled(() => f(url));
    if (!res.ok) throw new Error(`explorer ${res.status}`);
    const body = (await res.json()) as ScanResponse;
    if (body.status === "1" && Array.isArray(body.result)) return body.result as RawTx[];
    // status "0" + "No transactions found" is an empty (non-error) result.
    if (body.status === "0" && /no transactions/i.test(body.message ?? "")) return [];
    const msg = typeof body.result === "string" ? body.result : body.message || "explorer error";
    // The per-sec cap can still bite under bursty load — back off and retry a few times.
    if (/rate limit/i.test(msg) && attempt < 3) {
      await sleep(600 * (attempt + 1));
      continue;
    }
    throw new Error(msg);
  }
}

/**
 * Fetch the most recent `limit` asset movements for `address` on Base Sepolia. ERC-20
 * transfers are listed per-asset; a normal transaction is included only when it has no
 * token-transfer counterpart (so a swap shows its token legs, not a redundant 0-ETH call).
 * Throws on a failed/keyless explorer response so the caller can surface one error state.
 */
export async function fetchTransactions(
  address: string,
  apiKey: string,
  fetchImpl?: TxFetch,
  limit = 15,
): Promise<WalletTx[]> {
  const f: TxFetch = fetchImpl ?? ((url) => fetch(url) as unknown as ReturnType<TxFetch>);
  const base = `https://api.etherscan.io/v2/api?chainid=${BASE_SEPOLIA_CHAIN_ID}`;
  const auth = apiKey ? `&apikey=${apiKey}` : "";
  const q = `&address=${address}&page=1&offset=${limit}&sort=desc${auth}`;
  const [normal, token] = await Promise.all([
    fetchList(f, `${base}&module=account&action=txlist${q}`),
    fetchList(f, `${base}&module=account&action=tokentx${q}`),
  ]);

  const tokenHashes = new Set(token.map((t) => (t.hash ?? "").toLowerCase()));
  const rows: WalletTx[] = [
    ...token.map((t) => ({
      hash: t.hash ?? "",
      timeStamp: Number(t.timeStamp ?? 0),
      from: t.from ?? "",
      to: t.to ?? "",
      direction: directionOf(address, t.from, t.to),
      amount: `${trim(formatUnits(BigInt(t.value ?? "0"), Number(t.tokenDecimal ?? 18)))} ${t.tokenSymbol ?? ""}`.trim(),
      kind: "Transfer",
      link: SCAN_TX + (t.hash ?? ""),
    })),
    ...normal
      .filter((t) => !tokenHashes.has((t.hash ?? "").toLowerCase()))
      .map((t) => ({
        hash: t.hash ?? "",
        timeStamp: Number(t.timeStamp ?? 0),
        from: t.from ?? "",
        to: t.to ?? "",
        direction: directionOf(address, t.from, t.to),
        amount: `${trim(formatEther(BigInt(t.value ?? "0")))} ETH`,
        kind: prettyMethod(t.functionName, t.value),
        link: SCAN_TX + (t.hash ?? ""),
      })),
  ];

  rows.sort((a, b) => b.timeStamp - a.timeStamp);
  return rows.slice(0, limit);
}

/** Trim a decimal string to at most 5 fraction digits without trailing-zero noise. */
function trim(value: string): string {
  if (!value.includes(".")) return value;
  const [whole, frac] = value.split(".");
  const cut = frac.slice(0, 5).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}
