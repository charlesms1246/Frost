import type { Address, Hex } from "viem";
import {
  CAVEAT_TYPE,
  decodeCallableSurface,
  decodeUint16,
  decodeUint64,
  decodeUint256,
  type Caveat,
  type CaveatTypeSelector,
} from "@frost/sdk";

/**
 * The executor's pre-submission safety check (contract-architecture §10.3, the
 * critical safety boundary). PURE: it decodes the executor sub-mandate's own
 * caveats and decides whether the proposed transaction may be submitted, must be
 * rejected, or must pause for human approval — no network, no side effects.
 *
 * This is the OFF-CHAIN half of a two-layer guard: the contract layer enforces the
 * same caveats at validation time, and both layers must agree (§10.3 closing note).
 * We never weaken a bound the user signed — if a caveat constrains a dimension the
 * proposal does not declare (slippage, gas), we REFUSE rather than submit blind
 * (T-32 paranoid posture).
 *
 * "The LLM proposes, the runtime disposes." The (target, selector) checked here are
 * facts about the call that will actually execute, matched against the signed
 * CALLABLE_SURFACE allow-list — an LLM-suggested address can never widen it.
 */
export interface ProposedExecution {
  /** Contract the call targets (e.g. the DEX router). */
  target: Address;
  /** 4-byte selector of the function being called. */
  selector: Hex;
  /** USDC-equivalent value of this call (6 decimals) — checked vs maxValue + HITL. */
  notionalUsdc: bigint;
  /** Current gas price (wei) — checked vs MAX_GAS_PRICE when that caveat is present. */
  gasPriceWei?: bigint;
  /** Computed slippage (bps) of this swap — checked vs SLIPPAGE_TOLERANCE when present. */
  slippageBps?: number;
}

export type Preflight =
  | { decision: "submit" }
  | { decision: "reject"; reason: string }
  | { decision: "hitl"; reason: string };

const SELECTOR_RE = /^0x[0-9a-fA-F]{8}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function preflightExecution(
  caveats: readonly Caveat[],
  proposed: ProposedExecution,
): Preflight {
  // Defensive shape checks — these values are runtime-built, but a malformed one
  // must never slip through to a private-mempool submit.
  if (!ADDRESS_RE.test(proposed.target)) {
    return reject(`malformed target address "${proposed.target}"`);
  }
  if (!SELECTOR_RE.test(proposed.selector)) {
    return reject(`malformed selector "${proposed.selector}"`);
  }
  if (proposed.notionalUsdc < 0n) {
    return reject(`notional value must be non-negative, got ${proposed.notionalUsdc}`);
  }

  const find = (t: CaveatTypeSelector): Caveat | undefined =>
    caveats.find((c) => c.caveatType === t);

  // §10.3 step 3a/3b — target ∈ CALLABLE_SURFACE with matching selector, value ≤ maxValue.
  // No surface caveat ⇒ nothing is callable (an executor with no allow-list can act on
  // nothing), so refuse rather than fall open.
  const surfaceCaveat = find(CAVEAT_TYPE.CALLABLE_SURFACE);
  if (!surfaceCaveat) {
    return reject("no CALLABLE_SURFACE caveat — executor has no authorized call surface");
  }
  const surface = decodeCallableSurface(surfaceCaveat);
  const entry = surface.find(
    (e) =>
      e.target.toLowerCase() === proposed.target.toLowerCase() &&
      e.selector.toLowerCase() === proposed.selector.toLowerCase(),
  );
  if (!entry) {
    return reject(
      `target/selector not in CALLABLE_SURFACE: ${proposed.target} ${proposed.selector}`,
    );
  }
  if (proposed.notionalUsdc > entry.maxValue) {
    return reject(
      `call value ${proposed.notionalUsdc} exceeds CALLABLE_SURFACE maxValue ${entry.maxValue}`,
    );
  }

  // §10.3 step 3c — computed slippage ≤ SLIPPAGE_TOLERANCE.
  const slipCaveat = find(CAVEAT_TYPE.SLIPPAGE_TOLERANCE);
  if (slipCaveat) {
    if (proposed.slippageBps === undefined) {
      return reject("SLIPPAGE_TOLERANCE is set but proposed execution did not declare slippage");
    }
    const tolerance = decodeUint16(slipCaveat);
    if (proposed.slippageBps > tolerance) {
      return reject(`slippage ${proposed.slippageBps} bps exceeds tolerance ${tolerance} bps`);
    }
  }

  // §10.3 step 3d — current gas price ≤ MAX_GAS_PRICE.
  const gasCaveat = find(CAVEAT_TYPE.MAX_GAS_PRICE);
  if (gasCaveat) {
    if (proposed.gasPriceWei === undefined) {
      return reject("MAX_GAS_PRICE is set but proposed execution did not declare gas price");
    }
    const maxGas = decodeUint64(gasCaveat);
    if (proposed.gasPriceWei > maxGas) {
      return reject(`gas price ${proposed.gasPriceWei} wei exceeds MAX_GAS_PRICE ${maxGas} wei`);
    }
  }

  // §10.3 step 3e/4 — value ≥ HITL_THRESHOLD pauses for approval. Checked LAST: a hard
  // reject above (over maxValue, slippage, gas) takes precedence over a HITL pause.
  const hitlCaveat = find(CAVEAT_TYPE.HITL_THRESHOLD);
  if (hitlCaveat) {
    const threshold = decodeUint256(hitlCaveat);
    if (proposed.notionalUsdc > threshold) {
      return {
        decision: "hitl",
        reason: `call value ${proposed.notionalUsdc} exceeds HITL threshold ${threshold} — requires approval`,
      };
    }
  }

  return { decision: "submit" };
}

function reject(reason: string): Preflight {
  return { decision: "reject", reason };
}
