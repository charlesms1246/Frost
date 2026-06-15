import { formatUnits } from "viem";
import type { InferenceTransport } from "../inference/openrouter.js";
import {
  DEFAULT_EXPIRY_SECS,
  HIGH_RISK_CEILINGS,
  PARANOID_DEFAULTS,
} from "./defaults.js";
import {
  buildCompilePrompt,
  COMPILE_PROMPT_VERSION,
  parseCompilerOutput,
  type CompilerOutput,
} from "./prompt.js";
import {
  VARIABLE_SOURCES,
  type Assumption,
  type Clarification,
  type CommsTemplate,
  type CommsVariable,
  type CompiledSpec,
  type CompileInput,
  type CompileResult,
  type VariableSource,
} from "./types.js";

export interface CompilerConfig {
  transport: InferenceTransport;
  /** Model id passed to the transport. */
  model: string;
  /** Injectable clock (unix seconds) for deterministic tests. */
  now?: () => number;
}

/**
 * The master-agent compilation pipeline: natural-language workflow → structured,
 * signable {@link CompiledSpec}, plus the clarifications / assumptions / warnings
 * the user reviews before signing.
 *
 * Like the planner, the LLM PROPOSES and the runtime DISPOSES: the model fills
 * what it can from the (untrusted) description; deterministic code here applies
 * paranoid defaults, never lets a missing field become unlimited authority,
 * validates the comms template (T-25), and flags high-risk shapes (T-24). Bad
 * model output escalates to HITL — it never throws and never produces a guessed
 * spec the user might sign blind (T-30/T-35).
 */
export class Compiler {
  private readonly transport: InferenceTransport;
  private readonly model: string;
  private readonly now: () => number;

