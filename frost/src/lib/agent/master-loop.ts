/**
 * The master-agent multi-turn loop (chat side).
 *
 * The master agent is conversational but AGENTIC: within a single user turn it can
 * call tools, observe results, and react before yielding back to the user. It has:
 *   - read tools (`onchain_read`, `price_quote`, `web_search`, `fetch_url`,
 *     `contract_abi`, `current_time`) to gather live info — no wallet needed; and
 *   - the special `compile` tool (the real {@link Compiler}) to turn the goal into a
 *     signable spec.
 * Execution stays in the Runtime Manager: when the spec is ready-to-sign, the loop
 * returns it so the chat can hand it off to `/runtime` to run (Option B).
 *
 * The thinking transport is a plain `complete()` (no native function-calling), so the
 * tool protocol is a single JSON object per model turn. Everything outward is an
 * injected seam (`infer` / `compile` / `runTool` / `renderSpec`), so it is testable.
 */
import type { CompiledSpec, CompileResult } from "@frost/agent/browser";
import type { ToolResult } from "./master-tools";

export type LoopMessage = { role: "system" | "user" | "assistant"; content: string };

/** The JSON contract the master model emits each turn. */
export type MasterAction = {
  /** Plain-language message shown to the user. */
  say: string;
  /** Tool to call this turn: "compile" or a read-tool name; omit for a final reply. */
  tool?: string;
  /** Arguments for a read tool. */
  args?: Record<string, unknown>;
  /** Workflow sentence — required when `tool` is "compile". */
  workflow?: string;
  /** Answers to prior compile clarifications, keyed by clarification `field`. */
  answers?: Record<string, string>;
};

/** One visible step the chat renders for this turn. */
export type MasterStep =
  | { kind: "say"; text: string }
  | { kind: "compiled"; workflow: string; result: CompileResult; review: string[] }
  | { kind: "tool"; tool: string; summary: string; ok: boolean };

export type MasterDeps = {
  /** Raw model call: returns the assistant's JSON text. */
  infer: (messages: LoopMessage[]) => Promise<string>;
  /** The compile tool (real Compiler). */
  compile: (workflow: string, answers: Record<string, string>) => Promise<CompileResult>;
  /** Byte-tied plain-language review of a compiled spec. */
  renderSpec: (spec: CompiledSpec) => string[];
  /** Dispatch a read tool by name (omit ⇒ no read tools available). */
  runTool?: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  /** Names `runTool` recognizes (so the loop knows a tool call is a read tool). */
  readToolNames?: string[];
  /** Max compile tool-calls per user turn. Default 1. */
  maxCompiles?: number;
  /** Max read-tool calls per user turn. Default 4. */
  maxToolCalls?: number;
};

export type MasterTurnResult = {
  /** Ordered steps to render (assistant messages, tool steps, compile cards). */
  steps: MasterStep[];
  /** Accumulated clarification answers, to carry into the next turn. */
  answers: Record<string, string>;
  /** Present once a spec compiles ready-to-sign — handed off to /runtime to run. */
  ready?: { spec: CompiledSpec; workflow: string; result: CompileResult };
};

/** Tolerant parse: extract the first JSON object; on failure, treat all text as `say`. */
export function parseMasterAction(text: string): MasterAction {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1)) as Partial<MasterAction> & { compile?: boolean };
      const action: MasterAction = { say: typeof obj.say === "string" ? obj.say : "" };
      // `tool` is canonical; tolerate the legacy `compile: true` boolean.
      if (typeof obj.tool === "string" && obj.tool.trim()) action.tool = obj.tool.trim();
      else if (obj.compile === true) action.tool = "compile";
      if (obj.args && typeof obj.args === "object") action.args = obj.args as Record<string, unknown>;
      if (typeof obj.workflow === "string") action.workflow = obj.workflow;
      if (obj.answers && typeof obj.answers === "object") {
        action.answers = Object.fromEntries(Object.entries(obj.answers).map(([k, v]) => [k, String(v)]));
      }
      return action;
    } catch {
      /* fall through to plain-text */
    }
  }
  return { say: trimmed };
}

