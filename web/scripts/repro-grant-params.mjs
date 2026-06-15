// Pin down EXACTLY what tokenAddress input makes the kit throw
// "Invalid parameters: tokenAddress is not a valid hex value" (its toHexOrThrow validator).
// Runs the real requestExecutionPermissions client-side validation with a mock provider —
// no MetaMask. Run from web/:  node scripts/repro-grant-params.mjs

import { createWalletClient, custom, isHex, isAddress, getAddress } from "viem";
import { baseSepolia } from "viem/chains";
import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DELEGATE = "0x363b64Ab6299195E7EF06Ba3E3DBF37012522D0C";
const ACCOUNT = "0x1111111111111111111111111111111111111111";

console.log("USDC isHex:", isHex(USDC), "| isHex strict:", isHex(USDC, { strict: true }));
console.log("USDC isAddress (checksum-strict):", isAddress(USDC, { strict: true }));
try { console.log("USDC getAddress (canonical checksum):", getAddress(USDC)); }
catch (e) { console.log("USDC getAddress THREW:", e.message.split("\n")[0]); }

const provider = {
  request: async ({ method }) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
    if (method === "wallet_getSnaps") return {};
    // For the grant RPC, return null so any post-validation failure is clearly "not the validator".
    return null;
  },
};
const wallet = createWalletClient({ account: ACCOUNT, chain: baseSepolia, transport: custom(provider) })
  .extend(erc7715ProviderActions());

function makeReq(tokenAddress) {
  return {
    chainId: baseSepolia.id,
    to: DELEGATE,
    expiry: Math.floor(Date.now() / 1000) + 604800,
    permission: {
      type: "erc20-token-stream",
      isAdjustmentAllowed: true,
      data: {
        tokenAddress,
        amountPerSecond: 1n,
        maxAmount: 1000000n,
        initialAmount: 1000000n,
        startTime: Math.floor(Date.now() / 1000),
        justification: "repro",
      },
    },
  };
}

async function run(label, tokenAddress) {
  try {
    await wallet.requestExecutionPermissions([makeReq(tokenAddress)]);
    console.log(`PASS-validation  ${label}  (reached RPC; tokenAddress=${JSON.stringify(tokenAddress)})`);
  } catch (e) {
    const first = (e instanceof Error ? e.message : String(e)).split("\n")[0];
    const isHexErr = /valid hex/i.test(first);
    console.log(`${isHexErr ? "HEX-THROW " : "other-throw"}  ${label}  → ${first}`);
  }
}

console.log("\n--- token input variants ---");
await run("checksummed USDC", USDC);
await run("lowercased USDC", USDC.toLowerCase());
await run("no 0x prefix", USDC.slice(2));
await run("empty string", "");
await run("undefined", undefined);
await run("bigint(0) sentinel", 0n);
