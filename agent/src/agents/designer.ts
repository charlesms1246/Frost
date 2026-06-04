import { CAPABILITY } from "@frost/sdk";
import type { InferenceTransport } from "../inference/openrouter.js";
import { PARANOID_DEFAULTS } from "../compile/defaults.js";
import type { Assumption, Clarification } from "../compile/types.js";
import {
  AGENT_BEHAVIORS,
  BEHAVIOR_CAPABILITY,
  KNOWN_CAPABILITIES,
  validateDefinition,
  type AgentBehavior,
  type CustomAgentDefinition,
} from "./definition.js";
import {
  buildDesignPrompt,
  DESIGN_PROMPT_VERSION,
  parseDesignerOutput,
  type DesignInput,
} from "./prompt.js";

/**
 * The Agent Designer — the "agent that creates agents". It turns a natural-language
 * description of a desired specialist agent into a validated, reusable
 * {@link CustomAgentDefinition} (see `custom-agents.md`).
 *
 * Same posture as the compiler: the LLM PROPOSES, the runtime DISPOSES. The model
 * names the agent, picks a behavior, and proposes capabilities + spend bounds from
 * the (untrusted) description; deterministic code here drops unknown capabilities,
 * strips CAP_REDELEGATE (a specialist is a leaf), guarantees the behavior's required
 * capability, applies paranoid spend defaults, and escalates to HITL on unusable
 * output — it never throws and never returns an agent the user might save blind.
 */
export interface DesignerConfig {
  transport: InferenceTransport;
  model: string;
}

export interface DesignResult {
  /** Always present; on escalation it is an inert read-only floor the caller won't save. */
  definition: CustomAgentDefinition;
  clarifications: Clarification[];
  assumptions: Assumption[];
  warnings: string[];
  /** True when there are no open clarifications (safe to review + save). */
  readyToUse: boolean;
  escalateToHITL: boolean;
  hitlReason?: string;
  promptTemplate: string;
  modelUsed: string;
}

export class AgentDesigner {
  private readonly transport: InferenceTransport;
  private readonly model: string;

  constructor(config: DesignerConfig) {
    this.transport = config.transport;
    this.model = config.model;
  }

