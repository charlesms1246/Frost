import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  CAPABILITY,
  capabilityWhitelist,
  mandate,
  spendCapTotal,
  FROST_BASE_SEPOLIA,
} from "@frost/sdk";
import { encodeRootCaveats } from "../src/compile/encode.js";
import type { CompiledSpec } from "../src/compile/types.js";

/**
 * The LIVE root-mandate issuance chain on REAL Base Sepolia (not a fork). Proves
 * §10.1: a funded key issues a root `Mandate`, then — as that root's holder —
 * issues a sub-mandate under it, exactly what `liveSdkIssuer` does in the webview.
 *
 * The funded `BASE_SEPOLIA_PK` plays BOTH issuer (the "user" granting authority)
 * and holder (the master agent that redelegates) — a valid demo simplification;
 * in production those are distinct (the user's MetaMask vs an online session key).
 *
 * Self-skips without creds. This SPENDS testnet gas and writes real testnet state.
 */

function loadEnv(): Record<string, string> {
  const p = resolve(__dirname, "../../spikes/.env");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    // Strip surrounding quotes (BASE_SEPOLIA_PK is quoted in .env).
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv();
const rawPk = env["BASE_SEPOLIA_PK"];
const rpcUrl = env["BASE_SEPOLIA_HTTP"];
const hasCreds = Boolean(rawPk && rpcUrl);

describe.skipIf(!hasCreds)("Live issuance (root → sub) on Base Sepolia", () => {
  it("issues a root mandate, then a sub-mandate under it, verified on-chain", async () => {
    const pk = (rawPk!.startsWith("0x") ? rawPk! : `0x${rawPk}`) as Hex;
    const account = privateKeyToAccount(pk);
    const transport = http(rpcUrl!);
    const wallet = createWalletClient({ account, chain: baseSepolia, transport });
    const pc = createPublicClient({ chain: baseSepolia, transport });
    // @frost/sdk resolves its own viem copy (file: link), so its WalletClient/
    // PublicClient param types are nominally distinct from the ones built here though
    // structurally identical — the live run confirms the runtime. Cast at the SDK boundary.
    const w = wallet as never;
    const p = pc as never;

    // Per-issuer nonces must be unique across runs — derive from the clock.
    const nonce = BigInt(Date.now());

    // 1 — root mandate from the ACTUAL production caveat set the frost
    // `createLiveRootMandate` helper uses: the compiled spec's caveats
    // (`encodeRootCaveats`) PLUS a master-agent capability whitelist. The whitelist
    // is REQUIRED — `encodeRootCaveats` omits capabilities, and `issueSubMandate`
    // demands the parent hold CAP_REDELEGATE.
    const spec: CompiledSpec = {
      description: "live issuance smoke",
      spendCapTotal: 50_000_000n,
      hitlThreshold: 5_000_000n,
      slippageBps: 50,
      expiryUnixSeconds: BigInt(Math.floor(Date.now() / 1000) + 86_400),
      redelegationBounds: { maxSubMandates: 10, maxAggregateBudget: 50_000_000n },
      rateLimit: { capacity: 30, refillRatePerSec: 1 },
    };
    const root = await mandate.issueMandate(w, p, FROST_BASE_SEPOLIA, {
      holder: account.address,
      caveats: [
        capabilityWhitelist([
          CAPABILITY.REDELEGATE,
          CAPABILITY.INFERENCE_CALL,
          CAPABILITY.RPC_READ,
          CAPABILITY.ONCHAIN_EXECUTION,
          CAPABILITY.COMMS_POST,
        ]),
        ...encodeRootCaveats(spec),
      ],
      nonce,
    });
    expect(root.mandateId).toMatch(/^0x[0-9a-f]{64}$/i);
    console.log(`[issuance] root=${root.mandateId} tx=${root.txHash}`);

    // 2 — sub-mandate under the root, held by a fresh EOA. The master agent (this
    // key, the root's holder) signs; the contract intersects caveats vs the parent.
    const subHolder = privateKeyToAccount(generatePrivateKey()).address;
    const sub = await mandate.issueSubMandate(w, p, FROST_BASE_SEPOLIA, {
      parentMandateId: root.mandateId,
      holder: subHolder,
      caveats: [capabilityWhitelist([CAPABILITY.RPC_READ]), spendCapTotal(1_000_000n)],
      nonce: nonce + 1n,
    });
    expect(sub.mandateId).toMatch(/^0x[0-9a-f]{64}$/i);
    console.log(`[issuance] sub=${sub.mandateId} tx=${sub.txHash}`);

    // 3 — verify the sub exists on-chain, parented to the root, held by the EOA.
    const view = await mandate.getMandate(p, FROST_BASE_SEPOLIA, sub.mandateId);
    expect(view.parentMandateId).toBe(root.mandateId);
    expect(view.holder.toLowerCase()).toBe(subHolder.toLowerCase());
    expect(view.revoked).toBe(false);
  }, 120_000);
});