  constructor(config: CompilerConfig) {
    this.transport = config.transport;
    this.model = config.model;
    this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async compile(input: CompileInput): Promise<CompileResult> {
    const messages = buildCompilePrompt(input);

    let text: string;
    let modelUsed = this.model;
    try {
      const res = await this.transport.complete({
        model: this.model,
        messages,
        temperature: 0,
        json: true,
      });
      text = res.text;
      modelUsed = res.model;
    } catch (err) {
      return this.escalation(input, `inference call failed: ${errMessage(err)}`, modelUsed);
    }

    const parsed = parseCompilerOutput(text);
    if (parsed === null) {
      return this.escalation(
        input,
        "compiler output was not parseable JSON in the expected shape",
        modelUsed,
      );
    }
    if (parsed.escalate) {
      return this.escalation(
        input,
        parsed.escalateReason ?? "compiler requested HITL escalation",
        modelUsed,
      );
    }

    // Never trust the model's arithmetic: a malformed model amount escalates.
    let m: ModelValues;
    try {
      m = decodeModelValues(parsed);
    } catch (err) {
      return this.escalation(
        input,
        `compiler emitted an invalid value: ${errMessage(err)}`,
        modelUsed,
      );
    }

    const answers = input.answers ?? {};
    const assumptions: Assumption[] = [];
    const clarifications: Clarification[] = [];
    const warnings: string[] = [];
    const missingSet = new Set(
      (parsed.missing ?? [])
        .map((x) => (typeof x?.field === "string" ? x.field : undefined))
        .filter((x): x is string => x !== undefined),
    );

    /** answer > model > paranoid default (recording an assumption for the default). */
    const pick = <T>(
      field: string,
      answerVal: T | undefined,
      modelVal: T | undefined,
      def: T,
      fmt: (t: T) => string,
    ): T => {
      if (answerVal !== undefined) return answerVal;
      if (modelVal !== undefined) return modelVal;
      // A field the model explicitly asked about (in `missing`) is flagged via a
      // clarification, not an assumption — the default is only a preview placeholder.
      if (!missingSet.has(field)) {
        assumptions.push({
          field,
          assumed: fmt(def),
          note: "Not specified in your description; applied a conservative default.",
        });
      }
      return def;
    };

    const expirySecs = pick(
      "expirySecs",
      takeInt(answers, "expirySecs", 0, Number.MAX_SAFE_INTEGER, warnings),
      m.expirySecs,
      DEFAULT_EXPIRY_SECS,
      (n) => `${Math.round(n / 3600)}h`,
    );

    const spec: CompiledSpec = {
      description: input.description,
      spendCapTotal: pick(
        "spendCapTotal",
        takeAmount(answers, "spendCapTotal", warnings),
        m.spendCapTotal,
        PARANOID_DEFAULTS.spendCapTotal,
        fmtUsd,
      ),
      hitlThreshold: pick(
        "hitlThreshold",
        takeAmount(answers, "hitlThreshold", warnings),
        m.hitlThreshold,
        PARANOID_DEFAULTS.hitlThreshold,
        fmtUsd,
      ),
      slippageBps: pick(
        "slippageBps",
        takeInt(answers, "slippageBps", 0, 65535, warnings),
        m.slippageBps,
        PARANOID_DEFAULTS.slippageBps,
        (n) => `${n} bps`,
      ),
      expiryUnixSeconds: BigInt(this.now() + expirySecs),
      redelegationBounds: {
        maxSubMandates: pick(
          "maxSubMandates",
          takeInt(answers, "maxSubMandates", 0, 255, warnings),
          m.maxSubMandates,
          PARANOID_DEFAULTS.redelegationBounds.maxSubMandates,
          (n) => `${n}`,
        ),
        maxAggregateBudget: pick(
          "maxAggregateBudget",
          takeAmount(answers, "maxAggregateBudget", warnings),
          m.maxAggregateBudget,
          PARANOID_DEFAULTS.redelegationBounds.maxAggregateBudget,
          fmtUsd,
        ),
      },
      rateLimit: {
        capacity: pick(
          "rateLimitCapacity",
          takeInt(answers, "rateLimitCapacity", 0, Number.MAX_SAFE_INTEGER, warnings),
          m.rateCapacity,
          PARANOID_DEFAULTS.rateLimit.capacity,
          (n) => `${n}`,
        ),
        refillRatePerSec: pick(
          "rateLimitRefill",
          takeInt(answers, "rateLimitRefill", 0, Number.MAX_SAFE_INTEGER, warnings),
          m.rateRefill,
          PARANOID_DEFAULTS.rateLimit.refillRatePerSec,
          (n) => `${n}/s`,
        ),
      },
    };

    if (parsed.commsTemplate) {
      spec.commsTemplate = validateComms(
        parsed.commsTemplate,
        answers,
        warnings,
        clarifications,
      );
    }

    // Required fields the model couldn't determine and the user hasn't answered.
    for (const mm of parsed.missing ?? []) {
      if (typeof mm?.field !== "string") continue;
      if (answers[mm.field] !== undefined) continue;
      clarifications.push({
        field: mm.field,
        question: typeof mm.question === "string" ? mm.question : `Please provide ${mm.field}.`,
        reason: typeof mm.reason === "string" ? mm.reason : "Required for this workflow.",
      });
    }

    // Model-declared ambiguity resolutions (T-30 confidence signals).
    for (const a of parsed.assumptions ?? []) {
      if (typeof a?.field !== "string") continue;
      assumptions.push({
        field: a.field,
        assumed: typeof a.assumed === "string" ? a.assumed : "",
        note: typeof a.note === "string" ? a.note : "",
      });
    }

    addHighRiskWarnings(spec, warnings);

    return {
      spec,
      clarifications,
      assumptions,
      warnings,
      readyToSign: clarifications.length === 0,
      escalateToHITL: false,
      promptTemplate: COMPILE_PROMPT_VERSION,
      modelUsed,
    };
  }

  private escalation(
    input: CompileInput,
    reason: string,
    modelUsed: string,
  ): CompileResult {
    // Return the all-paranoid-default spec as a safe floor; the caller checks
    // escalateToHITL first and surfaces a human prompt rather than signing this.
    const spec: CompiledSpec = {
      description: input.description,
      spendCapTotal: PARANOID_DEFAULTS.spendCapTotal,
      hitlThreshold: PARANOID_DEFAULTS.hitlThreshold,
      slippageBps: PARANOID_DEFAULTS.slippageBps,
      expiryUnixSeconds: BigInt(this.now() + DEFAULT_EXPIRY_SECS),
      redelegationBounds: { ...PARANOID_DEFAULTS.redelegationBounds },
      rateLimit: { ...PARANOID_DEFAULTS.rateLimit },
    };
    return {
      spec,
      clarifications: [],
      assumptions: [],
      warnings: [],
      readyToSign: false,
      escalateToHITL: true,
      hitlReason: reason,
      promptTemplate: COMPILE_PROMPT_VERSION,
      modelUsed,
    };
  }
}

interface ModelValues {
  spendCapTotal?: bigint;
  hitlThreshold?: bigint;
  maxAggregateBudget?: bigint;
  slippageBps?: number;
  expirySecs?: number;
  maxSubMandates?: number;
  rateCapacity?: number;
  rateRefill?: number;
}

/** Parse the model's raw fields, throwing on a malformed value (→ escalation). */
function decodeModelValues(o: CompilerOutput): ModelValues {
  const out: ModelValues = {};
  const amt = (s: string | undefined, label: string): bigint | undefined => {
    if (s === undefined) return undefined;
    const v = parseAmount(s, label);
    return v;
  };
  const int = (n: number | string | undefined, label: string, lo: number, hi: number): number | undefined => {
    if (n === undefined || n === null) return undefined;
    // The model's JSON often carries numeric fields as strings ("50"); coerce before
    // validating so a well-formed-but-stringly-typed value isn't rejected as a compile failure.
    const num = typeof n === "number" ? n : typeof n === "string" ? Number(n.trim()) : NaN;
    if (!Number.isInteger(num) || num < lo || num > hi) {
      throw new Error(`${label} must be an integer in [${lo}, ${hi}], got ${JSON.stringify(n)}`);
    }
    return num;
  };
  const sc = amt(o.spendCapTotal, "spendCapTotal");
  if (sc !== undefined) out.spendCapTotal = sc;
  const ht = amt(o.hitlThreshold, "hitlThreshold");
  if (ht !== undefined) out.hitlThreshold = ht;
  const ab = amt(o.maxAggregateBudget, "maxAggregateBudget");
  if (ab !== undefined) out.maxAggregateBudget = ab;
  const sb = int(o.slippageBps, "slippageBps", 0, 65535);
  if (sb !== undefined) out.slippageBps = sb;
  const ex = int(o.expirySecs, "expirySecs", 0, Number.MAX_SAFE_INTEGER);
  if (ex !== undefined) out.expirySecs = ex;
  const ms = int(o.maxSubMandates, "maxSubMandates", 0, 255);
  if (ms !== undefined) out.maxSubMandates = ms;
  const rc = int(o.rateLimit?.capacity, "rateLimit.capacity", 0, Number.MAX_SAFE_INTEGER);
  if (rc !== undefined) out.rateCapacity = rc;
  const rr = int(o.rateLimit?.refillRatePerSec, "rateLimit.refillRatePerSec", 0, Number.MAX_SAFE_INTEGER);
  if (rr !== undefined) out.rateRefill = rr;
  return out;
}

function validateComms(
  raw: NonNullable<CompilerOutput["commsTemplate"]>,
  answers: Record<string, string>,
  warnings: string[],
  clarifications: Clarification[],
): CommsTemplate {
  const known = new Set<string>(VARIABLE_SOURCES);
  const variables: CommsVariable[] = (raw.variables ?? []).map((v) => {
    let source = v.source as VariableSource;
    if (!known.has(v.source)) {
      warnings.push(
        `Comms variable "${v.name}" had an unrecognized source "${v.source}"; ` +
          `treating it as untrusted text (the safe choice).`,
      );
      source = "untrusted-text";
    }
    const cv: CommsVariable = { name: v.name, source };
    if (source === "untrusted-text") {
      const optKey = `commsOptIn:${v.name}`;
      const answer = answers[optKey];
      if (answer !== undefined && /^(true|yes|y|1)$/i.test(answer.trim())) {
        cv.optIn = true;
      } else {
        warnings.push(
          `Message variable "${v.name}" inserts text controlled by outside parties; ` +
            `it will be escaped unless you opt in.`,
        );
        clarifications.push({
          field: optKey,
          question:
            `Variable "${v.name}" inserts text controlled by outside parties. ` +
            `Include it in your message verbatim? (yes/no)`,
          reason: "T-25: attacker-influenceable text in a message context.",
        });
      }
    }
    return cv;
  });
  return { text: raw.text, variables };
}

function addHighRiskWarnings(spec: CompiledSpec, warnings: string[]): void {
  if (spec.spendCapTotal > HIGH_RISK_CEILINGS.spendCapTotal) {
    warnings.push(`High session budget (${fmtUsd(spec.spendCapTotal)}) — confirm this is intended.`);
  }
  if (spec.redelegationBounds.maxAggregateBudget > HIGH_RISK_CEILINGS.maxAggregateBudget) {
    warnings.push(
      `High sub-agent budget (${fmtUsd(spec.redelegationBounds.maxAggregateBudget)}) — confirm this is intended.`,
    );
  }
  if (spec.redelegationBounds.maxSubMandates > HIGH_RISK_CEILINGS.maxSubMandates) {
    warnings.push(
      `Large number of sub-agents (${spec.redelegationBounds.maxSubMandates}) — confirm this is intended.`,
    );
  }
  if (spec.slippageBps > HIGH_RISK_CEILINGS.slippageBps) {
    warnings.push(`High slippage tolerance (${spec.slippageBps} bps) — confirm this is intended.`);
  }
}

/** Lenient answer reader: a bad amount is user error → warn + fall back, never escalate. */
function takeAmount(
  answers: Record<string, string>,
  field: string,
  warnings: string[],
): bigint | undefined {
  const raw = answers[field];
  if (raw === undefined) return undefined;
  try {
    return parseAmount(raw, field);
  } catch {
    warnings.push(
      `Could not read your answer for ${field} ("${raw}") as a USDC base-unit amount; using the default. Please re-enter.`,
    );
    return undefined;
  }
}

function takeInt(
  answers: Record<string, string>,
  field: string,
  lo: number,
  hi: number,
  warnings: string[],
): number | undefined {
  const raw = answers[field];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < lo || n > hi) {
    warnings.push(
      `Could not read your answer for ${field} ("${raw}") as an integer in [${lo}, ${hi}]; using the default. Please re-enter.`,
    );
    return undefined;
  }
  return n;
}

function parseAmount(s: string, label: string): bigint {
  let v: bigint;
  try {
    v = BigInt(s.trim());
  } catch {
    throw new Error(`${label} is not an integer base-unit amount: "${s}"`);
  }
  if (v < 0n) throw new Error(`${label} must be non-negative, got ${v}`);
  return v;
}

function fmtUsd(baseUnits: bigint): string {
  return `$${formatUnits(baseUnits, 6)}`;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
