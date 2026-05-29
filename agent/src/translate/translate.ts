import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { mandate, type Caveat, type FrostDeployment } from "@frost/sdk";
import type { PlanningEntry, PlanResult, SpawnDecision } from "../types.js";

/**
 * Plan→action translation layer.
 *
 * Turns a {@link PlanResult}'s runtime-APPROVED spawn decisions into real
 * on-chain sub-mandates, then fills in `PlanningEntry.spawnedSubMandateIds`
 * (contract-architecture §10.7).
 *
 * Scope boundary (deliberate): this module orchestrates issuance. It does NOT
 * encode high-level {@link SpawnDecision.proposedCaveats} into on-chain
 * `Caveat[]` — that is the next brick, injected here as {@link CaveatEncoder}.
 * Likewise the on-chain call itself is the SDK's already-tested
 * `mandate.issueSubMandate`, injected as {@link SubMandateIssuer} so this layer's
 * orchestration is unit-testable without constructing fake viem clients.
 */

/**
 * Encode a decision's high-level ProposedCaveats into the on-chain `Caveat[]`
 * the Mandate contract expects. Injected — the full encoder is the next brick.
 */
export type CaveatEncoder = (decision: SpawnDecision) => readonly Caveat[];

/** Resolve (or provision) the wallet address that will hold this sub-mandate. */
export type HolderProvisioner = (decision: SpawnDecision) => Promise<Address>;

/** Monotonic per-issuer nonce source for `issueSubMandate` dedup. */
export type NonceSource = () => bigint;

/** Issues one sub-mandate on-chain. Defaults to the SDK; injectable for tests. */
export type SubMandateIssuer = (params: {
  parentMandateId: Hex;
  holder: Address;
  caveats: readonly Caveat[];
  nonce: bigint;
}) => Promise<{ mandateId: Hex; txHash: Hex }>;

export interface TranslateDeps {
  issue: SubMandateIssuer;
  encodeCaveats: CaveatEncoder;
  provisionHolder: HolderProvisioner;
  nextNonce: NonceSource;
}

export type SpawnStatus = "issued" | "failed";

export interface SpawnOutcome {
  role: string;
  status: SpawnStatus;
  mandateId?: Hex;
  holder?: Address;
  txHash?: Hex;
  error?: string;
}

export interface TranslateResult {
  outcomes: SpawnOutcome[];
  /** Mandate IDs of the sub-mandates actually issued, in issuance order. */
  spawnedSubMandateIds: Hex[];
  /** A copy of the planning entry with `spawnedSubMandateIds` (§10.7) filled in. */
  entry: PlanningEntry;
}

/**
 * Issue the plan's runtime-approved sub-mandates on-chain.
 *
 * SAFETY: this only ever issues `plan.approved` — the subset the planner's guard
 * already cleared against the signed CAP_REDELEGATE bounds. It never sees the raw
 * LLM candidate list. The Mandate contract re-enforces the same bounds at
 * issuance, so a drifted off-chain view cannot over-issue: a contract revert
 * surfaces as a `failed` outcome, never a silent over-spend.
 *
 * Issuance is SEQUENTIAL — the DelegationRegistry's aggregate count/budget state
 * mutates per issuance, so parallel calls could race it. One failure does not
 * abort the rest: each sub-agent is independent (§10.5 resilience), so a single
 * revert (e.g. a transient nonce clash) leaves the other spawns intact.
 */
export async function translatePlan(
  plan: PlanResult,
  deps: TranslateDeps,
): Promise<TranslateResult> {
  const parentMandateId = plan.entry.parentMandateId;
  const outcomes: SpawnOutcome[] = [];
  const spawnedSubMandateIds: Hex[] = [];

  for (const decision of plan.approved) {
    try {
      const holder = await deps.provisionHolder(decision);
      const caveats = deps.encodeCaveats(decision);
      const nonce = deps.nextNonce();
      const { mandateId, txHash } = await deps.issue({
        parentMandateId,
        holder,
        caveats,
        nonce,
      });
      spawnedSubMandateIds.push(mandateId);
      outcomes.push({
        role: decision.role,
        status: "issued",
        mandateId,
        holder,
        txHash,
      });
    } catch (err) {
      outcomes.push({
        role: decision.role,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    outcomes,
    spawnedSubMandateIds,
    entry: { ...plan.entry, spawnedSubMandateIds },
  };
}

/** A simple monotonic nonce source. */
export function nonceCounter(start = 0n): NonceSource {
  let n = start;
  return () => n++;
}

/** Wire the SDK's `issueSubMandate` into a {@link SubMandateIssuer}. */
export function makeSdkIssuer(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
): SubMandateIssuer {
  return (params) =>
    mandate.issueSubMandate(wallet, publicClient, deployment, params);
}
