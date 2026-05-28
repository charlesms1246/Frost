import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { providerRegistryAbi } from "./abis.js";
import type { FrostDeployment } from "./addresses.js";

export type ProviderRecord = {
  providerAddress: Address;
  manifestHash: Hex;
  manifestUri: Hex;
  approvedAt: bigint;
  revokedAt: bigint;
  tier: number;
};

/** Admin-only: approve a provider with manifest commitment. */
export async function approveProvider(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  params: { provider: Address; manifestHash: Hex; manifestUri: Hex; tier: number }
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address: deployment.providerRegistry,
    abi: providerRegistryAbi,
    functionName: "approveProvider",
    args: [params.provider, params.manifestHash, params.manifestUri, params.tier],
    account,
  });
  const txHash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/** Admin-only: revoke a provider. Removes from `activeProviderList`. */
export async function revokeProvider(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  provider: Address
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address: deployment.providerRegistry,
    abi: providerRegistryAbi,
    functionName: "revokeProvider",
    args: [provider],
    account,
  });
  const txHash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function isApproved(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  provider: Address
): Promise<boolean> {
  return (await publicClient.readContract({
    address: deployment.providerRegistry,
    abi: providerRegistryAbi,
    functionName: "isApproved",
    args: [provider],
  })) as boolean;
}

export async function getActiveProviders(
  publicClient: PublicClient,
  deployment: FrostDeployment
): Promise<readonly Address[]> {
  return (await publicClient.readContract({
    address: deployment.providerRegistry,
    abi: providerRegistryAbi,
    functionName: "getActiveProviders",
  })) as readonly Address[];
}

export async function getManifest(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  provider: Address
): Promise<{ manifestHash: Hex; manifestUri: Hex }> {
  const [manifestHash, manifestUri] = (await publicClient.readContract({
    address: deployment.providerRegistry,
    abi: providerRegistryAbi,
    functionName: "getManifest",
    args: [provider],
  })) as readonly [Hex, Hex];
  return { manifestHash, manifestUri };
}
