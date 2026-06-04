// Transfer ETH from the funded Base Sepolia wallet to the 1Shot server wallet.
// Usage: node scripts/fund-server-wallet.mjs [amountEth]
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const env = {};
for (const line of readFileSync(new URL("../../spikes/.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const amount = process.argv[2] ?? "0.5";
const to = env.ONESHOT_WALLET_ADDRESS;
const pk = env.BASE_SEPOLIA_PK.startsWith("0x") ? env.BASE_SEPOLIA_PK : `0x${env.BASE_SEPOLIA_PK}`;
const account = privateKeyToAccount(pk);
const transport = http(env.BASE_SEPOLIA_HTTP);
const wallet = createWalletClient({ account, chain: baseSepolia, transport });
const pub = createPublicClient({ chain: baseSepolia, transport });

console.log(`[fund] funder ${account.address} balance=${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
console.log(`[fund] transferring ${amount} ETH → ${to}…`);
const hash = await wallet.sendTransaction({ to, value: parseEther(amount) });
console.log(`[fund] tx=${hash}`);
await pub.waitForTransactionReceipt({ hash });
console.log(`[fund] server wallet balance=${formatEther(await pub.getBalance({ address: to }))} ETH`);
