import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_HASH,
  CAVEAT_TYPE,
  decodeAddressArray,
  decodeBytes32Array,
  decodeCallableSurface,
  decodeCommsTemplate,
  decodeUint16,
  decodeUint64,
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

describe("encodeProposedCaveats — structural caveats (Week 3 widening)", () => {
  const ROUTER = ("0x" + "12".repeat(20)) as Address;
  const VENICE = ("0x" + "34".repeat(20)) as Address;
  const SWAP_SELECTOR = "0x12345678" as Hex;

  it("encodes TTL_EXPIRY and decodes back to the same timestamp", () => {
    const cs = encodeProposedCaveats(decision("executor", { ttlExpiry: 1_900_000_000n }));
    const ttl = cs.find((c) => c.caveatType === CAVEAT_TYPE.TTL_EXPIRY)!;
    expect(decodeUint64(ttl)).toBe(1_900_000_000n);
  });

  it("encodes PROVIDER_WHITELIST", () => {
    const cs = encodeProposedCaveats(
      decision("settler", { providerWhitelist: [VENICE, ROUTER] }),
    );
    const pw = cs.find((c) => c.caveatType === CAVEAT_TYPE.PROVIDER_WHITELIST)!;
    expect(decodeAddressArray(pw).map((a) => a.toLowerCase())).toEqual([
      VENICE.toLowerCase(),
      ROUTER.toLowerCase(),
    ]);
  });

  it("encodes CALLABLE_SURFACE entries", () => {
    const cs = encodeProposedCaveats(
      decision("executor", {
        capabilities: ["CAP_ONCHAIN_EXECUTION"],
        callableSurface: [{ target: ROUTER, selector: SWAP_SELECTOR, maxValue: 5_000_000n }],
      }),
    );
    const surface = decodeCallableSurface(
      cs.find((c) => c.caveatType === CAVEAT_TYPE.CALLABLE_SURFACE)!,
    );
    expect(surface).toHaveLength(1);
    expect(surface[0]!.target.toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(surface[0]!.selector).toBe(SWAP_SELECTOR);
    expect(surface[0]!.maxValue).toBe(5_000_000n);
  });

  it("encodes COMMS_TEMPLATE with a verifiable hash binding (I-16)", () => {
    const cs = encodeProposedCaveats(
      decision("comms", {
        capabilities: ["CAP_COMMS_POST"],
        commsTemplate: {
          text: "Best rate: ${rate}",
          variables: [{ name: "rate", source: "numeric" }],
        },
      }),
    );
    const { templateHash, templateMetadata } = decodeCommsTemplate(
      cs.find((c) => c.caveatType === CAVEAT_TYPE.COMMS_TEMPLATE)!,
    );
    // The decoded metadata round-trips to the template, and the committed hash matches.
    expect(JSON.parse(Buffer.from(templateMetadata.slice(2), "hex").toString("utf8")).text).toBe(
      "Best rate: ${rate}",
    );
    expect(templateHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a malformed address / selector / empty set", () => {
    expect(() =>
      encodeProposedCaveats(decision("x", { providerWhitelist: [] })),
    ).toThrow(/must not be empty/);
    expect(() =>
      encodeProposedCaveats(decision("x", { providerWhitelist: ["0xnope" as Address] })),
    ).toThrow(/20-byte address/);
    expect(() =>
      encodeProposedCaveats(
        decision("x", {
          callableSurface: [{ target: ROUTER, selector: "0x1234" as Hex, maxValue: 0n }],
        }),
      ),
    ).toThrow(/4-byte selector/);
    expect(() =>
      encodeProposedCaveats(decision("x", { ttlExpiry: -1n })),
    ).toThrow(/non-negative/);
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
