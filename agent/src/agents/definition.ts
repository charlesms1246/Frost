import { CAPABILITY } from "@frost/sdk";
import type { ProposedCaveats, SpawnCandidate } from "../types.js";

/**
 * A user-defined, reusable specialist agent type (see `custom-agents.md`). It is
 * modeled as a reusable {@link SpawnCandidate} template: a role, a capability
 * whitelist, and spend caveats — exactly what the planner emits per spawn — so it
 * drops into the existing planner → translate → enrich pipeline with nothing new
 * downstream.
 *
 * The definition stays at the INTENT level and carries no on-chain addresses: call
 * surfaces, provider whitelists, and comms-template bindings are stamped by the
 * enricher from trusted config at spawn time, exactly as for the built-in agents.
 */

/** The primitive behavior a custom agent performs; routes to a built-in runtime. */
export const AGENT_BEHAVIORS = ["monitor", "pricer", "executor", "comms", "inference"] as const;
export type AgentBehavior = (typeof AGENT_BEHAVIORS)[number];

/** The capability each behavior REQUIRES to function. */
export const BEHAVIOR_CAPABILITY: Record<AgentBehavior, string> = {
  monitor: CAPABILITY.RPC_READ,
  pricer: CAPABILITY.RPC_READ,
  executor: CAPABILITY.ONCHAIN_EXECUTION,
  comms: CAPABILITY.COMMS_POST,
  inference: CAPABILITY.INFERENCE_CALL,
};

export const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set(Object.values(CAPABILITY));

/** Role slug: lowercase, starts alphanumeric, ≤ 41 chars. Keeps audit labels clean. */
export const ROLE_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

export interface CustomAgentDefinition {
  /** Stable role label (slug), e.g. "eth-dip-buyer". */
  role: string;
  /** The user's intent; also carried as the spawn `reasoning`. */
  description: string;
  /** Which primitive runtime this agent routes to. */
  behavior: AgentBehavior;
  /** Capability whitelist (⊆ CAPABILITY; must include the behavior's required cap). */
  capabilities: string[];
  /** SPEND_CAP_TOTAL for this agent's sub-mandate, USDC base units. */
  spendCapTotal: bigint;
  /** Optional per-action HITL approval gate, USDC base units. */
  hitlThreshold?: bigint;
  /** LLM estimate of inference budget this agent consumes, USDC base units. */
  estimatedTokenCost: bigint;
}

/**
 * Validate a definition; returns a list of problems (empty ⇒ valid). The
 * {@link CustomAgentRegistry} rejects on a non-empty result, and the Designer uses
 * the same rules so a saved definition is always spawnable.
 */
export function validateDefinition(def: CustomAgentDefinition): string[] {
  const errors: string[] = [];
  if (!ROLE_RE.test(def.role)) {
    errors.push(`role "${def.role}" is not a valid slug (^[a-z0-9][a-z0-9-]{0,40}$)`);
  }
  if (!AGENT_BEHAVIORS.includes(def.behavior)) {
    errors.push(`unknown behavior "${def.behavior}"`);
  }
  if (def.capabilities.length === 0) {
    errors.push("capabilities must not be empty");
  }
  for (const c of def.capabilities) {
    if (!KNOWN_CAPABILITIES.has(c)) errors.push(`unknown capability "${c}"`);
  }
  const required = BEHAVIOR_CAPABILITY[def.behavior];
  if (required && !def.capabilities.includes(required)) {
    errors.push(`behavior "${def.behavior}" requires capability ${required}`);
  }
  if (def.spendCapTotal < 0n) errors.push(`spendCapTotal must be non-negative, got ${def.spendCapTotal}`);
  if (def.hitlThreshold !== undefined && def.hitlThreshold < 0n) {
    errors.push(`hitlThreshold must be non-negative, got ${def.hitlThreshold}`);
  }
  if (def.estimatedTokenCost < 0n) {
    errors.push(`estimatedTokenCost must be non-negative, got ${def.estimatedTokenCost}`);
  }
  return errors;
}

/**
 * Lower a definition to a {@link SpawnCandidate}. Structural caveats (TTL_EXPIRY,
 * CALLABLE_SURFACE, PROVIDER_WHITELIST, COMMS_TEMPLATE) are intentionally NOT set
 * here — the enricher stamps those by capability from trusted config at spawn time.
 */
export function toSpawnCandidate(def: CustomAgentDefinition): SpawnCandidate {
  const proposedCaveats: ProposedCaveats = {
    capabilities: [...def.capabilities],
    spendCapTotal: def.spendCapTotal,
  };
  if (def.hitlThreshold !== undefined) proposedCaveats.hitlThreshold = def.hitlThreshold;
  return {
    role: def.role,
    proposedCaveats,
    estimatedTokenCost: def.estimatedTokenCost,
    reasoning: def.description,
  };
}

/**
 * In-memory store of the user's saved custom agents. Persistence (OS storage) is
 * the desktop app's concern; this is the lookup the session loop consults. Rejects
 * malformed definitions on register so only spawnable agents are ever held.
 */
export class CustomAgentRegistry {
  private readonly byRole = new Map<string, CustomAgentDefinition>();

  register(def: CustomAgentDefinition): void {
    const errors = validateDefinition(def);
    if (errors.length > 0) {
      throw new Error(`invalid custom agent "${def.role}": ${errors.join("; ")}`);
    }
    this.byRole.set(def.role, def);
  }

  get(role: string): CustomAgentDefinition | undefined {
    return this.byRole.get(role);
  }

  has(role: string): boolean {
    return this.byRole.has(role);
  }

  list(): CustomAgentDefinition[] {
    return [...this.byRole.values()];
  }
}
