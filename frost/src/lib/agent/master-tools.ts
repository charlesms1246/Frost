/**
 * Read-only tools for the master-agent loop.
 *
 * These let the chat-side master agent gather live information WHILE shaping the
 * user's goal — without a connected wallet. Reads need no signing authority; only
 * the WRITE path (issuing mandates, executing swaps) needs the MetaMask delegation.
 * All of these run off the Venice key already in config (RPC reads, price quotes,
 * web search, page scrape) except `contract_abi`, which uses an optional BaseScan key.
 *
 * Every tool is pure-ish (one network call via an injectable `fetch`) and returns a
 * short user-facing `summary` plus a fuller `observation` fed back to the model.
 */
import { VeniceRpcClient, Pricer, uniswapV3Source, DiscordWebhookPoster } from "@frost/agent/browser";
import type { RpcCall, RpcResult, RpcTransport } from "@frost/agent/browser";
import type { Address } from "viem";

export type ToolFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok?: boolean; status: number; text(): Promise<string> }>;

export type ToolContext = {
  veniceApiKey: string;
  /** Venice RPC network slug for reads/quotes (e.g. "base-mainnet"). */
  veniceNetwork: string;
  /** Optional BaseScan/Etherscan-v2 key; without it `contract_abi` is disabled. */
  basescanApiKey: string;
  /** Configured Discord webhook; without it `discord_test` is disabled. */
  discordWebhookUrl: string;
  /** Cost-control kill switch: when true, NO Venice calls — reads use the public RPC,
   *  and the Venice-only augment tools (web_search/fetch_url) are disabled. */
  veniceDisabled: boolean;
  /** Public Base RPC used for reads/quotes when Venice is disabled or keyless. */
  fallbackRpcUrl: string;
  /** Chain id for explorer lookups (8453 = Base mainnet). */
  chainId: number;
  /**
   * WRITE seam for `request_authority`: drive a NEW ERC-7715 USDC spending grant via the
   * MetaMask bridge (opens MetaMask for the user to approve a scoped, revocable permission).
   * The chat page supplies it (it has the wallet bridge); omitted ⇒ the tool reports it's
   * unavailable (e.g. no wallet context / tests).
   */
  requestAuthority?: (req: {
    amountBaseUnits: bigint;
    periodSecs: number;
    justification: string;
  }) => Promise<{ ok: boolean; detail: string }>;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: ToolFetch;
};

export type ToolResult = { ok: boolean; summary: string; observation: string };

export type MasterTool = {
  name: string;
  /** One line shown to the model so it knows when to call this tool. */
  description: string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

// Base mainnet read targets (mirror src/lib/agent/session.ts) — real liquidity/state.
const WETH = "0x4200000000000000000000000000000000000006" as Address;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as Address;

// The model often passes token SYMBOLS ("ETH"/"WETH"/"USDC") where an address is required;
// viem then throws `Address "ETH" is invalid`. Resolve known symbols to addresses, accept a
// literal 0x address, and fall back to the default for anything unrecognized (never crash).
const TOKEN_SYMBOLS: Record<string, Address> = {
  ETH: WETH,
  WETH: WETH,
  WRAPPEDETHER: WETH,
  USDC: USDC,
  USD: USDC,
  USDCOIN: USDC,
};
function resolveToken(raw: string, fallback: Address): Address {
  const t = raw.trim();
  if (!t) return fallback;
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return t as Address;
  return TOKEN_SYMBOLS[t.toUpperCase().replace(/[^A-Z]/g, "")] ?? fallback;
}

const fail = (msg: string): ToolResult => ({ ok: false, summary: msg, observation: `ERROR: ${msg}` });
const str = (a: Record<string, unknown>, k: string): string =>
  typeof a[k] === "string" ? (a[k] as string).trim() : "";
const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + "…" : s);
const authJson = (key: string) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" });
const httpOk = (r: { ok?: boolean; status: number }): boolean => r.ok ?? (r.status >= 200 && r.status < 300);
const fetcher = (ctx: ToolContext): ToolFetch =>
  ctx.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));

/** Minimal direct JSON-RPC client (the read fallback when Venice is off/keyless). */
function publicRpc(url: string, fetchImpl?: ToolFetch): RpcTransport {
  const f = fetchImpl ?? ((u, init) => fetch(u, init as RequestInit));
  return {
    async batch(calls: RpcCall[]): Promise<RpcResult[]> {
      if (calls.length === 0) return [];
      const reqs = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }));
      const res = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reqs) });
      const raw = await res.text();
      if (!httpOk(res)) throw new Error(`RPC ${res.status}: ${truncate(raw, 200)}`);
      const parsed = JSON.parse(raw) as { id: number; result?: `0x${string}`; error?: { code: number; message: string } }[];
      const byId = new Map(parsed.map((p) => [p.id, p]));
      return calls.map((_, i) => {
        const p = byId.get(i);
        return p?.error ? { error: p.error } : { result: p?.result };
      });
    },
  };
}

