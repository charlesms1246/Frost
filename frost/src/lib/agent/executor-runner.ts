import { toFunctionSelector, type Address, type Hex } from "viem";
import { callableSurface, hitlThreshold, slippageTolerance } from "@frost/sdk";
import {
  Executor,
  OneShotRestMethods,
  OneShotTransactionSubmitter,
  type CompiledSpec,
  type ExecutionRequest,
  type HitlApprovalRequest,
  type OneShotFetch,
  type SessionContext,
  type SubAgentRunner,
  type SubmittedTx,
  type TransactionSubmitter,
} from "@frost/agent/browser";

/** The HITL approval gate the executor calls when an action trips HITL_THRESHOLD. */
export type RequestApproval = (req: HitlApprovalRequest) => Promise<boolean>;

/**
 * The executor `SubAgentRunner` for the webview embedding — the live on-chain WRITE
 * path (threat T-21). It runs the §10.3 pre-submission safety check
 * (`preflightExecution`, via `Executor`) against the session's CALLABLE_SURFACE and
 * then submits through 1Shot's private mempool via the `fetch`-based
 * {@link OneShotRestMethods} (no Node-only SDK — runs in the renderer).
 *
 * Opt-in: only wired when the caller supplies 1Shot creds + a pre-registered
 * `contractMethodId` (the Uniswap SwapRouter02 method, registered once via 1Shot's
 * `importFromABI`/`create`) + the swap to submit. The swap's `target`/`signature`
 * must match a CALLABLE_SURFACE entry or the preflight rejects it.
 *
 * Demo note: the executor mandate's caveats are reconstructed from the session
 * context + spec (CALLABLE_SURFACE + HITL + slippage) rather than read back from the
 * issued sub-mandate — sufficient for the off-chain preflight; the contract enforces
 * the on-chain intersection independently.
 */
export interface ExecutorRunnerOptions {
  oneShot: {
    apiKey: string;
    apiSecret: string;
    baseUrl?: string;
    /** The 1Shot server wallet that signs/relays. */
    walletId: string;
    /** Test injection; defaults to the webview `fetch`. */
    fetchImpl?: OneShotFetch;
  };
  /** Pre-registered 1Shot contract method id for the swap. */
  contractMethodId: string;
  swap: {
    /** Router address — must be in the session's CALLABLE_SURFACE. */
    target: Address;
    /** Function signature → 4-byte selector (must match a CALLABLE_SURFACE entry). */
    signature: string;
    /** USDC-equivalent value of the call (for maxValue + HITL checks). */
    notionalUsdc: bigint;
    /** Named params for the 1Shot method. */
    params: Record<string, unknown>;
    slippageBps?: number;
    gasPriceWei?: bigint;
    /** Native value (wei) to attach. */
    valueWei?: bigint;
  };
  context: SessionContext;
  spec: CompiledSpec;
  /** HITL gate; when an action trips HITL_THRESHOLD the executor pauses for this. */
  requestApproval?: RequestApproval;
}

