import {
  CAPABILITY,
  callableSurface,
  capabilityWhitelist,
  hitlThreshold,
  providerWhitelist,
  slippageTolerance,
  spendCapPerCall,
  spendCapTotal,
  ttlExpiry,
  type Caveat,
} from "@frost/sdk";
import type { SpawnDecision } from "../types.js";
import { encodeCommsTemplate } from "../compile/encode.js";
import type { CaveatEncoder } from "./translate.js";

/**
 * Encode a runtime-approved {@link SpawnDecision}'s high-level
 * {@link ProposedCaveats} into the on-chain `Caveat[]` the Mandate contract
 * expects, using `@frost/sdk`'s builders verbatim.
 *
 * This is the `CaveatEncoder` seam `translatePlan` takes injected. It does NOT
 * pre-intersect against the parent — the contract recomputes the intersection at
 * issuance (§2.5; the SDK builders' contract). It only builds what the decision
 * requested, and throws on input that is malformed rather than silently emitting
 * a useless caveat — `translatePlan` catches the throw and records a `failed`
 * outcome, so a bad approved decision never becomes a live sub-mandate.
 *
 * Covers every field `ProposedCaveats` carries: capabilities, spend caps, HITL
 * threshold, slippage, plus the role-specific structural caveats — TTL_EXPIRY,
 * PROVIDER_WHITELIST (settlements), CALLABLE_SURFACE (executor), and COMMS_TEMPLATE
 * (comms). The address/selector-bearing fields are populated by the runtime / the
 * compiled session spec, never by the LLM — this encoder only translates whatever
 * the (runtime-approved) decision carries.
 */
const KNOWN_CAPABILITIES = new Set<string>(Object.values(CAPABILITY));

export function encodeProposedCaveats(decision: SpawnDecision): Caveat[] {
  const { role, proposedCaveats: pc } = decision;

  if (pc.capabilities.length === 0) {
    throw new Error(`sub-agent "${role}" was approved with no capabilities`);
  }
  for (const cap of pc.capabilities) {
    // Either a known capability name (hashed by the builder) or a custom
    // pre-hashed bytes32. Anything else would hash to a capability the contract
    // never checks for — a silent no-op, so reject it loudly instead.
    if (!KNOWN_CAPABILITIES.has(cap) && !cap.startsWith("0x")) {
      throw new Error(`unknown capability "${cap}" for sub-agent "${role}"`);
    }
  }

  requireNonNegative(`${role} spendCapTotal`, pc.spendCapTotal);

  const caveats: Caveat[] = [
    capabilityWhitelist(pc.capabilities),
    spendCapTotal(pc.spendCapTotal),
  ];

  if (pc.spendCapPerCall !== undefined) {
    requireNonNegative(`${role} spendCapPerCall`, pc.spendCapPerCall);
    caveats.push(spendCapPerCall(pc.spendCapPerCall));
  }
  if (pc.hitlThreshold !== undefined) {
    requireNonNegative(`${role} hitlThreshold`, pc.hitlThreshold);
    caveats.push(hitlThreshold(pc.hitlThreshold));
  }
  if (pc.slippageToleranceBps !== undefined) {
    const bps = pc.slippageToleranceBps;
    if (!Number.isInteger(bps) || bps < 0 || bps > 65535) {
      throw new Error(
        `${role} slippageToleranceBps must be an integer in [0, 65535], got ${bps}`,
      );
    }
    caveats.push(slippageTolerance(bps));
  }
  if (pc.ttlExpiry !== undefined) {
    requireUint64(`${role} ttlExpiry`, pc.ttlExpiry);
    caveats.push(ttlExpiry(pc.ttlExpiry));
  }
  if (pc.providerWhitelist !== undefined) {
    if (pc.providerWhitelist.length === 0) {
      throw new Error(`${role} providerWhitelist must not be empty`);
    }
    pc.providerWhitelist.forEach((a, i) =>
      requireAddress(`${role} providerWhitelist[${i}]`, a),
    );
    caveats.push(providerWhitelist(pc.providerWhitelist));
  }
  if (pc.callableSurface !== undefined) {
    if (pc.callableSurface.length === 0) {
      throw new Error(`${role} callableSurface must not be empty`);
    }
    pc.callableSurface.forEach((e, i) => {
      requireAddress(`${role} callableSurface[${i}].target`, e.target);
      requireSelector(`${role} callableSurface[${i}].selector`, e.selector);
      requireNonNegative(`${role} callableSurface[${i}].maxValue`, e.maxValue);
    });
    caveats.push(callableSurface(pc.callableSurface));
  }
  if (pc.commsTemplate !== undefined) {
    if (pc.commsTemplate.text.length === 0) {
      throw new Error(`${role} commsTemplate.text must not be empty`);
    }
    caveats.push(encodeCommsTemplate(pc.commsTemplate));
  }

  return caveats;
}

/** The default {@link CaveatEncoder} for wiring into `translatePlan`. */
export const defaultCaveatEncoder: CaveatEncoder = encodeProposedCaveats;

function requireNonNegative(label: string, v: bigint): void {
  if (v < 0n) throw new Error(`${label} must be non-negative, got ${v}`);
}

function requireUint64(label: string, v: bigint): void {
  if (v < 0n) throw new Error(`${label} must be non-negative, got ${v}`);
  if (v >= 1n << 64n) throw new Error(`${label} exceeds uint64, got ${v}`);
}

function requireAddress(label: string, a: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
    throw new Error(`${label} must be a 0x-prefixed 20-byte address, got "${a}"`);
  }
}

function requireSelector(label: string, s: string): void {
  if (!/^0x[0-9a-fA-F]{8}$/.test(s)) {
    throw new Error(`${label} must be a 0x-prefixed 4-byte selector, got "${s}"`);
  }
}
