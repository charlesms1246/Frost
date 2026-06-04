import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  zeroAddress,
} from "viem";
import { auditRegistryAbi } from "./abis.js";
import { auditCommitEip712Domain, type FrostDeployment } from "./addresses.js";

/**
 * AuditRegistry (§10.8) — the on-chain anchor for a session's audit Merkle root.
 *
 * `commit` is the direct path (the Frost session key submits, and is recorded as the
 * committer). `commitWithSig` is the co-signed path: the user's wallet signs an EIP-712
 * `AuditCommit` and any relayer submits it — the typed data matches the wallet-bridge
 * page (`web/app/connect/commit`).
 */

export const AUDIT_COMMIT_TYPES = {
  AuditCommit: [
    { name: "sessionId", type: "bytes32" },
    { name: "auditRoot", type: "bytes32" },
    { name: "sessionEnd", type: "uint64" },
  ],
} as const;

export type AuditCommit = {
  sessionId: Hex;
  /** The session's Merkle root (`SessionReceipt.merkleRoot`). */
  merkleRoot: Hex;
  /** Session-end timestamp in seconds (uint64). */
  sessionEnd: bigint;
};

export type Commitment = {
  merkleRoot: Hex;
  committer: Address;
  sessionEnd: bigint;
  committedAt: bigint;
};

function requireDeployed(deployment: FrostDeployment): Address {
  if (deployment.auditRegistry === zeroAddress) {
    throw new Error(
      "AuditRegistry not deployed: run `forge script script/DeployAudit.s.sol` and set FROST_BASE_SEPOLIA.auditRegistry to the printed address."
    );
  }
  return deployment.auditRegistry;
}

/**
 * Commit a session's Merkle root directly (committer == the wallet's account). Returns
 * the tx hash. Reverts (already committed / zero root) surface as viem errors carrying
 * the contract's custom-error selector.
 */
export async function commit(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  params: AuditCommit
): Promise<Hex> {
  const address = requireDeployed(deployment);
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address,
    abi: auditRegistryAbi,
    functionName: "commit",
    args: [params.sessionId, params.merkleRoot, params.sessionEnd],
    account,
  });
  const txHash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * Sign an `AuditCommit` with the session owner's key (for the co-signed path). The
 * returned 65-byte signature is what `AuditRegistry.commitWithSig` recovers against.
 */
export async function signAuditCommit(
  wallet: WalletClient,
  deployment: FrostDeployment,
  params: AuditCommit
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  return wallet.signTypedData({
    account,
    domain: auditCommitEip712Domain(deployment),
    types: AUDIT_COMMIT_TYPES,
    primaryType: "AuditCommit",
    message: {
      sessionId: params.sessionId,
      auditRoot: params.merkleRoot,
      sessionEnd: params.sessionEnd,
    },
  });
}

/** Submit a co-signed commit. The committer is the EIP-712 signer, not the sender. */
export async function commitWithSig(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  params: AuditCommit & { signature: Hex }
): Promise<Hex> {
  const address = requireDeployed(deployment);
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address,
    abi: auditRegistryAbi,
    functionName: "commitWithSig",
    args: [params.sessionId, params.merkleRoot, params.sessionEnd, params.signature],
    account,
  });
  const txHash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/** Read a session's commitment. `committedAt === 0n` means "not committed". */
export async function getCommitment(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  sessionId: Hex
): Promise<Commitment> {
  const address = requireDeployed(deployment);
  const [merkleRoot, committer, sessionEnd, committedAt] = (await publicClient.readContract({
    address,
    abi: auditRegistryAbi,
    functionName: "commitments",
    args: [sessionId],
  })) as readonly [Hex, Address, bigint, bigint];
  return { merkleRoot, committer, sessionEnd, committedAt };
}
