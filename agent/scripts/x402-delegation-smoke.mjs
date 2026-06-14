// Node smoke: the agent's delegation inference buyer pays the REAL erc7710 gateway
// end-to-end (402 → ERC-7710 delegation → settle → completion). Mirrors spike 11 but
// drives it through makeDelegationInferenceClient + X402InferenceClient (the agent path).
//
// Prereq: the erc7710 gateway running (X402_ASSET_TRANSFER_METHOD=erc7710), and a buyer
// key whose address is 7702-delegated + USDC-funded. Run from agent/:
//   GATEWAY_URL=http://localhost:4023 SMOKE_BUYER_PK=0x... node scripts/x402-delegation-smoke.mjs

import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { makeDelegationInferenceClient } from "../dist/browser.js";

const GATEWAY_URL = process.env.GATEWAY_URL ?? "http://localhost:4023";
const RPC_URL = process.env.BASE_SEPOLIA_HTTP ?? "https://sepolia.base.org";
const rawPk = process.env.SMOKE_BUYER_PK;
if (!rawPk) throw new Error("SMOKE_BUYER_PK required (a 7702-delegated, USDC-funded Base Sepolia key)");
const PK = rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`;

const account = privateKeyToAccount(PK);
console.log("[smoke] buyer account:", account.address, "→ gateway:", GATEWAY_URL);

const client = makeDelegationInferenceClient({
  baseUrl: GATEWAY_URL,
  model: "x402-delegation-smoke",
  account,
  chain: baseSepolia,
  rpcUrl: RPC_URL,
  onSettle: (info) => console.log("[smoke] onSettle:", JSON.stringify(info)),
});

const res = await client.complete({
  messages: [{ role: "user", content: "Reply with exactly: DELEGATION_OK" }],
  temperature: 0,
});

console.log("[smoke] completion:", JSON.stringify({ model: res.model, id: res.id, text: res.text?.slice(0, 120) }));
if (typeof res.text === "string" && res.text.length > 0) {
  console.log("\n✅ AGENT x402-DELEGATION SMOKE PASS — inference paid via ERC-7710 delegation.");
} else {
  console.log("\n❌ no completion text returned.");
  process.exit(1);
}
