import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { VeniceRpcClient } from "../src/pricer/venice-rpc.js";
import { Pricer } from "../src/pricer/pricer.js";
import { uniswapV3Source } from "../src/pricer/sources/uniswap-v3.js";

/**
 * Live pricer smoke test — a real Uniswap v3 quote through the Venice Crypto-RPC
 * read path. Self-skips without `VENICE_API_KEY`. Quotes need mainnet liquidity,
 * so this targets Base mainnet (network `base`).
 *
 * The Base addresses below are best-known defaults and are OVERRIDABLE via env
 * (`BASE_QUOTER` / `BASE_WETH` / `BASE_USDC` / `VENICE_NETWORK`) — verify the
 * QuoterV2 address on BaseScan if the quote reverts. The unit suite
 * (`pricer.test.ts`) is the authoritative check of the pricer logic; this only
 * confirms the live wiring + batching against a real network.
 */

function loadEnv(): Record<string, string> {
  const p = resolve(__dirname, "../../spikes/.env");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    // Strip surrounding quotes — `.env` values like VENICE_API_KEY="..." must not
    // carry the quotes into the Bearer token (that yields a 401).
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv();
const hasCreds = Boolean(env["VENICE_API_KEY"]);

// Base mainnet defaults (override via env). WETH and native USDC are canonical;
// QuoterV2 should be confirmed on BaseScan. Venice's slug is `base-mainnet`
// (per GET /crypto/rpc/networks), NOT `base`.
const NETWORK = env["VENICE_NETWORK"] ?? "base-mainnet";
const WETH = (env["BASE_WETH"] ?? "0x4200000000000000000000000000000000000006") as Address;
const USDC = (env["BASE_USDC"] ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address;
const QUOTER = (env["BASE_QUOTER"] ?? "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a") as Address;

describe.skipIf(!hasCreds)("Pricer live (Venice RPC, Uniswap v3 on Base)", () => {
  it("quotes 1 WETH → USDC across fee tiers in one batch", async () => {
    const rpc = new VeniceRpcClient({ apiKey: env["VENICE_API_KEY"]!, network: NETWORK });
    const pricer = new Pricer(rpc);
    const sources = [500, 3000].map((fee) => uniswapV3Source({ quoter: QUOTER, fee }));

    const res = await pricer.quote({ tokenIn: WETH, tokenOut: USDC, amountIn: 10n ** 18n }, sources);

    console.log(
      `[pricer] 1 WETH → USDC: best=${res.best ? `${res.best.source} ${res.best.amountOut}` : "none"}` +
        ` quotes=${res.quotes.length} failed=${res.failed.map((f) => `${f.source}:${f.error}`).join("; ")}`,
    );

    // Treat a Venice transport/auth/credit failure as an environment skip, not a
    // code failure — the same philosophy as self-skipping without creds. We only
    // meaningfully assert when Venice actually served the batch.
    const envIssue =
      res.best === null &&
      res.failed.length > 0 &&
      res.failed.every((f) => /auth|401|402|balance|insufficient|rate|429|forbidden/i.test(f.error));
    if (envIssue) {
      console.warn(
        `[pricer] live test SKIPPED — Venice did not serve the batch (creds/credits/network): ${res.failed[0]?.error}`,
      );
      return;
    }

    // Venice responded: a live WETH/USDC quote should be positive on a tier.
    expect(res.best).not.toBeNull();
    expect(res.best!.amountOut).toBeGreaterThan(0n);
  });
});
