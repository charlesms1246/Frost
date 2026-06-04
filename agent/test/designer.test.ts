import { describe, expect, it } from "vitest";
import type { InferenceTransport } from "../src/inference/openrouter.js";
import { PARANOID_DEFAULTS } from "../src/compile/defaults.js";
import { AgentDesigner } from "../src/agents/designer.js";

function transport(text: string): InferenceTransport {
  return {
    async complete() {
      return { text, model: "test-model", id: "gen-1" };
    },
  };
}

function designer(text: string): AgentDesigner {
  return new AgentDesigner({ transport: transport(text), model: "test-model" });
}

describe("AgentDesigner (LLM proposes, runtime disposes)", () => {
  it("builds a value-moving executor agent from a clear description", async () => {
    const res = await designer(
      JSON.stringify({
        role: "eth-dip-buyer",
        description: "Buys ETH when the price dips",
        behavior: "executor",
        capabilities: ["CAP_ONCHAIN_EXECUTION"],
        spendCapTotal: "50000000",
        hitlThreshold: "20000000",
      }),
    ).design({ description: "buy eth on dips" });

    expect(res.escalateToHITL).toBe(false);
    expect(res.readyToUse).toBe(true);
    expect(res.definition.role).toBe("eth-dip-buyer");
    expect(res.definition.behavior).toBe("executor");
    expect(res.definition.capabilities).toEqual(["CAP_ONCHAIN_EXECUTION"]);
    expect(res.definition.spendCapTotal).toBe(50_000_000n);
    expect(res.definition.hitlThreshold).toBe(20_000_000n);
  });

  it("applies a paranoid spend default — but not as an assumption for a read-only agent", async () => {
    const res = await designer(
      JSON.stringify({
        role: "lp-watcher",
        description: "watch my LP position",
        behavior: "monitor",
        capabilities: ["CAP_RPC_READ"],
      }),
    ).design({ description: "watch my LP" });

    expect(res.definition.spendCapTotal).toBe(PARANOID_DEFAULTS.spendCapTotal);
    expect(res.definition.hitlThreshold).toBeUndefined();
    expect(res.assumptions.find((a) => a.field === "spendCapTotal")).toBeUndefined();
    expect(res.readyToUse).toBe(true);
  });

  it("strips CAP_REDELEGATE (a specialist is a leaf) with a warning", async () => {
    const res = await designer(
      JSON.stringify({
        role: "executor-x",
        behavior: "executor",
        capabilities: ["CAP_ONCHAIN_EXECUTION", "CAP_REDELEGATE"],
        spendCapTotal: "10000000",
      }),
    ).design({ description: "x" });

    expect(res.definition.capabilities).not.toContain("CAP_REDELEGATE");
    expect(res.warnings.some((w) => /CAP_REDELEGATE/.test(w))).toBe(true);
  });

  it("guarantees the behavior's required capability, recording an assumption", async () => {
    const res = await designer(
      JSON.stringify({ role: "notifier", behavior: "comms", capabilities: [] }),
    ).design({ description: "post to discord" });

    expect(res.definition.capabilities).toContain("CAP_COMMS_POST");
    expect(res.assumptions.some((a) => a.field === "capabilities")).toBe(true);
  });

  it("slugifies a messy role name", async () => {
    const res = await designer(
      JSON.stringify({ role: "ETH Dip Buyer!!", behavior: "monitor", capabilities: ["CAP_RPC_READ"] }),
    ).design({ description: "x" });
    expect(res.definition.role).toBe("eth-dip-buyer");
  });

  it("escalates on unparseable output", async () => {
    const res = await designer("not json at all").design({ description: "x" });
    expect(res.escalateToHITL).toBe(true);
    expect(res.hitlReason).toMatch(/not parseable/);
  });

  it("escalates when the model asks to", async () => {
    const res = await designer(
      JSON.stringify({ escalate: true, escalateReason: "asks to move all funds with no cap" }),
    ).design({ description: "drain everything" });
    expect(res.escalateToHITL).toBe(true);
    expect(res.hitlReason).toMatch(/move all funds/);
  });

  it("escalates on an unknown behavior (no safe default to route)", async () => {
    const res = await designer(
      JSON.stringify({ role: "x", behavior: "teleport", capabilities: ["CAP_RPC_READ"] }),
    ).design({ description: "x" });
    expect(res.escalateToHITL).toBe(true);
    expect(res.hitlReason).toMatch(/valid behavior/);
  });

  it("surfaces a model-flagged missing field as a clarification, resolved by an answer", async () => {
    const output = JSON.stringify({
      role: "notifier",
      behavior: "comms",
      capabilities: ["CAP_COMMS_POST"],
      missing: [{ field: "webhookUrl", question: "Which Discord webhook?", reason: "comms needs a channel" }],
    });
    const open = await designer(output).design({ description: "notify me" });
    expect(open.readyToUse).toBe(false);
    expect(open.clarifications.map((c) => c.field)).toContain("webhookUrl");

    const answered = await designer(output).design({
      description: "notify me",
      answers: { webhookUrl: "https://discord.com/api/webhooks/1/abc" },
    });
    expect(answered.readyToUse).toBe(true);
    expect(answered.clarifications).toHaveLength(0);
  });
});
