import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { config } from "$lib/stores/config.svelte";
import { chats } from "$lib/stores/chats.svelte";
import { customAgents } from "$lib/stores/custom-agents.svelte";
import { profile } from "$lib/stores/profile.svelte";
import { cloudSession } from "$lib/cloud";
import { TauriKeyStore } from "$lib/key-store";
import type { InvokeFn } from "$lib/agent/metamask-issuer";

/**
 * Full sign-out hygiene. Because all user data (incl. the ERC-7715 grant) lives in
 * localStorage, signing out must (1) REVOKE the on-chain delegation so a later user
 * on the same machine can't reuse the granted authority, and (2) WIPE every persisted
 * store. Revocation is best-effort — if MetaMask is unreachable or declined, local
 * data is still wiped and the error surfaced; the grant lapses at its expiry anyway.
 */

/** Pull the ERC-7715 permissions `context` hex out of the stored `granted` blob. */
function grantContextHex(grantJson?: string): string | undefined {
  if (!grantJson) return undefined;
  try {
    const g = JSON.parse(grantJson) as { context?: unknown } | Array<{ context?: unknown }>;
    const ctx = Array.isArray(g) ? g[0]?.context : g?.context;
    return typeof ctx === "string" && ctx.startsWith("0x") ? ctx : undefined;
  } catch {
    return undefined;
  }
}

interface WalletOperationResult {
  body: { error?: string };
}

/**
 * Revoke the active grant on-chain via the wallet bridge (`/connect/revoke` →
 * `disableDelegation` signed in MetaMask). Returns false (no-op) when there is no
 * grant; throws on a bridge-reported error.
 */
export async function revokeActiveGrant(invoke: InvokeFn = tauriInvoke): Promise<boolean> {
  const context = grantContextHex(config.value.metaMaskGrant);
  if (!context) return false;
  const result = await invoke<WalletOperationResult>("wallet_bridge_perform", {
    args: { operation: "revoke", params: { permissionContext: context }, timeout_secs: 300 },
  });
  if (result.body?.error) throw new Error(result.body.error);
  return true;
}

export interface SignOutResult {
  revoked: boolean;
  revokeError?: string;
}

export interface SignOutDeps {
  invoke?: InvokeFn;
  keyStore?: { delete(id: string): Promise<void> };
}

export async function signOut(deps: SignOutDeps = {}): Promise<SignOutResult> {
  const invoke = deps.invoke ?? tauriInvoke;
  let revoked = false;
  let revokeError: string | undefined;

  // 1 — kill the on-chain authority while we still hold the grant.
  if (config.value.metaMaskGrant) {
    try {
      revoked = await revokeActiveGrant(invoke);
    } catch (e) {
      revokeError = e instanceof Error ? e.message : String(e);
    }
  }

  // 2 — purge any session key the app minted (best-effort).
  const sessionAccount = config.value.sessionAccount;
  if (sessionAccount) {
    try {
      await (deps.keyStore ?? new TauriKeyStore()).delete(sessionAccount);
    } catch {
      /* no key / not in vault — fine */
    }
  }

  // 3 — wipe everything persisted locally (the grant blob, chats, agents, profile,
  //     and the cloud session JWT — the cloud data itself persists server-side).
  config.clear();
  chats.clearAll();
  customAgents.clearAll();
  profile.clear();
  cloudSession.clear();

  return revokeError ? { revoked, revokeError } : { revoked };
}
