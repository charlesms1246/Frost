import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_HASH,
  CAVEAT_TYPE,
  decodeBytes32Array,
  decodeUint16,
  decodeUint256,
  type Caveat,
} from "@frost/sdk";
import type { PlanResult, ProposedCaveats, SpawnDecision } from "../src/types.js";
import {
  defaultCaveatEncoder,
  encodeProposedCaveats,
} from "../src/translate/caveat-encoder.js";
import {
  nonceCounter,
  translatePlan,
  type SubMandateIssuer,
} from "../src/translate/translate.js";

function decision(
  role: string,
  pc: Partial<ProposedCaveats> = {},
): SpawnDecision {
  return {
    role,
    proposedCaveats: {
      capabilities: ["CAP_RPC_READ"],
      spendCapTotal: 1_000_000n,
      ...pc,
    },
    estimatedTokenCost: 0n,
    reasoning: "",
    decision: "spawned",
  };
}

describe("encodeProposedCaveats", () => {
  it("encodes the minimal pair (capabilities + spendCapTotal)", () => {
    const cs = encodeProposedCaveats(
      decision("pricer-uniswap", {
        capabilities: ["CAP_RPC_READ"],
        spendCapTotal: 5_000_000n,
      }),
    );

    expect(cs.map((c) => c.caveatType)).toEqual([
      CAVEAT_TYPE.CAPABILITY_WHITELIST,
      CAVEAT_TYPE.SPEND_CAP_TOTAL,
    ]);
    expect(decodeBytes32Array(cs[0]!)).toEqual([CAPABILITY_HASH.RPC_READ]);
    expect(decodeUint256(cs[1]!)).toBe(5_000_000n);
  });

  it("encodes every optional field in a stable order", () => {
    const cs = encodeProposedCaveats(
      decision("executor", {
        capabilities: ["CAP_ONCHAIN_EXECUTION"],
        spendCapTotal: 10_000_000n,
        spendCapPerCall: 2_000_000n,
        hitlThreshold: 5_000_000n,
        slippageToleranceBps: 50,
      }),
    );

    expect(cs.map((c) => c.caveatType)).toEqual([
      CAVEAT_TYPE.CAPABILITY_WHITELIST,
      CAVEAT_TYPE.SPEND_CAP_TOTAL,
      CAVEAT_TYPE.SPEND_CAP_PER_CALL,
      CAVEAT_TYPE.HITL_THRESHOLD,
      CAVEAT_TYPE.SLIPPAGE_TOLERANCE,
    ]);
    expect(decodeUint256(cs[2]!)).toBe(2_000_000n);
    expect(decodeUint256(cs[3]!)).toBe(5_000_000n);
    expect(decodeUint16(cs[4]!)).toBe(50);
  });

  it("accepts a pre-hashed bytes32 capability verbatim", () => {
    const hexCap = ("0x" + "ab".repeat(32)) as Hex;
    const cs = encodeProposedCaveats(
      decision("custom", { capabilities: [hexCap] }),
    );
    expect(decodeBytes32Array(cs[0]!)).toEqual([hexCap]);
  });

  it("throws on an unknown capability name", () => {
    expect(() =>
      encodeProposedCaveats(decision("x", { capabilities: ["CAP_BOGUS"] })),
    ).toThrow(/unknown capability/);
  });

  it("throws when a decision has no capabilities", () => {
    expect(() =>
      encodeProposedCaveats(decision("x", { capabilities: [] })),
    ).toThrow(/no capabilities/);
  });

  it("throws on a negative spend cap", () => {
    expect(() =>
      encodeProposedCaveats(decision("x", { spendCapTotal: -1n })),
    ).toThrow(/non-negative/);
  });

  it("throws on out-of-range or non-integer slippage", () => {
    expect(() =>
      encodeProposedCaveats(decision("x", { slippageToleranceBps: 70_000 })),
    ).toThrow(/slippageToleranceBps/);
    expect(() =>
      encodeProposedCaveats(decision("x", { slippageToleranceBps: 1.5 })),
    ).toThrow(/slippageToleranceBps/);
  });
});

describe("defaultCaveatEncoder composed through translatePlan", () => {
  it("feeds real encoded caveats to the issuer", async () => {
    const seen: Array<readonly Caveat[]> = [];
    const issue: SubMandateIssuer = async (p) => {
      seen.push(p.caveats);
      return {
        mandateId: ("0x" + "11".repeat(32)) as Hex,
        txHash: ("0x" + "22".repeat(32)) as Hex,
      };
    };

    const plan: PlanResult = {
      approved: [
        decision("comms", {
          capabilities: ["CAP_COMMS_POST"],
          spendCapTotal: 1_000_000n,
        }),
      ],
      escalateToHITL: false,
      entry: {
        timestamp: 1,
        sessionId: ("0x" + "00".repeat(32)) as Hex,
        parentMandateId: ("0x" + "33".repeat(32)) as Hex,
        triggerEvent: { kind: "session-start" },
        candidatesConsidered: [],
        spawnedSubMandateIds: [],
        promptTemplate: "frost-planner-v1",
        modelUsed: "m",
        inferenceCallId: "i",
      },
    };

    const result = await translatePlan(plan, {
      issue,
      encodeCaveats: defaultCaveatEncoder,
      provisionHolder: async () => ("0x" + "44".repeat(20)) as Address,
      nextNonce: nonceCounter(0n),
    });

    expect(result.outcomes[0]?.status).toBe("issued");
    expect(seen[0]?.map((c) => c.caveatType)).toEqual([
      CAVEAT_TYPE.CAPABILITY_WHITELIST,
      CAVEAT_TYPE.SPEND_CAP_TOTAL,
    ]);
    expect(decodeBytes32Array(seen[0]![0]!)).toEqual([CAPABILITY_HASH.COMMS_POST]);
  });
});
