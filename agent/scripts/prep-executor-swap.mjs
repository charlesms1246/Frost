// Prep the executor server wallet for LIVE demo swaps on /runtime: wrap a chunk of
// ETH→WETH and approve the Uniswap SwapRouter02 for a generous amount, so several
// demo swaps (0.001 WETH each) run without re-prepping. Idempotent: skips the wrap
// when WETH is already sufficient and the approve when the allowance is already large.
//
// Uses the already-registered 1Shot method ids from ../../spikes/.env
// (ONESHOT_WETH_DEPOSIT_METHOD_ID / ONESHOT_WETH_APPROVE_METHOD_ID). Run before a
// recording session:  node scripts/prep-executor-swap.mjs

import { readFileSync } from "node:fs";
import { OneShotClient } from "@1shotapi/client-sdk";
import { createPublicClient, http, erc20Abi, parseEther, formatEther, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";

const env = {};
for (const line of readFileSync(new URL("../../spikes/.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const walletId = env.ONESHOT_WALLET_ID;
const wallet = env.ONESHOT_WALLET_ADDRESS;
const depositId = env.ONESHOT_WETH_DEPOSIT_METHOD_ID;
const approveId = env.ONESHOT_WETH_APPROVE_METHOD_ID;

const WRAP_AMOUNT = parseEther("0.01"); // ~10 demo swaps of 0.001 WETH
const APPROVE_AMOUNT = parseEther("1"); // generous — avoids re-approving per swap
const MIN_WETH = parseEther("0.005");
const MIN_ALLOWANCE = parseEther("0.1");

for (const [k, v] of [["ONESHOT_API_KEY", env.ONESHOT_API_KEY], ["ONESHOT_WALLET_ID", walletId], ["ONESHOT_WETH_DEPOSIT_METHOD_ID", depositId], ["ONESHOT_WETH_APPROVE_METHOD_ID", approveId]]) {
  if (!v) { console.log(`Missing ${k} in ../spikes/.env`); process.exit(1); }
}

const client = new OneShotClient({ apiKey: env.ONESHOT_API_KEY, apiSecret: env.ONESHOT_API_SECRET, baseUrl: env.ONESHOT_API_BASE });
const pub = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_SEPOLIA_HTTP || "https://sepolia.base.org") });

async function poll(txId, label) {
  for (let i = 0; i < 30; i++) {
    const tx = await client.transactions.get(txId);
    if (tx.status === "Completed" || tx.status === "Failed") {
      console.log(`  [${label}] ${tx.status} ${tx.transactionHash ?? ""} ${tx.failureReason ?? ""}`);
      return tx;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log(`  [${label}] still pending after timeout`);
}

const read = async () => ({
  eth: await pub.getBalance({ address: wallet }),
  weth: await pub.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
  usdc: await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
  allow: await pub.readContract({ address: WETH, abi: erc20Abi, functionName: "allowance", args: [wallet, ROUTER] }),
});

let s = await read();
console.log(`server wallet ${wallet}`);
console.log(`  before: ETH ${formatEther(s.eth)} · WETH ${formatEther(s.weth)} · USDC ${formatUnits(s.usdc, 6)} · allowance ${formatEther(s.allow)}`);

if (s.weth < MIN_WETH) {
  console.log(`[wrap] depositing ${formatEther(WRAP_AMOUNT)} ETH → WETH…`);
  const tx = await client.contractMethods.execute(depositId, {}, { walletId, value: WRAP_AMOUNT.toString() });
  await poll(tx.id, "wrap");
} else {
  console.log(`[wrap] skipped — WETH ${formatEther(s.weth)} ≥ ${formatEther(MIN_WETH)}`);
}

if (s.allow < MIN_ALLOWANCE) {
  console.log(`[approve] approving router for ${formatEther(APPROVE_AMOUNT)} WETH…`);
  const tx = await client.contractMethods.execute(approveId, { spender: ROUTER, amount: APPROVE_AMOUNT.toString() }, { walletId });
  await poll(tx.id, "approve");
} else {
  console.log(`[approve] skipped — allowance ${formatEther(s.allow)} ≥ ${formatEther(MIN_ALLOWANCE)}`);
}

s = await read();
console.log(`  after:  ETH ${formatEther(s.eth)} · WETH ${formatEther(s.weth)} · USDC ${formatUnits(s.usdc, 6)} · allowance ${formatEther(s.allow)}`);
console.log(s.weth >= parseEther("0.001") && s.allow >= parseEther("0.001") ? "\n✓ Ready for live demo swaps." : "\n✗ Not ready — check the tx results above.");
