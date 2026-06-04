import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { SubMandateIssuer } from "@frost/agent/browser";
import { revocation, FROST_BASE_SEPOLIA } from "@frost/sdk";

/**
 * Revocation for the demo's moment 3: the user revokes the master agent's spawning
 * authority, after which new sub-agents are refused (the cascade) while already-running
 * ones finish.
 *
 * Two pieces:
 *  - {@link revocableIssuer} wraps the sub-mandate issuer so that, once revoked, every
 *    spawn attempt throws BEFORE any chain write — `translatePlan` records each as a
 *    `failed` outcome, so the tree shows the cascade immediately and deterministically
 *    (simulated or live). This mirrors what the contract does on-chain: a parent that no
 *    longer holds CAP_REDELEGATE cannot issue sub-mandates (§8.3 / I-10).
 *  - {@link liveRevoke} performs the REAL on-chain `Revocation.revoke(rootMandateId)` —
 *    the authentic action backing the UI state when a funded session key is present.
 */

/** Wrap an issuer so it refuses to spawn while `isRevoked()` is true. */
export function revocableIssuer(inner: SubMandateIssuer, isRevoked: () => boolean): SubMandateIssuer {
  return async (req) => {
    if (isRevoked()) {
      throw new Error("spawning authority revoked (parent no longer holds CAP_REDELEGATE)");
    }
    return inner(req);
  };
}

export interface LiveRevokeOptions {
  /** The key authorized to revoke — issuer / parent holder / root issuer (§8.3). */
  sessionPrivateKey: Hex;
  rpcUrl: string;
  /** The mandate whose authority is being revoked (the root, for spawning authority). */
  mandateId: Hex;
}

/** On-chain `Revocation.revoke(mandateId)` on Base Sepolia. Returns the tx hash. */
export async function liveRevoke(opts: LiveRevokeOptions): Promise<Hex> {
  const account = privateKeyToAccount(opts.sessionPrivateKey);
  const transport = http(opts.rpcUrl);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  // Cast across the duplicate-viem-types boundary (see live.ts).
  return revocation.revoke(wallet as never, publicClient as never, FROST_BASE_SEPOLIA, opts.mandateId);
}
