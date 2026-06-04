import { describe, it, expect } from "vitest";
import { customAgents, fromDefinition, toDefinition } from "./custom-agents.svelte";
import type { CustomAgentDefinition } from "@frost/agent/browser";

const def: CustomAgentDefinition = {
  role: "eth-dip-buyer",
  description: "Buys the dip",
  behavior: "executor",
  capabilities: ["CAP_ONCHAIN_EXECUTION"],
  spendCapTotal: 50_000_000n,
  hitlThreshold: 5_000_000n,
  estimatedTokenCost: 1_000n,
};

describe("custom-agents store", () => {
  it("round-trips bigint caps through string storage", () => {
    const stored = fromDefinition(def);
    expect(stored.spendCapTotal).toBe("50000000");
    expect(stored.hitlThreshold).toBe("5000000");
    const back = toDefinition(stored);
    expect(back.spendCapTotal).toBe(50_000_000n);
    expect(back.hitlThreshold).toBe(5_000_000n);
    expect(back.behavior).toBe("executor");
  });

  it("omits hitlThreshold when absent", () => {
    const { hitlThreshold, ...noHitl } = def;
    void hitlThreshold;
    const stored = fromDefinition(noHitl as CustomAgentDefinition);
    expect(stored.hitlThreshold).toBeUndefined();
    expect(toDefinition(stored).hitlThreshold).toBeUndefined();
  });

  it("save adds/replaces by role and remove deletes", () => {
    customAgents.list.slice().forEach((a) => customAgents.remove(a.role));
    customAgents.save(def);
    expect(customAgents.has("eth-dip-buyer")).toBe(true);
    expect(customAgents.list.length).toBe(1);
    customAgents.save({ ...def, description: "updated" }); // same role → replace
    expect(customAgents.list.length).toBe(1);
    expect(customAgents.list[0].description).toBe("updated");
    customAgents.remove("eth-dip-buyer");
    expect(customAgents.has("eth-dip-buyer")).toBe(false);
  });
});
