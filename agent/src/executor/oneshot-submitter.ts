import type { Hex } from "viem";
import type { OnchainCall, SubmittedTx, TransactionSubmitter } from "./submitter.js";

/**
 * Real 1Shot-backed {@link TransactionSubmitter} — the private-mempool relay the
 * executor submits through (threat T-21). Wraps `client.contractMethods.execute`,
 * 1Shot's actual submission primitive: a pre-registered contract method executed
 * by a server wallet, relayed privately and gas-sponsored by 1Shot.
 *
 * The SDK client slice is injectable so the mapping is unit-testable offline (the
 * real `OneShotClient` is narrowed to it at the boundary, as in
 * `wallet/oneshot.ts`). Construction makes no network call; the token is fetched
 * lazily by the client on first request. **Submitting is a live write** — exercise
 * only with explicit approval.
 */

/** 1Shot transaction shape this submitter reads (a subset of the SDK `Transaction`). */
interface OneShotTransaction {
  id: string;
  status: string;
  transactionHash: string | null;
}

/** The slice of `client.contractMethods` this submitter uses (injectable for tests). */
export interface OneShotContractMethodsApi {
  execute(
    contractMethodId: string,
    params: Record<string, unknown>,
    options?: { walletId?: string; value?: string; memo?: string },
  ): Promise<OneShotTransaction>;
  /**
   * Execute under an ERC-7710 delegation chain — the spend is drawn from the
   * delegator's funds (ultimately the user's, via the ERC-7715 grant). Only needed
   * for the production user-funds path; a plain `execute` spends the server wallet.
   */
  executeAsDelegator(
    contractMethodId: string,
    params: Record<string, unknown>,
    options?: { walletId?: string; value?: string; memo?: string; delegationData?: string[] },
  ): Promise<OneShotTransaction>;
}

export class OneShotTransactionSubmitter implements TransactionSubmitter {
  /**
   * @param methods The 1Shot `contractMethods` API (inject a fake in tests).
   * @param walletId The server wallet that signs/relays — the executor's 1Shot wallet.
   */
  constructor(
    private readonly methods: OneShotContractMethodsApi,
    private readonly walletId: string,
  ) {}

  async submit(call: OnchainCall): Promise<SubmittedTx> {
    const options: { walletId: string; value?: string; memo?: string; delegationData?: string[] } = {
      walletId: this.walletId,
    };
    // 1Shot takes value as a decimal string; only set it when non-default.
    if (call.valueWei !== undefined) options.value = call.valueWei.toString();
    if (call.memo !== undefined) options.memo = call.memo;

    let tx: OneShotTransaction;
    if (call.delegationData && call.delegationData.length > 0) {
      // Production user-funds path: redeem the ERC-7710 chain so the spend comes from
      // the delegator (the user), not this server wallet.
      options.delegationData = call.delegationData;
      tx = await this.methods.executeAsDelegator(call.contractMethodId, call.params, options);
    } else {
      tx = await this.methods.execute(call.contractMethodId, call.params, options);
    }

    const out: SubmittedTx = { transactionId: tx.id, status: tx.status };
    if (tx.transactionHash) out.txHash = tx.transactionHash as Hex;
    return out;
  }
}
