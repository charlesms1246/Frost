import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  decodeEventLog,
} from "viem";
import { refillableMandateAbi } from "./abis.js";
import type { Caveat } from "./caveats/types.js";
import type { FrostDeployment } from "./addresses.js";

export type RefillTerms = {
  totalCap: bigint;
  perRefillAmount: bigint;
  refillThreshold: bigint;
  minRefillInterval: bigint;
};

export type RefillPolicy = {
  user: Address;
  holder: Address;
  totalCap: bigint;
  totalRefilled: bigint;
  perRefillAmount: bigint;
  refillThreshold: bigint;
  minRefillInterval: bigint;
  lastRefillTimestamp: bigint;
  activeMandateId: Hex;
  revoked: boolean;
};

/**
 * Create a refillable mandate.
 *
 * The active-mandate caveat template MUST contain a `SPEND_CAP_TOTAL` caveat
 * whose value equals `terms.perRefillAmount` — the contract enforces this
 * with `SpendCapMismatch`. Use the {@link spendCapTotal} builder.
 *
 * Returns both ids extracted from the `RefillableMandateCreated` log.
 */
export async function createRefillableMandate(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  params: {
    holder: Address;
    activeMandateCaveats: readonly Caveat[];
    terms: RefillTerms;
    userNonce: bigint;
  }
): Promise<{ parentAuthId: Hex; activeMandateId: Hex; txHash: Hex }> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address: deployment.refillableMandate,
    abi: refillableMandateAbi,
    functionName: "createRefillableMandate",
    args: [params.holder, params.activeMandateCaveats, params.terms, params.userNonce],
    account,
  });
  const txHash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const { parentAuthId, activeMandateId } = extractCreatedIds(receipt.logs, deployment.refillableMandate);
  return { parentAuthId, activeMandateId, txHash };
}

/**
 * Trigger a refill. Permissionless — anyone can call once the policy's
 * preconditions are met (depletion past threshold, min-interval elapsed,
 * total cap not exceeded, policy not revoked).
 */
export async function triggerRefill(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  parentAuthId: Hex
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address: deployment.refillableMandate,
    abi: refillableMandateAbi,
    functionName: "triggerRefill",
    args: [parentAuthId],
    account,
  });
  const txHash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Stop future refills. Caller must be `policy.user`. Does NOT revoke the
 * current active mandate — the holder revokes that separately via
 * `Revocation.revoke` if they want immediate stop.
 */
export async function revokeRefillPolicy(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  parentAuthId: Hex
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address: deployment.refillableMandate,
    abi: refillableMandateAbi,
    functionName: "revokeRefillPolicy",
    args: [parentAuthId],
    account,
  });
  const txHash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function getRefillStatus(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  parentAuthId: Hex
): Promise<RefillPolicy> {
  const p = await publicClient.readContract({
    address: deployment.refillableMandate,
    abi: refillableMandateAbi,
    functionName: "getRefillStatus",
    args: [parentAuthId],
  });
  return p as RefillPolicy;
}

export async function getCaveatTemplate(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  parentAuthId: Hex
): Promise<readonly Caveat[]> {
  const cs = await publicClient.readContract({
    address: deployment.refillableMandate,
    abi: refillableMandateAbi,
    functionName: "getCaveatTemplate",
    args: [parentAuthId],
  });
  return cs as readonly Caveat[];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractCreatedIds(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  refillableAddress: Address
): { parentAuthId: Hex; activeMandateId: Hex } {
  for (const log of logs) {
    if (log.address.toLowerCase() !== refillableAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: refillableMandateAbi,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      if (decoded.eventName === "RefillableMandateCreated") {
        const args = decoded.args as unknown as { parentAuthId: Hex; activeMandateId: Hex };
        return { parentAuthId: args.parentAuthId, activeMandateId: args.activeMandateId };
      }
    } catch {
      // skip
    }
  }
  throw new Error("RefillableMandateCreated event not found in receipt logs");
}
