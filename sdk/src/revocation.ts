import {
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { revocationAbi } from "./abis.js";
import type { FrostDeployment } from "./addresses.js";

/**
 * Revoke a mandate. Caller must be the mandate's issuer, the parent's
 * holder, or the root issuer (§8.3 / I-10).
 */
export async function revoke(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  mandateId: Hex
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address: deployment.revocation,
    abi: revocationAbi,
    functionName: "revoke",
    args: [mandateId],
    account,
  });
  const txHash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function isRevoked(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  mandateId: Hex
): Promise<boolean> {
  return (await publicClient.readContract({
    address: deployment.revocation,
    abi: revocationAbi,
    functionName: "isRevoked",
    args: [mandateId],
  })) as boolean;
}

export async function isAncestorRevoked(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  mandateId: Hex
): Promise<boolean> {
  return (await publicClient.readContract({
    address: deployment.revocation,
    abi: revocationAbi,
    functionName: "isAncestorRevoked",
    args: [mandateId],
  })) as boolean;
}

export async function revokedAtBlock(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  mandateId: Hex
): Promise<bigint> {
  return (await publicClient.readContract({
    address: deployment.revocation,
    abi: revocationAbi,
    functionName: "revokedAtBlock",
    args: [mandateId],
  })) as bigint;
}

export async function nearestRevokedAtBlock(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  mandateId: Hex
): Promise<bigint> {
  return (await publicClient.readContract({
    address: deployment.revocation,
    abi: revocationAbi,
    functionName: "nearestRevokedAtBlock",
    args: [mandateId],
  })) as bigint;
}