/** Summarize a compile result as a system observation the model reacts to next turn. */
function compileObservation(result: CompileResult): string {
  if (result.escalateToHITL) {
    return `TOOL compile RESULT: escalated — could not compile safely. reason: ${result.hitlReason ?? "unknown"}. Tell the user plainly and ask for a clearer/safer goal.`;
  }
  const parts: string[] = [`readyToSign=${result.readyToSign}`];
  if (result.clarifications.length > 0) {
    parts.push(
      `OPEN QUESTIONS (ask the user; put their replies in "answers" keyed by field next compile): ` +
        result.clarifications.map((c) => `${c.field}: ${c.question}`).join(" | "),
    );
  }
  if (result.warnings.length > 0) parts.push(`WARNINGS: ${result.warnings.join(" | ")}`);
  if (result.readyToSign) parts.push(`The spec is ready — tell the user they can press "Run on Runtime Manager".`);
  return `TOOL compile RESULT: ${parts.join(". ")}`;
}

/**
 * Run one user turn of the master loop: invoke the model; let it call read tools
 * and/or compile ONCE; collect renderable steps. At most one compile per turn (a
 * second is a sign the model is looping, so it is refused) and at most
 * `maxToolCalls` read tools. The turn always ends with a clear closing message.
 */
export async function runMasterTurn(
  system: string,
  history: LoopMessage[],
  priorAnswers: Record<string, string>,
  deps: MasterDeps,
): Promise<MasterTurnResult> {
  const answers: Record<string, string> = { ...priorAnswers };
  const steps: MasterStep[] = [];
  const observations: LoopMessage[] = [];
  const maxCompiles = deps.maxCompiles ?? 1;
  const maxToolCalls = deps.maxToolCalls ?? 4;
  const readTools = new Set(deps.readToolNames ?? []);
  const maxIters = maxCompiles + maxToolCalls + 2;
  let compiles = 0;
  let toolCalls = 0;
  let ready: MasterTurnResult["ready"];
  let refusedCompile = false;

  for (let i = 0; i < maxIters; i++) {
    const raw = await deps.infer([{ role: "system", content: system }, ...history, ...observations]);
    const action = parseMasterAction(raw);

    const isCompile = action.tool === "compile" && !!action.workflow && action.workflow.trim() !== "";
    const isReadTool = !!action.tool && action.tool !== "compile" && !!deps.runTool && readTools.has(action.tool);
    const willCompile = isCompile && compiles < maxCompiles && !ready;
    const willRunTool = isReadTool && toolCalls < maxToolCalls && !ready;

    // Suppress a "say" that only announces a tool we won't actually run (otherwise
    // the user sees a dangling "Compiling…"/"Checking…" with no result).
    refusedCompile = isCompile && !willCompile;
    const refusedTool = isReadTool && !willRunTool;
    if (action.say.trim() && !refusedCompile && !refusedTool) steps.push({ kind: "say", text: action.say.trim() });
    if (action.answers) Object.assign(answers, action.answers);

    if (willCompile) {
      compiles++;
      const result = await deps.compile(action.workflow as string, answers);
      const review = result.escalateToHITL ? [] : deps.renderSpec(result.spec);
      steps.push({ kind: "compiled", workflow: action.workflow as string, result, review });
      if (!result.escalateToHITL && result.readyToSign) {
        ready = { spec: result.spec, workflow: action.workflow as string, result };
        break;
      }
      // Observation is a USER turn (not system): some providers (Groq) require the
      // final message role to be "user", and the next loop iteration infers again.
      observations.push({ role: "assistant", content: action.say.trim() || "(compiling)" });
      observations.push({ role: "user", content: compileObservation(result) });
      continue;
    }

    if (willRunTool) {
      toolCalls++;
      const res = await (deps.runTool as NonNullable<MasterDeps["runTool"]>)(action.tool as string, action.args ?? {});
      steps.push({ kind: "tool", tool: action.tool as string, summary: res.summary, ok: res.ok });
      observations.push({ role: "assistant", content: action.say.trim() || `(${action.tool})` });
      observations.push({ role: "user", content: `TOOL ${action.tool} RESULT: ${res.observation}` });
      continue;
    }

    break;
  }

  // Always end on a clear message so the turn never dangles.
  const lastIsSay = steps.length > 0 && steps[steps.length - 1].kind === "say";
  if (ready && !lastIsSay) {
    steps.push({
      kind: "say",
      text: 'This workflow is ready — press "Run on Runtime Manager" to run it under signed, revocable limits.',
    });
  } else if (refusedCompile && !ready) {
    steps.push({
      kind: "say",
      text: 'I\'ve drafted the workflow above. Tell me what to adjust, or press "Run on Runtime Manager" to proceed.',
    });
  }

  return ready ? { steps, answers, ready } : { steps, answers };
}