  async design(input: DesignInput): Promise<DesignResult> {
    const messages = buildDesignPrompt(input);

    let text: string;
    let modelUsed = this.model;
    try {
      const res = await this.transport.complete({
        model: this.model,
        messages,
        temperature: 0,
        json: true,
      });
      text = res.text;
      modelUsed = res.model;
    } catch (err) {
      return this.escalation(`inference call failed: ${errMessage(err)}`, modelUsed);
    }

    const parsed = parseDesignerOutput(text);
    if (parsed === null) {
      return this.escalation("designer output was not parseable JSON in the expected shape", modelUsed);
    }
    if (parsed.escalate) {
      return this.escalation(parsed.escalateReason ?? "designer requested HITL escalation", modelUsed);
    }

    // Behavior is essential for routing and has no safe default — escalate if absent/unknown.
    const behavior = parsed.behavior as AgentBehavior | undefined;
    if (!behavior || !AGENT_BEHAVIORS.includes(behavior)) {
      return this.escalation(`could not determine a valid behavior (got "${parsed.behavior ?? ""}")`, modelUsed);
    }

    const answers = input.answers ?? {};
    const assumptions: Assumption[] = [];
    const warnings: string[] = [];
    const clarifications: Clarification[] = [];

    // Role: slugify the model's name; fall back to custom-<behavior> if unusable.
    let role = slugifyRole(parsed.role ?? "");
    if (role === "") {
      role = `custom-${behavior}`;
      assumptions.push({
        field: "role",
        assumed: role,
        note: "No clear name in your description; generated one from the behavior.",
      });
    }

    // Capabilities: keep only known ones; never auto-grant CAP_REDELEGATE; guarantee
    // the behavior's required capability.
    const proposed = Array.isArray(parsed.capabilities) ? parsed.capabilities : [];
    const caps = new Set<string>();
    for (const c of proposed) {
      if (typeof c !== "string") continue;
      if (c === CAPABILITY.REDELEGATE) {
        warnings.push("Removed CAP_REDELEGATE — a specialist agent is a leaf and must not spawn others.");
        continue;
      }
      if (!KNOWN_CAPABILITIES.has(c)) {
        warnings.push(`Dropped unknown capability "${c}".`);
        continue;
      }
      caps.add(c);
    }
    const required = BEHAVIOR_CAPABILITY[behavior];
    if (!caps.has(required)) {
      caps.add(required);
      assumptions.push({
        field: "capabilities",
        assumed: required,
        note: `Added the capability the "${behavior}" behavior requires.`,
      });
    }

    const spends = behavior === "executor" || behavior === "inference";
    let spendCapTotal =
      takeAmount(answers, "spendCapTotal", warnings) ??
      parseModelAmount(parsed.spendCapTotal, "spendCapTotal", warnings);
    if (spendCapTotal === undefined) {
      spendCapTotal = PARANOID_DEFAULTS.spendCapTotal;
      // A read-only agent's spend cap is immaterial, so only surface the default for
      // agents that actually spend.
      if (spends) {
        assumptions.push({
          field: "spendCapTotal",
          assumed: "$10",
          note: "Not specified; applied a conservative default.",
        });
      }
    }

    const definition: CustomAgentDefinition = {
      role,
      description: typeof parsed.description === "string" && parsed.description.trim() !== ""
        ? parsed.description.trim()
        : input.description.trim(),
      behavior,
      capabilities: [...caps],
      spendCapTotal,
      estimatedTokenCost:
        parseModelAmount(parsed.estimatedTokenCost, "estimatedTokenCost", warnings) ?? 0n,
    };

    // HITL gate: meaningful for value-moving agents; carried if the model set one.
    const hitl =
      takeAmount(answers, "hitlThreshold", warnings) ??
      parseModelAmount(parsed.hitlThreshold, "hitlThreshold", warnings) ??
      (spends ? PARANOID_DEFAULTS.hitlThreshold : undefined);
    if (hitl !== undefined) definition.hitlThreshold = hitl;

    // Defensive: a definition we assembled should always validate; if not, escalate
    // rather than hand back something unspawnable.
    const errors = validateDefinition(definition);
    if (errors.length > 0) {
      return this.escalation(`assembled an invalid agent: ${errors.join("; ")}`, modelUsed);
    }

    // Required parameters the model flagged and the user hasn't answered.
    for (const m of parsed.missing ?? []) {
      if (typeof m?.field !== "string") continue;
      if (answers[m.field] !== undefined) continue;
      clarifications.push({
        field: m.field,
        question: typeof m.question === "string" ? m.question : `Please provide ${m.field}.`,
        reason: typeof m.reason === "string" ? m.reason : "Required for this agent.",
      });
    }
    for (const a of parsed.assumptions ?? []) {
      if (typeof a?.field !== "string") continue;
      assumptions.push({
        field: a.field,
        assumed: typeof a.assumed === "string" ? a.assumed : "",
        note: typeof a.note === "string" ? a.note : "",
      });
    }

    return {
      definition,
      clarifications,
      assumptions,
      warnings,
      readyToUse: clarifications.length === 0,
      escalateToHITL: false,
      promptTemplate: DESIGN_PROMPT_VERSION,
      modelUsed,
    };
  }

  private escalation(reason: string, modelUsed: string): DesignResult {
    // Inert read-only floor: least authority (a monitor needs only CAP_RPC_READ, no
    // spend). The caller checks escalateToHITL first and surfaces a human prompt.
    const definition: CustomAgentDefinition = {
      role: "unbuilt-agent",
      description: "",
      behavior: "monitor",
      capabilities: [CAPABILITY.RPC_READ],
      spendCapTotal: 0n,
      estimatedTokenCost: 0n,
    };
    return {
      definition,
      clarifications: [],
      assumptions: [],
      warnings: [],
      readyToUse: false,
      escalateToHITL: true,
      hitlReason: reason,
      promptTemplate: DESIGN_PROMPT_VERSION,
      modelUsed,
    };
  }
}

function slugifyRole(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 41)
    .replace(/-+$/g, "");
  return /^[a-z0-9]/.test(s) ? s : "";
}

/** Lenient answer reader: a bad amount is user error → warn + fall back, never escalate. */
function takeAmount(
  answers: Record<string, string>,
  field: string,
  warnings: string[],
): bigint | undefined {
  const raw = answers[field];
  if (raw === undefined) return undefined;
  try {
    return parseBaseUnits(raw);
  } catch {
    warnings.push(`Could not read your answer for ${field} ("${raw}") as a USDC base-unit amount; using the default.`);
    return undefined;
  }
}

function parseModelAmount(
  s: string | undefined,
  field: string,
  warnings: string[],
): bigint | undefined {
  if (s === undefined) return undefined;
  try {
    return parseBaseUnits(s);
  } catch {
    warnings.push(`Ignored a malformed ${field} from the model ("${s}").`);
    return undefined;
  }
}

function parseBaseUnits(s: string): bigint {
  const v = BigInt(s.trim());
  if (v < 0n) throw new Error("negative");
  return v;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
