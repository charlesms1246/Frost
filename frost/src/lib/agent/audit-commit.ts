import { createWalletClient, createPublicClient, http, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
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
