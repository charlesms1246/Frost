// List the contract methods registered in the 1Shot account and print each method's
// id + REST endpoints (the "contract access API links"). Read-only — lists what's there.
//
//   node scripts/list-oneshot-methods.mjs                         # all methods
//   node scripts/list-oneshot-methods.mjs 0x036CbD53…F7e 84532    # filter by contract + chain
//
// Reads ONESHOT_API_KEY / _SECRET / _BUSINESS_ID / _API_BASE from D:\Frost\.env.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OneShotClient } from "@1shotapi/client-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv(p) {
  try {
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
}
loadEnv(resolve(__dirname, "../../.env"));
loadEnv(resolve(__dirname, "../../spikes/.env"));

const apiKey = process.env.ONESHOT_API_KEY;
const apiSecret = process.env.ONESHOT_API_SECRET;
const businessId = process.env.ONESHOT_BUSINESS_ID;
const baseUrl = process.env.ONESHOT_API_BASE || "https://api.1shotapi.com/v0";
if (!apiKey || !apiSecret || !businessId) {
  console.log("Missing ONESHOT_API_KEY / ONESHOT_API_SECRET / ONESHOT_BUSINESS_ID in .env");
  process.exit(1);
}

const argAddr = process.argv[2];
const argChain = process.argv[3];

const client = new OneShotClient({
  apiKey,
  apiSecret,
  ...(process.env.ONESHOT_API_BASE ? { baseUrl: process.env.ONESHOT_API_BASE } : {}),
});

const filter = { pageSize: 100, page: 1 };
if (argAddr) filter.contractAddress = argAddr;
if (argChain) filter.chainId = Number(argChain);

const res = await client.contractMethods.list(businessId, filter);
const methods = res?.response ?? [];
console.log(`Business ${businessId} · base ${baseUrl}`);
console.log(`${methods.length} method(s)${argAddr ? ` for ${argAddr}${argChain ? ` @ ${argChain}` : ""}` : ""} (totalResults ${res?.totalResults ?? "?"})\n`);

for (const m of methods) {
  const name = m.functionName ?? m.name ?? "(unnamed)";
  const sig = Array.isArray(m.inputs) ? m.inputs.map((i) => `${i.type} ${i.name}`).join(", ") : "";
  console.log(`• ${name}(${sig})  [${m.stateMutability ?? "?"}]  chain ${m.chainId ?? "?"}`);
  console.log(`    contract : ${m.contractAddress ?? "?"}`);
  console.log(`    methodId : ${m.id}`);
  console.log(`    execute  : POST ${baseUrl}/methods/${m.id}/execute`);
  console.log(`    delegate : POST ${baseUrl}/methods/${m.id}/executeAsDelegator`);
  console.log(`    read     : POST ${baseUrl}/methods/${m.id}/read`);
  console.log("");
}
if (methods.length === 0) {
  console.log("No methods returned. If you just added it, check the chainId/address filter,");
  console.log("or run with no args to list everything in the business.");
}
