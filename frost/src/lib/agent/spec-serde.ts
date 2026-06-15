import type { CompiledSpec } from "@frost/agent/browser";

/**
 * Serialize / revive a {@link CompiledSpec} for localStorage + cloud persistence.
 * The spec carries `bigint` caveat amounts that `JSON.stringify` can't encode, so the
 * four bigint fields are written as decimal strings and reconstructed on revive. Keeping
 * the EXACT compiled spec (vs re-deriving it from the workflow text) means a run after
 * an app reload uses the real caveats + comms template the user reviewed — no recompile,
 * no drift, no lost comms binding.
 */
export function serializeSpec(s: CompiledSpec): string {
  return JSON.stringify({
    ...s,
    spendCapTotal: s.spendCapTotal.toString(),
    hitlThreshold: s.hitlThreshold.toString(),
    expiryUnixSeconds: s.expiryUnixSeconds.toString(),
    redelegationBounds: {
      ...s.redelegationBounds,
      maxAggregateBudget: s.redelegationBounds.maxAggregateBudget.toString(),
    },
  });
}

/** Revive a spec serialized by {@link serializeSpec}. Returns undefined on bad input. */
export function reviveSpec(json: string): CompiledSpec | undefined {
  try {
    const o = JSON.parse(json) as Record<string, unknown> & {
      redelegationBounds?: Record<string, unknown>;
    };
    if (!o || typeof o !== "object") return undefined;
    const rb = o.redelegationBounds ?? {};
    return {
      ...(o as object),
      spendCapTotal: BigInt(o.spendCapTotal as string),
      hitlThreshold: BigInt(o.hitlThreshold as string),
      expiryUnixSeconds: BigInt(o.expiryUnixSeconds as string),
      redelegationBounds: {
        ...(rb as object),
        maxAggregateBudget: BigInt(rb.maxAggregateBudget as string),
      },
    } as CompiledSpec;
  } catch {
    return undefined;
  }
}
