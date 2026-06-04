import type { CompiledSpec } from "./types.js";

/**
 * Paranoid defaults (T-24, T-30, T-32). Anything the user's description does not
 * specify gets a TIGHT value, never an unlimited one — a misread or
 * prompt-injected description can then only authorize a small amount. The user
 * sees every defaulted field surfaced as an {@link Assumption} at review.
 *
 * All USDC amounts are base units (6 decimals): $1 = 1_000_000.
 */
export const PARANOID_DEFAULTS: Omit<CompiledSpec, "description"> = {
  /** $10 session budget. */
  spendCapTotal: 10_000_000n,
  /** Any single action ≥ $5 pauses for approval. */
  hitlThreshold: 5_000_000n,
  /** 0.50%. */
  slippageBps: 50,
  /** Set per-pass relative to now; this constant is the duration applied. */
  expiryUnixSeconds: 0n,
  redelegationBounds: {
    /** T-32: 6 sub-mandates for a typical session. */
    maxSubMandates: 6,
    /** T-32: $50 aggregate redelegation budget. */
    maxAggregateBudget: 50_000_000n,
  },
  rateLimit: {
    /** 30 operations of burst (settlements + sub-mandate issuance combined). */
    capacity: 30,
    /** ~1 token/2s sustained. */
    refillRatePerSec: 1,
  },
};

/** Default session lifetime when the description doesn't state one: 24h. */
export const DEFAULT_EXPIRY_SECS = 24 * 60 * 60;

/**
 * Thresholds above which a value is flagged as a high-risk shape (T-24 "visual
 * cues for high-risk shapes"). The value is NOT clamped — the user signs what
 * they signed — but it is surfaced as a warning so review attention lands on it.
 */
export const HIGH_RISK_CEILINGS = {
  /** Session budget over $1,000. */
  spendCapTotal: 1_000_000_000n,
  /** Aggregate redelegation budget over $500. */
  maxAggregateBudget: 500_000_000n,
  /** More than 12 sub-agents. */
  maxSubMandates: 12,
  /** Slippage over 3%. */
  slippageBps: 300,
} as const;
