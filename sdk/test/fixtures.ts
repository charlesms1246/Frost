import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseEther,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { FROST_BASE_SEPOLIA } from "../src/addresses.js";

const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

export const anvilChain = defineChain({
  ...{
    id: FROST_BASE_SEPOLIA.chainId,
    name: "Anvil (Base Sepolia fork)",
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  },
});

export function rpcUrl(): string {
  return process.env["FROST_TEST_RPC"] ?? "http://127.0.0.1:8545";
}

export function publicClient(): PublicClient {
  return createPublicClient({ chain: anvilChain, transport: http(rpcUrl()) });
}

export function anvilAccount(index: number): Account {
  return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });
}

export function walletFor(account: Account): WalletClient {
  return createWalletClient({ chain: anvilChain, account, transport: http(rpcUrl()) });
}

/**
 * Impersonate an arbitrary address (e.g. the deployed-contracts admin) on
 * anvil so we can call admin-gated functions like `approveProvider` from
 * tests without holding the admin's private key.
 */
export async function impersonate(address: Address): Promise<void> {
  await jsonRpc("anvil_impersonateAccount", [address]);
  // Fund the impersonated account so it can pay gas.
  await jsonRpc("anvil_setBalance", [address, toQuantity(parseEther("10"))]);
}

export async function stopImpersonating(address: Address): Promise<void> {
  await jsonRpc("anvil_stopImpersonatingAccount", [address]);
}

export function walletForImpersonated(address: Address): WalletClient {
  return createWalletClient({
    chain: anvilChain,
    account: address,
    transport: http(rpcUrl()),
  });
}

export async function snapshot(): Promise<Hex> {
  return (await jsonRpc("evm_snapshot", [])) as Hex;
}

export async function revertTo(snapshotId: Hex): Promise<void> {
  await jsonRpc("evm_revert", [snapshotId]);
}

export async function mineBlocks(n: number): Promise<void> {
  await jsonRpc("anvil_mine", [toQuantity(BigInt(n))]);
}

export async function increaseTime(seconds: number): Promise<void> {
  await jsonRpc("evm_increaseTime", [toQuantity(BigInt(seconds))]);
  await jsonRpc("anvil_mine", [toQuantity(1n)]);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function jsonRpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const j = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

function toQuantity(v: bigint): Hex {
  return `0x${v.toString(16)}` as Hex;
}

export { privateKeyToAccount };
