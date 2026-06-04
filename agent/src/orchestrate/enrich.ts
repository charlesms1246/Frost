import type { Address } from "viem";
import { CAPABILITY, type CallableSurfaceEntry } from "@frost/sdk";
import type { CommsTemplate } from "../compile/types.js";
import type { ProposedCaveats, SpawnDecision } from "../types.js";
import type { DecisionEnricher } from "../translate/translate.js";

/**
 * Sub-agent orchestration: attach the role-appropriate STRUCTURAL caveats to an
 * approved {@link SpawnDecision} before it is issued on-chain.
 *
 * The planner's LLM proposes intent + spend caps; it must never invent on-chain
 * addresses, selectors, comms wording, or expiries. Those come from the SIGNED
 * session authority (the compiled spec the user reviewed) and from deployment
 * config — assembled here into a {@link SessionContext} and stamped onto each
 * decision by capability. This is the "runtime disposes" half: the encoder
 * (`translate/caveat-encoder.ts`) already knows how to serialize these fields;
 * this module decides WHICH ones a given role gets and WHERE the values come from.
 */
export interface SessionContext {
  /**
   * Absolute unix seconds the session expires. Every sub-mandate inherits this as
   * its TTL_EXPIRY — a child can never outlive the session the user signed for.
   */
  expiryUnixSeconds: bigint;
  /**
   * Approved x402 settlement providers (e.g. Venice). Attached to any role that
   * spends through a paid provider (CAP_INFERENCE_CALL / CAP_RPC_READ).
   */
  providerWhitelist: Address[];
  /**
   * The allowed `(target, selector, maxValue)` call surface for on-chain
   * executors — the DEX-router allowlist for the workflow. Attached to roles with
   * CAP_ONCHAIN_EXECUTION.
   */
  callableSurface: CallableSurfaceEntry[];
  /**
   * The comms template from the compiled, signed session spec. Attached to roles
   * with CAP_COMMS_POST. Absent for sessions with no comms step.
   */
  commsTemplate?: CommsTemplate;
}

/** Capabilities whose holder spends through a paid (x402-settled) provider. */
const SETTLES_VIA_PROVIDER: ReadonlySet<string> = new Set([
  CAPABILITY.INFERENCE_CALL,
  CAPABILITY.RPC_READ,
]);

/**
 * Stamp the session's structural caveats onto one approved decision, by
 * capability. Throws (→ a per-spawn `failed` outcome in `translatePlan`) when a
 * role needs a structural caveat the session doesn't provide — e.g. a comms role
 * with no signed template, or an executor with an empty call surface. That is a
 * setup/planning anomaly the runtime must not paper over.
 *
 * Runtime values are AUTHORITATIVE: they overwrite anything already on the
 * decision, so a hypothetical LLM-supplied address can never reach issuance.
 */
export function enrichDecision(
  decision: SpawnDecision,
  ctx: SessionContext,
): SpawnDecision {
  const caps = new Set(decision.proposedCaveats.capabilities);
  const pc: ProposedCaveats = { ...decision.proposedCaveats };

  // Every sub-mandate is bounded by the session's own expiry.
  pc.ttlExpiry = ctx.expiryUnixSeconds;

  if (caps.has(CAPABILITY.ONCHAIN_EXECUTION)) {
    if (ctx.callableSurface.length === 0) {
      throw new Error(
        `role "${decision.role}" has CAP_ONCHAIN_EXECUTION but the session defines no callable surface`,
      );
    }
    pc.callableSurface = ctx.callableSurface;
  }

  if (caps.has(CAPABILITY.COMMS_POST)) {
    if (!ctx.commsTemplate) {
      throw new Error(
        `role "${decision.role}" has CAP_COMMS_POST but the session has no comms template`,
      );
    }
    pc.commsTemplate = ctx.commsTemplate;
  }

  if ([...caps].some((c) => SETTLES_VIA_PROVIDER.has(c))) {
    if (ctx.providerWhitelist.length === 0) {
      throw new Error(
        `role "${decision.role}" spends via a paid provider but the session has no approved providers`,
      );
    }
    pc.providerWhitelist = ctx.providerWhitelist;
  }

  return { ...decision, proposedCaveats: pc };
}

/** Bind a {@link SessionContext} into the {@link DecisionEnricher} seam `translatePlan` takes. */
export function makeEnricher(ctx: SessionContext): DecisionEnricher {
  return (decision) => enrichDecision(decision, ctx);
}
