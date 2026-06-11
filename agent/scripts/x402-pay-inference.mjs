// End-to-end x402 inference payment (IG-04 capstone): the agent's X402InferenceClient
// hits the running x402-inference gateway, gets a 402, signs an EIP-3009 USDC
// transferWithAuthorization with the session key, retries with X-PAYMENT, the 1Shot
// facilitator settles on Base Sepolia, and the gateway returns a real completion.
//
//   node scripts/x402-pay-inference.mjs        # pays ~$0.001 USDC (testnet), real settlement
//
// Prereqs: the gateway running (node dist/server.js in x402-inference/), and the payer
// (BASE_SEPOLIA_PK) holding USDC on Base Sepolia. Env from D:\Frost\.env.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createPublicClient, http, erc20Abi, getAddress, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { X402InferenceClient, makeEvmX402Signer } from "../dist/browser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv(p) {
  try {
    for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
}
loadEnv(resolve(__dirname, "../../.env"));
loadEnv(resolve(__dirname, "../../spikes/.env"));

const pkRaw = process.env.BASE_SEPOLIA_PK;
if (!pkRaw) { console.log("Missing BASE_SEPOLIA_PK in .env"); process.exit(1); }
const account = privateKeyToAccount(pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`);
const baseUrl = process.env.X402_GATEWAY_URL || "http://localhost:4021";
const network = process.env.X402_NETWORK || "eip155:84532";

console.log("payer (session key):", account.address);
console.log("gateway            :", baseUrl, "·", network);

const signer = makeEvmX402Signer({ account, network });
let settle;
const client = new X402InferenceClient({
  baseUrl,
  model: "openai/gpt-4o-mini",
  signer,
  onSettle: (i) => { settle = i; },
});

// Read the payer's USDC balance before/after to prove the on-chain settlement delta.
const rpc = createPublicClient({ transport: http(process.env.BASE_SEPOLIA_HTTP || "https://sepolia.base.org") });
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const usdcBal = () => rpc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
const before = await usdcBal();
console.log("payer USDC before  :", formatUnits(before, 6));

console.log("\n→ POST /chat/completions  (expect 402 → sign EIP-3009 → settle → retry)…");
const t0 = Date.now();
const res = await client.complete({
  model: "openai/gpt-4o-mini",
  temperature: 0,
  messages: [{ role: "user", content: "In one short sentence, what is an x402 payment?" }],
});
console.log(`\n✓ PAID inference completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log("  completion :", res.text);
console.log("  model      :", res.model, "· id:", res.id);
console.log("  settlement (X-PAYMENT-RESPONSE):", settle?.paymentResponse ?? "(none returned)");

// Poll the balance briefly — settlement may land a block or two after the 200.
let after = before;
for (let i = 0; i < 10; i++) {
  after = await usdcBal();
  if (after !== before) break;
  await new Promise((r) => setTimeout(r, 2000));
}
const delta = Number(formatUnits(before - after, 6));
console.log("payer USDC after   :", formatUnits(after, 6));
console.log(delta > 0
  ? `\n✅ ON-CHAIN SETTLEMENT CONFIRMED — payer paid ${delta} USDC for this inference call.`
  : "\n(balance unchanged in the poll window — settlement may be async/pending; the 200 means /verify passed.)");

