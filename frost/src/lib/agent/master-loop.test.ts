import { describe, it, expect } from "vitest";
import { runMasterTurn, parseMasterAction, type MasterDeps } from "./master-loop";
import type { CompiledSpec, CompileResult } from "@frost/agent/browser";

const spec = {} as CompiledSpec;

function result(over: Partial<CompileResult>): CompileResult {
  return {
    spec,
    clarifications: [],
    assumptions: [],
    warnings: [],
    readyToSign: true,
    escalateToHITL: false,
    promptTemplate: "v1",
    modelUsed: "test",
    ...over,
  };
}

/** Scripted deps: `infer` returns the next queued JSON; `compile` the next queued result. */
function deps(
  inferQueue: string[],
  compileQueue: CompileResult[],
  over: Partial<MasterDeps> = {},
): MasterDeps & { compileCalls: { wf: string; ans: Record<string, string> }[] } {
  const compileCalls: { wf: string; ans: Record<string, string> }[] = [];
  return {
    infer: async () => inferQueue.shift() ?? '{"say":"(done)"}',
    compile: async (wf, ans) => {
      compileCalls.push({ wf, ans: { ...ans } });
      return compileQueue.shift() ?? result({});
    },
    renderSpec: () => ["you authorize X"],
    compileCalls,
    ...over,
  };
}

describe("parseMasterAction", () => {
  it("parses a tool call", () => {
    const a = parseMasterAction('{"say":"checking","tool":"price_quote","args":{"tokenIn":"0xabc"}}');
    expect(a.say).toBe("checking");
    expect(a.tool).toBe("price_quote");
    expect(a.args).toEqual({ tokenIn: "0xabc" });
  });

  it("tolerates the legacy compile boolean as tool=compile", () => {
    const a = parseMasterAction('{"say":"hi","compile":true,"workflow":"do X"}');
    expect(a.tool).toBe("compile");
    expect(a.workflow).toBe("do X");
  });

  it("extracts JSON embedded in surrounding prose", () => {
    const a = parseMasterAction('Sure!\n{"say":"ok"}\nthanks');
    expect(a.say).toBe("ok");
  });

  it("falls back to treating non-JSON as the say text", () => {
    const a = parseMasterAction("just a plain reply");
    expect(a.say).toBe("just a plain reply");
    expect(a.tool).toBeUndefined();
  });

  it("coerces answer values to strings", () => {
    const a = parseMasterAction('{"say":"x","answers":{"amount":200}}');
    expect(a.answers).toEqual({ amount: "200" });
  });
});

