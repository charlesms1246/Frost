// Live executor proof on Base Sepolia: register the 1Shot methods, wrap ETH→WETH,
// approve the router, then submit a real WETH→USDC swap THROUGH the Frost Executor
// (§10.3 preflight + OneShotRestMethods relay). All txs run on the custodial 1Shot
// server wallet. Run: node scripts/executor-live-swap.mjs
import { readFileSync } from "node:fs";
import { OneShotClient } from "@1shotapi/client-sdk";
import { toFunctionSelector } from "viem";
import { callableSurface, hitlThreshold } from "@frost/sdk";
import {
  Executor,
  OneShotRestMethods,
  OneShotTransactionSubmitter,
} from "../dist/browser.js";

const env = {};
for (const line of readFileSync(new URL("../../spikes/.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const CHAIN = 84532;
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const FEE = 3000;
const AMOUNT_IN = "1000000000000000"; // 0.001 WETH
const businessId = env.ONESHOT_BUSINESS_ID;
const walletId = env.ONESHOT_WALLET_ID;
const recipient = env.ONESHOT_WALLET_ADDRESS;

const client = new OneShotClient({ apiKey: env.ONESHOT_API_KEY, apiSecret: env.ONESHOT_API_SECRET, baseUrl: env.ONESHOT_API_BASE });

const WETH_ABI = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "success", type: "bool" }] },
];
const ROUTER_ABI = [
  { type: "function", name: "exactInputSingle", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" },
    { name: "recipient", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
  ] }], outputs: [{ name: "amountOut", type: "uint256" }] },
];

async function listExisting(contractAddress) {
  const res = await client.contractMethods.list(businessId, { contractAddress, chainId: CHAIN }).catch(() => null);
  const byName = {};
  for (const m of res?.response ?? []) byName[m.functionName] = m.id;
  return byName;
}

// Idempotent + retrying: reuse already-registered methods; importFromABI can return
// transient 503s, so retry and re-check what landed before giving up.
async function register(contractAddress, abi, label) {
  const fns = abi.filter((f) => f.type === "function").map((f) => f.name);
  let byName = await listExisting(contractAddress);
  if (fns.every((n) => byName[n])) { console.log(`[register] ${label} (reused):`, byName); return byName; }

  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const created = await client.contractMethods.importFromABI(businessId, {
        chainId: CHAIN, contractAddress, walletId, name: `frost-${label}`, description: `Frost executor demo (${label})`, abi,
      });
      for (const m of created) byName[m.functionName] = m.id;
      console.log(`[register] ${label}:`, byName);
      return byName;
    } catch (e) {
      lastErr = e;
      console.log(`[register] ${label} attempt ${i + 1} failed: ${e.message}; retrying…`);
      await new Promise((r) => setTimeout(r, 4000));
      byName = await listExisting(contractAddress);
      if (fns.every((n) => byName[n])) { console.log(`[register] ${label} (recovered):`, byName); return byName; }
    }
  }
  throw lastErr;
}

async function poll(txId, label) {
  for (let i = 0; i < 30; i++) {
    const tx = await client.transactions.get(txId);
    if (tx.status === "Completed" || tx.status === "Failed") {
      console.log(`[${label}] ${tx.status} hash=${tx.transactionHash} ${tx.failureReason ?? ""}`);
      return tx;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  console.log(`[${label}] still pending after timeout`);
}

// 1 — register methods.
const weth = await register(WETH, WETH_ABI, "weth");
const router = await register(ROUTER, ROUTER_ABI, "router");

// 2 — wrap ETH → WETH (deposit with value).
console.log("[wrap] depositing 0.001 ETH → WETH…");
const wrapTx = await client.contractMethods.execute(weth.deposit, {}, { walletId, value: AMOUNT_IN });
await poll(wrapTx.id, "wrap");

// 3 — approve the router to spend WETH.
console.log("[approve] approving router…");
const approveTx = await client.contractMethods.execute(weth.approve, { spender: ROUTER, amount: AMOUNT_IN }, { walletId });
await poll(approveTx.id, "approve");

// 4 — submit the swap THROUGH the Frost Executor (preflight + OneShotRestMethods relay).
const selector = toFunctionSelector("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))");
const submitter = new OneShotTransactionSubmitter(
  new OneShotRestMethods({ apiKey: env.ONESHOT_API_KEY, apiSecret: env.ONESHOT_API_SECRET, baseUrl: env.ONESHOT_API_BASE }),
  walletId,
);
const executor = new Executor({ submitter });
const caveats = [
  callableSurface([{ target: ROUTER, selector, maxValue: 1_000_000_000n }]), // $1000/call
  hitlThreshold(100_000_000n), // $100 — above the swap notional, so no HITL pause
];
const req = {
  target: ROUTER,
  selector,
  notionalUsdc: 3_700_000n, // ~$3.70 (0.001 WETH), under maxValue + HITL
  call: {
    contractMethodId: router.exactInputSingle,
    // 1Shot wants every param value as a string — including the uint24 fee.
    params: { params: { tokenIn: WETH, tokenOut: USDC, fee: String(FEE), recipient, amountIn: AMOUNT_IN, amountOutMinimum: "0", sqrtPriceLimitX96: "0" } },
  },
};
console.log("[executor] running §10.3 preflight + submit via 1Shot…");
const res = await executor.execute({ id: "0x" + "11".repeat(32), caveats }, req);
console.log("[executor] result:", res.status, res.status === "submitted" ? res.tx : res.reason);
if (res.status === "submitted") await poll(res.tx.transactionId, "swap");
