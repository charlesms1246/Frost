import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Production cloud sign-in: drive the wallet bridge `sign_message` op. The browser
 * `/connect/sign` page runs the full SIWE handshake (MetaMask `personal_sign` →
 * same-origin /api/auth) and posts back a finished session JWT, so the desktop app
 * gets a token in one round-trip. `personal_sign` is a basic signature — it does NOT
 * touch the ERC-7715 permissions snap, so this is decoupled from the flaky grant flow.
 *
 * `invoke` is injectable so the call shape is unit-testable without a Tauri shell.
 */
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface WalletOperationResult {
  challenge: string;
  body: { challenge: string; token?: string; address?: string; error?: string };
}

export async function bridgeCloudSignIn(
  invoke: InvokeFn = tauriInvoke,
): Promise<{ token: string; address: string }> {
  const result = await invoke<WalletOperationResult>("wallet_bridge_perform", {
    args: { operation: "sign_message", params: {}, timeout_secs: 300 },
  });
  if (result.body.error) throw new Error(`Cloud sign-in failed: ${result.body.error}`);
  if (!result.body.token) throw new Error("Cloud sign-in returned no token");
  return { token: result.body.token, address: result.body.address ?? "" };
}
