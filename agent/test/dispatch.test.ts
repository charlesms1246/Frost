import { describe, expect, it } from "vitest";
import { resolveBehavior } from "../src/session/dispatch.js";
import { CustomAgentRegistry } from "../src/agents/definition.js";

describe("resolveBehavior", () => {
  it("maps built-in role labels by prefix", () => {
    expect(resolveBehavior("pricer-uniswap")).toBe("pricer");
    expect(resolveBehavior("pricer")).toBe("pricer");
    expect(resolveBehavior("monitor")).toBe("monitor");
    expect(resolveBehavior("executor")).toBe("executor");
    expect(resolveBehavior("comms")).toBe("comms");
    expect(resolveBehavior("inference")).toBe("inference");
  });

  it("returns undefined for an unknown role with no runtime", () => {
    expect(resolveBehavior("teleporter")).toBeUndefined();
  });

  it("prefers a registered custom agent's explicit behavior", () => {
    const reg = new CustomAgentRegistry();
    reg.register({
      role: "eth-dip-buyer",
      description: "buys dips",
      behavior: "executor",
      capabilities: ["CAP_ONCHAIN_EXECUTION"],
      spendCapTotal: 10_000_000n,
      estimatedTokenCost: 0n,
    });
    expect(resolveBehavior("eth-dip-buyer", reg)).toBe("executor");
    // Unregistered custom-looking role still falls through to undefined.
    expect(resolveBehavior("lp-guardian", reg)).toBeUndefined();
  });
});
