import type { InferenceTransport } from "../inference/openrouter.js";
import type {
  PlanningEntry,
  PlanResult,
  ProposedCaveats,
  SpawnCandidate,
  SpawnDecision,
} from "../types.js";
import {
  buildPlanningPrompt,
  parsePlannerOutput,
  PLANNING_PROMPT_VERSION,
  type PlannerOutput,
  type PromptInput,
} from "./prompt.js";

/** Everything one planning cycle needs. Same shape the prompt builder reads. */
export type PlanInput = PromptInput;

export interface PlannerConfig {
  transport: InferenceTransport;
  /** Model id passed to the transport, e.g. "anthropic/claude-3.5-sonnet". */
  model: string;
  /** Injectable clock (unix seconds) for deterministic tests. */
  now?: () => number;
}

/**
 * The Frost master-agent dynamic planning loop (Day-14 checkpoint surface).
 *
 * It is LLM-driven but NOT LLM-trusted: the model proposes candidate sub-agents,
 * and {@link Planner.plan} re-validates every one against the signed
 * CAP_REDELEGATE bounds and the rate-limit bucket before approving it. The
 * contract enforces the same bounds at issuance — this is the off-chain guard of
 * a two-layer defence. Anything the planner cannot handle escalates to HITL
 * rather than acting on a guess (T-35).
 */
export class Planner {
  private readonly transport: InferenceTransport;
  private readonly model: string;
  private readonly now: () => number;

  constructor(config: PlannerConfig) {
    this.transport = config.transport;
    this.model = config.model;
    this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async plan(input: PlanInput): Promise<PlanResult> {
    const messages = buildPlanningPrompt(input);

    let text: string;
    let modelUsed = this.model;
    let inferenceCallId = "";
    try {
      const res = await this.transport.complete({
        model: this.model,
        messages,
        temperature: 0,
        json: true,
      });
      text = res.text;
      modelUsed = res.model;
      inferenceCallId = res.id;
    } catch (err) {
      return this.escalation(
        input,
        `inference call failed: ${errMessage(err)}`,
        [],
        modelUsed,
        inferenceCallId,
      );
    }

    const parsed = parsePlannerOutput(text);
    if (parsed === null) {
      return this.escalation(
        input,
        "planner output was not parseable JSON in the expected shape",
        [],
        modelUsed,
        inferenceCallId,
      );
    }

    // Decode candidate amounts; a bad integer means we don't trust the plan.
    let candidates: SpawnCandidate[];
    try {
      candidates = parsed.candidates.map(decodeCandidate);
    } catch (err) {
      return this.escalation(
        input,
        `planner emitted an invalid amount: ${errMessage(err)}`,
        [],
        modelUsed,
        inferenceCallId,
      );
    }

    // The model itself asked to hand off.
    if (parsed.escalate) {
      const deferred = candidates.map<SpawnDecision>((c) => ({
        ...c,
        decision: "deferred",
        rejectionReason: "planner requested HITL escalation",
      }));
      return {
        approved: [],
        entry: this.buildEntry(input, deferred, modelUsed, inferenceCallId),
        escalateToHITL: true,
        hitlReason: parsed.escalateReason ?? "planner requested HITL escalation",
      };
    }

    // Runtime guard: greedily approve candidates that still fit the bounds.
    const { bounds, state, bucket } = input;
    let usedCount = state.subMandateCount;
    let usedBudget = state.aggregateSubMandateBudget;
    let usedTokens = 0;

    const decisions: SpawnDecision[] = [];
    const approved: SpawnDecision[] = [];

    for (const c of candidates) {
      const reason = guardReject(c, {
        usedCount,
        usedBudget,
        usedTokens,
        maxSubMandates: bounds.maxSubMandates,
        maxAggregateBudget: bounds.maxAggregateBudget,
        tokensAvailable: bucket.available,
      });
      if (reason) {
        decisions.push({ ...c, decision: "rejected", rejectionReason: reason });
        continue;
      }
      const decision: SpawnDecision = { ...c, decision: "spawned" };
      decisions.push(decision);
      approved.push(decision);
      usedCount += 1;
      usedBudget += c.proposedCaveats.spendCapTotal;
      usedTokens += 1;
    }

    // The model proposed work but the bounds blocked all of it → hand off.
    const blockedAll = candidates.length > 0 && approved.length === 0;
    const result: PlanResult = {
      approved,
      entry: this.buildEntry(input, decisions, modelUsed, inferenceCallId),
      escalateToHITL: blockedAll,
    };
    if (blockedAll) {
      result.hitlReason =
        "every proposed sub-agent exceeded the signed CAP_REDELEGATE bounds or the rate-limit bucket";
    }
    return result;
  }

  private escalation(
    input: PlanInput,
    reason: string,
    decisions: SpawnDecision[],
    modelUsed: string,
    inferenceCallId: string,
  ): PlanResult {
    return {
      approved: [],
      entry: this.buildEntry(input, decisions, modelUsed, inferenceCallId),
      escalateToHITL: true,
      hitlReason: reason,
    };
  }

  private buildEntry(
    input: PlanInput,
    decisions: SpawnDecision[],
    modelUsed: string,
    inferenceCallId: string,
  ): PlanningEntry {
    return {
      timestamp: this.now(),
      sessionId: input.spec.sessionId,
      parentMandateId: input.spec.rootMandateId,
      triggerEvent: input.trigger,
      candidatesConsidered: decisions,
      spawnedSubMandateIds: [],
      promptTemplate: PLANNING_PROMPT_VERSION,
      modelUsed,
      inferenceCallId,
    };
  }
}

interface GuardState {
  usedCount: number;
  usedBudget: bigint;
  usedTokens: number;
  maxSubMandates: number;
  maxAggregateBudget: bigint;
  tokensAvailable: number;
}

/** Returns a rejection reason, or `null` if the candidate fits. */
function guardReject(c: SpawnCandidate, s: GuardState): string | null {
  if (s.usedCount + 1 > s.maxSubMandates) {
    return "max sub-mandate count reached";
  }
  if (s.usedBudget + c.proposedCaveats.spendCapTotal > s.maxAggregateBudget) {
    return "aggregate redelegation budget exceeded";
  }
  if (s.tokensAvailable - s.usedTokens < 1) {
    return "rate-limit bucket exhausted";
  }
  return null;
}

function decodeCandidate(
  c: PlannerOutput["candidates"][number],
): SpawnCandidate {
  const proposedCaveats: ProposedCaveats = {
    capabilities: c.capabilities,
    spendCapTotal: BigInt(c.spendCapTotal),
  };
  if (c.spendCapPerCall !== undefined)
    proposedCaveats.spendCapPerCall = BigInt(c.spendCapPerCall);
  if (c.hitlThreshold !== undefined)
    proposedCaveats.hitlThreshold = BigInt(c.hitlThreshold);
  if (c.slippageToleranceBps !== undefined)
    proposedCaveats.slippageToleranceBps = c.slippageToleranceBps;

  return {
    role: c.role,
    proposedCaveats,
    estimatedTokenCost: BigInt(c.estimatedTokenCost),
    reasoning: c.reasoning,
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
