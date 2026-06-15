import {
  createWalletClient,
  createPublicClient,
  http,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { audit, FROST_BASE_SEPOLIA } from "@frost/sdk";
import { OneShotRestMethods, type OneShotFetch } from "@frost/agent/browser";

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
  // Widen to `string`: the SDK types `auditRegistry` as the deployed address literal,
  // so a direct `!== zeroAddress` is a "no overlap" type error though it's a real runtime check.
  return (FROST_BASE_SEPOLIA.auditRegistry as string) !== zeroAddress;
}

export async function liveCommitAudit(opts: LiveCommitOptions): Promise<Hex> {
  const account = privateKeyToAccount(opts.sessionPrivateKey);
  const transport = http(opts.rpcUrl);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  // Cast across the duplicate-viem-types boundary (see live.ts / revocation.ts).
  return audit.commit(
    wallet as never,
    publicClient as never,
    FROST_BASE_SEPOLIA,
    {
      sessionId: opts.sessionId,
      merkleRoot: opts.merkleRoot,
      sessionEnd: opts.sessionEnd,
    },
  );
}

// ---------------------------------------------------------------------------
// Gas-sponsored anchor (#4): submit AuditRegistry.commit through a 1Shot server
// wallet, so 1Shot sponsors gas and the session key needs no ETH.
// ---------------------------------------------------------------------------

export interface OneShotCommitOptions {
  oneShot: {
    apiKey: string;
    apiSecret: string;
    /** The 1Shot server wallet that signs + relays (1Shot pays gas). */
    walletId: string;
    /** Pre-registered 1Shot method id for `AuditRegistry.commit`. */
    methodId: string;
    baseUrl?: string;
  };
  sessionId: Hex;
  merkleRoot: Hex;
  /** Session-end timestamp in seconds. */
  sessionEnd: bigint;
  /** 1Shot HTTP fetch — pass the Tauri-backed fetch so the call runs from Rust (no CORS). */
  fetchImpl?: OneShotFetch;
}

/**
 * Anchor a session's Merkle root by submitting `AuditRegistry.commit(sessionId, merkleRoot,
 * sessionEnd)` through a 1Shot server wallet's method registry. 1Shot sponsors gas, so —
 * unlike {@link liveCommitAudit} — no funded session key (with ETH) is required. The 1Shot
 * method must be pre-registered (`ONESHOT_AUDIT_METHOD_ID`) with named params
 * `sessionId` / `merkleRoot` / `sessionEnd`. Returns the on-chain tx hash when 1Shot reports it.
 */
export async function commitAuditViaOneShot(
  opts: OneShotCommitOptions,
): Promise<{ txHash?: string; transactionId: string; status: string }> {
  const cfg: ConstructorParameters<typeof OneShotRestMethods>[0] = {
    apiKey: opts.oneShot.apiKey,
    apiSecret: opts.oneShot.apiSecret,
  };
  if (opts.oneShot.baseUrl) cfg.baseUrl = opts.oneShot.baseUrl;
  if (opts.fetchImpl) cfg.fetchImpl = opts.fetchImpl;
  const methods = new OneShotRestMethods(cfg);
  const tx = await methods.execute(
    opts.oneShot.methodId,
    { sessionId: opts.sessionId, merkleRoot: opts.merkleRoot, sessionEnd: opts.sessionEnd.toString() },
    { walletId: opts.oneShot.walletId },
  );
  return { transactionId: tx.id, status: tx.status, ...(tx.transactionHash ? { txHash: tx.transactionHash } : {}) };
}

// ---------------------------------------------------------------------------
// Co-signed anchor (T-17, IG-08): the USER co-signs the Merkle root in MetaMask
// so neither party can unilaterally forge the audit history. The session key only
// RELAYS (pays gas); the on-chain `committer` is the recovered EIP-712 signer.
// ---------------------------------------------------------------------------

export type InvokeFn = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/** The wallet-bridge `commit` callback (`web/app/connect/commit` POSTs these back). */
interface CommitBridgeResult {
  challenge: string;
  body: {
    challenge: string;
    signature?: string;
    signer?: string;
    error?: string;
  };
}

export interface AuditCommitSignature {
  /** 65-byte EIP-712 signature over the `AuditCommit` struct. */
  signature: Hex;
  /** The recovering signer (the user's wallet) — becomes the on-chain committer. */
  signer: Hex;
}

/**
 * Drive the wallet bridge to obtain the user's EIP-712 co-signature over the audit
 * root (opens `xfrost.vercel.app/connect/commit` → MetaMask → callback). The typed
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
      params: {
        sessionId: params.sessionId,
        auditRoot: params.auditRoot,
        sessionEnd: params.sessionEnd,
      },
      timeout_secs: 300,
    },
  });
  if (result.body.error)
    throw new Error(`Audit co-sign failed: ${result.body.error}`);
  const { signature, signer } = result.body;
  if (!signature || !signer)
    throw new Error("Audit co-sign returned no signature");
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
export async function liveCommitAuditWithSig(
  opts: LiveCommitWithSigOptions,
): Promise<Hex> {
  const account = privateKeyToAccount(opts.sessionPrivateKey);
  const transport = http(opts.rpcUrl);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  // Cast across the duplicate-viem-types boundary (see live.ts / revocation.ts).
  return audit.commitWithSig(
    wallet as never,
    publicClient as never,
    FROST_BASE_SEPOLIA,
    {
      sessionId: opts.sessionId,
      merkleRoot: opts.merkleRoot,
      sessionEnd: opts.sessionEnd,
      signature: opts.signature,
    },
  );
}
