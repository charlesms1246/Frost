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
  type RelayerExecution,
  type SessionContext,
  type SubAgentRunner,
  type SubmittedTx,
  type TransactionSubmitter,
} from "@frost/agent/browser";
import { submitViaRelayer, type RelayerExecDeps, type RelayerExecInput } from "./relayer-exec";

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
  /**
   * ERC-7710 redelegation chain (root→leaf) from the user's ERC-7715 grant. When
   * present, the swap submits via 1Shot `executeAsDelegator` so it spends the USER's
   * tokens, not the server wallet's. Empty/absent ⇒ the server wallet funds it (today).
   */
  delegationData?: string[];
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
    if (opts.delegationData && opts.delegationData.length > 0) req.call.delegationData = opts.delegationData;
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

export interface RelayerExecutorOptions {
  /** Parsed `config.metaMaskGrant` — the user's ERC-7715 grant, delegated to the relayer. */
  granted: unknown;
  /** Provides the signed HITL_THRESHOLD. */
  spec: CompiledSpec;
  /** USDC-equivalent notional of the action (6 decimals) — gates the HITL threshold. */
  notionalUsdc: bigint;
  /** Work execution(s) the relayer redeems (e.g. a USDC transfer; a swap FunctionCall later). */
  work: RelayerExecution[];
  /** HITL gate; omitted ⇒ a tripped threshold returns `hitl_required` without submitting. */
  requestApproval?: RequestApproval;
  chainId?: number;
  destinationUrl?: string;
  memo?: string;
  /** Test injection (relayer client + decode seam). */
  deps?: RelayerExecDeps;
}

const fmtUsdc = (n: bigint) => `$${(Number(n) / 1e6).toFixed(2)}`;

/**
 * The executor `SubAgentRunner` for the KEYLESS public-relayer path: redeem the user's
 * ERC-7715 grant through the 1Shot public relayer (paid per-tx in USDC, NO custodial
 * wallet). It enforces the same HITL_THRESHOLD gate as the swap runners — an action at
 * or above the signed threshold pauses for `requestApproval` — then submits via
 * {@link submitViaRelayer}.
 *
 * Scope note: the demo work is a USDC transfer, whose target/selector are not the swap
 * router in CALLABLE_SURFACE, so the swap-specific §10.3 preflight ({@link
 * makeExecutorRunner}) does not apply here; HITL is the carried-over gate. A swap
 * FunctionCall through the relayer would reinstate the full preflight (follow-up).
 */
export function makeRelayerExecutorRunner(opts: RelayerExecutorOptions): SubAgentRunner {
  return async ({ outcome }) => {
    if (!outcome.mandateId) return { role: outcome.role, ran: false, detail: "no mandate id" };

    if (opts.notionalUsdc >= opts.spec.hitlThreshold) {
      if (!opts.requestApproval) return { role: outcome.role, ran: false, detail: "hitl_required" };
      const first = opts.work[0];
      const req: HitlApprovalRequest = {
        mandateId: outcome.mandateId,
        target: (first?.target ?? "0x0000000000000000000000000000000000000000") as Address,
        selector: (first ? first.data.slice(0, 10) : "0x00000000") as Hex,
        notionalUsdc: opts.notionalUsdc,
        reason: `value ${fmtUsdc(opts.notionalUsdc)} ≥ HITL threshold ${fmtUsdc(opts.spec.hitlThreshold)}`,
      };
      if (!(await opts.requestApproval(req))) return { role: outcome.role, ran: false, detail: "human declined" };
    }

    const input: RelayerExecInput = { granted: opts.granted, work: opts.work };
    if (opts.chainId !== undefined) input.chainId = opts.chainId;
    if (opts.destinationUrl) input.destinationUrl = opts.destinationUrl;
    if (opts.memo) input.memo = opts.memo;

    try {
      const res = await submitViaRelayer(input, opts.deps ?? {});
      return {
        role: outcome.role,
        ran: true,
        detail: `relayed ${res.taskId} (${fmtUsdc(opts.notionalUsdc)}, fee ${res.feeAmount})`,
      };
    } catch (e) {
      return { role: outcome.role, ran: false, detail: e instanceof Error ? e.message : String(e) };
    }
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
