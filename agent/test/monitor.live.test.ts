import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { VeniceRpcClient } from "../src/pricer/venice-rpc.js";
import { Monitor } from "../src/monitor/monitor.js";
import { priceThresholdCondition } from "../src/monitor/conditions/price-threshold.js";

/**
 * Live monitor smoke test — exercises the T-23 gate against a real chain through
 * the Venice read path: reads the head, evaluates a price condition at head − 3.
 * Self-skips without `VENICE_API_KEY`, and treats a Venice auth/credit/rate failure
 * as an environment skip (the key has rotated since the Day-1 spikes — see ERRORS).
 * The unit suite (`monitor.test.ts`) is the authoritative check of the gate logic.
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

const NETWORK = env["VENICE_NETWORK"] ?? "base-mainnet";
const WETH = (env["BASE_WETH"] ?? "0x4200000000000000000000000000000000000006") as Address;
const USDC = (env["BASE_USDC"] ?? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address;
const QUOTER = (env["BASE_QUOTER"] ?? "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a") as Address;

describe.skipIf(!hasCreds)("Monitor live (T-23 gate, Venice RPC on Base)", () => {
  it("evaluates a WETH→USDC price condition at the confirmed block", async () => {
    const rpc = new VeniceRpcClient({ apiKey: env["VENICE_API_KEY"]!, network: NETWORK });
    // Threshold absurdly high so "below" holds for any real quote — we are testing
    // the gate end-to-end, not the price itself.
    const cond = priceThresholdCondition({
      quoter: QUOTER,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: 10n ** 18n,
      fee: 500,
      threshold: 10n ** 30n,
      direction: "below",
    });

    const res = await new Monitor(rpc).check(cond);
    console.log(`[monitor] result=${res.status}${res.status === "fired" ? ` confirmed=${res.confirmedBlock}` : ""}`);

    if (res.status === "error" && /auth|401|402|balance|insufficient|rate|429|forbidden/i.test(res.reason)) {
      console.warn(`[monitor] live test SKIPPED — Venice did not serve the read: ${res.reason}`);
      return;
    }

    expect(res.status).toBe("fired");
    if (res.status === "fired") expect(res.confirmedBlock).toBeGreaterThan(0n);
  });
});
