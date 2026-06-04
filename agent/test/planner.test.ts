import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import type { InferenceTransport } from "../src/inference/openrouter.js";
import { Planner, type PlanInput } from "../src/planner/planner.js";
import { PLANNING_PROMPT_VERSION } from "../src/planner/prompt.js";

const SESSION_ID = ("0x" + "11".repeat(32)) as Hex;
const ROOT_MANDATE = ("0x" + "22".repeat(32)) as Hex;
const FIXED_NOW = 1_700_000_000;

function transportReturning(
  text: string,
  opts: { id?: string; model?: string } = {},
): InferenceTransport {
  return {
    complete: async () => ({
      text,
      model: opts.model ?? "test-model",
      id: opts.id ?? "gen-1",
    }),
  };
}

function transportThrowing(err: Error): InferenceTransport {
  return {
    complete: async () => {
      throw err;
    },
  };
}

function makePlanner(transport: InferenceTransport): Planner {
  return new Planner({ transport, model: "plan-model", now: () => FIXED_NOW });
}

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    spec: {
      sessionId: SESSION_ID,
      rootMandateId: ROOT_MANDATE,
      description: "If ETH < $2800, swap 30% to USDC on the best Base DEX",
      redelegationBounds: { maxSubMandates: 8, maxAggregateBudget: 50_000_000n },
    },
    trigger: { kind: "condition-fired" },
    bounds: { maxSubMandates: 8, maxAggregateBudget: 50_000_000n },
    state: { subMandateCount: 0, aggregateSubMandateBudget: 0n },
    bucket: { available: 33, capacity: 33 },
    ...overrides,
  };
}

function pricer(role: string, spendCapTotal: string) {
  return {
    role,
    capabilities: ["CAP_RPC_READ"],
    spendCapTotal,
    estimatedTokenCost: "100000",
    reasoning: `fetch quote from ${role}`,
  };
}

function plannerJson(body: {
  escalate: boolean;
  escalateReason?: string;
  candidates: unknown[];
}): string {
  return JSON.stringify(body);
}

describe("Planner — happy path", () => {
  it("spawns every candidate that fits the bounds", async () => {
    const transport = transportReturning(
      plannerJson({
        escalate: false,
        candidates: [
          pricer("pricer-uniswap", "1000000"),
          pricer("pricer-1inch", "1000000"),
          pricer("pricer-paraswap", "1000000"),
        ],
      }),
    );
    const result = await makePlanner(transport).plan(baseInput());

    expect(result.escalateToHITL).toBe(false);
    expect(result.approved.map((d) => d.role)).toEqual([
      "pricer-uniswap",
      "pricer-1inch",
      "pricer-paraswap",
    ]);
    expect(result.approved.every((d) => d.decision === "spawned")).toBe(true);
    expect(result.approved[0]?.proposedCaveats.spendCapTotal).toBe(1_000_000n);
  });

  it("produces a well-formed PlanningEntry", async () => {
    const transport = transportReturning(
      plannerJson({ escalate: false, candidates: [pricer("pricer-uniswap", "1000000")] }),
      { id: "gen-xyz", model: "anthropic/claude-3.5-sonnet" },
    );
    const { entry } = await makePlanner(transport).plan(baseInput());

    expect(entry.timestamp).toBe(FIXED_NOW);
    expect(entry.sessionId).toBe(SESSION_ID);
    expect(entry.parentMandateId).toBe(ROOT_MANDATE);
    expect(entry.triggerEvent.kind).toBe("condition-fired");
    expect(entry.promptTemplate).toBe(PLANNING_PROMPT_VERSION);
    expect(entry.modelUsed).toBe("anthropic/claude-3.5-sonnet");
    expect(entry.inferenceCallId).toBe("gen-xyz");
    expect(entry.spawnedSubMandateIds).toEqual([]);
    expect(entry.candidatesConsidered).toHaveLength(1);
  });
});

