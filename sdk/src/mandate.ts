import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  decodeEventLog,
} from "viem";
import { mandateAbi } from "./abis.js";
import type { Caveat } from "./caveats/types.js";
import type { FrostDeployment } from "./addresses.js";

/**
 * `IMandate.InvalidReason` enum, kept in numeric order to match the on-chain
 * value emitted by `validateMandateForOperation` and bubbled by
 * `Settlement.MandateAuthorizationFailed`.
 */
export const INVALID_REASON = [
  "OK",
  "NotFound",
  "Revoked",
  "Expired",
  "CapabilityNotPermitted",
  "ProviderNotPermitted",
  "TargetNotPermitted",
  "SpendCapTotalExceeded",
  "SpendCapPerCallExceeded",
  "RateLimited",
  "SlippageExceeded",
  "GasPriceExceeded",
  "AncestorRevoked",
  "Unknown",
] as const;
export type InvalidReason = (typeof INVALID_REASON)[number];

/** Decoded shape of `IMandate.MandateView`. */
export type MandateView = {
  issuer: Address;
  holder: Address;
  parentMandateId: Hex;
  issuedAt: bigint;
  revoked: boolean;
  cumulativeSpend: bigint;
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Issue a root mandate. Caller (the wallet client's account) becomes the
 * issuer. Per-issuer nonces are scoped under the caller's address.
 *
 * Returns the new `mandateId` extracted from the `MandateIssued` event log.
 */
export async function issueMandate(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  params: { holder: Address; caveats: readonly Caveat[]; nonce: bigint }
): Promise<{ mandateId: Hex; txHash: Hex }> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address: deployment.mandate,
    abi: mandateAbi,
    functionName: "issueMandate",
    args: [params.holder, params.caveats, params.nonce],
    account,
  });
  const txHash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const mandateId = extractMandateIssuedId(receipt.logs, deployment.mandate);
  return { mandateId, txHash };
}

/**
 * Issue a sub-mandate under `parentMandateId`. Caller must be the parent's
 * holder. The contract intersects every caveat type against the parent —
 * the request is just that, a request.
 */
export async function issueSubMandate(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  params: {
    parentMandateId: Hex;
    holder: Address;
    caveats: readonly Caveat[];
    nonce: bigint;
  }
): Promise<{ mandateId: Hex; txHash: Hex }> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address: deployment.mandate,
    abi: mandateAbi,
    functionName: "issueSubMandate",
    args: [params.parentMandateId, params.holder, params.caveats, params.nonce],
    account,
  });
  const txHash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const mandateId = extractSubMandateIssuedId(receipt.logs, deployment.mandate);
  return { mandateId, txHash };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getMandate(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  mandateId: Hex
): Promise<MandateView> {
  const v = await publicClient.readContract({
    address: deployment.mandate,
    abi: mandateAbi,
    functionName: "getMandate",
    args: [mandateId],
  });
  return v as MandateView;
}

export async function getCaveats(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  mandateId: Hex
): Promise<readonly Caveat[]> {
  const cs = await publicClient.readContract({
    address: deployment.mandate,
    abi: mandateAbi,
    functionName: "getCaveats",
    args: [mandateId],
  });
  return cs as readonly Caveat[];
}

export async function getRateLimitState(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  mandateId: Hex
): Promise<{ currentTokens: bigint; lastRefill: bigint }> {
  const [currentTokens, lastRefill] = (await publicClient.readContract({
    address: deployment.mandate,
    abi: mandateAbi,
    functionName: "getRateLimitState",
    args: [mandateId],
  })) as readonly [bigint, bigint];
  return { currentTokens, lastRefill };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractMandateIssuedId(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  mandateAddress: Address
): Hex {
  return findEventId(logs, mandateAddress, "MandateIssued");
}

function extractSubMandateIssuedId(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  mandateAddress: Address
): Hex {
  return findEventId(logs, mandateAddress, "SubMandateIssued");
}

function findEventId(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  mandateAddress: Address,
  eventName: "MandateIssued" | "SubMandateIssued"
): Hex {
  for (const log of logs) {
    if (log.address.toLowerCase() !== mandateAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: mandateAbi,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      if (decoded.eventName === eventName) {
        const args = decoded.args as unknown as { mandateId: Hex };
        return args.mandateId;
      }
    } catch {
      // not a Mandate event we recognize; skip
    }
  }
  throw new Error(`${eventName} event not found in receipt logs`);
}
