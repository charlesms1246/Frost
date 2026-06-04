import { keccak256, stringToHex } from "viem";
import {
  capRedelegate,
  commsTemplate,
  hitlThreshold,
  rateLimit,
  slippageTolerance,
  spendCapTotal,
  ttlExpiry,
  type Caveat,
} from "@frost/sdk";
import type { CommsTemplate, CompiledSpec } from "./types.js";

/**
 * Encode a {@link CompiledSpec} into the on-chain `Caveat[]` the `Mandate`
 * contract receives at `issueMandate`. This array IS the signed artifact — the
 * plain-language review copy is rendered by decoding it back (see `render.ts`),
 * so display and signature share one source (I-16).
 *
 * Throws on malformed input (negative amount, out-of-range field) rather than
 * emitting a caveat the contract would misread — the caller surfaces that as a
 * failed compile, never a silently wrong mandate. Mirrors the validation
 * contract of `translate/caveat-encoder.ts`.
 */
export function encodeRootCaveats(spec: CompiledSpec): Caveat[] {
  requireNonNegative("spendCapTotal", spec.spendCapTotal);
  requireNonNegative("hitlThreshold", spec.hitlThreshold);
  requireNonNegative("maxAggregateBudget", spec.redelegationBounds.maxAggregateBudget);
  requireUint("expiryUnixSeconds", spec.expiryUnixSeconds, 64n);
  requireIntInRange("slippageBps", spec.slippageBps, 0, 65535);
  requireIntInRange("maxSubMandates", spec.redelegationBounds.maxSubMandates, 0, 255);
  requireIntInRange("rateLimit.capacity", spec.rateLimit.capacity, 0, Number.MAX_SAFE_INTEGER);
  requireIntInRange("rateLimit.refillRatePerSec", spec.rateLimit.refillRatePerSec, 0, Number.MAX_SAFE_INTEGER);

  const caveats: Caveat[] = [
    spendCapTotal(spec.spendCapTotal),
    hitlThreshold(spec.hitlThreshold),
    slippageTolerance(spec.slippageBps),
    ttlExpiry(spec.expiryUnixSeconds),
    capRedelegate({
      maxSubMandates: spec.redelegationBounds.maxSubMandates,
      maxAggregateBudget: spec.redelegationBounds.maxAggregateBudget,
    }),
    rateLimit({
      capacity: BigInt(spec.rateLimit.capacity),
      refillRate: BigInt(spec.rateLimit.refillRatePerSec),
      // Start the bucket full; the contract stamps lastRefill at storage time.
      currentTokens: BigInt(spec.rateLimit.capacity),
      lastRefill: 0n,
    }),
  ];

  if (spec.commsTemplate) {
    caveats.push(encodeCommsTemplate(spec.commsTemplate));
  }

  return caveats;
}

/**
 * Encode a high-level {@link CommsTemplate} into a COMMS_TEMPLATE caveat: the
 * canonical JSON goes in `templateMetadata` and its keccak256 in `templateHash`,
 * so the render side can verify the binding (I-16). Shared by the root-mandate
 * encoder here and the sub-mandate `caveat-encoder`.
 */
export function encodeCommsTemplate(t: CommsTemplate): Caveat {
  const metadata = stringToHex(canonicalCommsJson(t));
  return commsTemplate({ templateHash: keccak256(metadata), templateMetadata: metadata });
}

/**
 * Deterministic JSON serialization of a comms template. Fixed key order so the
 * bytes (and therefore the templateHash) are stable for a given template —
 * required for the I-16 byte-tie and the render-side hash check.
 */
export function canonicalCommsJson(t: CommsTemplate): string {
  return JSON.stringify({
    text: t.text,
    variables: t.variables.map((v) => ({
      name: v.name,
      source: v.source,
      optIn: v.optIn === true,
    })),
  });
}

function requireNonNegative(label: string, v: bigint): void {
  if (v < 0n) throw new Error(`${label} must be non-negative, got ${v}`);
}

function requireUint(label: string, v: bigint, bits: bigint): void {
  if (v < 0n) throw new Error(`${label} must be non-negative, got ${v}`);
  if (v >= 1n << bits) throw new Error(`${label} exceeds uint${bits}, got ${v}`);
}

function requireIntInRange(label: string, v: number, lo: number, hi: number): void {
  if (!Number.isInteger(v) || v < lo || v > hi) {
    throw new Error(`${label} must be an integer in [${lo}, ${hi}], got ${v}`);
  }
}