describe("Planner — runtime guards (never trust the LLM)", () => {
  it("rejects candidates past maxSubMandates", async () => {
    const transport = transportReturning(
      plannerJson({
        escalate: false,
        candidates: [
          pricer("a", "1000000"),
          pricer("b", "1000000"),
          pricer("c", "1000000"),
        ],
      }),
    );
    const result = await makePlanner(transport).plan(
      baseInput({ bounds: { maxSubMandates: 2, maxAggregateBudget: 50_000_000n } }),
    );

    expect(result.approved).toHaveLength(2);
    const last = result.entry.candidatesConsidered[2];
    expect(last?.decision).toBe("rejected");
    expect(last?.rejectionReason).toMatch(/max sub-mandate count/);
  });

  it("rejects candidates that bust the aggregate budget", async () => {
    const transport = transportReturning(
      plannerJson({
        escalate: false,
        candidates: [pricer("a", "1000000"), pricer("b", "1000000")],
      }),
    );
    const result = await makePlanner(transport).plan(
      baseInput({ bounds: { maxSubMandates: 8, maxAggregateBudget: 1_500_000n } }),
    );

    expect(result.approved.map((d) => d.role)).toEqual(["a"]);
    const second = result.entry.candidatesConsidered[1];
    expect(second?.decision).toBe("rejected");
    expect(second?.rejectionReason).toMatch(/aggregate redelegation budget/);
  });

  it("rejects candidates once the rate-limit bucket is empty", async () => {
    const transport = transportReturning(
      plannerJson({
        escalate: false,
        candidates: [pricer("a", "1000000"), pricer("b", "1000000")],
      }),
    );
    const result = await makePlanner(transport).plan(
      baseInput({ bucket: { available: 1, capacity: 33 } }),
    );

    expect(result.approved.map((d) => d.role)).toEqual(["a"]);
    expect(result.entry.candidatesConsidered[1]?.rejectionReason).toMatch(
      /rate-limit bucket/,
    );
  });

  it("accounts for budget already consumed by earlier cycles", async () => {
    const transport = transportReturning(
      plannerJson({ escalate: false, candidates: [pricer("a", "1000000")] }),
    );
    const result = await makePlanner(transport).plan(
      baseInput({
        bounds: { maxSubMandates: 8, maxAggregateBudget: 1_500_000n },
        state: { subMandateCount: 1, aggregateSubMandateBudget: 1_000_000n },
      }),
    );

    // 1_000_000 already used + 1_000_000 requested = 2_000_000 > 1_500_000 cap.
    expect(result.approved).toHaveLength(0);
    expect(result.escalateToHITL).toBe(true);
    expect(result.hitlReason).toMatch(/CAP_REDELEGATE bounds/);
  });
});

describe("Planner — T-35 graceful escalation", () => {
  it("escalates when the model asks to", async () => {
    const transport = transportReturning(
      plannerJson({
        escalate: true,
        escalateReason: "workflow is ambiguous",
        candidates: [],
      }),
    );
    const result = await makePlanner(transport).plan(baseInput());

    expect(result.escalateToHITL).toBe(true);
    expect(result.hitlReason).toBe("workflow is ambiguous");
    expect(result.approved).toHaveLength(0);
  });

  it("escalates (no throw) on unparseable output", async () => {
    const transport = transportReturning("not json at all {{{");
    const result = await makePlanner(transport).plan(baseInput());

    expect(result.escalateToHITL).toBe(true);
    expect(result.hitlReason).toMatch(/parseable/);
    expect(result.approved).toHaveLength(0);
    // Inference succeeded, so the cross-reference is still recorded.
    expect(result.entry.inferenceCallId).toBe("gen-1");
  });

  it("escalates when the inference call fails", async () => {
    const transport = transportThrowing(new Error("boom"));
    const result = await makePlanner(transport).plan(baseInput());

    expect(result.escalateToHITL).toBe(true);
    expect(result.hitlReason).toMatch(/inference call failed.*boom/);
    expect(result.entry.modelUsed).toBe("plan-model");
    expect(result.entry.inferenceCallId).toBe("");
  });

  it("escalates on an invalid amount string", async () => {
    const transport = transportReturning(
      plannerJson({ escalate: false, candidates: [pricer("a", "not-a-number")] }),
    );
    const result = await makePlanner(transport).plan(baseInput());

    expect(result.escalateToHITL).toBe(true);
    expect(result.hitlReason).toMatch(/invalid amount/);
  });

  it("treats an empty no-op plan as success, not escalation", async () => {
    const transport = transportReturning(
      plannerJson({ escalate: false, candidates: [] }),
    );
    const result = await makePlanner(transport).plan(baseInput());

    expect(result.escalateToHITL).toBe(false);
    expect(result.approved).toHaveLength(0);
    expect(result.entry.candidatesConsidered).toHaveLength(0);
  });
});