export function makeExecutorRunner(opts: ExecutorRunnerOptions): SubAgentRunner {
  const restConfig: ConstructorParameters<typeof OneShotRestMethods>[0] = {
    apiKey: opts.oneShot.apiKey,
    apiSecret: opts.oneShot.apiSecret,
  };
  if (opts.oneShot.baseUrl) restConfig.baseUrl = opts.oneShot.baseUrl;
  if (opts.oneShot.fetchImpl) restConfig.fetchImpl = opts.oneShot.fetchImpl;

  const submitter = new OneShotTransactionSubmitter(
    new OneShotRestMethods(restConfig),
    opts.oneShot.walletId,
  );
  const executor = new Executor({ submitter, ...(opts.requestApproval ? { requestApproval: opts.requestApproval } : {}) });
  const selector = toFunctionSelector(opts.swap.signature);

  // Reconstruct the executor sub-mandate's caveats from trusted session state.
  const caveats = [
    callableSurface(opts.context.callableSurface),
    hitlThreshold(opts.spec.hitlThreshold),
    slippageTolerance(opts.spec.slippageBps),
  ];

  return async ({ outcome }) => {
    // The Session only dispatches issued outcomes (mandateId set); guard anyway so
    // the type narrows and a malformed dispatch fails cleanly rather than throwing.
    if (!outcome.mandateId) return { role: outcome.role, ran: false, detail: "no mandate id" };

    const req: ExecutionRequest = {
      target: opts.swap.target,
      selector,
      notionalUsdc: opts.swap.notionalUsdc,
      call: { contractMethodId: opts.contractMethodId, params: opts.swap.params },
    };
    if (opts.swap.valueWei !== undefined) req.call.valueWei = opts.swap.valueWei;
    if (opts.swap.slippageBps !== undefined) req.slippageBps = opts.swap.slippageBps;
    if (opts.swap.gasPriceWei !== undefined) req.gasPriceWei = opts.swap.gasPriceWei;

    const res = await executor.execute({ id: outcome.mandateId, caveats }, req);
    return {
      role: outcome.role,
      ran: res.status === "submitted",
      detail:
        res.status === "submitted"
          ? `submitted ${res.tx.transactionId} (${res.tx.status})`
          : (res as { reason?: string }).reason ?? res.status,
    };
  };
}

export interface SimulatedExecutorOptions {
  context: SessionContext;
  spec: CompiledSpec;
  /** USDC-equivalent notional of the demo swap (6 decimals). > HITL ⇒ the gate fires. */
  notionalUsdc: bigint;
  /** HITL gate; omitted ⇒ a tripped threshold returns `hitl_required` without resuming. */
  requestApproval?: RequestApproval;
}

/**
 * An executor `SubAgentRunner` that runs the REAL §10.3 preflight + HITL gate against
 * the session's CALLABLE_SURFACE but SIMULATES the on-chain submit (no 1Shot, no funds).
 * It targets the first surface entry with the given notional, so a notional above the
 * session HITL_THRESHOLD deterministically pauses for approval — the demo's HITL moment
 * without the live-execution setup. The live path ({@link makeExecutorRunner}) shares the
 * identical gate.
 */
export function makeSimulatedExecutorRunner(opts: SimulatedExecutorOptions): SubAgentRunner {
  let n = 0;
  const submitter: TransactionSubmitter = {
    async submit(): Promise<SubmittedTx> {
      n += 1;
      return { transactionId: `sim-${n}`, status: "Simulated", txHash: ("0x" + "5".repeat(64)) as Hex };
    },
  };
  const executor = new Executor({ submitter, ...(opts.requestApproval ? { requestApproval: opts.requestApproval } : {}) });
  const caveats = [
    callableSurface(opts.context.callableSurface),
    hitlThreshold(opts.spec.hitlThreshold),
    slippageTolerance(opts.spec.slippageBps),
  ];

  return async ({ outcome }) => {
    if (!outcome.mandateId) return { role: outcome.role, ran: false, detail: "no mandate id" };
    const surface = opts.context.callableSurface[0];
    if (!surface) return { role: outcome.role, ran: false, detail: "no callable surface configured" };

    const req: ExecutionRequest = {
      target: surface.target,
      selector: surface.selector,
      notionalUsdc: opts.notionalUsdc,
      slippageBps: opts.spec.slippageBps,
      call: { contractMethodId: "simulated-swap", params: {} },
    };
    const res = await executor.execute({ id: outcome.mandateId, caveats }, req);
    return {
      role: outcome.role,
      ran: res.status === "submitted",
      detail:
        res.status === "submitted"
          ? `simulated swap ${res.tx.transactionId} ($${(Number(opts.notionalUsdc) / 1e6).toFixed(2)})`
          : (res as { reason?: string }).reason ?? res.status,
    };
  };
}
