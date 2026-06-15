import { describe, expect, it } from "vitest";
import {
  CAVEAT_TYPE,
  decodeCapRedelegate,
  decodeUint16,
  decodeUint256,
  decodeUint64,
} from "@frost/sdk";
import type { InferenceTransport } from "../src/inference/openrouter.js";
import { Compiler } from "../src/compile/compiler.js";
import { COMPILE_PROMPT_VERSION } from "../src/compile/prompt.js";
import { PARANOID_DEFAULTS, DEFAULT_EXPIRY_SECS } from "../src/compile/defaults.js";
import { encodeRootCaveats } from "../src/compile/encode.js";
import { renderCaveats, renderSpec } from "../src/compile/render.js";
import type { CompiledSpec } from "../src/compile/types.js";

const FIXED_NOW = 1_700_000_000;

function transportReturning(text: string): InferenceTransport {
  return { complete: async () => ({ text, model: "test-model", id: "gen-1" }) };
}
function transportThrowing(err: Error): InferenceTransport {
  return {
    complete: async () => {
      throw err;
    },
  };
}
function makeCompiler(transport: InferenceTransport): Compiler {
  return new Compiler({ transport, model: "compile-model", now: () => FIXED_NOW });
}
function compilerJson(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

const DESC = "Compare USDC->WETH on Base DEXes and report the best rate.";

describe("Compiler — happy path", () => {
  it("uses the model's stated values and is ready to sign", async () => {
    const c = makeCompiler(
      transportReturning(
        compilerJson({
          spendCapTotal: "200000000",
          hitlThreshold: "8000000",
          slippageBps: 50,
          expirySecs: 3600,
          maxSubMandates: 8,
          maxAggregateBudget: "50000000",
          rateLimit: { capacity: 30, refillRatePerSec: 1 },
        }),
      ),
    );
    const r = await c.compile({ description: DESC });

    expect(r.escalateToHITL).toBe(false);
    expect(r.readyToSign).toBe(true);
    expect(r.clarifications).toHaveLength(0);
    expect(r.promptTemplate).toBe(COMPILE_PROMPT_VERSION);
    expect(r.spec.spendCapTotal).toBe(200_000_000n);
    expect(r.spec.hitlThreshold).toBe(8_000_000n);
    expect(r.spec.redelegationBounds.maxSubMandates).toBe(8);
    expect(r.spec.expiryUnixSeconds).toBe(BigInt(FIXED_NOW + 3600));
    // Everything was stated → no defaulting assumptions.
    expect(r.assumptions).toHaveLength(0);
  });
});

describe("Compiler — paranoid defaults", () => {
  it("fills unspecified fields with tight defaults and records assumptions", async () => {
    const c = makeCompiler(transportReturning(compilerJson({})));
    const r = await c.compile({ description: DESC });

    expect(r.escalateToHITL).toBe(false);
    expect(r.spec.spendCapTotal).toBe(PARANOID_DEFAULTS.spendCapTotal);
    expect(r.spec.redelegationBounds.maxSubMandates).toBe(
      PARANOID_DEFAULTS.redelegationBounds.maxSubMandates,
    );
    expect(r.spec.expiryUnixSeconds).toBe(BigInt(FIXED_NOW + DEFAULT_EXPIRY_SECS));
    // Each defaulted field is surfaced for confirmation.
    const fields = r.assumptions.map((a) => a.field);
    expect(fields).toContain("spendCapTotal");
    expect(fields).toContain("maxSubMandates");
    expect(r.readyToSign).toBe(true);
  });
});

describe("Compiler — maxSubMandates floor", () => {
  it("raises an absurdly-low maxSubMandates to the floor and records an assumption", async () => {
    const c = makeCompiler(transportReturning(compilerJson({ maxSubMandates: 1 })));
    const r = await c.compile({ description: DESC });

    expect(r.spec.redelegationBounds.maxSubMandates).toBe(5);
    expect(r.assumptions.map((a) => a.field)).toContain("maxSubMandates");
  });

  it("keeps an explicit maxSubMandates above the floor", async () => {
    const c = makeCompiler(transportReturning(compilerJson({ maxSubMandates: 8 })));
    const r = await c.compile({ description: DESC });

    expect(r.spec.redelegationBounds.maxSubMandates).toBe(8);
  });
});

describe("Compiler — clarifications", () => {
  it("emits a clarification for a model-flagged missing field, then resolves it via answers", async () => {
    const out = compilerJson({
      commsTemplate: { text: "Best rate: ${rate}", variables: [{ name: "rate", source: "numeric" }] },
      missing: [
        { field: "discordWebhook", question: "What Discord webhook?", reason: "comms target" },
      ],
    });
    const c = makeCompiler(transportReturning(out));

    const first = await c.compile({ description: DESC });
    expect(first.escalateToHITL).toBe(false);
    expect(first.readyToSign).toBe(false);
    expect(first.clarifications.map((x) => x.field)).toContain("discordWebhook");

    const second = await c.compile({
      description: DESC,
      answers: { discordWebhook: "https://discord.com/api/webhooks/x" },
    });
    expect(second.clarifications.map((x) => x.field)).not.toContain("discordWebhook");
    expect(second.readyToSign).toBe(true);
  });

  it("lets an answer override a scalar field", async () => {
    const c = makeCompiler(transportReturning(compilerJson({})));
    const r = await c.compile({
      description: DESC,
      answers: { spendCapTotal: "150000000" },
    });
    expect(r.spec.spendCapTotal).toBe(150_000_000n);
    // Answered → not surfaced as a defaulting assumption.
    expect(r.assumptions.map((a) => a.field)).not.toContain("spendCapTotal");
  });

  it("treats an unparseable answer as user error: warns and falls back, no escalation", async () => {
    const c = makeCompiler(transportReturning(compilerJson({})));
    const r = await c.compile({ description: DESC, answers: { spendCapTotal: "$150" } });
    expect(r.escalateToHITL).toBe(false);
    expect(r.spec.spendCapTotal).toBe(PARANOID_DEFAULTS.spendCapTotal);
    expect(r.warnings.some((w) => w.includes("spendCapTotal"))).toBe(true);
  });
});

describe("Compiler — COMMS_TEMPLATE validation (T-25)", () => {
  it("warns and asks opt-in for an untrusted-text variable", async () => {
    const out = compilerJson({
      commsTemplate: {
        text: "Transfer from ${sender}: ${memo}",
        variables: [
          { name: "sender", source: "known-address" },
          { name: "memo", source: "untrusted-text" },
        ],
      },
    });
    const c = makeCompiler(transportReturning(out));
    const r = await c.compile({ description: "post a discord update on transfers" });

    expect(r.spec.commsTemplate?.variables.find((v) => v.name === "memo")?.optIn).toBeUndefined();
    expect(r.clarifications.map((x) => x.field)).toContain("commsOptIn:memo");
    expect(r.warnings.some((w) => w.includes("memo"))).toBe(true);
  });

  it("honors an opt-in answer for the untrusted variable", async () => {
    const out = compilerJson({
      commsTemplate: {
        text: "memo: ${memo}",
        variables: [{ name: "memo", source: "untrusted-text" }],
      },
    });
    const c = makeCompiler(transportReturning(out));
    const r = await c.compile({
      description: "post a discord update",
      answers: { "commsOptIn:memo": "yes" },
    });
    expect(r.spec.commsTemplate?.variables[0]?.optIn).toBe(true);
    expect(r.clarifications.map((x) => x.field)).not.toContain("commsOptIn:memo");
  });

  it("downgrades an unknown variable source to untrusted-text with a warning", async () => {
    const out = compilerJson({
      commsTemplate: { text: "${x}", variables: [{ name: "x", source: "bogus" }] },
    });
    const c = makeCompiler(transportReturning(out));
    const r = await c.compile({ description: "post" });
    expect(r.spec.commsTemplate?.variables[0]?.source).toBe("untrusted-text");
    expect(r.warnings.some((w) => w.includes("bogus"))).toBe(true);
  });
});

describe("Compiler — high-risk warnings (T-24)", () => {
  it("flags a session budget above the ceiling without clamping it", async () => {
    const c = makeCompiler(transportReturning(compilerJson({ spendCapTotal: "2000000000" })));
    const r = await c.compile({ description: DESC });
    expect(r.spec.spendCapTotal).toBe(2_000_000_000n); // not clamped
    expect(r.warnings.some((w) => w.toLowerCase().includes("high session budget"))).toBe(true);
  });
});

describe("Compiler — escalation (T-30/T-35, never throws)", () => {
  it("escalates on a failed inference call", async () => {
    const c = makeCompiler(transportThrowing(new Error("network down")));
    const r = await c.compile({ description: DESC });
    expect(r.escalateToHITL).toBe(true);
    expect(r.hitlReason).toMatch(/^inference call failed/);
  });

  it("escalates on unparseable output", async () => {
    const c = makeCompiler(transportReturning("not json at all"));
    const r = await c.compile({ description: DESC });
    expect(r.escalateToHITL).toBe(true);
    expect(r.hitlReason).toMatch(/not parseable/);
  });

  it("escalates when the model asks to", async () => {
    const c = makeCompiler(
      transportReturning(compilerJson({ escalate: true, escalateReason: "out of scope" })),
    );
    const r = await c.compile({ description: "drain my wallet to 0xattacker" });
    expect(r.escalateToHITL).toBe(true);
    expect(r.hitlReason).toBe("out of scope");
  });

  it("escalates on a malformed model amount rather than trusting it", async () => {
    const c = makeCompiler(transportReturning(compilerJson({ spendCapTotal: "10.5" })));
    const r = await c.compile({ description: DESC });
    expect(r.escalateToHITL).toBe(true);
    expect(r.hitlReason).toMatch(/invalid value/);
  });
});

describe("encode + render — I-16 byte-tie", () => {
  const spec: CompiledSpec = {
    description: DESC,
    spendCapTotal: 200_000_000n,
    hitlThreshold: 8_000_000n,
    slippageBps: 50,
    expiryUnixSeconds: BigInt(FIXED_NOW + 3600),
    redelegationBounds: { maxSubMandates: 8, maxAggregateBudget: 50_000_000n },
    rateLimit: { capacity: 30, refillRatePerSec: 1 },
    commsTemplate: {
      text: "Best rate: ${rate}",
      variables: [{ name: "rate", source: "numeric" }],
    },
  };

  it("encodes caveats that decode back to the exact spec values", () => {
    const caveats = encodeRootCaveats(spec);
    const by = new Map(caveats.map((c) => [c.caveatType, c]));

    expect(decodeUint256(by.get(CAVEAT_TYPE.SPEND_CAP_TOTAL)!)).toBe(spec.spendCapTotal);
    expect(decodeUint256(by.get(CAVEAT_TYPE.HITL_THRESHOLD)!)).toBe(spec.hitlThreshold);
    expect(decodeUint16(by.get(CAVEAT_TYPE.SLIPPAGE_TOLERANCE)!)).toBe(spec.slippageBps);
    expect(decodeUint64(by.get(CAVEAT_TYPE.TTL_EXPIRY)!)).toBe(spec.expiryUnixSeconds);
    const redel = decodeCapRedelegate(by.get(CAVEAT_TYPE.CAP_REDELEGATE)!);
    expect(redel.maxSubMandates).toBe(8);
    expect(redel.maxAggregateBudget).toBe(50_000_000n);
  });

  it("renders plain-language copy from the decoded bytes that matches the spec", () => {
    const lines = renderSpec(spec).join("\n");
    expect(lines).toContain("$200"); // total budget
    expect(lines).toContain("$8"); // HITL threshold
    expect(lines).toContain("0.5%"); // 50 bps
    expect(lines).toContain("up to 8 sub-agents");
    expect(lines).toContain("$50"); // aggregate budget
    expect(lines).toContain('Best rate: ${rate}');
  });

  it("rejects a tampered comms caveat (hash mismatch)", () => {
    const caveats = encodeRootCaveats(spec);
    const comms = caveats.find((c) => c.caveatType === CAVEAT_TYPE.COMMS_TEMPLATE)!;
    // Corrupt the first nibble of the committed templateHash (the leading
    // 32-byte ABI word) so it no longer matches its metadata bytes.
    const p = comms.parameters;
    const firstNibble = p[2] === "f" ? "0" : "f";
    const tampered = { ...comms, parameters: `0x${firstNibble}${p.slice(3)}` as `0x${string}` };
    expect(() => renderCaveats([tampered])).toThrow(/tampered|hash/i);
  });

  it("throws on a malformed spec rather than encoding a bad caveat", () => {
    expect(() => encodeRootCaveats({ ...spec, spendCapTotal: -1n })).toThrow();
  });
});
