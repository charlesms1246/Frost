import { describe, expect, it } from "vitest";
import {
  CustomAgentRegistry,
  toSpawnCandidate,
  validateDefinition,
  type CustomAgentDefinition,
} from "../src/agents/definition.js";

function def(overrides: Partial<CustomAgentDefinition> = {}): CustomAgentDefinition {
  return {
    role: "eth-dip-buyer",
    description: "Buys ETH on a dip",
    behavior: "executor",
    capabilities: ["CAP_ONCHAIN_EXECUTION"],
    spendCapTotal: 50_000_000n,
    estimatedTokenCost: 0n,
    ...overrides,
  };
}

describe("validateDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(validateDefinition(def())).toEqual([]);
  });

  it("rejects a bad role slug", () => {
    expect(validateDefinition(def({ role: "Bad Role!" }))).toContainEqual(
      expect.stringMatching(/not a valid slug/),
    );
  });

  it("rejects an unknown behavior", () => {
    expect(validateDefinition(def({ behavior: "teleport" as never }))).toContainEqual(
      expect.stringMatching(/unknown behavior/),
    );
  });

  it("rejects an unknown capability", () => {
    expect(
      validateDefinition(def({ capabilities: ["CAP_ONCHAIN_EXECUTION", "CAP_FLY"] })),
    ).toContainEqual(expect.stringMatching(/unknown capability "CAP_FLY"/));
  });

  it("requires the behavior's capability to be present", () => {
    expect(validateDefinition(def({ behavior: "comms", capabilities: ["CAP_RPC_READ"] }))).toContainEqual(
      expect.stringMatching(/requires capability CAP_COMMS_POST/),
    );
  });

  it("rejects a negative spend cap", () => {
    expect(validateDefinition(def({ spendCapTotal: -1n }))).toContainEqual(
      expect.stringMatching(/spendCapTotal must be non-negative/),
    );
  });
});

describe("toSpawnCandidate", () => {
  it("maps to a SpawnCandidate without structural caveats (the enricher adds those)", () => {
    const c = toSpawnCandidate(def({ hitlThreshold: 20_000_000n }));
    expect(c.role).toBe("eth-dip-buyer");
    expect(c.reasoning).toBe("Buys ETH on a dip");
    expect(c.proposedCaveats.capabilities).toEqual(["CAP_ONCHAIN_EXECUTION"]);
    expect(c.proposedCaveats.spendCapTotal).toBe(50_000_000n);
    expect(c.proposedCaveats.hitlThreshold).toBe(20_000_000n);
    // Structural caveats are NOT set here.
    expect(c.proposedCaveats.callableSurface).toBeUndefined();
    expect(c.proposedCaveats.commsTemplate).toBeUndefined();
    expect(c.proposedCaveats.providerWhitelist).toBeUndefined();
    expect(c.proposedCaveats.ttlExpiry).toBeUndefined();
  });

  it("omits hitlThreshold when the definition has none", () => {
    expect(toSpawnCandidate(def()).proposedCaveats.hitlThreshold).toBeUndefined();
  });
});

describe("CustomAgentRegistry", () => {
  it("registers, gets, has, and lists valid definitions", () => {
    const reg = new CustomAgentRegistry();
    reg.register(def());
    expect(reg.has("eth-dip-buyer")).toBe(true);
    expect(reg.get("eth-dip-buyer")?.behavior).toBe("executor");
    expect(reg.list()).toHaveLength(1);
  });

  it("rejects an invalid definition on register", () => {
    const reg = new CustomAgentRegistry();
    expect(() => reg.register(def({ capabilities: ["CAP_RPC_READ"], behavior: "comms" }))).toThrow(
      /invalid custom agent/,
    );
  });
});
