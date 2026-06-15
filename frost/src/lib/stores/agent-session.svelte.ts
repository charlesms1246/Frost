import type { SessionEvent, RouteInfo, HitlApprovalRequest, ReceiptInput } from "@frost/agent/browser";

/**
 * The live dashboard store: consumes the @frost/agent {@link SessionEvent} spine and
 * the inference {@link RouteInfo} stream into a delegation tree + activity log + the
 * right-rail AI stats. One source of truth for every panel; Svelte 5 runes make the
 * mutations reactive, so the tree grows on screen as the cycle runs.
 */

export type NodeStatus = "planned" | "issued" | "running" | "done" | "failed";

export interface AgentNode {
  index: number;
  role: string;
  behavior?: string;
  status: NodeStatus;
  spendCapTotal?: bigint;
  mandateId?: string;
  txHash?: string;
  detail?: string;
  /** Structured quote for pricer nodes (cross-source ranking). */
  quote?: { label: string; amountOutUsdc: bigint };
}

export interface BestRoute {
  role: string;
  label: string;
  amountOutUsdc: bigint;
  /** Number of pricer quotes it beat (for "best of N" copy). */
  outOf: number;
}

export type Phase = "idle" | "planning" | "issuing" | "dispatching" | "done" | "escalated" | "error";

export interface ActivityLine {
  t: number;
  kind: "info" | "spawn" | "run" | "warn" | "error" | "route";
  text: string;
}

export interface MasterNode {
  description: string;
  rootMandateId?: string;
  status: NodeStatus;
}

const SHORT = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
const usdc = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;

export class AgentSessionStore {
  phase = $state<Phase>("idle");
  master = $state<MasterNode>({ description: "", status: "planned" });
  children = $state<AgentNode[]>([]);
  activity = $state<ActivityLine[]>([]);
  routes = $state<{ venice: number; openrouter: number }>({ venice: 0, openrouter: 0 });
  escalation = $state<string | undefined>(undefined);
  authority = $state<{ subMandateCount: number; aggregateSubMandateBudget: bigint; bucketAvailable: number } | undefined>(undefined);
  errorText = $state<string | undefined>(undefined);

  // --- HITL gate (IG-07: rate-limited + prompt-bound) ---
  /**
   * Per-SESSION cap on HITL prompts (T-28b): an attacker who can trigger actions
   * cannot spam approval dialogs to induce fatigue/habituation. Past the cap, every
   * further prompt is auto-rejected (default-deny) without surfacing a dialog.
   */
  static readonly HITL_PROMPT_LIMIT = 5;
  hitl = $state<{ pending: boolean; request?: HitlApprovalRequest; approvalId?: number }>({ pending: false });
  /** HITL prompts raised this session (counts toward HITL_PROMPT_LIMIT). */
  hitlPromptCount = $state(0);
  private hitlResolve: ((approved: boolean) => void) | undefined;
  /** Monotonic id source; each prompt gets a unique id its approval must match (H-12). */
  private nextApprovalId = 1;
  /** The id of the currently-pending prompt — an approval for any other id is stale. */
  private pendingApprovalId: number | undefined;
  /** Every HITL decision this session — fed into the audit receipt. */
  hitlApprovals = $state<{ notionalUsdc: bigint; reason: string; approved: boolean }[]>([]);

  // --- revocation (demo moment 3) ---
  spawningRevoked = $state(false);
  revokeTxHash = $state<string | undefined>(undefined);

  // --- derived stats (right rail) ---
  get agentsTotal(): number {
    return this.children.length;
  }
  get agentsRunning(): number {
    return this.children.filter((c) => c.status === "running").length;
  }
  get agentsDone(): number {
    return this.children.filter((c) => c.status === "done").length;
  }
  get agentsFailed(): number {
    return this.children.filter((c) => c.status === "failed").length;
  }
  get inferenceCalls(): number {
    return this.routes.venice + this.routes.openrouter;
  }

  /**
   * The winning route across all pricer sub-agents that reported a quote — the
   * demo's "spawn N pricers, pick the best rate" payoff. Highest USDC out wins
   * (a SELL of WETH → USDC). Undefined until at least one pricer has a quote.
   */
  get bestRoute(): BestRoute | undefined {
    const quoted = this.children.filter((c) => c.quote);
    if (quoted.length === 0) return undefined;
    let best = quoted[0]!;
    for (const c of quoted) if (c.quote!.amountOutUsdc > best.quote!.amountOutUsdc) best = c;
    return { role: best.role, label: best.quote!.label, amountOutUsdc: best.quote!.amountOutUsdc, outOf: quoted.length };
  }

