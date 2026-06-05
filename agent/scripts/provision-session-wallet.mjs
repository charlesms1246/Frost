// Provision the Path-A SESSION wallet: a 1Shot custodial wallet that becomes the
// DELEGATE (`to`) of the user's ERC-7715 grant. 1Shot can then sign the ERC-7710
// redelegation to the executor (`redelegateWithDelegationData` requires the wallet
// to BE the grant's delegate — verified against the SDK's wallets.js).
//
// Creds (../spikes/.env): ONESHOT_API_KEY / _SECRET / _BUSINESS_ID [/ _API_BASE].
// Idempotent: reuses an existing wallet named "frost-session-delegate" if present.
//
// Run:  node scripts/provision-session-wallet.mjs   (from agent/)
//
// Prints the walletId + address and the exact spike env + desktop config to set.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    /* rely on process env */
  }
}
loadEnv(resolve(__dirname, "../../spikes/.env"));

const API_KEY = process.env.ONESHOT_API_KEY;
const API_SECRET = process.env.ONESHOT_API_SECRET;
const BUSINESS_ID = process.env.ONESHOT_BUSINESS_ID;
const BASE = (process.env.ONESHOT_API_BASE || "https://api.1shotapi.com/v0").replace(/\/$/, "");
const CHAIN_ID = Number(process.env.ONESHOT_CHAIN_ID || 84532); // Base Sepolia
const NAME = process.env.SESSION_WALLET_NAME || "frost-session-delegate";

if (!API_KEY || !API_SECRET || !BUSINESS_ID) {
  console.log("SKIP: ONESHOT_API_KEY/_SECRET/_BUSINESS_ID required in ../spikes/.env");
  process.exit(0);
}

async function token() {
  const res = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: API_KEY, client_secret: API_SECRET }).toString(),
  });
  if (!res.ok) throw new Error(`token failed ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

const t = await token();
const authHeaders = { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };

// List-first (idempotent).
const listRes = await fetch(`${BASE}/business/${BUSINESS_ID}/wallets`, { headers: { Authorization: `Bearer ${t}` } });
if (!listRes.ok) {
  console.log(`✗ list wallets failed ${listRes.status}: ${(await listRes.text()).slice(0, 200)}`);
  process.exit(1);
}
const existing = ((await listRes.json()).response ?? []).find((w) => w.name === NAME);

let wallet;
if (existing) {
  wallet = { id: existing.id, accountAddress: existing.accountAddress };
  console.log(`Reusing existing "${NAME}" wallet.`);
} else {
  const res = await fetch(`${BASE}/business/${BUSINESS_ID}/wallets`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ chainId: CHAIN_ID, name: NAME, description: "Frost ERC-7715 grant delegate (Path A redelegation)" }),
  });
  if (!res.ok) {
    console.log(`✗ create wallet failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  wallet = await res.json();
  console.log(`Created a new "${NAME}" wallet.`);
}

console.log(`\n  walletId : ${wallet.id}`);
console.log(`  address  : ${wallet.accountAddress}`);
console.log(`  chainId  : ${CHAIN_ID} (Base Sepolia)`);

console.log(
  "\nNext — fund this address for gas (it's the redelegator), then:\n" +
    "  1. In the desktop app config, set signingWalletAddress + signingWalletId to the\n" +
    "     values above (so capture grants TO this wallet — Path A delegate).\n" +
    `       signingWalletAddress = ${wallet.accountAddress}\n` +
    `       signingWalletId      = ${wallet.id}\n` +
    "  2. Run the desktop app, capture the grant, save config.metaMaskGrant to a JSON file.\n" +
    "  3. Set the spike env and run scripts/spike-redelegation.mjs:\n" +
    `       SPIKE_SESSION_WALLET_ID=${wallet.id}\n` +
    `       SPIKE_EXECUTOR_ADDRESS=${process.env.ONESHOT_WALLET_ADDRESS || "<executor 0x address>"}\n` +
    "       SPIKE_GRANTED_FILE=<path to the saved granted JSON>\n",
);