describe("runMasterTurn", () => {
  it("compiles, surfaces clarifications, then reacts and waits (not ready)", async () => {
    const d = deps(
      [
        '{"say":"Setting this up.","compile":true,"workflow":"Compare WETH→USDC and report best to Discord"}',
        '{"say":"Which Discord webhook should I post to?","compile":false}',
      ],
      [result({ readyToSign: false, clarifications: [{ field: "dest", question: "Which channel?", reason: "needed" }] })],
    );
    const res = await runMasterTurn("SYS", [{ role: "user", content: "compare and report" }], {}, d);

    expect(res.steps.map((s) => s.kind)).toEqual(["say", "compiled", "say"]);
    expect(res.ready).toBeUndefined();
    expect(d.compileCalls.length).toBe(1);
  });

  it("returns the ready spec once a compile is ready-to-sign", async () => {
    const d = deps(
      [
        '{"say":"Great.","compile":true,"workflow":"Compare WETH→USDC, report best to Discord #main","answers":{"dest":"main"}}',
        '{"say":"Ready — press Run on Runtime Manager.","compile":false}',
      ],
      [result({ readyToSign: true })],
    );
    const res = await runMasterTurn("SYS", [{ role: "user", content: "use #main" }], {}, d);

    expect(res.ready?.spec).toBe(spec);
    expect(res.ready?.workflow).toContain("Compare WETH");
    expect(res.answers).toEqual({ dest: "main" }); // accumulated from the action
  });

  it("renders an escalation as a compiled step with no review and no ready spec", async () => {
    const d = deps(
      ['{"say":"Let me try.","compile":true,"workflow":"do something vague"}', '{"say":"Could you be more specific?"}'],
      [result({ escalateToHITL: true, readyToSign: false, hitlReason: "too broad" })],
    );
    const res = await runMasterTurn("SYS", [{ role: "user", content: "do stuff" }], {}, d);
    const compiled = res.steps.find((s) => s.kind === "compiled");
    expect(compiled && compiled.kind === "compiled" && compiled.review).toEqual([]);
    expect(res.ready).toBeUndefined();
  });

  it("never exceeds maxCompiles even if the model keeps asking", async () => {
    const d = deps(
      ['{"say":"a","compile":true,"workflow":"w1"}', '{"say":"b","compile":true,"workflow":"w2"}', '{"say":"c","compile":true,"workflow":"w3"}'],
      [result({ readyToSign: false }), result({ readyToSign: false }), result({ readyToSign: false })],
      { maxCompiles: 1 },
    );
    const res = await runMasterTurn("SYS", [{ role: "user", content: "go" }], {}, d);
    expect(d.compileCalls.length).toBe(1);
    // Only one compile card; the refused 2nd compile's filler "say" is suppressed.
    expect(res.steps.filter((s) => s.kind === "compiled").length).toBe(1);
    // The turn still closes on a helpful message, never a dangling "Compiling…".
    const last = res.steps[res.steps.length - 1];
    expect(last.kind === "say" && last.text).toMatch(/adjust|Run on Runtime Manager/);
  });

  it("appends a ready-to-run closing when the model ends on the compile card", async () => {
    const d = deps(['{"say":"Setting up.","compile":true,"workflow":"post WETH/USD to Discord"}'], [result({ readyToSign: true })]);
    const res = await runMasterTurn("SYS", [{ role: "user", content: "go" }], {}, d);
    const last = res.steps[res.steps.length - 1];
    expect(last.kind).toBe("say");
    expect(last.kind === "say" && last.text).toContain("Run on Runtime Manager");
    expect(res.ready).toBeDefined();
  });

  it("runs a read tool, observes its result, then replies", async () => {
    const inferQueue = ['{"say":"Let me check the price.","tool":"price_quote","args":{}}', '{"say":"Best quote is ~2,413 USDC."}'];
    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
    const res = await runMasterTurn("SYS", [{ role: "user", content: "price?" }], {}, {
      infer: async () => inferQueue.shift() ?? '{"say":"(done)"}',
      compile: async () => result({}),
      renderSpec: () => [],
      runTool: async (name, args) => {
        toolCalls.push({ name, args });
        return { ok: true, summary: "best uni-v3: 2413", observation: "best quote 2413" };
      },
      readToolNames: ["price_quote"],
    });
    expect(toolCalls).toEqual([{ name: "price_quote", args: {} }]);
    expect(res.steps.map((s) => s.kind)).toEqual(["say", "tool", "say"]);
  });

  it("treats an unknown tool as a final reply (no dispatch)", async () => {
    let called = 0;
    const res = await runMasterTurn("SYS", [{ role: "user", content: "hi" }], {}, {
      infer: async () => '{"say":"hello","tool":"does_not_exist"}',
      compile: async () => result({}),
      renderSpec: () => [],
      runTool: async () => {
        called++;
        return { ok: true, summary: "x", observation: "x" };
      },
      readToolNames: ["price_quote"],
    });
    expect(called).toBe(0);
    expect(res.steps).toEqual([{ kind: "say", text: "hello" }]);
  });

  it("caps read-tool calls per turn", async () => {
    let calls = 0;
    await runMasterTurn("SYS", [{ role: "user", content: "go" }], {}, {
      infer: async () => '{"say":"again","tool":"price_quote","args":{}}',
      compile: async () => result({}),
      renderSpec: () => [],
      runTool: async () => {
        calls++;
        return { ok: true, summary: "q", observation: "q" };
      },
      readToolNames: ["price_quote"],
      maxToolCalls: 2,
    });
    expect(calls).toBe(2);
  });
});
