// Register the `AuditRegistry.commit` function as a 1Shot contract method, so Frost can
// anchor a session's Merkle root through a 1Shot SERVER WALLET (1Shot sponsors gas — the
// session key needs no ETH). Prints the methodId and appends ONESHOT_AUDIT_METHOD_ID to
// the repo `.env` if not already present. Idempotent: reuses an existing method.
//
//   node scripts/register-audit-method.mjs
//
// Reads ONESHOT_API_KEY / _SECRET / _BUSINESS_ID / _WALLET_ID / _API_BASE from D:\Frost\.env.
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OneShotClient } from "@1shotapi/client-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../.env");
function loadEnv(p) {
  try {
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
}
loadEnv(ENV_PATH);

const apiKey = process.env.ONESHOT_API_KEY;
const apiSecret = process.env.ONESHOT_API_SECRET;
const businessId = process.env.ONESHOT_BUSINESS_ID;
const walletId = process.env.ONESHOT_WALLET_ID;
const baseUrl = process.env.ONESHOT_API_BASE || "https://api.1shotapi.com/v0";
const CHAIN_ID = 84532;
const AUDIT_REGISTRY = "0xeA157DE7D1ec58a0610D82171bbb4873bc19319B";

if (!apiKey || !apiSecret || !businessId || !walletId) {
  console.error("Missing ONESHOT_API_KEY / _SECRET / _BUSINESS_ID / _WALLET_ID in .env");
  process.exit(1);
}

const client = new OneShotClient({
  apiKey,
  apiSecret,
  ...(process.env.ONESHOT_API_BASE ? { baseUrl } : {}),
});

// AuditRegistry.commit(bytes32 sessionId, bytes32 merkleRoot, uint64 sessionEnd)
const commitFragment = {
  type: "function",
  name: "commit",
  stateMutability: "nonpayable",
  inputs: [
    { name: "sessionId", type: "bytes32" },
    { name: "merkleRoot", type: "bytes32" },
    { name: "sessionEnd", type: "uint64" },
  ],
  outputs: [],
};

function persistMethodId(id) {
  if (process.env.ONESHOT_AUDIT_METHOD_ID === id) return;
  const has = (() => { try { return /^ONESHOT_AUDIT_METHOD_ID=/m.test(readFileSync(ENV_PATH, "utf8")); } catch { return false; } })();
  if (has) {
    console.log(`\n.env already has an ONESHOT_AUDIT_METHOD_ID line — update it manually to:\n  ONESHOT_AUDIT_METHOD_ID=${id}`);
    return;
  }
  appendFileSync(ENV_PATH, `\nONESHOT_AUDIT_METHOD_ID=${id}\n`);
  console.log(`\nAppended to ${ENV_PATH}:\n  ONESHOT_AUDIT_METHOD_ID=${id}`);
}

const existing = await client.contractMethods
  .list(businessId, { chainId: CHAIN_ID, contractAddress: AUDIT_REGISTRY })
  .then((r) => (Array.isArray(r) ? r : r?.response ?? r?.data ?? []))
  .catch(() => []);
const found = (Array.isArray(existing) ? existing : []).find((m) => m.functionName === "commit");
if (found) {
  console.log(`Already registered: ${found.id} (commit @ ${AUDIT_REGISTRY})`);
  persistMethodId(found.id);
  process.exit(0);
}

const created = await client.contractMethods.importFromABI(businessId, {
  chainId: CHAIN_ID,
  contractAddress: AUDIT_REGISTRY,
  walletId,
  name: "Frost AuditRegistry commit",
  description: "Anchor a Frost session's Merkle audit root (gas-sponsored via the 1Shot server wallet).",
  abi: [commitFragment],
});
const method = Array.isArray(created) ? created[0] : created;
if (!method?.id) {
  console.error("Import returned no method id:", JSON.stringify(created, null, 2));
  process.exit(1);
}
console.log(`Registered AuditRegistry.commit → methodId ${method.id}`);
persistMethodId(method.id);
