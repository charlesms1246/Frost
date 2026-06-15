import { CAPABILITY } from "@frost/sdk";
import type { ChatMessage } from "../inference/openrouter.js";
import type {
  RedelegationBounds,
  RedelegationState,
  TaskSpec,
  TokenBucketState,
  TriggerEvent,
} from "../types.js";

/**
 * Versioned identifier recorded in every PlanningEntry.promptTemplate. Bump on
 * any change to the prompt wording so the audit log stays interpretable and the
 * offline LLM-evaluation corpus (§10.7) is comparable across versions.
 */
export const PLANNING_PROMPT_VERSION = "frost-planner-v1";

/** The strict JSON shape we instruct the model to emit. */
export interface PlannerOutput {
  /** True when the model cannot plan safely and wants a human in the loop. */
  escalate: boolean;
  escalateReason?: string;
  candidates: {
    role: string;
    capabilities: string[];
    /** SPEND_CAP_TOTAL, USDC base units (integer string to survive JSON). */
    spendCapTotal: string;
    spendCapPerCall?: string;
    hitlThreshold?: string;
    slippageToleranceBps?: number;
    /** USDC base units (integer string). */
    estimatedTokenCost: string;
    reasoning: string;
  }[];
}

export interface PromptInput {
  spec: TaskSpec;
  trigger: TriggerEvent;
  bounds: RedelegationBounds;
  state: RedelegationState;
  bucket: TokenBucketState;
}

const KNOWN_CAPABILITIES = Object.values(CAPABILITY).join(", ");

const SYSTEM_PROMPT = `You are Frost's master-agent planner. Frost is an agentic web3 automation app: a user describes a workflow, signs a bounded authority, and you autonomously decide which specialist sub-agents to spawn to carry it out.

Specialist roles you may spawn (use a concrete label, e.g. "pricer-uniswap"):
- pricer-<dex>: read-only DEX quote fetcher (RPC reads). One per DEX when comparing routes.
- executor: submits the chosen on-chain transaction. Needs CAP_ONCHAIN_EXECUTION.
- monitor: watches an on-chain condition and reports back.
- comms: posts updates to a Discord channel. Needs CAP_COMMS_POST.

Known capabilities (use only these): ${KNOWN_CAPABILITIES}.

HARD RULES — you operate under signed CAP_REDELEGATE bounds:
1. The number of sub-mandates you spawn this cycle plus those already spawned must not exceed maxSubMandates.
2. The sum of every candidate's spendCapTotal plus the budget already consumed must not exceed maxAggregateBudget.
3. Each spawn consumes one token from the rate-limit bucket; do not propose more spawns than tokens available.
4. Sub-agent HITL_THRESHOLD may only be lower (more conservative) than the parent's, never higher.

If the workflow is ambiguous, out of scope, or you cannot plan within the bounds, DO NOT guess — return an empty candidates array with escalate=true and a short escalateReason.

Respond with a SINGLE JSON object, no prose, exactly this shape:
{"escalate": boolean, "escalateReason"?: string, "candidates": [{"role": string, "capabilities": string[], "spendCapTotal": string, "spendCapPerCall"?: string, "hitlThreshold"?: string, "slippageToleranceBps"?: number, "estimatedTokenCost": string, "reasoning": string}]}
All amount fields are USDC base-unit integers encoded as strings.`;

