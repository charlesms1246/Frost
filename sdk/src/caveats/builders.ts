import {
  encodeAbiParameters,
  decodeAbiParameters,
  parseAbiParameters,
  toHex,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { CAVEAT_SCHEMA_VERSION_V1, CAVEAT_TYPE, CAPABILITY } from "./selectors.js";
import type {
  Caveat,
  CallableSurfaceEntry,
  RateLimitParams,
  CapRedelegateParams,
  CommsTemplateParams,
} from "./types.js";

/**
 * Caveat builders — one per type, mirroring `Caveats.sol` encoders verbatim.
 *
 * Each builder returns a `Caveat` ready to pass into `Mandate.issueMandate`
 * (or `issueSubMandate`). The contract recomputes the intersection with the
 * parent's caveats at issuance time; the SDK does NOT pre-intersect. That
 * is intentional: per §2.5 the contract does not trust the issuer's view,
 * and re-implementing intersection off-chain would just be a second source
 * of truth to drift.
 */

// ---------------------------------------------------------------------------
// Numeric / scalar caveats
// ---------------------------------------------------------------------------

/** USDC-denominated total spend cap across the mandate's lifetime (§2.2). */
export function spendCapTotal(amountUsdc6: bigint): Caveat {
  return wrap(CAVEAT_TYPE.SPEND_CAP_TOTAL, encodeAbiParameters([{ type: "uint256" }], [amountUsdc6]));
}

/** USDC-denominated per-call cap (§2.2). */
export function spendCapPerCall(amountUsdc6: bigint): Caveat {
  return wrap(CAVEAT_TYPE.SPEND_CAP_PER_CALL, encodeAbiParameters([{ type: "uint256" }], [amountUsdc6]));
}

/** Mandate expires when `block.timestamp >= expiryUnixSeconds`. */
export function ttlExpiry(expiryUnixSeconds: bigint): Caveat {
  return wrap(CAVEAT_TYPE.TTL_EXPIRY, encodeAbiParameters([{ type: "uint64" }], [expiryUnixSeconds]));
}

/** Max remaining redelegation depth a child may declare (§2). */
export function maxRedelegationDepth(remainingDepth: number): Caveat {
  return wrap(CAVEAT_TYPE.MAX_REDELEGATION_DEPTH, encodeAbiParameters([{ type: "uint8" }], [remainingDepth]));
}

/** Slippage cap in basis points (1 bp = 0.01%). */
export function slippageTolerance(basisPoints: number): Caveat {
  return wrap(CAVEAT_TYPE.SLIPPAGE_TOLERANCE, encodeAbiParameters([{ type: "uint16" }], [basisPoints]));
}

/** Max gas price the executor may submit at, in wei. */
export function maxGasPrice(weiPerGas: bigint): Caveat {
  return wrap(CAVEAT_TYPE.MAX_GAS_PRICE, encodeAbiParameters([{ type: "uint64" }], [weiPerGas]));
}

/**
 * HITL_THRESHOLD — USDC value at or above which a human must approve.
 *
 * **Direction is inverted (§2.8 / I-14):** lower number = stricter. A sub
 * cannot raise the threshold above its parent. Intersection at the contract
 * is `min(parent, sub)`. Audit hotspot H-11.
 */
export function hitlThreshold(amountUsdc6: bigint): Caveat {
  return wrap(CAVEAT_TYPE.HITL_THRESHOLD, encodeAbiParameters([{ type: "uint256" }], [amountUsdc6]));
}

/** Free-form 32-byte context tag (§2). `0x00…00` means "any scope". */
export function contextScope(scope: Hex): Caveat {
  return wrap(CAVEAT_TYPE.CONTEXT_SCOPE, encodeAbiParameters([{ type: "bytes32" }], [pad32(scope)]));
}

// ---------------------------------------------------------------------------
// Set caveats
// ---------------------------------------------------------------------------

/** Approved providers (ProviderRegistry lookup happens at Settlement). */
export function providerWhitelist(providers: readonly Address[]): Caveat {
  return wrap(CAVEAT_TYPE.PROVIDER_WHITELIST, encodeAbiParameters([{ type: "address[]" }], [providers as Address[]]));
}

/**
 * CAPABILITY_WHITELIST — names hashed to `bytes32` via keccak256 (§2.3).
 *
 * Accepts either:
 * - Capability key strings ("CAP_INFERENCE_CALL", "CAP_REDELEGATE", …)
 *   from the {@link CAPABILITY} table — most common.
 * - Pre-hashed `bytes32` values for custom capabilities.
 */
export function capabilityWhitelist(caps: readonly (string | Hex)[]): Caveat {
  const hashed = caps.map((c) =>
    typeof c === "string" && !c.startsWith("0x")
      ? keccak256(toBytes(c))
      : (c as Hex)
  );
  return wrap(
    CAVEAT_TYPE.CAPABILITY_WHITELIST,
    encodeAbiParameters([{ type: "bytes32[]" }], [hashed])
  );
}

// ---------------------------------------------------------------------------
// Composite caveats
// ---------------------------------------------------------------------------

/**
 * RATE_LIMIT — unified token bucket covering both x402 settlements and
 * sub-mandate issuance (§2.4 Option A). Pass `lastRefill: 0n` to let the
 * contract stamp it at storage time.
 */
export function rateLimit(p: RateLimitParams): Caveat {
  return wrap(
    CAVEAT_TYPE.RATE_LIMIT,
    encodeAbiParameters(
      parseAbiParameters("uint256, uint256, uint256, uint64"),
      [p.capacity, p.refillRate, p.currentTokens, p.lastRefill]
    )
  );
}

/** CAP_REDELEGATE — fan-out + aggregate budget caps for children (§2.6). */
export function capRedelegate(p: CapRedelegateParams): Caveat {
  return wrap(
    CAVEAT_TYPE.CAP_REDELEGATE,
    encodeAbiParameters(
      parseAbiParameters("uint8, uint256"),
      [p.maxSubMandates, p.maxAggregateBudget]
    )
  );
}

/** CALLABLE_SURFACE — explicit allow-list of (target, selector, maxValue) triples (§2.7). */
export function callableSurface(entries: readonly CallableSurfaceEntry[]): Caveat {
  return wrap(
    CAVEAT_TYPE.CALLABLE_SURFACE,
    encodeAbiParameters(
      [
        {
          type: "tuple[]",
          components: [
            { name: "target", type: "address" },
            { name: "selector", type: "bytes4" },
            { name: "maxValue", type: "uint256" },
          ],
        },
      ],
      [entries as CallableSurfaceEntry[]]
    )
  );
}

/** COMMS_TEMPLATE — single-channel template binding (§2.9 / I-16). */
export function commsTemplate(p: CommsTemplateParams): Caveat {
  return wrap(
    CAVEAT_TYPE.COMMS_TEMPLATE,
    encodeAbiParameters(parseAbiParameters("bytes32, bytes"), [p.templateHash, p.templateMetadata])
  );
}

// ---------------------------------------------------------------------------
// Decoders — symmetric inverses; used by tests and audit tooling.
// ---------------------------------------------------------------------------

export function decodeUint256(c: Caveat): bigint {
  return decodeAbiParameters([{ type: "uint256" }], c.parameters)[0];
}
export function decodeUint64(c: Caveat): bigint {
  return decodeAbiParameters([{ type: "uint64" }], c.parameters)[0];
}
export function decodeUint16(c: Caveat): number {
  return decodeAbiParameters([{ type: "uint16" }], c.parameters)[0];
}
export function decodeUint8(c: Caveat): number {
  return decodeAbiParameters([{ type: "uint8" }], c.parameters)[0];
}
export function decodeBytes32(c: Caveat): Hex {
  return decodeAbiParameters([{ type: "bytes32" }], c.parameters)[0];
}
export function decodeAddressArray(c: Caveat): readonly Address[] {
  return decodeAbiParameters([{ type: "address[]" }], c.parameters)[0];
}
export function decodeBytes32Array(c: Caveat): readonly Hex[] {
  return decodeAbiParameters([{ type: "bytes32[]" }], c.parameters)[0];
}
export function decodeRateLimit(c: Caveat): RateLimitParams {
  const [capacity, refillRate, currentTokens, lastRefill] = decodeAbiParameters(
    parseAbiParameters("uint256, uint256, uint256, uint64"),
    c.parameters
  );
  return { capacity, refillRate, currentTokens, lastRefill };
}
export function decodeCapRedelegate(c: Caveat): CapRedelegateParams {
  const [maxSubMandates, maxAggregateBudget] = decodeAbiParameters(
    parseAbiParameters("uint8, uint256"),
    c.parameters
  );
  return { maxSubMandates, maxAggregateBudget };
}
export function decodeCallableSurface(c: Caveat): readonly CallableSurfaceEntry[] {
  return decodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "selector", type: "bytes4" },
          { name: "maxValue", type: "uint256" },
        ],
      },
    ],
    c.parameters
  )[0] as readonly CallableSurfaceEntry[];
}
export function decodeCommsTemplate(c: Caveat): CommsTemplateParams {
  const [templateHash, templateMetadata] = decodeAbiParameters(
    parseAbiParameters("bytes32, bytes"),
    c.parameters
  );
  return { templateHash, templateMetadata };
}

// ---------------------------------------------------------------------------
// Convenience: pre-canned capability hashes (keccak256 of the name strings).
// ---------------------------------------------------------------------------

export const CAPABILITY_HASH: Record<keyof typeof CAPABILITY, Hex> = Object.fromEntries(
  Object.entries(CAPABILITY).map(([k, name]) => [k, keccak256(toBytes(name))])
) as Record<keyof typeof CAPABILITY, Hex>;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function wrap(caveatType: (typeof CAVEAT_TYPE)[keyof typeof CAVEAT_TYPE], parameters: Hex): Caveat {
  return { caveatType, parameters, schemaVersion: CAVEAT_SCHEMA_VERSION_V1 };
}

function pad32(h: Hex): Hex {
  const stripped = h.toLowerCase().replace(/^0x/, "");
  if (stripped.length > 64) throw new Error(`contextScope value > 32 bytes: ${h}`);
  return `0x${stripped.padStart(64, "0")}` as Hex;
}

export { toHex };
