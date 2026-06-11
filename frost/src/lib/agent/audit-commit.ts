import { createWalletClient, createPublicClient, http, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { audit, FROST_BASE_SEPOLIA } from "@frost/sdk";

/**
 * On-chain audit anchor (§10.8, demo's closing shot): commit a session's Merkle root to
 * the deployed `AuditRegistry`. Mirrors {@link liveRevoke} — a funded session key submits
 * the tx (the key is recorded as committer). Returns the tx hash.
 *
 * The registry address comes from `@frost/sdk`'s `FROST_BASE_SEPOLIA.auditRegistry`; until
 * `DeployAudit.s.sol` runs and that address is set, the SDK throws a clear "not deployed"
 * error and the caller falls back to a simulated commit.
 */

export interface LiveCommitOptions {
  sessionPrivateKey: Hex;
  rpcUrl: string;
  sessionId: Hex;
  merkleRoot: Hex;
  /** Session-end timestamp in seconds. */
  sessionEnd: bigint;
}

/** True once the AuditRegistry address is configured in the SDK deployment record. */
export function auditRegistryConfigured(): boolean {
  return FROST_BASE_SEPOLIA.auditRegistry !== zeroAddress;
}

export async function liveCommitAudit(opts: LiveCommitOptions): Promise<Hex> {
  const account = privateKeyToAccount(opts.sessionPrivateKey);
  const transport = http(opts.rpcUrl);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  // Cast across the duplicate-viem-types boundary (see live.ts / revocation.ts).
  return audit.commit(wallet as never, publicClient as never, FROST_BASE_SEPOLIA, {
    sessionId: opts.sessionId,
    merkleRoot: opts.merkleRoot,
    sessionEnd: opts.sessionEnd,
  });
}

// ---------------------------------------------------------------------------
// Co-signed anchor (T-17, IG-08): the USER co-signs the Merkle root in MetaMask
// so neither party can unilaterally forge the audit history. The session key only
// RELAYS (pays gas); the on-chain `committer` is the recovered EIP-712 signer.
// ---------------------------------------------------------------------------

export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** The wallet-bridge `commit` callback (`web/app/connect/commit` POSTs these back). */
interface CommitBridgeResult {
  challenge: string;
  body: { challenge: string; signature?: string; signer?: string; error?: string };
}

export interface AuditCommitSignature {
  /** 65-byte EIP-712 signature over the `AuditCommit` struct. */
  signature: Hex;
  /** The recovering signer (the user's wallet) — becomes the on-chain committer. */
  signer: Hex;
}

/**
 * Drive the wallet bridge to obtain the user's EIP-712 co-signature over the audit
 * root (opens `port42.vercel.app/connect/commit` → MetaMask → callback). The typed
 * data + domain are produced by that page and match `AuditRegistry.commitWithSig`.
 * `invoke` is injectable so this is unit-testable without the Tauri shell.
 */
export async function requestAuditCommitSignature(
  params: { sessionId: Hex; auditRoot: Hex; sessionEnd: number },
  invoke: InvokeFn = tauriInvoke,
): Promise<AuditCommitSignature> {
  const result = await invoke<CommitBridgeResult>("wallet_bridge_perform", {
    args: {
      operation: "commit",
      params: { sessionId: params.sessionId, auditRoot: params.auditRoot, sessionEnd: params.sessionEnd },
      timeout_secs: 300,
    },
  });
  if (result.body.error) throw new Error(`Audit co-sign failed: ${result.body.error}`);
  const { signature, signer } = result.body;
  if (!signature || !signer) throw new Error("Audit co-sign returned no signature");
  return { signature: signature as Hex, signer: signer as Hex };
}

export interface LiveCommitWithSigOptions extends LiveCommitOptions {
  /** The user's EIP-712 co-signature (from {@link requestAuditCommitSignature}). */
  signature: Hex;
}

/**
 * Submit a CO-SIGNED audit commit: the session key (relayer) pays gas; the on-chain
 * committer is the user who signed. Realizes the T-17 "neither party can unilaterally
 * forge the audit trail" property on the live path.
 */
export async function liveCommitAuditWithSig(opts: LiveCommitWithSigOptions): Promise<Hex> {
  const account = privateKeyToAccount(opts.sessionPrivateKey);
  const transport = http(opts.rpcUrl);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  // Cast across the duplicate-viem-types boundary (see live.ts / revocation.ts).
  return audit.commitWithSig(wallet as never, publicClient as never, FROST_BASE_SEPOLIA, {
    sessionId: opts.sessionId,
    merkleRoot: opts.merkleRoot,
    sessionEnd: opts.sessionEnd,
    signature: opts.signature,
  });
}
