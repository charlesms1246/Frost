// Live RefillableMandate proof on Base Sepolia (IG-05 — the "bounded streaming
// spend" differentiator, deployed but previously never exercised at runtime).
//
// Demonstrates the §4 refillable primitive end-to-end on-chain with the funded
// session key:
//   1. createRefillableMandate  — signs the refill POLICY + mints the first active mandate
//   2. getRefillStatus          — reads the policy back (cap, per-refill, threshold, active id)
//   3. triggerRefill            — shows the on-chain anti-griefing PRECONDITION:
//                                 a refill is refused until the active mandate is depleted
//                                 (remaining < threshold). Depletion happens via
//                                 Settlement.settle (the x402 spend path) — so a *successful*
//                                 refill shares IG-04's settlement dependency; the refusal here
//                                 IS the live proof that the cap can't be topped up for free.
//   4. revokeRefillPolicy       — stops future refills (policy.revoked = true)
//
//   node scripts/refillable-mandate-demo.mjs          # dry-run: plan + balances + feasibility
//   node scripts/refillable-mandate-demo.mjs send      # execute the live sequence (real txs, gas)
//
// Reads BASE_SEPOLIA_PK / BASE_SEPOLIA_HTTP from D:\Frost\.env (quotes stripped).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createWalletClient, createPublicClient, http, formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { refillable, spendCapTotal, capabilityWhitelist, CAPABILITY, FROST_BASE_SEPOLIA } from "@frost/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
}
loadEnv(resolve(__dirname, "../../.env"));
loadEnv(resolve(__dirname, "../../spikes/.env"));

const PK = process.env.BASE_SEPOLIA_PK;
if (!PK) { console.log("Missing BASE_SEPOLIA_PK in .env"); process.exit(1); }
const pk = PK.startsWith("0x") ? PK : `0x${PK}`;
const RPC = process.env.BASE_SEPOLIA_HTTP || "https://sepolia.base.org";

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });

// Refill policy terms (6-dec USDC). threshold == perRefill is the max the contract
// allows (ThresholdExceedsPerRefill guards >); minInterval 0 = no time gate.
const PER_REFILL = 1_000_000n;     // $1.00 released per cycle
const TOTAL_CAP = 3_000_000n;      // $3.00 lifetime ceiling (≤ 3 refills)
const REFILL_THRESHOLD = 1_000_000n;
const MIN_INTERVAL = 0n;
const usd = (v) => `$${formatUnits(v, 6)}`;
const link = (tx) => `https://sepolia.basescan.org/tx/${tx}`;

console.log("Network          : Base Sepolia (84532)");
console.log("Signer (user)    :", account.address);
console.log("RefillableMandate:", FROST_BASE_SEPOLIA.refillableMandate);
console.log("Policy terms     :", `perRefill ${usd(PER_REFILL)} · totalCap ${usd(TOTAL_CAP)} · threshold ${usd(REFILL_THRESHOLD)} · minInterval ${MIN_INTERVAL}s`);

const ethBal = await publicClient.getBalance({ address: account.address });
console.log("Signer ETH       :", formatEther(ethBal));

if (process.argv[2] !== "send") {
  console.log("\n(dry-run — re-run with `send` to execute the live sequence)");
  console.log(`Feasible (gas)   : ${ethBal > 2_000_000_000_000_000n ? "OK" : "LOW — fund the signer with Base Sepolia ETH"}`);
  process.exit(0);
}

if (ethBal === 0n) { console.log("\n✗ Signer has 0 ETH — fund it for gas before running. Aborting."); process.exit(1); }

const deployment = FROST_BASE_SEPOLIA;
const userNonce = BigInt(Date.now());

// 1 — create the refillable mandate (policy + first active mandate).
console.log("\n[1/4] createRefillableMandate…");
const created = await refillable.createRefillableMandate(walletClient, publicClient, deployment, {
  holder: account.address,
  // Mandate §3.3 requires every mandate carry BOTH a CAPABILITY_WHITELIST and a
  // SPEND_CAP_TOTAL (paranoid default — an absent caveat denies everything). The
  // active mandate is a streaming-spend leaf, so CAP_INFERENCE_CALL; SPEND_CAP_TOTAL
  // must equal perRefillAmount (RefillableMandate._assertSpendCapMatches).
  activeMandateCaveats: [capabilityWhitelist([CAPABILITY.INFERENCE_CALL]), spendCapTotal(PER_REFILL)],
  terms: { totalCap: TOTAL_CAP, perRefillAmount: PER_REFILL, refillThreshold: REFILL_THRESHOLD, minRefillInterval: MIN_INTERVAL },
  userNonce,
});
console.log("  ✓ parentAuthId   :", created.parentAuthId);
console.log("  ✓ activeMandateId:", created.activeMandateId);
console.log("  ✓ tx             :", link(created.txHash));

// 2 — read the policy back.
console.log("\n[2/4] getRefillStatus…");
const status = await refillable.getRefillStatus(publicClient, deployment, created.parentAuthId);
console.log(`  totalCap ${usd(status.totalCap)} · totalRefilled ${usd(status.totalRefilled)} · perRefill ${usd(status.perRefillAmount)} · threshold ${usd(status.refillThreshold)} · revoked ${status.revoked}`);
console.log("  active mandate   :", status.activeMandateId);

// 3 — triggerRefill: demonstrates the on-chain depletion PRECONDITION.
console.log("\n[3/4] triggerRefill (expecting the anti-griefing refusal)…");
try {
  const tx = await refillable.triggerRefill(walletClient, publicClient, deployment, created.parentAuthId);
  console.log("  ✓ refilled (active mandate was depleted) tx:", link(tx));
} catch (e) {
  // Dig the decoded custom error out of viem's error chain (the top-level message is generic).
  const reverted = typeof e?.walk === "function" ? e.walk((x) => x?.name === "ContractFunctionRevertedError") : undefined;
  const errorName = reverted?.data?.errorName;
  const args = reverted?.data?.args;
  if (errorName === "ActiveMandateNotDepleted") {
    const [remaining, threshold] = args ?? [];
    console.log(`  ✓ correctly REFUSED — ActiveMandateNotDepleted(remaining ${usd(remaining)}, threshold ${usd(threshold)}).`);
    console.log("    The cap cannot be topped up for free: a refill needs the active mandate spent");
    console.log("    down via Settlement.settle first (the x402 spend path, shared with IG-04).");
  } else {
    console.log("  ! triggerRefill reverted unexpectedly:", errorName || reverted?.shortMessage || e?.shortMessage || String(e));
  }
}

// 4 — revoke the refill policy (stops future refills).
console.log("\n[4/4] revokeRefillPolicy…");
const revokeTx = await refillable.revokeRefillPolicy(walletClient, publicClient, deployment, created.parentAuthId);
console.log("  ✓ tx             :", link(revokeTx));
const after = await refillable.getRefillStatus(publicClient, deployment, created.parentAuthId);
console.log("  policy.revoked   :", after.revoked);

console.log("\nDone — RefillableMandate exercised live on Base Sepolia.");
