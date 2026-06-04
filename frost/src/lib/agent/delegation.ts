import { OneShotRestDelegations, type OneShotRestConfig } from "@frost/agent/browser";

/**
 * The middle link of the production ERC-7710 chain (option A): turn the user's
 * ERC-7715 grant into a delegation chain the EXECUTOR can redeem, so the swap
 * spends the USER's tokens rather than the executor server wallet's own funds.
 *
 *   user MetaMask ──ERC-7715 grant──▶ session 1Shot wallet
 *                                       │  redelegate (this module)
 *                                       ▼
 *                                     executor 1Shot wallet ──executeAsDelegator──▶ swap
 *
 * Prerequisites for a LIVE run (manual / not done here):
 *   - a SESSION 1Shot wallet whose address is the `to` of the user's ERC-7715 grant;
 *   - the user has approved that grant in MetaMask (`requestMetaMaskGrant`);
 *   - the EXECUTOR 1Shot wallet (the swap relay) exists.
 *
 * Open verification: whether MetaMask's ERC-7715 `granted` serializes directly into
 * 1Shot's `delegationData` (both are MetaMask Delegation Framework delegations, so
 * likely, but unconfirmed end-to-end).
 */
export interface DelegationChainOptions {
  /** 1Shot REST credentials (apiKey/apiSecret/baseUrl/fetchImpl). */
  oneShot: OneShotRestConfig;
  /** The session 1Shot wallet that holds the user's ERC-7715 grant. */
  sessionWalletId: string;
  /** The executor server wallet address the session redelegates to. */
  executorAddress: `0x${string}`;
  /** The user's ERC-7715 grant as a serialized delegation (from `requestMetaMaskGrant`). */
  grantDelegationData: string;
}

/**
 * Redelegate the user's grant from the session wallet to the executor, returning the
 * ERC-7710 chain (root→leaf) to pass as `delegationData` to the executor runner.
 */
export async function buildExecutorDelegationChain(opts: DelegationChainOptions): Promise<string[]> {
  const delegations = new OneShotRestDelegations(opts.oneShot);
  const { delegationData } = await delegations.redelegate(
    opts.sessionWalletId,
    opts.grantDelegationData,
    opts.executorAddress,
  );
  return delegationData;
}
