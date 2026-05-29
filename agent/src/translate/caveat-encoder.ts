import {
  CAPABILITY,
  capabilityWhitelist,
  hitlThreshold,
  slippageTolerance,
  spendCapPerCall,
  spendCapTotal,
  type Caveat,
} from "@frost/sdk";
import type { SpawnDecision } from "../types.js";
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
 * Coverage is limited to the fields `ProposedCaveats` carries today
 * (capabilities, spend caps, HITL threshold, slippage). Richer caveats —
 * CALLABLE_SURFACE for the executor, COMMS_TEMPLATE for comms, PROVIDER_WHITELIST
 * — need new `ProposedCaveats` fields first and land with the sub-agent
 * capabilities (Week 3).
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

  return caveats;
}

/** The default {@link CaveatEncoder} for wiring into `translatePlan`. */
export const defaultCaveatEncoder: CaveatEncoder = encodeProposedCaveats;

function requireNonNegative(label: string, v: bigint): void {
  if (v < 0n) throw new Error(`${label} must be non-negative, got ${v}`);
}
