import type { Hex } from "viem";

/**
 * Stable caveat-type identifiers, copied verbatim from `Caveats.sol`.
 * `bytes4(keccak256("FROST_CAVEAT_<NAME>_V1"))`. Never change a value;
 * adding a new caveat type means a new constant.
 */
export const CAVEAT_TYPE = {
  SPEND_CAP_TOTAL:         "0x0a4f8e8a",
  SPEND_CAP_PER_CALL:      "0x0b3c9a21",
  PROVIDER_WHITELIST:      "0x0c1e7d42",
  CAPABILITY_WHITELIST:    "0x0d2b4c63",
  TTL_EXPIRY:              "0x0e5d3b84",
  CONTEXT_SCOPE:           "0x0f6e2aa5",
  RATE_LIMIT:              "0x107f1cc6",
  MAX_REDELEGATION_DEPTH:  "0x118a0de7",
  CAP_REDELEGATE:          "0x129b1e08",
  CALLABLE_SURFACE:        "0x13ac2f29",
  SLIPPAGE_TOLERANCE:      "0x14bd304a",
  MAX_GAS_PRICE:           "0x15ce416b",
  HITL_THRESHOLD:          "0x16df528c",
  COMMS_TEMPLATE:          "0x17e063ad",
} as const satisfies Record<string, Hex>;

export type CaveatTypeKey = keyof typeof CAVEAT_TYPE;
export type CaveatTypeSelector = (typeof CAVEAT_TYPE)[CaveatTypeKey];

/** Reverse map: selector → human name. Useful for decoding revert traces. */
export const CAVEAT_NAME_BY_SELECTOR: Record<Hex, CaveatTypeKey> =
  Object.fromEntries(
    Object.entries(CAVEAT_TYPE).map(([k, v]) => [v, k as CaveatTypeKey])
  ) as Record<Hex, CaveatTypeKey>;

/** Schema version baked into every encoded caveat (v1.0, locked Day 4 per HANDOFF). */
export const CAVEAT_SCHEMA_VERSION_V1 = 1;

/**
 * Capability identifiers from `contract-architecture.md` §2.3. Used as
 * entries in CAPABILITY_WHITELIST.
 */
export const CAPABILITY = {
  /** Spend through an x402 payment endpoint (inference, audit, etc.). */
  INFERENCE_CALL: "CAP_INFERENCE_CALL",
  /** Issue a sub-mandate. Required for any non-leaf mandate. */
  REDELEGATE: "CAP_REDELEGATE",
  /** Submit an on-chain execution through CALLABLE_SURFACE. */
  ONCHAIN_EXECUTION: "CAP_ONCHAIN_EXECUTION",
  /** Read-only chain queries via Venice Crypto RPC. */
  RPC_READ: "CAP_RPC_READ",
  /** Post via a COMMS_TEMPLATE channel. */
  COMMS_POST: "CAP_COMMS_POST",
} as const;

export type CapabilityKey = keyof typeof CAPABILITY;
