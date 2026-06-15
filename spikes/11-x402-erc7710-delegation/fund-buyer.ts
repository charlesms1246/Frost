// Spike 11 helper: fund + deploy the buyer smart account so the buyer leg can settle.
// Uses SPIKE_BUYER_PK (the funded EOA) to (1) transfer USDC to the counterfactual buyer
// smart account and (2) deploy that smart account via its factory (EOA pays gas). The
// buyer delegator pays the x402 price from the SA's own USDC balance, and the kit docs
// require the delegator deployed before a delegation can be redeemed.
//
// Run: SPIKE_BUYER_PK=0x... SPIKE_FUND_USDC=1 npx tsx fund-buyer.ts

import { createPublicClient, createWalletClient, http, encodeFunctionData, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/smart-accounts-kit";

const RPC_URL = process.env.BASE_SEPOLIA_HTTP ?? "https://sepolia.base.org";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const FUND_USDC = process.env.SPIKE_FUND_USDC ?? "1"; // human USDC to send to the SA
const rawPk = process.env.SPIKE_BUYER_PK;
if (!rawPk) throw new Error("SPIKE_BUYER_PK required");
const PK = (rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`) as `0x${string}`;

const erc20Abi = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function main() {
  const eoa = privateKeyToAccount(PK);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account: eoa, chain: baseSepolia, transport: http(RPC_URL) });

  const sa = await toMetaMaskSmartAccount({
    client: publicClient as never,
    implementation: Implementation.Hybrid,
    deployParams: [eoa.address, [], [], []],
    deploySalt: "0x",
    signer: { account: eoa as never },
  });
  console.log("EOA:", eoa.address, "| buyer SA:", sa.address);

  // 1) USDC → SA
  const want = parseUnits(FUND_USDC, 6);
  const have = (await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [sa.address] })) as bigint;
  console.log(`SA USDC balance: ${have} (target ≥ ${want})`);
  if (have < want) {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [sa.address, want - have] });
    const tx = await walletClient.sendTransaction({ to: USDC, data });
    console.log("USDC transfer tx:", tx);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const now = (await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [sa.address] })) as bigint;
    console.log("SA USDC balance now:", now);
  }

  // 2) Deploy the SA via its factory (EOA pays gas). Idempotent — skip if already deployed.
  const code = await publicClient.getCode({ address: sa.address }).catch(() => undefined);
  if (code && code !== "0x") {
    console.log("SA already deployed.");
  } else {
    const { factory, factoryData } = await sa.getFactoryArgs();
    if (!factory || !factoryData) throw new Error("no factory args from smart account");
    const tx = await walletClient.sendTransaction({ to: factory, data: factoryData });
    console.log("SA deploy tx:", tx);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const c2 = await publicClient.getCode({ address: sa.address }).catch(() => undefined);
    console.log("SA deployed:", c2 && c2 !== "0x" ? "yes" : "NO");
  }
  console.log("\n✅ buyer SA funded + deployed:", sa.address);
}

main().catch((e) => { console.error("fund-buyer ERROR:", e instanceof Error ? e.stack : String(e)); process.exit(1); });
