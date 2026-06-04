import type { Hex } from "viem";
import type { Planner } from "../planner/planner.js";
import { translatePlan, type SpawnOutcome, type TranslateDeps } from "../translate/translate.js";
import { makeEnricher } from "../orchestrate/enrich.js";
import type { SessionContext } from "../orchestrate/enrich.js";
import type { CustomAgentRegistry, AgentBehavior } from "../agents/definition.js";
import type {
  PlanningEntry,
  RedelegationState,
  TaskSpec,
  TokenBucketState,
  TriggerEvent,
} from "../types.js";
import { resolveBehavior } from "./dispatch.js";

/**
 * The session loop conductor — the spine that ties the master-agent runtime
 * together for one trigger: PLAN (planner) → enrich + ISSUE (translatePlan, with
 * the session's structural caveats) → DISPATCH each issued sub-agent to its
 * runtime → advance the session's authority state.
 *
 * It owns the piece no individual brick does: the cumulative authority STATE
 * (redelegation count/budget + rate-limit bucket) evolving across cycles. The
 * planner re-reads that state every cycle and the contract enforces the same
 * bounds at issuance, so advancing it here keeps multi-cycle sessions honest —
 * cycle 2 plans knowing what cycle 1 already spawned.
 *
 * Everything outward is an injected seam (the planner's transport, translate's
 * issuer/encoder/provisioner, and the per-behavior runners), so a whole session
 * cycle is unit-testable offline.
 */

/** How a dispatched sub-agent ran. The runner owns the actual work (monitor/executor/…). */
export interface RunOutcome {
  role: string;
  /** The resolved behavior; absent when the role mapped to no known runtime. */
  behavior?: AgentBehavior;
  mandateId: Hex;
  ran: boolean;
  /** Free-form detail (e.g. "fired", "submitted", "posted", or why it was skipped). */
  detail?: string;
}

/** Context handed to a behavior runner for one issued sub-agent. */
export interface RunContext {
  behavior: AgentBehavior;
  outcome: SpawnOutcome;
}

/** Runs one issued sub-agent of a given behavior. Injected; closes over live deps. */
export type SubAgentRunner = (ctx: RunContext) => Promise<Omit<RunOutcome, "behavior" | "mandateId">>;

/**
 * Incremental lifecycle events emitted as a cycle runs, so a UI can grow the
 * delegation tree in real time (the demo's camera anchor) instead of waiting for
 * the batch result. The `index` on plan/spawn events is the position in
 * `plan.approved` / `outcomes` (same order), so a consumer can tie a planned node
 * to its issuance; `mandateId` ties issuance to dispatch + result. Purely
 * observational — emitting never changes control flow, and it is synchronous.
 */
export type SessionEvent =
  | { type: "cycle-start"; trigger: TriggerEvent }
  | {
      type: "plan-decided";
      approved: { index: number; role: string; spendCapTotal: bigint }[];
      escalateToHITL: boolean;
      hitlReason?: string;
    }
  | { type: "escalated"; reason?: string }
  | {
      type: "sub-mandate";
      index: number;
      role: string;
      status: SpawnOutcome["status"];
      mandateId?: Hex;
      txHash?: Hex;
      /** Failure reason, when `status` is not "issued". */
      detail?: string;
    }
  | {
      type: "state-advanced";
      subMandateCount: number;
      aggregateSubMandateBudget: bigint;
      bucketAvailable: number;
    }
  | { type: "sub-agent-dispatched"; role: string; behavior: AgentBehavior; mandateId: Hex }
  | { type: "sub-agent-result"; role: string; behavior?: AgentBehavior; mandateId: Hex; ran: boolean; detail?: string }
  | { type: "cycle-complete"; spawnedSubMandateIds: Hex[]; escalateToHITL: boolean };

/** Sink for {@link SessionEvent}s. Injected; must not throw (the session ignores throws). */
export type SessionObserver = (event: SessionEvent) => void;

/** The session's evolving authority state (mirrors what the planner reads). */
export interface SessionState {
  spec: TaskSpec;
  redelegation: RedelegationState;
  bucket: TokenBucketState;
}

export interface SessionConfig {
  planner: Planner;
  /** Structural-caveat source for the enricher (signed spec expiry/comms + deployment). */
  context: SessionContext;
  /** translate seams MINUS `enrich` — the session supplies the enricher itself. */
  translate: Omit<TranslateDeps, "enrich">;
  /** Runtimes per behavior. A behavior with no runner is recorded as undispatched. */
  runners?: Partial<Record<AgentBehavior, SubAgentRunner>>;
  /** Custom-agent definitions, for resolving custom role labels to a behavior. */
  registry?: CustomAgentRegistry;
  /** Optional live event sink for UI/telemetry. Omitted ⇒ no events (unchanged behavior). */
  observer?: SessionObserver;
}

export interface SpawnCycleResult {
  entry: PlanningEntry;
  outcomes: SpawnOutcome[];
  runOutcomes: RunOutcome[];
  spawnedSubMandateIds: Hex[];
  escalateToHITL: boolean;
  hitlReason?: string;
}

export class Session {
  constructor(
    private readonly config: SessionConfig,
    private readonly state: SessionState,
  ) {}

  /** Snapshot of the current authority state (count/budget/bucket). */
  get authority(): SessionState {
    return this.state;
  }

  /** Emit one event to the observer, swallowing any throw (events never break a cycle). */
  private emit(event: SessionEvent): void {
    const observer = this.config.observer;
    if (!observer) return;
    try {
      observer(event);
    } catch {
      /* an observer must not be able to abort the session */
    }
  }

