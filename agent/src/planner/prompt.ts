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
 * Parse the model's response into a {@link PlannerOutput}. Tolerant of a code
 * fence wrapper. Returns `null` when the text is not usable — the planner treats
 * that as an escalation (T-35 graceful degradation), never a throw.
 */
export function parsePlannerOutput(text: string): PlannerOutput | null {
  const stripped = stripCodeFence(text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  if (typeof obj["escalate"] !== "boolean") return null;
  const rawCandidates = obj["candidates"];
  if (!Array.isArray(rawCandidates)) return null;

  const candidates: PlannerOutput["candidates"] = [];
  for (const c of rawCandidates) {
    if (typeof c !== "object" || c === null) return null;
    const cand = c as Record<string, unknown>;
    if (
      typeof cand["role"] !== "string" ||
      !Array.isArray(cand["capabilities"]) ||
      typeof cand["spendCapTotal"] !== "string" ||
      typeof cand["estimatedTokenCost"] !== "string" ||
      typeof cand["reasoning"] !== "string"
    ) {
      return null;
    }
    if (!cand["capabilities"].every((x) => typeof x === "string")) return null;

    const entry: PlannerOutput["candidates"][number] = {
      role: cand["role"],
      capabilities: cand["capabilities"] as string[],
      spendCapTotal: cand["spendCapTotal"],
      estimatedTokenCost: cand["estimatedTokenCost"],
      reasoning: cand["reasoning"],
    };
    if (typeof cand["spendCapPerCall"] === "string")
      entry.spendCapPerCall = cand["spendCapPerCall"];
    if (typeof cand["hitlThreshold"] === "string")
      entry.hitlThreshold = cand["hitlThreshold"];
    if (typeof cand["slippageToleranceBps"] === "number")
      entry.slippageToleranceBps = cand["slippageToleranceBps"];
    candidates.push(entry);
  }

  const out: PlannerOutput = {
    escalate: obj["escalate"] as boolean,
    candidates,
  };
  if (typeof obj["escalateReason"] === "string")
    out.escalateReason = obj["escalateReason"];
  return out;
}

function stripCodeFence(text: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(text.trim());
  return fence?.[1] ?? text;
}
