import type { Address } from "viem";
import type { CallableSurfaceEntry } from "@frost/sdk";
import type { CompiledSpec } from "../compile/types.js";
import type { SessionContext } from "./enrich.js";

/**
 * Assemble the {@link SessionContext} the enricher consumes from the two
 * trusted, non-LLM sources it draws structural caveats from:
 *
 *  - the **signed `CompiledSpec`** — the session-level authority the user reviewed
 *    and signed (its expiry and, if any, its comms template); and
 *  - **deployment config** — the on-chain targets that are a property of the
 *    deployment, not the workflow: the approved settlement providers and the
 *    executor's DEX-router call surface.
 *
 * Keeping this assembly in one small adapter means the enrichment policy
 * (`enrich.ts`) stays pure and the sub-agent capabilities don't each re-derive
 * where these values come from.
 */
export interface DeploymentConfig {
  /** Approved x402 settlement-provider addresses (e.g. the Venice payment address). */
  approvedProviders: Address[];
  /** The allowed `(target, selector, maxValue)` call surface for executors. */
  callableSurface: CallableSurfaceEntry[];
}

export function sessionContextFrom(
  spec: CompiledSpec,
  config: DeploymentConfig,
): SessionContext {
  const ctx: SessionContext = {
    expiryUnixSeconds: spec.expiryUnixSeconds,
    providerWhitelist: config.approvedProviders,
    callableSurface: config.callableSurface,
  };
  // Only sessions with a comms step carry a template (exactOptionalPropertyTypes:
  // set it only when present, never as `undefined`).
  if (spec.commsTemplate) ctx.commsTemplate = spec.commsTemplate;
  return ctx;
}