  reset(description: string, rootMandateId?: string): void {
    // Release any in-flight approval so its awaiter doesn't hang across a reset.
    if (this.hitlResolve) {
      this.hitlResolve(false);
      this.hitlResolve = undefined;
    }
    this.phase = "idle";
    this.master = { description, status: "planned", ...(rootMandateId ? { rootMandateId } : {}) };
    this.children = [];
    this.activity = [];
    this.routes = { venice: 0, openrouter: 0 };
    this.escalation = undefined;
    this.authority = undefined;
    this.errorText = undefined;
    this.hitl = { pending: false };
    this.hitlApprovals = [];
    this.hitlPromptCount = 0;
    this.pendingApprovalId = undefined;
    this.spawningRevoked = false;
    this.revokeTxHash = undefined;
  }

  /**
   * Start a new cycle within the SAME session: clear the per-cycle view (tree, phase,
   * escalation) but PRESERVE session-level state — `spawningRevoked`, the root mandate,
   * routes, authority, and the running activity log — so a second condition can
   * demonstrate the revocation cascade after a successful first cycle.
   */
  beginCycle(description?: string): void {
    if (this.hitlResolve) {
      this.hitlResolve(false);
      this.hitlResolve = undefined;
    }
    // The pending prompt (if any) is cleared, but hitlPromptCount PERSISTS across cycles
    // within a session — the T-28b fatigue cap is a session-level budget, not per-cycle.
    this.pendingApprovalId = undefined;
    this.phase = "idle";
    if (description !== undefined) this.master.description = description;
    this.master.status = "planned";
    this.children = [];
    this.escalation = undefined;
    this.errorText = undefined;
    this.hitl = { pending: false };
  }

  /** Mark the master's spawning authority revoked (demo moment 3). */
  markSpawningRevoked(txHash?: string): void {
    this.spawningRevoked = true;
    if (txHash) this.revokeTxHash = txHash;
    this.log("warn", `Spawning authority revoked${txHash ? ` (tx ${SHORT(txHash)})` : ""} — new sub-agents will be refused.`);
  }

  /**
   * The executor's HITL gate: record the pending action and return a promise that
   * resolves when the user clicks Approve/Reject (via {@link resolveHitl}). Wired into
   * the executor runner as its `requestApproval`.
   */
  awaitApproval(request: HitlApprovalRequest): Promise<boolean> {
    // T-28b: cap prompts per session — beyond the limit, default-deny without prompting
    // so approval dialogs can't be spammed to fatigue the user into a careless "yes".
    if (this.hitlPromptCount >= AgentSessionStore.HITL_PROMPT_LIMIT) {
      this.log("warn", `HITL: prompt limit (${AgentSessionStore.HITL_PROMPT_LIMIT}/session) reached — auto-rejecting ${usdc(request.notionalUsdc)} (${request.reason}).`);
      return Promise.resolve(false);
    }
    this.hitlPromptCount += 1;
    const approvalId = this.nextApprovalId++;
    this.pendingApprovalId = approvalId;
    this.hitl = { pending: true, request, approvalId };
    this.log("warn", `HITL: approval required — ${usdc(request.notionalUsdc)} (${request.reason}) [#${approvalId}]`);
    return new Promise<boolean>((resolve) => {
      this.hitlResolve = resolve;
    });
  }

  /**
   * Resolve the pending approval — called by the HITL banner's Approve/Reject. H-12:
   * the decision is BOUND to the prompt that fired (`approvalId`). A resolve whose id
   * doesn't match the pending prompt is a stale/replayed click and is ignored, so a
   * "yes" for one action can never be applied to a different pending action.
   */
  resolveHitl(approved: boolean, approvalId?: number): void {
    if (!this.hitlResolve) return;
    if (approvalId !== undefined && approvalId !== this.pendingApprovalId) {
      this.log("warn", `HITL: ignored a stale approval (#${approvalId} ≠ pending #${this.pendingApprovalId ?? "none"}).`);
      return;
    }
    const req = this.hitl.request;
    if (req) this.hitlApprovals.push({ notionalUsdc: req.notionalUsdc, reason: req.reason, approved });
    this.hitlResolve(approved);
    this.hitlResolve = undefined;
    this.pendingApprovalId = undefined;
    this.log(approved ? "run" : "warn", `HITL: ${approved ? "approved → resuming" : "rejected"}`);
    this.hitl = { pending: false };
  }

  /**
   * Map the live session state into the agent runtime's {@link ReceiptInput} — the audit
   * trail the Merkle commitment is computed over. Pure projection of the current store.
   */
  get receiptInput(): ReceiptInput {
    return {
      description: this.master.description,
      ...(this.master.rootMandateId ? { rootMandateId: this.master.rootMandateId } : {}),
      children: this.children.map((c) => ({
        index: c.index,
        role: c.role,
        ...(c.behavior ? { behavior: c.behavior } : {}),
        status: c.status,
        ...(c.spendCapTotal !== undefined ? { spendCapTotal: c.spendCapTotal } : {}),
        ...(c.mandateId ? { mandateId: c.mandateId } : {}),
        ...(c.txHash ? { txHash: c.txHash } : {}),
        ...(c.detail ? { detail: c.detail } : {}),
      })),
      routes: { venice: this.routes.venice, openrouter: this.routes.openrouter },
      ...(this.authority ? { authority: this.authority } : {}),
      hitlApprovals: this.hitlApprovals.map((h) => ({ ...h })),
      revoked: this.spawningRevoked,
      ...(this.revokeTxHash ? { revokeTxHash: this.revokeTxHash } : {}),
    };
  }

