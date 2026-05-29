import type { Hex } from "viem";

/**
 * Core types for the Frost master-agent planning runtime.
 *
 * The planner consumes a compiled {@link TaskSpec} plus the live authority
 * state (redelegation bounds, their current consumption, and the unified
 * rate-limit token bucket from contract-architecture §2.4) and emits validated
 * {@link SpawnDecision}s together with a {@link PlanningEntry} for the audit log
 * (contract-architecture §10.7, T-35 mitigation).
 *
 * NOTE: caveats here are HIGH-LEVEL ({@link ProposedCaveats}), not ABI-encoded
 * bytes. Encoding to on-chain caveats and issuing the sub-mandates is the job of
 * a later plan→action translation layer that calls `@frost/sdk`'s mandate
 * helpers — this module stops at the decision.
 */

/**
 * Parametric `CAP_REDELEGATE` bounds the user signed on the parent mandate
 * (contract-architecture §2.6). The planner must never exceed these — and the
 * `Mandate` contract enforces them again at issuance, so this is defence in
 * depth, not the sole guard.
 */
export interface RedelegationBounds {
  /** Cumulative count of sub-mandates that may be issued under this mandate. */
  maxSubMandates: number;
  /** Cumulative SPEND_CAP_TOTAL (USDC base units) across all sub-mandates. */
  maxAggregateBudget: bigint;
}

/**
 * Current consumption of the redelegation bounds, mirroring
 * `DelegationRegistry.getAggregateRedelegationState` (contract-architecture §5).
 */
export interface RedelegationState {
  subMandateCount: number;
  aggregateSubMandateBudget: bigint;
}

/**
 * Unified token bucket (contract-architecture §2.4, Option A). One bucket per
 * mandate, consumed by BOTH x402 settlements and sub-mandate issuance. Each
 * spawn the planner approves consumes exactly one token.
 */
export interface TokenBucketState {
  /** Tokens currently available. */
  available: number;
  /** Bucket capacity (for reporting; the guard only reads `available`). */
  capacity: number;
}

/** What prompted a planning cycle. Recorded verbatim in the audit log. */
export interface TriggerEvent {
  /** e.g. "session-start", "condition-fired", "sub-agent-result". */
  kind: string;
  detail?: Record<string, unknown>;
}

/**
 * The compiled structured workflow spec the planner reasons over. Produced by
 * the (separate, later) compilation pipeline; for the planning core we only
 * need the fields the planner reads.
 */
export interface TaskSpec {
  /** bytes32 session identifier. */
  sessionId: Hex;
  /** bytes32 mandate the master agent holds and plans under. */
  rootMandateId: Hex;
  /** Natural-language workflow description, fed to the planning prompt. */
  description: string;
  /** Bounds the user signed on the master agent's redelegation authority. */
  redelegationBounds: RedelegationBounds;
}

/**
 * High-level caveats the planner proposes for a candidate sub-agent. Encoded to
 * on-chain bytes later by the translation layer. `spendCapTotal` is the field
 * the aggregate-budget guard reads.
 */
export interface ProposedCaveats {
  /** Capability whitelist entries — values from `@frost/sdk`'s `CAPABILITY`. */
  capabilities: string[];
  /** SPEND_CAP_TOTAL for this sub-mandate, USDC base units. Guarded. */
  spendCapTotal: bigint;
  /** SPEND_CAP_PER_CALL, USDC base units. */
  spendCapPerCall?: bigint;
  /** HITL_THRESHOLD, USDC base units (lower = more conservative, §2.8). */
  hitlThreshold?: bigint;
  /** SLIPPAGE_TOLERANCE in basis points. */
  slippageToleranceBps?: number;
}

/** A sub-agent the planner's LLM proposed spawning. */
export interface SpawnCandidate {
  /** Role label, e.g. "pricer-uniswap", "executor", "comms", "monitor". */
  role: string;
  proposedCaveats: ProposedCaveats;
  /** LLM's estimate of inference budget this sub-agent will consume (USDC base units). */
  estimatedTokenCost: bigint;
  /** The LLM's stated reasoning for proposing this candidate. */
  reasoning: string;
}

export type DecisionOutcome = "spawned" | "rejected" | "deferred";

/** A candidate after the runtime guard has ruled on it. */
export interface SpawnDecision extends SpawnCandidate {
  decision: DecisionOutcome;
  /** Why the runtime guard rejected/deferred it (absent when spawned). */
  rejectionReason?: string;
}

/**
 * One planning-cycle audit-log entry (contract-architecture §10.7). The Merkle
 * tree over these per session is committed on-chain at session end.
 */
export interface PlanningEntry {
  /** Unix seconds. */
  timestamp: number;
  sessionId: Hex;
  parentMandateId: Hex;
  triggerEvent: TriggerEvent;
  candidatesConsidered: SpawnDecision[];
  /**
   * Sub-mandate IDs actually issued this cycle. Empty at planning time — the
   * translation layer fills it after on-chain issuance.
   */
  spawnedSubMandateIds: Hex[];
  /** Versioned prompt identifier (not the full prompt text). */
  promptTemplate: string;
  /** Model used, e.g. "anthropic/claude-3.5-sonnet". */
  modelUsed: string;
  /** Cross-reference to the inference settlement; empty until settled. */
  inferenceCallId: string;
}

/** The planner's output for one planning cycle. */
export interface PlanResult {
  /** Candidates the runtime approved (decision === "spawned"), in order. */
  approved: SpawnDecision[];
  /** The audit-log entry for this cycle. */
  entry: PlanningEntry;
  /**
   * T-35 graceful degradation: set when the planner could not produce a usable
   * plan (LLM escalated, output unparseable, or no candidates fit the bounds and
   * the LLM asked to escalate). The caller surfaces this as a HITL prompt rather
   * than acting autonomously.
   */
  escalateToHITL: boolean;
  hitlReason?: string;
}
