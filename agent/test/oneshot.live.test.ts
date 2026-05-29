import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FROST_BASE_SEPOLIA } from "@frost/sdk";
import { oneShotProviderFromEnv } from "../src/wallet/oneshot.js";

/**
 * Live 1Shot auth smoke test. Reads credentials from ../spikes/.env and skips
 * itself when they're absent, so it is safe to run anywhere. It only does a
 * read-only `wallets.list` — it creates no resources on the business.
 */

function loadEnv(): Record<string, string> {
  const p = resolve(__dirname, "../../spikes/.env");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = loadEnv();
const hasCreds = Boolean(
  env["ONESHOT_API_KEY"] && env["ONESHOT_API_SECRET"] && env["ONESHOT_BUSINESS_ID"],
);

describe.skipIf(!hasCreds)("1Shot live auth", () => {
  it("authenticates and lists wallets for the business (read-only)", async () => {
    const provider = oneShotProviderFromEnv(env, {
      chainId: FROST_BASE_SEPOLIA.chainId,
    });
    await expect(provider.verify()).resolves.toBeUndefined();
  });
});