/** The read transport: Venice when enabled+keyed, else the public RPC fallback. */
const rpc = (ctx: ToolContext): RpcTransport =>
  ctx.veniceDisabled || ctx.veniceApiKey.trim() === ""
    ? publicRpc(ctx.fallbackRpcUrl, ctx.fetchImpl)
    : new VeniceRpcClient({
        apiKey: ctx.veniceApiKey,
        network: ctx.veniceNetwork,
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl as never } : {}),
      });

const READ_METHODS = new Set([
  "eth_call",
  "eth_getBalance",
  "eth_blockNumber",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_gasPrice",
  "eth_chainId",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getBlockByNumber",
  "eth_getLogs",
]);

const TOOLS: MasterTool[] = [
  {
    name: "current_time",
    description: "Get the current date/time (ISO + unix seconds). Use for 'now', expiries, scheduling.",
    run: async () => {
      const now = new Date();
      const unix = Math.floor(now.getTime() / 1000);
      return { ok: true, summary: `now ${now.toISOString()}`, observation: `current time: ${now.toISOString()} (unix ${unix})` };
    },
  },
  {
    name: "onchain_read",
    description: `Read Base chain state via read-only JSON-RPC. args: { method, params?: any[] }. Allowed: ${[...READ_METHODS].join(", ")}.`,
    run: async (args, ctx) => {
      const method = str(args, "method");
      if (!READ_METHODS.has(method)) return fail(`'${method}' is not an allowed read method`);
      const params = Array.isArray(args.params) ? args.params : [];
      const [r] = await rpc(ctx).batch([{ method, params }]);
      if (!r || r.error) return fail(`${method}: ${r?.error?.message ?? "no result"}`);
      return { ok: true, summary: `${method} → ${truncate(String(r.result), 24)}`, observation: `${method} result: ${r.result}` };
    },
  },
  {
    name: "price_quote",
    description:
      "Best live DEX quote on Base (Uniswap v3). args: { tokenIn?, tokenOut?, amountIn? } — pass token " +
      "SYMBOLS (ETH/WETH/USDC) or 0x addresses. amountIn is in tokenIn BASE UNITS (1 WETH = " +
      "1000000000000000000, 1 USDC = 1000000); omit for 1 token. Defaults 1 WETH → USDC.",
    run: async (args, ctx) => {
      const tokenIn = resolveToken(str(args, "tokenIn"), WETH);
      const tokenOut = resolveToken(str(args, "tokenOut"), USDC);
      let amountIn = 10n ** 18n;
      if (args.amountIn !== undefined) {
        try {
          amountIn = BigInt(String(args.amountIn));
        } catch {
          return fail("amountIn must be an integer (base units)");
        }
      }
      const sources = [500, 3000].map((fee) => uniswapV3Source({ quoter: QUOTER, fee }));
      const res = await new Pricer(rpc(ctx)).quote({ tokenIn, tokenOut, amountIn }, sources);
      if (!res.best) return fail(`no quote (${res.failed.map((f) => f.error).join("; ")})`);
      return {
        ok: true,
        summary: `best ${res.best.source}: ${res.best.amountOut}`,
        observation: `best quote: ${res.best.amountOut} out via ${res.best.source} for amountIn ${amountIn} (${tokenIn} → ${tokenOut})`,
      };
    },
  },
  {
    name: "request_authority",
    description:
      "Request a NEW scoped USDC spending permission from the user via MetaMask (ERC-7715). Use ONLY " +
      "when a task needs authority the user has not granted yet — e.g. a bigger per-period budget to " +
      "fund a swap beyond the existing grant. Opens MetaMask for the user to review + approve a " +
      "human-readable, revocable permission. args: { amount: number (USDC per period), period?: " +
      "'day'|'week', justification?: string }.",
    run: async (args, ctx) => {
      if (!ctx.requestAuthority) return fail("authority requests need a connected wallet (unavailable here)");
      const amount = typeof args.amount === "number" ? args.amount : Number(str(args, "amount"));
      if (!Number.isFinite(amount) || amount <= 0) return fail("amount must be a positive number of USDC per period");
      const period = str(args, "period").toLowerCase();
      const periodSecs = period === "week" ? 604_800 : 86_400; // default: per day
      const amountBaseUnits = BigInt(Math.round(amount * 1_000_000)); // USDC has 6 decimals
      const justification = str(args, "justification") || `Agent-requested budget: ${amount} USDC / ${period || "day"}`;
      const r = await ctx.requestAuthority({ amountBaseUnits, periodSecs, justification });
      if (!r.ok) return fail(`authority request declined or failed: ${r.detail}`);
      return {
        ok: true,
        summary: `new permission: ${amount} USDC / ${period || "day"}`,
        observation: `the user approved a new ERC-7715 permission (${r.detail}). You may now act within this budget.`,
      };
    },
  },
  {
    name: "web_search",
    description: "Search the public web for up-to-date info. args: { query: string, limit?: number }.",
    run: async (args, ctx) => {
      const query = str(args, "query");
      if (!query) return fail("web_search needs a 'query'");
      if (ctx.veniceDisabled) return fail("Web search is disabled right now (Venice is off — it's the only search provider wired).");
      if (!ctx.veniceApiKey) return fail("Venice API key not configured");
      const limit = Math.min(Number(args.limit) || 5, 10);
      const res = await fetcher(ctx)("https://api.venice.ai/api/v1/augment/search", {
        method: "POST",
        headers: authJson(ctx.veniceApiKey),
        body: JSON.stringify({ query, limit }),
      });
      const raw = await res.text();
      if (!httpOk(res)) return fail(`web search failed (${res.status}): ${truncate(raw, 200)}`);
      const data = JSON.parse(raw) as { results?: { title: string; url: string; content: string; date?: string }[] };
      const results = (data.results ?? []).slice(0, limit);
      if (results.length === 0) return { ok: true, summary: `no web results for "${truncate(query, 40)}"`, observation: `no results for "${query}"` };
      const obs = results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${truncate(r.content, 300)}`).join("\n\n");
      return { ok: true, summary: `web search: ${results.length} result(s)`, observation: obs };
    },
  },
  {
    name: "fetch_url",
    description: "Fetch a web page and return its text (markdown). args: { url: string }.",
    run: async (args, ctx) => {
      const url = str(args, "url");
      if (!/^https?:\/\//.test(url)) return fail("fetch_url needs an http(s) 'url'");
      if (ctx.veniceDisabled) return fail("Page fetch is disabled right now (Venice is off — it's the only scrape provider wired).");
      if (!ctx.veniceApiKey) return fail("Venice API key not configured");
      const res = await fetcher(ctx)("https://api.venice.ai/api/v1/augment/scrape", {
        method: "POST",
        headers: authJson(ctx.veniceApiKey),
        body: JSON.stringify({ url }),
      });
      const raw = await res.text();
      if (!httpOk(res)) return fail(`scrape failed (${res.status}): ${truncate(raw, 200)}`);
      const data = JSON.parse(raw) as { content?: string };
      return { ok: true, summary: `fetched ${truncate(url, 48)}`, observation: truncate(data.content ?? "", 2000) || "(empty page)" };
    },
  },
  {
    name: "discord_test",
    description: "Send a FIXED test message ('Frost webhook test') to the configured Discord webhook to verify it works. No args, no custom text.",
    run: async (_args, ctx) => {
      if (!ctx.discordWebhookUrl) return fail("No Discord webhook configured (add one in Setup → Comms).");
      const poster = new DiscordWebhookPoster(ctx.discordWebhookUrl, ctx.fetchImpl as never);
      await poster.post("Frost webhook test");
      return { ok: true, summary: "sent test message to Discord", observation: "posted 'Frost webhook test' to the configured webhook (mentions disabled)" };
    },
  },
  {
    name: "contract_abi",
    description: "Look up a verified contract's functions on Base (BaseScan). args: { address }. Needs a BaseScan API key.",
    run: async (args, ctx) => {
      const address = str(args, "address");
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return fail("contract_abi needs a valid 'address'");
      if (!ctx.basescanApiKey) return fail("No BaseScan API key configured (add one in Setup → Advanced) — contract lookups are disabled.");
      const url = `https://api.etherscan.io/v2/api?chainid=${ctx.chainId}&module=contract&action=getabi&address=${address}&apikey=${ctx.basescanApiKey}`;
      const res = await fetcher(ctx)(url, { method: "GET", headers: {} });
      const raw = await res.text();
      if (!httpOk(res)) return fail(`BaseScan request failed (${res.status})`);
      const data = JSON.parse(raw) as { status: string; result: string; message?: string };
      if (data.status !== "1") return fail(`BaseScan: ${data.result || data.message || "not verified"}`);
      let abi: { type: string; name?: string }[];
      try {
        abi = JSON.parse(data.result);
      } catch {
        return fail("BaseScan returned an unparseable ABI");
      }
      const fns = abi.filter((x) => x.type === "function" && x.name).map((x) => x.name as string);
      return { ok: true, summary: `${fns.length} function(s)`, observation: `functions: ${fns.slice(0, 40).join(", ")}${fns.length > 40 ? " …" : ""}` };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Tool names the loop recognizes (besides the special `compile`). */
export function readToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

/** The tool catalog block injected into the master prompt. */
export function toolCatalog(): string {
  return TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}

/** Dispatch one read tool by name; never throws (errors become a failed ToolResult). */
export async function runMasterTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  if (!tool) return fail(`unknown tool '${name}'`);
  try {
    return await tool.run(args, ctx);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
