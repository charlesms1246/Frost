import type { Hex } from "viem";

/**
 * The private-mempool submission seam for the executor (threat T-21).
 *
 * Frost's executor never broadcasts to the public mempool — it hands a validated
 * call to a relay that submits privately (1Shot). This is the injected boundary so
 * the executor's safety logic is testable without a live relay, exactly like
 * `translatePlan`'s `SubMandateIssuer` and the wallet provisioner's
 * `ServerWalletProvider`.
 *
 * The call is expressed as a **pre-registered 1Shot contract method execution**
 * (`contractMethodId` + named `params`), which is 1Shot's actual primitive — it
 * builds and relays the calldata server-side. The preflight (`preflight.ts`)
 * validates the (target, selector, value) the call *resolves to* against the
 * mandate's signed caveats BEFORE anything reaches this seam.
 */
export interface OnchainCall {
  /** Pre-registered 1Shot contract method id binding (router, function). */
  contractMethodId: string;
  /** Named parameters for the method (1Shot `ContractMethodParams`). */
  params: Record<string, unknown>;
  /** Native value (wei) to attach to the call. Omitted ⇒ 0 (typical ERC-20 swap). */
  valueWei?: bigint;
  /** Optional audit memo carried on the 1Shot transaction. */
  memo?: string;
  /**
   * ERC-7710 delegation chain (serialized delegations, root→leaf) under which to
   * execute. When present, the call is submitted via `executeAsDelegator` so the
   * spend is drawn from the DELEGATOR's funds (ultimately the user's, via the
   * ERC-7715 grant) rather than the executor server wallet's own balance. Absent ⇒
   * a plain `execute` against the server wallet's funds.
   */
  delegationData?: string[];
}

/** What the relay returns once it has accepted the submission. */
export interface SubmittedTx {
  /** 1Shot transaction id — the handle to poll for confirmation. */
  transactionId: string;
  /** 1Shot status at submission (`Pending` / `Submitted` / …). */
  status: string;
  /** On-chain tx hash once known; absent while still pending. */
  txHash?: Hex;
}

export interface TransactionSubmitter {
  submit(call: OnchainCall): Promise<SubmittedTx>;
}
