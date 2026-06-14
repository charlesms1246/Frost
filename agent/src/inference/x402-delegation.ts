/**
 * x402 DELEGATION inference buyer — the MetaMask-Smart-Account native path.
 *
 * Pays an x402-gated `/chat/completions` with a signed ERC-7710 DELEGATION payload
 * (not EIP-3009), so each inference call settles USDC from the agent's MetaMask Smart
 * Account on a `402 PAYMENT-REQUIRED`. This is the purist "no API keys, pay-per-call,
 * MetaMask delegation" path proven end-to-end in spike 11
 * (`spikes/11-x402-erc7710-delegation/`).
 *
 * Architecture: reuses {@link X402InferenceClient} (which already owns the OpenAI-shaped
 * request/parse + the 402 handshake) but swaps its `fetchImpl` for a PAYMENT-WRAPPED fetch
 * built from the kit's `createx402DelegationProvider` + `@x402/fetch`'s `wrapFetchWithPayment`.
 * The wrapped fetch performs the 402→sign-delegation→retry internally and returns the final
 * 200, so the client's own EIP-3009 signer is never reached (a guard stub makes that explicit).
 *
 * CRITICAL (spike-11 finding): the buyer account MUST be an EIP-7702-DELEGATED account
 * (`Implementation.Stateless7702` at the EOA address, code = `0xef0100‖gator`) or the MetaMask
 * facilitator rejects it with `invalid_exact_evm_erc7710_account_not_delegated`. The caller is
 * responsible for ensuring the session key is 7702-upgraded (see `frost` `ensureSessionDelegated`).
 */

import { createPublicClient, http } from "viem";
import type { Chain, LocalAccount } from "viem";
import { Implementation, toMetaMaskSmartAccount } from "@metamask/smart-accounts-kit";
import { createx402DelegationProvider } from "@metamask/smart-accounts-kit/experimental";
import { x402Erc7710Client } from "@metamask/x402";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import {
  X402InferenceClient,
  type SettleInfo,
  type X402FetchLike,
  type X402PaymentSigner,
} from "./x402-inference.js";

export interface DelegationInferenceConfig {
  /** Base URL of the x402-gated OpenAI-compatible API (the erc7710-mode gateway). */
  baseUrl: string;
  /** Default model when a request omits one. */
  model: string;
  /** The agent's payment account — a local key whose address is 7702-upgraded to the gator. */
  account: LocalAccount;
  /** viem chain for the buyer smart account / public client (e.g. baseSepolia). */
  chain: Chain;
  /** RPC URL for chain reads. */
  rpcUrl?: string;
  /**
   * The user's ERC-7715 permission context (`granted[0].context`). When provided, each x402
   * payment is an open REDELEGATION of the USER's granted budget (the agent spends the user's
   * USDC within the grant's caveats) instead of an open root delegation from the session
   * account's own funds. Requires `from` (the granter) and that the grant's delegate (`to`) is
   * THIS session account. Absent ⇒ the session account pays from its own balance.
   */
  parentPermissionContext?: `0x${string}`;
  /** The granter (user) address — `granted[0].from`. Required with `parentPermissionContext`. */
  from?: `0x${string}`;
  /** Settlement telemetry (UI: "payment settled"). */
  onSettle?: (info: SettleInfo) => void;
}

/** Never reached on the happy path — the wrapped fetch settles payment before the client's handshake. */
const guardSigner: X402PaymentSigner = {
  async paymentHeadersFor() {
    throw new Error(
      "x402 delegation: the payment-wrapped fetch should have settled the 402 — " +
        "the gateway likely rejected the delegation (check the account is 7702-delegated and funded).",
    );
  },
};

/**
 * Build an {@link X402InferenceClient} that pays via an ERC-7710 delegation. The returned
 * client implements the same `InferenceTransport` the planner/compiler depend on, so it drops
 * in as the PRIMARY leg of `SwitchingInferenceTransport` exactly where the EIP-3009 x402 client
 * sits — only the payment mechanism differs.
 */
export function makeDelegationInferenceClient(config: DelegationInferenceConfig): X402InferenceClient {
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  // The buyer DELEGATOR — the agent account upgraded to a MetaMask smart account via EIP-7702
  // (Stateless7702), so the smart-account address IS the account address. `client`/`signer`
  // cast `as never`: the agent's viem and the kit's bundled viem are distinct installs, so the
  // types are nominally unrelated though structurally identical (duplicate-viem gotcha).
  const buyerSmartAccountP = toMetaMaskSmartAccount({
    client: publicClient as never,
    implementation: Implementation.Stateless7702,
    address: config.account.address,
    signer: { account: config.account as never },
  });

  // The payment-handling fetch: on a 402 advertising erc7710, it asks the delegation provider
  // to mint + sign an open root delegation scoped to the payment terms, attaches it as X-PAYMENT,
  // and retries. Lazily built once (the smart account is async).
  let wrappedFetchP: Promise<typeof fetch> | undefined;
  const getWrappedFetch = async (): Promise<typeof fetch> => {
    if (!wrappedFetchP) {
      wrappedFetchP = (async () => {
        const buyerSmartAccount = await buyerSmartAccountP;
        // With a parent context → redelegate the user's granted budget; without → an open root
        // delegation from the session account's own funds.
        const providerConfig =
          config.parentPermissionContext && config.from
            ? {
                account: buyerSmartAccount,
                parentPermissionContext: config.parentPermissionContext,
                from: config.from,
              }
            : { account: buyerSmartAccount };
        const erc7710Client = new x402Erc7710Client({
          delegationProvider: createx402DelegationProvider(providerConfig as never),
        });
        const coreClient = new x402Client().register("eip155:*", erc7710Client);
        const httpClient = new x402HTTPClient(coreClient);
        return wrapFetchWithPayment(fetch, httpClient);
      })();
    }
    return wrappedFetchP;
  };

  // Adapt the wrapped fetch to the X402FetchLike signature the client calls. A standard Response
  // already satisfies X402FetchResponse (ok/status/headers.get/text).
  const fetchImpl: X402FetchLike = async (url, init) => {
    const wrapped = await getWrappedFetch();
    return wrapped(url, init as RequestInit) as unknown as ReturnType<X402FetchLike>;
  };

  return new X402InferenceClient({
    baseUrl: config.baseUrl,
    model: config.model,
    signer: guardSigner,
    fetchImpl,
    ...(config.onSettle ? { onSettle: config.onSettle } : {}),
  });
}