  async runCycle(trigger: TriggerEvent): Promise<SpawnCycleResult> {
    this.emit({ type: "cycle-start", trigger });

    // 1 — PLAN against the current authority state.
    const plan = await this.config.planner.plan({
      spec: this.state.spec,
      trigger,
      bounds: this.state.spec.redelegationBounds,
      state: this.state.redelegation,
      bucket: this.state.bucket,
    });

    this.emit({
      type: "plan-decided",
      approved: plan.approved.map((d, i) => ({
        index: i,
        role: d.role,
        spendCapTotal: d.proposedCaveats.spendCapTotal ?? 0n,
      })),
      escalateToHITL: plan.escalateToHITL,
      ...(plan.hitlReason !== undefined ? { hitlReason: plan.hitlReason } : {}),
    });

    if (plan.escalateToHITL) {
      // Never act on a guessed plan (T-35) — surface the HITL and leave state intact.
      this.emit({ type: "escalated", ...(plan.hitlReason !== undefined ? { reason: plan.hitlReason } : {}) });
      this.emit({ type: "cycle-complete", spawnedSubMandateIds: [], escalateToHITL: true });
      const result: SpawnCycleResult = {
        entry: plan.entry,
        outcomes: [],
        runOutcomes: [],
        spawnedSubMandateIds: [],
        escalateToHITL: true,
      };
      if (plan.hitlReason !== undefined) result.hitlReason = plan.hitlReason;
      return result;
    }

    // 2 — enrich (structural caveats from the signed spec + config) + ISSUE on-chain.
    const translated = await translatePlan(plan, {
      ...this.config.translate,
      enrich: makeEnricher(this.config.context),
    });

    // 3 — advance authority state by what was ACTUALLY issued (outcomes are in
    // plan.approved order, so zip them to recover each issued decision's budget).
    let issuedCount = 0;
    let issuedBudget = 0n;
    translated.outcomes.forEach((o, i) => {
      this.emit({
        type: "sub-mandate",
        index: i,
        role: o.role,
        status: o.status,
        ...(o.mandateId ? { mandateId: o.mandateId } : {}),
        ...(o.txHash ? { txHash: o.txHash } : {}),
        ...(o.error !== undefined ? { detail: o.error } : {}),
      });
      if (o.status !== "issued") return;
      issuedCount += 1;
      issuedBudget += plan.approved[i]?.proposedCaveats.spendCapTotal ?? 0n;
    });
    this.state.redelegation.subMandateCount += issuedCount;
    this.state.redelegation.aggregateSubMandateBudget += issuedBudget;
    this.state.bucket.available = Math.max(0, this.state.bucket.available - issuedCount);
    this.emit({
      type: "state-advanced",
      subMandateCount: this.state.redelegation.subMandateCount,
      aggregateSubMandateBudget: this.state.redelegation.aggregateSubMandateBudget,
      bucketAvailable: this.state.bucket.available,
    });

    // 4 — DISPATCH each issued sub-agent to its behavior runner.
    const runOutcomes = await this.dispatch(translated.outcomes);

    this.emit({
      type: "cycle-complete",
      spawnedSubMandateIds: translated.spawnedSubMandateIds,
      escalateToHITL: false,
    });
    return {
      entry: translated.entry,
      outcomes: translated.outcomes,
      runOutcomes,
      spawnedSubMandateIds: translated.spawnedSubMandateIds,
      escalateToHITL: false,
    };
  }

  private async dispatch(outcomes: SpawnOutcome[]): Promise<RunOutcome[]> {
    const runs: RunOutcome[] = [];
    for (const outcome of outcomes) {
      if (outcome.status !== "issued" || !outcome.mandateId) continue;
      const behavior = resolveBehavior(outcome.role, this.config.registry);
      if (!behavior) {
        runs.push({ role: outcome.role, mandateId: outcome.mandateId, ran: false, detail: "no behavior resolved for role" });
        this.emit({ type: "sub-agent-result", role: outcome.role, mandateId: outcome.mandateId, ran: false, detail: "no behavior resolved for role" });
        continue;
      }
      const runner = this.config.runners?.[behavior];
      if (!runner) {
        runs.push({ role: outcome.role, behavior, mandateId: outcome.mandateId, ran: false, detail: "no runner for behavior" });
        this.emit({ type: "sub-agent-result", role: outcome.role, behavior, mandateId: outcome.mandateId, ran: false, detail: "no runner for behavior" });
        continue;
      }
      this.emit({ type: "sub-agent-dispatched", role: outcome.role, behavior, mandateId: outcome.mandateId });
      try {
        const r = await runner({ behavior, outcome });
        runs.push({ role: r.role, behavior, mandateId: outcome.mandateId, ran: r.ran, ...(r.detail !== undefined ? { detail: r.detail } : {}) });
        this.emit({ type: "sub-agent-result", role: r.role, behavior, mandateId: outcome.mandateId, ran: r.ran, ...(r.detail !== undefined ? { detail: r.detail } : {}) });
      } catch (e) {
        const detail = `runner threw: ${e instanceof Error ? e.message : String(e)}`;
        runs.push({ role: outcome.role, behavior, mandateId: outcome.mandateId, ran: false, detail });
        this.emit({ type: "sub-agent-result", role: outcome.role, behavior, mandateId: outcome.mandateId, ran: false, detail });
      }
    }
    return runs;
  }
}
