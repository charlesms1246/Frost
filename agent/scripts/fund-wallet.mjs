// Fund a wallet from BASE_SEPOLIA_PK (Base Sepolia ONLY — never mainnet).
// Sends 1 ETH (native) + 40 USDC to the destination.
//
//   node scripts/fund-wallet.mjs            # read-only: prints source address + balances
//   node scripts/fund-wallet.mjs send       # actually transfers
//
// Reads BASE_SEPOLIA_PK / BASE_SEPOLIA_HTTP from D:\Frost\.env (quotes stripped).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, formatEther, formatUnits, erc20Abi, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

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

const DEST = getAddress("0xbc393533aD43Bf642B11690f42EE27fe7FCE4344");
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e"); // Base Sepolia USDC
const ETH_AMOUNT = parseEther("1");
const USDC_AMOUNT = parseUnits("40", 6);
const RPC = process.env.BASE_SEPOLIA_HTTP || "https://sepolia.base.org";

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });

const [ethBal, usdcBal] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
]);

console.log("Network : Base Sepolia (84532)");
console.log("Source  :", account.address);
console.log("  ETH   :", formatEther(ethBal));
console.log("  USDC  :", formatUnits(usdcBal, 6));
console.log("Dest    :", DEST);
console.log("Send    : 1 ETH + 40 USDC");

if (process.argv[2] !== "send") {
  console.log("\n(dry-run — re-run with `send` to transfer)");
  const okEth = ethBal > ETH_AMOUNT; // need >1 ETH (1 + gas)
  const okUsdc = usdcBal >= USDC_AMOUNT;
  console.log(`Feasible: ETH ${okEth ? "OK" : "INSUFFICIENT"}, USDC ${okUsdc ? "OK" : "INSUFFICIENT"}`);
  process.exit(0);
}

if (ethBal <= ETH_AMOUNT) { console.log("\n✗ Insufficient ETH (need 1 ETH + gas). Aborting before any send."); process.exit(1); }
if (usdcBal < USDC_AMOUNT) { console.log("\n✗ Insufficient USDC (need 40). Aborting before any send."); process.exit(1); }

console.log("\nSending 1 ETH…");
const ethTx = await walletClient.sendTransaction({ to: DEST, value: ETH_AMOUNT });
console.log("  tx:", ethTx, "→ waiting…");
const ethRcpt = await publicClient.waitForTransactionReceipt({ hash: ethTx });
console.log("  ✓ ETH", ethRcpt.status, `https://sepolia.basescan.org/tx/${ethTx}`);

console.log("Sending 40 USDC…");
const usdcTx = await walletClient.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [DEST, USDC_AMOUNT] });
console.log("  tx:", usdcTx, "→ waiting…");
const usdcRcpt = await publicClient.waitForTransactionReceipt({ hash: usdcTx });
console.log("  ✓ USDC", usdcRcpt.status, `https://sepolia.basescan.org/tx/${usdcTx}`);

console.log("\nDone.");