/** Build the chat messages for one planning cycle. */
export function buildPlanningPrompt(input: PromptInput): ChatMessage[] {
  const { spec, trigger, bounds, state, bucket } = input;
  const remainingCount = bounds.maxSubMandates - state.subMandateCount;
  const remainingBudget =
    bounds.maxAggregateBudget - state.aggregateSubMandateBudget;

  const context = {
    sessionId: spec.sessionId,
    parentMandateId: spec.rootMandateId,
    workflow: spec.description,
    triggerEvent: trigger,
    bounds: {
      maxSubMandates: bounds.maxSubMandates,
      maxAggregateBudget: bounds.maxAggregateBudget.toString(),
    },
    alreadyConsumed: {
      subMandateCount: state.subMandateCount,
      aggregateSubMandateBudget: state.aggregateSubMandateBudget.toString(),
    },
    headroom: {
      subMandatesRemaining: remainingCount,
      budgetRemaining: remainingBudget.toString(),
      rateLimitTokensAvailable: bucket.available,
    },
  };

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Plan the next cycle. Current state:\n${JSON.stringify(context, null, 2)}`,
    },
  ];
}

/**
 * Parse the model's response into a {@link PlannerOutput}. Tolerant of real-world
 * LLM output: a code-fence wrapper, prose around the JSON, `escalate` as a string,
 * and — crucially — amount fields emitted as NUMBERS instead of integer strings
 * (a frequent divergence across models, e.g. llama-3.3-70b). Safety is NOT relaxed:
 * the planner re-validates every coerced candidate against the signed bounds, and a
 * non-coercible amount (e.g. "not-a-number") still rejects. Returns `null` when the
 * text is unusable — the planner treats that as an escalation (T-35), never a throw.
 */
export function parsePlannerOutput(text: string): PlannerOutput | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;

  const escalate = asBool(obj["escalate"]);
  if (escalate === undefined) return null;
  // A model that escalates (or has nothing to spawn) often OMITS `candidates`
  // despite the prompt asking for an empty array — treat a missing field as []
  // so the escalation parses and its real `escalateReason` survives, rather than
  // being swallowed by a generic "not parseable" failure. A PRESENT-but-non-array
  // value is still a structural error.
  const rawCandidates = obj["candidates"];
  if (rawCandidates !== undefined && !Array.isArray(rawCandidates)) return null;
  const candidateList = Array.isArray(rawCandidates) ? rawCandidates : [];

  const candidates: PlannerOutput["candidates"] = [];
  for (const c of candidateList) {
    if (typeof c !== "object" || c === null) return null;
    const cand = c as Record<string, unknown>;
    // The structural essentials of a candidate are role + capabilities + reasoning.
    // The two amount estimates are frequently OMITTED by models (e.g. llama-3.3-70b)
    // even though the prompt asks for them; a missing amount defaults to "0" rather
    // than failing the whole plan (the designer does the same, and the planner
    // re-validates real budgets against the signed bounds + the on-chain Mandate). A
    // PRESENT-but-non-numeric amount is left as-is so the downstream amount check still
    // rejects it with "invalid amount".
    const spendCapTotal = asAmountString(cand["spendCapTotal"]) ?? "0";
    const estimatedTokenCost = asAmountString(cand["estimatedTokenCost"]) ?? "0";
    if (
      typeof cand["role"] !== "string" ||
      !Array.isArray(cand["capabilities"]) ||
      typeof cand["reasoning"] !== "string"
    ) {
      return null;
    }
    if (!cand["capabilities"].every((x) => typeof x === "string")) return null;

    const entry: PlannerOutput["candidates"][number] = {
      role: cand["role"],
      capabilities: cand["capabilities"] as string[],
      spendCapTotal,
      estimatedTokenCost,
      reasoning: cand["reasoning"],
    };
    const perCall = asAmountString(cand["spendCapPerCall"]);
    if (perCall !== undefined) entry.spendCapPerCall = perCall;
    const hitl = asAmountString(cand["hitlThreshold"]);
    if (hitl !== undefined) entry.hitlThreshold = hitl;
    const slippage = asInt(cand["slippageToleranceBps"]);
    if (slippage !== undefined) entry.slippageToleranceBps = slippage;
    candidates.push(entry);
  }

  const out: PlannerOutput = { escalate, candidates };
  if (typeof obj["escalateReason"] === "string")
    out.escalateReason = obj["escalateReason"];
  return out;
}

/**
 * Normalize an amount field to a STRING. A NUMBER is coerced to its integer string
 * (the common model divergence we fix here); a STRING is passed through UNCHANGED so
 * the planner's downstream amount validation still rejects non-numeric strings with
 * its "invalid amount" reason. Missing / non-scalar ⇒ undefined (a structural error).
 */
function asAmountString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v).toString();
  return undefined;
}

/** Coerce a value to an integer NUMBER (number or numeric string); else undefined. */
function asInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return undefined;
}

/** Coerce a value to a boolean (true/false or "true"/"false"); else undefined. */
function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

/**
 * Pull the planner JSON object out of the model text: try a code-fence body, then a
 * direct parse, then the first balanced `{…}` object embedded in prose. Returns the
 * parsed object (not an array) or null.
 */
function extractJsonObject(text: string): Record<string, unknown> | null {
  for (const candidate of [stripCodeFence(text).trim(), firstBalancedObject(text)]) {
    if (!candidate) continue;
    try {
      const p: unknown = JSON.parse(candidate);
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function stripCodeFence(text: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(text.trim());
  return fence?.[1] ?? text;
}

/** The first brace-balanced JSON object substring (string-aware), or null. */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
