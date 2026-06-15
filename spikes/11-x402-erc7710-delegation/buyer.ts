// Spike 11 — BUYER: pay an x402-protected endpoint with an ERC-7710 DELEGATION payload,
// from a MetaMask smart account, using createx402DelegationProvider.
//
// The buyer smart account is the DELEGATOR (must be a MetaMask smart account, local-key signer —
// the kit's createx402DelegationProvider signs the delegation in-process, no extension prompt).
// In Frost this maps to the master-agent SESSION account. Here we use SPIKE_BUYER_PK (a funded
// Base Sepolia key with USDC). wrapFetchWithPayment auto-handles the 402: it asks the delegation
// provider to mint+sign an open root delegation scoped to the payment terms, puts it in the
// X-Payment header, and retries — the facilitator redeems it on-chain.
//
// Run: SPIKE_BUYER_PK=0x... npm run buyer   (against a running seller)

import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/smart-accounts-kit";
import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client } from "@metamask/x402";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const SELLER_URL = process.env.SPIKE_SELLER_URL ?? "http://localhost:4111/api/agent-data";
const RPC_URL = process.env.BASE_SEPOLIA_HTTP ?? "https://sepolia.base.org";
const BUYER_PK = process.env.SPIKE_BUYER_PK;

if (!BUYER_PK) throw new Error("SPIKE_BUYER_PK is required — a funded Base Sepolia key (USDC + a little ETH).");

async function main() {
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const buyerEoa = privateKeyToAccount((BUYER_PK.startsWith("0x") ? BUYER_PK : `0x${BUYER_PK}`) as `0x${string}`);

  // The buyer DELEGATOR — the EOA upgraded to a MetaMask smart account via EIP-7702
  // (Stateless7702), so the smart-account address IS the EOA address. The MetaMask x402
  // facilitator requires the paying account to be a 7702-DELEGATED account (it rejects a
  // plain ERC-4337 Hybrid account with `account_not_delegated`) — this is the same account
  // shape the user's real MetaMask produces. The EOA must already be 7702-upgraded to the
  // gator (Frost's session key would be upgraded the same way the user's account is).
  // `client`/`signer` cast `as never`: spike viem ≠ kit's bundled viem (duplicate-viem gotcha).
  const buyerSmartAccount = await toMetaMaskSmartAccount({
    client: publicClient as never,
    implementation: Implementation.Stateless7702,
    address: buyerEoa.address,
    signer: { account: buyerEoa as never },
  });
  console.log("[spike11-buyer] buyer EOA:        ", buyerEoa.address);
  console.log("[spike11-buyer] buyer smart acct: ", buyerSmartAccount.address, "(fund THIS with USDC)");

  const erc7710Client = new x402Erc7710Client({
    delegationProvider: createx402DelegationProvider({ account: buyerSmartAccount }),
  });

  const coreClient = new x402Client().register("eip155:*", erc7710Client);
  const httpClient = new x402HTTPClient(coreClient);
  const fetchWithPayment = wrapFetchWithPayment(fetch, httpClient);

  console.log("[spike11-buyer] GET", SELLER_URL, "(expect 402 → pay via erc7710 delegation → 200)");
  const res = await fetchWithPayment(SELLER_URL, { method: "GET" });
  console.log("[spike11-buyer] HTTP", res.status);
  const body = await res.text();
  console.log("[spike11-buyer] body:", body);
  const settle = res.headers.get("x-payment-response");
  if (settle) console.log("[spike11-buyer] X-PAYMENT-RESPONSE:", settle);
  // On a non-200, decode the PAYMENT-REQUIRED header (b64 JSON) — the facilitator's
  // verify/settle rejection reason lives in its `error` field.
  if (res.status !== 200) {
    const pr = res.headers.get("payment-required") ?? res.headers.get("PAYMENT-REQUIRED");
    if (pr) {
      try {
        console.log("[spike11-buyer] PAYMENT-REQUIRED decoded:", Buffer.from(pr, "base64").toString("utf8"));
      } catch {
        console.log("[spike11-buyer] PAYMENT-REQUIRED (raw):", pr);
      }
    }
    console.log("[spike11-buyer] all response headers:");
    res.headers.forEach((v, k) => console.log(`    ${k}: ${v.slice(0, 200)}`));
  }

  if (res.status === 200) {
    console.log("\n✅ SPIKE 11 PASS — paid an x402 resource with an ERC-7710 delegation payload.");
  } else {
    console.log("\n❌ SPIKE 11 did not reach 200 — see status/body above.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[spike11-buyer] ERROR:", e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
