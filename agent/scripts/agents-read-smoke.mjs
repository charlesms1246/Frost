// Live smoke: prove the READ sub-agents (pricer + monitor) actually run end-to-end
// against real Base MAINNET state — the demo's WETH→USDC path. No keys needed (public
// RPC). Run from agent/:  node scripts/agents-read-smoke.mjs
import { Pricer, uniswapV3Source, Monitor, priceThresholdCondition } from "../dist/browser.js";

const RPC = process.env.BASE_RPC ?? "https://base-rpc.publicnode.com";
const BASE = {
  weth: "0x4200000000000000000000000000000000000006",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
};

/** Minimal batched JSON-RPC transport over a public node (mirrors the agent's RpcTransport). */
function publicRpc(url) {
  return {
    async batch(calls) {
      if (calls.length === 0) return [];
      const reqs = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }));
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqs),
      });
      const parsed = await res.json();
      const byId = new Map((Array.isArray(parsed) ? parsed : [parsed]).map((p) => [p.id, p]));
      return calls.map((_, i) => {
        const p = byId.get(i);
        return p?.error ? { error: p.error } : { result: p?.result };
      });
    },
  };
}

const rpc = publicRpc(RPC);
let failures = 0;

// 1 — PRICER: quote 1 WETH → USDC across Uniswap v3 fee tiers, report the best.
console.log(`[smoke] RPC ${RPC}`);
const sources = [500, 3000].map((fee) => uniswapV3Source({ quoter: BASE.quoter, fee }));
const quote = await new Pricer(rpc).quote({ tokenIn: BASE.weth, tokenOut: BASE.usdc, amountIn: 10n ** 18n }, sources);
if (quote.best) {
  const usd = (Number(quote.best.amountOut) / 1e6).toFixed(2);
  console.log(`[PASS] pricer: 1 WETH → $${usd} USDC via ${quote.best.source}`);
} else {
  failures++;
  console.log(`[FAIL] pricer: no quote (${quote.failed.map((f) => f.error).join("; ")})`);
}

// 2 — MONITOR: a multi-confirmation price-threshold check (T-23 gate) at the confirmed block.
const condition = priceThresholdCondition({
  quoter: BASE.quoter,
  tokenIn: BASE.weth,
  tokenOut: BASE.usdc,
  amountIn: 10n ** 18n,
  fee: 500,
  threshold: 1n, // 1 USDC base unit → WETH price is always above this → should FIRE
  direction: "above",
});
const mon = await new Monitor(rpc).check(condition);
if (mon.status === "fired") {
  console.log(`[PASS] monitor: condition fired at confirmed block (status=${mon.status})`);
} else if (mon.status === "error") {
  failures++;
  console.log(`[FAIL] monitor: ${mon.status} ${mon.detail ?? ""}`);
} else {
  console.log(`[WARN] monitor: status=${mon.status} (ran, but did not fire)`);
}

console.log(failures === 0 ? "\n[smoke] READ AGENTS OK" : `\n[smoke] ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
