// One-off setup: create a 1Shot server wallet for the executor on Base Sepolia and
// fund its address (for gas) from BASE_SEPOLIA_PK. Prints the walletId + address to
// save into ../spikes/.env. Run: node scripts/setup-oneshot-executor.mjs
import { readFileSync } from "node:fs";
import { OneShotClient } from "@1shotapi/client-sdk";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const env = {};
for (const line of readFileSync(new URL("../../spikes/.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const CHAIN_ID = 84532;
const FUND_ETH = "0.02"; // gas headroom for a few executor txs

const client = new OneShotClient({
  apiKey: env.ONESHOT_API_KEY,
  apiSecret: env.ONESHOT_API_SECRET,
  baseUrl: env.ONESHOT_API_BASE,
});
const businessId = env.ONESHOT_BUSINESS_ID;

console.log("[setup] creating 1Shot server wallet on Base Sepolia…");
const wallet = await client.wallets.create(businessId, {
  chainId: CHAIN_ID,
  name: `frost-executor-${Date.now()}`,
  description: "Frost executor sub-agent server wallet (Base Sepolia)",
});
console.log(`[setup] walletId=${wallet.id}`);
console.log(`[setup] address=${wallet.accountAddress}`);

// Fund the server wallet address for gas from BASE_SEPOLIA_PK.
const pk = env.BASE_SEPOLIA_PK.startsWith("0x") ? env.BASE_SEPOLIA_PK : `0x${env.BASE_SEPOLIA_PK}`;
const funder = privateKeyToAccount(pk);
const transport = http(env.BASE_SEPOLIA_HTTP);
const walletClient = createWalletClient({ account: funder, chain: baseSepolia, transport });
const pub = createPublicClient({ chain: baseSepolia, transport });

const funderBal = await pub.getBalance({ address: funder.address });
console.log(`[setup] funder ${funder.address} balance=${formatEther(funderBal)} ETH`);

console.log(`[setup] transferring ${FUND_ETH} ETH → ${wallet.accountAddress}…`);
const txHash = await walletClient.sendTransaction({
  to: wallet.accountAddress,
  value: parseEther(FUND_ETH),
});
console.log(`[setup] fund tx=${txHash}`);
await pub.waitForTransactionReceipt({ hash: txHash });
const newBal = await pub.getBalance({ address: wallet.accountAddress });
console.log(`[setup] server wallet balance=${formatEther(newBal)} ETH`);

console.log("\n[setup] DONE. Add to spikes/.env:");
console.log(`ONESHOT_WALLET_ID=${wallet.id}`);
console.log(`ONESHOT_WALLET_ADDRESS=${wallet.accountAddress}`);
