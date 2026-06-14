import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * The PRODUCTION root-authority path: obtain the user's authorization from their
 * own MetaMask, instead of the funded demo session key (`liveSdkIssuer`).
 *
 * This drives the existing wallet bridge end-to-end from the embedded runtime:
 *   1. Build the ERC-7715 permission spec via the Rust `permission_spec` builders
 *      (`build_erc20_token_periodic_permission`) — the single source of the Flask
 *      13.32 schema (`wallet-bridge-spec.md` §4).
 *   2. Drive the Tauri bridge (`wallet_bridge_perform`, op `grant_permissions`): it
 *      opens the user's browser to `xfrost.vercel.app/connect/grant-permissions`,
 *      the user reviews + approves in MetaMask Flask, and the signed grant POSTs
 *      back to the local callback server.
 *   3. Return the ERC-7715 `granted` delegation.
 *
 * IMPORTANT — what this grant IS vs. is NOT (the open design decision):
 *   - The grant is an ERC-7715 token-PERIODIC spending delegation to `sessionAccount`
 *     (the master agent). It lets that account spend up to `periodAmount` of the user's
 *     tokens per period, enforced by MetaMask's Delegation Manager.
 *   - It is NOT the Frost `Mandate` contract's caveat-tree root (what
 *     `createLiveRootMandate`/`liveSdkIssuer` write). Connecting the two — so the
 *     executor spends the USER's tokens via an ERC-7710 redelegation chain rather
 *     than the server wallet's own funds — is the remaining production integration.
 *
 * `invoke` is injectable so the spec-build → bridge sequence is unit-testable
 * without a live Tauri shell.
 */

export type InvokeFn = <T>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface MetaMaskGrantOptions {
  /** The delegate the permission is granted TO — the master-agent session account. */
  sessionAccount: `0x${string}`;
  /** ERC-20 the session may spend (e.g. USDC on Base Sepolia). */
  tokenAddress: `0x${string}`;
  /**
   * Per-period spend cap, hex base-units (e.g. 10 USDC = `0x989680`). The periodic
   * enforcer resets this allowance at the start of each new period — no front-loading
   * needed (unlike the stream variant). `erc20-token-periodic` is the type MetaMask's
   * Advanced Permissions grant UI fully supports (stream fell through to the blocked
   * raw-delegation path; periodic grants cleanly — verified live, see ERRORS.MD).
   */
  periodAmountHex: string;
  /** Period length in seconds (e.g. 86400 = 1 day); the cap resets each period. */
  periodDurationSecs: number;
  /** Session lifetime, seconds (becomes the ERC-7715 expiry rule). */
  expirySecs: number;
  /** Human justification shown in the bridge preview + MetaMask. */
  justification: string;
  /** Optional override; defaults to Base Sepolia (`0x14a34`) in the Rust builder. */
  chainIdHex?: string;
}

/** What the bridge callback delivers (`web/.../grant-permissions` POSTs `{ challenge, granted, ts }`). */
export interface MetaMaskGrant {
  /** The ERC-7715 granted delegation, exact shape from MetaMask Smart Accounts Kit. */
  granted: unknown;
}

interface WalletOperationResult {
  challenge: string;
  body: { challenge: string; granted?: unknown; error?: string };
}

export async function requestMetaMaskGrant(
  opts: MetaMaskGrantOptions,
  invoke: InvokeFn = tauriInvoke,
): Promise<MetaMaskGrant> {
  // 1 — build the ERC-7715 spec in Rust (the schema lives there, not here).
  const specArgs: Record<string, unknown> = {
    session_account: opts.sessionAccount,
    token_address: opts.tokenAddress,
    period_amount_hex: opts.periodAmountHex,
    period_duration_secs: opts.periodDurationSecs,
    expiry_secs: opts.expirySecs,
    justification: opts.justification,
  };
  if (opts.chainIdHex) specArgs["chain_id_hex"] = opts.chainIdHex;
  const spec = await invoke<unknown>("build_erc20_token_periodic_permission", {
    args: specArgs,
  });

  // 2 — drive the bridge: browser → MetaMask → callback. The user approves manually.
  const result = await invoke<WalletOperationResult>("wallet_bridge_perform", {
    args: { operation: "grant_permissions", params: spec, timeout_secs: 300 },
  });

  if (result.body.error) {
    throw new Error(`MetaMask grant failed: ${result.body.error}`);
  }
  if (result.body.granted === undefined) {
    throw new Error("MetaMask grant returned no permission");
  }
  return { granted: result.body.granted };
}
