// Spike: does MetaMask's ERC-7715 `granted` serialize into 1Shot's redelegate
// `delegationData`? This is THE unverified seam that decides the on-chain
// redelegation path (frost `delegation.ts` → 1Shot `/wallets/{id}/delegations/redelegate`).
//
// It can't be fully automated — capturing a grant needs a browser + MetaMask Flask.
// So this runs in stages; read the prompts it prints.
//
//   Stage 0 (creds):   ONESHOT_API_KEY/_SECRET[/_API_BASE] in ../spikes/.env
//   Stage 1 (probe):   SPIKE_SESSION_WALLET_ID  — a 1Shot wallet id (the grant delegate)
//                      SPIKE_EXECUTOR_ADDRESS   — the executor's 0x address
//                      SPIKE_GRANTED_FILE       — path to a JSON file with the captured
//                                                 `granted` blob (from the desktop app:
//                                                 Setup → Connect, then copy config.metaMaskGrant)
//
// Run:  node scripts/spike-redelegation.mjs
//
// It POSTs `redelegate` with several candidate serializations of `granted` and
// reports which (if any) 1Shot accepts (2xx) vs rejects (4xx + error body). The
// first 2xx tells us the exact serialization to use in `captureMetaMaskAuthority`
// → `buildExecutorDelegationChain`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Minimal .env loader that strips surrounding quotes (the repo's gotcha). */
function loadEnv(path) {
  try {
    const txt = readFileSync(path, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      const val = m[2].replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* no .env — rely on process env */
  }
}
loadEnv(resolve(__dirname, "../../spikes/.env"));

const API_KEY = process.env.ONESHOT_API_KEY;
const API_SECRET = process.env.ONESHOT_API_SECRET;
const BASE = (process.env.ONESHOT_API_BASE || "https://api.1shotapi.com/v0").replace(/\/$/, "");

if (!API_KEY || !API_SECRET) {
  console.log("SKIP: ONESHOT_API_KEY/_SECRET not set in ../spikes/.env");
  process.exit(0);
}

async function token() {
  const res = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: API_KEY, client_secret: API_SECRET }),
  });
  if (!res.ok) throw new Error(`token failed ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

const sessionWalletId = process.env.SPIKE_SESSION_WALLET_ID;
const executor = process.env.SPIKE_EXECUTOR_ADDRESS;
const grantedFile = process.env.SPIKE_GRANTED_FILE;

if (!sessionWalletId || !executor || !grantedFile) {
  console.log("Stage 0 OK — 1Shot creds present, OAuth reachable:");
  try {
    await token();
    console.log("  ✓ got an access token.");
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    process.exit(1);
  }
  console.log(
    "\nStage 1 needs (capture a grant in the desktop app first):\n" +
      "  SPIKE_SESSION_WALLET_ID=<1Shot wallet id used as the grant delegate>\n" +
      "  SPIKE_EXECUTOR_ADDRESS=<0x executor address>\n" +
      "  SPIKE_GRANTED_FILE=<path to JSON of config.metaMaskGrant>\n",
  );
  process.exit(0);
}

const granted = JSON.parse(readFileSync(grantedFile, "utf8"));

/** Candidate serializations of `granted` → the `delegationData` string 1Shot wants. */
function candidates(g) {
  const out = [];
  const push = (label, v) => v != null && out.push({ label, value: typeof v === "string" ? v : JSON.stringify(v) });
  if (typeof g === "string") push("raw-string", g);
  push("JSON.stringify(granted)", g);
  push("granted.context", g?.context);
  push("granted.permissionsContext", g?.permissionsContext);
  push("granted.permission?.data", g?.permission?.data);
  push("granted.signerMeta", g?.signerMeta);
  if (Array.isArray(g)) {
    push("granted[0]", g[0]);
    push("granted[0].context", g[0]?.context);
    push("granted[0].permissionsContext", g[0]?.permissionsContext);
  }
  return out;
}

const t = await token();
const cands = candidates(granted);
console.log(`Probing ${cands.length} serializations against ${BASE}/wallets/${sessionWalletId}/delegations/redelegate\n`);

let firstWin = null;
for (const c of cands) {
  try {
    const res = await fetch(`${BASE}/wallets/${sessionWalletId}/delegations/redelegate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ delegationData: c.value, delegateAddress: executor }),
    });
    const body = await res.text();
    const ok = res.ok;
    console.log(`  [${ok ? "✓ ACCEPT" : "✗ " + res.status}] ${c.label} ${ok ? "" : "→ " + body.slice(0, 160)}`);
    if (ok && !firstWin) firstWin = c.label;
  } catch (e) {
    console.log(`  [✗ ERR] ${c.label} → ${e.message}`);
  }
}

console.log(
  firstWin
    ? `\nVERDICT: 1Shot accepts "${firstWin}". Use that serialization in captureMetaMaskAuthority → buildExecutorDelegationChain.`
    : "\nVERDICT: none accepted — Path A (1Shot redelegate) does not take the grant as-is. Inspect the error bodies above; we may need a different delegate type or Path B (local viem redelegation).",
);