  /** Append an informational activity line (e.g. live pre-trade quote telemetry). */
  note(text: string): void {
    this.log("run", text);
  }

  private log(kind: ActivityLine["kind"], text: string): void {
    this.activity.push({ t: Date.now(), kind, text });
  }

  private node(mandateId?: string, index?: number): AgentNode | undefined {
    if (mandateId) {
      const byId = this.children.find((c) => c.mandateId === mandateId);
      if (byId) return byId;
    }
    if (index !== undefined) return this.children[index];
    return undefined;
  }

  /** Feed one session lifecycle event. */
  onEvent(e: SessionEvent): void {
    switch (e.type) {
      case "cycle-start": {
        this.phase = "planning";
        this.master.status = "running";
        this.log("info", `Cycle started (${e.trigger.kind}) — master agent planning…`);
        break;
      }
      case "plan-decided": {
        if (e.escalateToHITL) {
          this.log("warn", "Planner escalated to human review — no sub-agents spawned.");
        } else {
          this.children = e.approved.map((a) => ({
            index: a.index,
            role: a.role,
            status: "planned" as NodeStatus,
            spendCapTotal: a.spendCapTotal,
          }));
          this.phase = "issuing";
          this.log("info", `Plan decided: ${e.approved.length} sub-agent(s) — ${e.approved.map((a) => a.role).join(", ")}`);
        }
        break;
      }
      case "sub-mandate": {
        const n = this.node(undefined, e.index);
        if (n) {
          n.status = e.status === "issued" ? "issued" : "failed";
          if (e.mandateId) n.mandateId = e.mandateId;
          if (e.txHash) n.txHash = e.txHash;
          if (e.detail) n.detail = e.detail;
        }
        if (e.status === "issued") this.log("spawn", `Issued sub-mandate for ${e.role} (${SHORT(e.mandateId)})`);
        else this.log("error", `Issuance failed for ${e.role}: ${e.detail ?? e.status}`);
        break;
      }
      case "state-advanced": {
        this.authority = {
          subMandateCount: e.subMandateCount,
          aggregateSubMandateBudget: e.aggregateSubMandateBudget,
          bucketAvailable: e.bucketAvailable,
        };
        this.phase = "dispatching";
        break;
      }
      case "sub-agent-dispatched": {
        const n = this.node(e.mandateId);
        if (n) {
          n.status = "running";
          n.behavior = e.behavior;
        }
        this.log("run", `${e.role} (${e.behavior}) running…`);
        break;
      }
      case "sub-agent-result": {
        const n = this.node(e.mandateId);
        if (n) {
          n.status = e.ran ? "done" : "failed";
          if (e.behavior) n.behavior = e.behavior;
          if (e.detail) n.detail = e.detail;
          if (e.quote) n.quote = { label: e.quote.label, amountOutUsdc: BigInt(e.quote.amountOutUsdc) };
        }
        this.log(e.ran ? "run" : "warn", `${e.role} ${e.ran ? "done" : "failed"}${e.detail ? " — " + e.detail : ""}`);
        break;
      }
      case "escalated": {
        this.phase = "escalated";
        this.escalation = e.reason ?? "Escalated to human review.";
        this.master.status = "failed";
        this.log("warn", `HITL: ${this.escalation}`);
        break;
      }
      case "cycle-complete": {
        if (!e.escalateToHITL) {
          this.phase = "done";
          this.master.status = "done";
          this.log("info", `Cycle complete — ${e.spawnedSubMandateIds.length} sub-mandate(s) spawned.`);
        }
        break;
      }
    }
  }

  /** Feed one inference routing decision (Venice vs OpenRouter). */
  onRoute(info: RouteInfo): void {
    if (info.provider === "primary") this.routes.venice += 1;
    else this.routes.openrouter += 1;
    const label = info.provider === "primary" ? "Venice (paid/x402)" : "OpenRouter";
    const why =
      info.reason === "budget-exhausted"
        ? " — Venice budget spent, switched"
        : info.reason === "disabled"
          ? " — Venice off"
          : info.reason === "primary-error-fallback"
            ? ` — Venice error, fell back (${info.primaryError ?? ""})`
            : "";
    this.log("route", `Inference → ${label}${why} [${info.primaryCallsUsed}/${info.primaryCallBudget} paid]`);
  }

  markError(message: string): void {
    this.phase = "error";
    this.errorText = message;
    this.master.status = "failed";
    this.log("error", message);
  }
}
