import type { Hex } from "viem";

/**
 * Types for the master-agent compilation pipeline (the layer in front of the
 * planner): natural-language workflow → structured, signable session authority.
 *
 * Security-load-bearing surface — see threat-model T-24/T-06c (the user's
 * description is untrusted input), T-30 (compilation diverging from intent),
 * T-25/I-15 (COMMS_TEMPLATE untrusted-text), I-16 (the reviewed plain-language
 * spec is byte-tied to the signed mandate), and the paranoid-defaults posture
 * (T-32). The model proposes; the runtime disposes — exactly like the planner.
 */

/**
 * The allowlist of COMMS_TEMPLATE variable sources (T-25). Only `untrusted-text`
 * is attacker-influenceable and so requires explicit user opt-in + escaping at
 * send time; the rest resolve from numeric/known/internal data.
 */
export const VARIABLE_SOURCES = [
  "numeric",
  "known-address",
  "timestamp",
  "txhash",
  "internal",
  "untrusted-text",
] as const;
export type VariableSource = (typeof VARIABLE_SOURCES)[number];

/** One interpolated variable in a comms template. */
export interface CommsVariable {
  name: string;
  source: VariableSource;
  /** Required `true` for an `untrusted-text` variable to be used verbatim. */
  optIn?: boolean;
}

/** A single-channel comms template the comms sub-agent fills at send time. */
export interface CommsTemplate {
  text: string;
  variables: CommsVariable[];
}

/**
 * The canonical structured session spec. The SINGLE source both the on-chain
 * caveat encoder ({@link encodeRootCaveats}) and the plain-language renderer
 * consume — there is no second description that could drift from the signature
 * (I-16). All USDC amounts are base units (6 decimals).
 */
export interface CompiledSpec {
  /** NL workflow description, carried forward to the planner's `TaskSpec`. */
  description: string;
  /** SPEND_CAP_TOTAL — session-wide budget. */
  spendCapTotal: bigint;
  /** HITL_THRESHOLD — single-action value that pauses for human approval. */
  hitlThreshold: bigint;
  /** SLIPPAGE_TOLERANCE in basis points. */
  slippageBps: number;
  /** TTL_EXPIRY — absolute unix-seconds the mandate expires at. */
  expiryUnixSeconds: bigint;
  /** Parametric CAP_REDELEGATE bounds on the master agent's spawning. */
  redelegationBounds: {
    maxSubMandates: number;
    maxAggregateBudget: bigint;
  };
  /** Unified token bucket (§2.4) covering settlements + sub-mandate issuance. */
  rateLimit: {
    capacity: number;
    refillRatePerSec: number;
  };
  /** Optional comms binding; absent when the workflow has no comms step. */
  commsTemplate?: CommsTemplate;
}

/**
 * A required field the model could not determine from the description and the
 * user has not yet answered. Blocking for sign-readiness, non-escalating.
 */
export interface Clarification {
  /** Stable key; an answer under this key in {@link CompileInput.answers} resolves it. */
  field: string;
  question: string;
  reason: string;
}

/**
 * A paranoid default or model ambiguity-resolution applied during compilation.
 * Surfaced for the user to confirm (T-30 confidence signal), non-blocking.
 */
export interface Assumption {
  field: string;
  assumed: string;
  note: string;
}

/** Input to one compilation pass. Stateless: pure function of these. */
export interface CompileInput {
  /** The user's natural-language workflow description (untrusted). */
  description: string;
  /**
   * Answers to prior {@link Clarification}s, keyed by `Clarification.field`. An
   * answer is authoritative — it overrides any model-derived value for that
   * field and is never silently re-derived.
   */
  answers?: Record<string, string>;
}

/** The result of one compilation pass. */
export interface CompileResult {
  /** Always complete (gaps filled by paranoid defaults) so it is previewable. */
  spec: CompiledSpec;
  /** Unresolved required fields the user should answer before signing. */
  clarifications: Clarification[];
  /** Defaults / resolutions applied; the user should glance at these. */
  assumptions: Assumption[];
  /** High-risk shapes flagged for attention (T-24). */
  warnings: string[];
  /** True when there are no open clarifications (safe to proceed to review). */
  readyToSign: boolean;
  /**
   * T-35-style graceful degradation: the model output was unusable (unparseable,
   * a bad amount, a failed call, or the model asked to escalate). The caller
   * surfaces a HITL prompt rather than trusting a guessed spec.
   */
  escalateToHITL: boolean;
  hitlReason?: string;
  /** Versioned prompt identifier (not the prompt text). */
  promptTemplate: string;
  /** Model that served the compilation. */
  modelUsed: string;
}
