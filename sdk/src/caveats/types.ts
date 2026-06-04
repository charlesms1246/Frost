import type { Address, Hex } from "viem";
import type { CaveatTypeSelector } from "./selectors.js";

/**
 * On-chain `Caveat` struct shape — mirrors `Caveats.Caveat` exactly.
 * The triple `(caveatType, parameters, schemaVersion)` is what gets
 * passed into `Mandate.issueMandate` / `issueSubMandate`.
 */
export type Caveat = {
  caveatType: CaveatTypeSelector;
  parameters: Hex;
  schemaVersion: number;
};

/** `Caveats.CallableSurfaceEntry` — one allowed (target, selector, maxValue) triple. */
export type CallableSurfaceEntry = {
  target: Address;
  /** `bytes4` function selector. */
  selector: Hex;
  /** USDC-denominated cap per call (6 decimals). */
  maxValue: bigint;
};

/**
 * Token-bucket parameters for the RATE_LIMIT caveat (§2.4).
 *
 * The bucket governs BOTH x402 settlements AND sub-mandate issuance — a
 * single unified rate-limit per mandate (Option A in §2.4).
 */
export type RateLimitParams = {
  capacity: bigint;
  /** Tokens per second. */
  refillRate: bigint;
  /** Initial token count when the caveat is first stored. */
  currentTokens: bigint;
  /** Timestamp the bucket was last refilled. `0` lets the contract stamp it. */
  lastRefill: bigint;
};

/** Parametric portion of CAP_REDELEGATE (§2.6). */
export type CapRedelegateParams = {
  maxSubMandates: number;
  maxAggregateBudget: bigint;
};

/** Decoded COMMS_TEMPLATE payload (§2.9 / I-16). */
export type CommsTemplateParams = {
  templateHash: Hex;
  /** Channel-specific metadata (e.g. webhook URL hash, schema). */
  templateMetadata: Hex;
};
