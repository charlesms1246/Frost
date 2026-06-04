import type { Address, Hex } from "viem";
import type { Caveat } from "@frost/sdk";
import { preflightExecution, type ProposedExecution } from "./preflight.js";
import type { OnchainCall, SubmittedTx, TransactionSubmitter } from "./submitter.js";

/**
 * The executor sub-agent runtime (contract-architecture §10.3). Given its issued
 * sub-mandate's caveats and a proposed swap, it runs the pre-submission safety
 * boundary and, only if it passes, relays the call through the private mempool.
 *
 * Orchestration only — the safety decision lives in the pure `preflightExecution`,
 * the relay behind the injected `TransactionSubmitter`, and the ancestor-revocation
 * read behind the optional `RevocationGuard`. Every outward action is a seam, so
 * the whole flow is unit-testable offline. Mirrors the planner/translate split:
 * **the LLM proposes, the runtime disposes.**
 */

/** §10.3 step 2 — `Revocation.isAncestorRevoked(executorMandateId)`. */
export interface RevocationGuard {
  isAncestorRevoked(mandateId: Hex): Promise<boolean>;
}

/**
 * The human-facing facts of an action that tripped the HITL_THRESHOLD — handed to
 * the approval gate so the user decides on the real call, not an abstraction.
 */
export interface HitlApprovalRequest {
  mandateId: Hex;
  target: Address;
  selector: Hex;
  notionalUsdc: bigint;
  /** Why preflight paused (e.g. "value 12.00 ≥ HITL threshold 5.00"). */
  reason: string;
}

/** The executor's own issued sub-mandate: its id (for the revocation read) + caveats. */
export interface ExecutorMandate {
  id: Hex;
  caveats: readonly Caveat[];
}

/** A swap the executor has been asked to submit: the preflight facts + the relay payload. */
export interface ExecutionRequest {
  /** Contract the call targets — matched against CALLABLE_SURFACE. */
  target: Address;
  /** 4-byte selector of the function being called — matched against CALLABLE_SURFACE. */
  selector: Hex;
  /** USDC-equivalent value of the call (6 decimals). */
  notionalUsdc: bigint;
  /** Current gas price (wei), if known — enforced when MAX_GAS_PRICE is signed. */
  gasPriceWei?: bigint;
  /** Computed slippage (bps), if known — enforced when SLIPPAGE_TOLERANCE is signed. */
  slippageBps?: number;
  /** The private-mempool submission payload (opaque to the preflight). */
  call: OnchainCall;
}

export type ExecutionResult =
  | { status: "submitted"; tx: SubmittedTx }
  | { status: "rejected"; reason: string }
  | { status: "hitl_required"; reason: string }
  | { status: "aborted"; reason: string }
  | { status: "failed"; reason: string };

export interface ExecutorDeps {
  submitter: TransactionSubmitter;
  /** Optional ancestor-revocation read; skipped when absent (e.g. in tests). */
  revocation?: RevocationGuard;
  /**
   * Human-in-the-loop gate. When preflight returns `hitl`, this is asked for a
   * decision: `true` ⇒ the human approved, submit the call; `false` ⇒ declined,
   * reject. Absent ⇒ the executor returns `hitl_required` without submitting (the
   * prior, gate-less behavior). A throw here aborts (never submit on an unclear gate).
   */
  requestApproval?: (req: HitlApprovalRequest) => Promise<boolean>;
}

export class Executor {
  constructor(private readonly deps: ExecutorDeps) {}

  async execute(mandate: ExecutorMandate, req: ExecutionRequest): Promise<ExecutionResult> {
    // §10.3 step 2 — abort if any ancestor mandate is revoked. A failed read is
    // treated as abort, not submit: we never act on an unverifiable chain.
    if (this.deps.revocation) {
      let revoked: boolean;
      try {
        revoked = await this.deps.revocation.isAncestorRevoked(mandate.id);
      } catch (e) {
        return { status: "aborted", reason: `revocation check failed: ${errMsg(e)}` };
      }
      if (revoked) return { status: "aborted", reason: "ancestor mandate revoked" };
    }

    // §10.3 steps 3-4 — the safety boundary.
    const proposed: ProposedExecution = {
      target: req.target,
      selector: req.selector,
      notionalUsdc: req.notionalUsdc,
    };
    if (req.gasPriceWei !== undefined) proposed.gasPriceWei = req.gasPriceWei;
    if (req.slippageBps !== undefined) proposed.slippageBps = req.slippageBps;

    const verdict = preflightExecution(mandate.caveats, proposed);
    if (verdict.decision === "reject") return { status: "rejected", reason: verdict.reason };
    if (verdict.decision === "hitl") {
      // No gate wired ⇒ pause and surface the requirement (prior behavior).
      if (!this.deps.requestApproval) {
        return { status: "hitl_required", reason: verdict.reason };
      }
      // Gate wired ⇒ ask the human and resume on their decision.
      let approved: boolean;
      try {
        approved = await this.deps.requestApproval({
          mandateId: mandate.id,
          target: req.target,
          selector: req.selector,
          notionalUsdc: req.notionalUsdc,
          reason: verdict.reason,
        });
      } catch (e) {
        return { status: "aborted", reason: `approval request failed: ${errMsg(e)}` };
      }
      if (!approved) return { status: "rejected", reason: `human declined: ${verdict.reason}` };
      // Approved — fall through to submit.
    }

    // §10.3 step 6 — submit through the private-mempool relay (1Shot).
    try {
      const tx = await this.deps.submitter.submit(req.call);
      return { status: "submitted", tx };
    } catch (e) {
      return { status: "failed", reason: `submission failed: ${errMsg(e)}` };
    }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
