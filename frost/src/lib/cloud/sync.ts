import { cloudUrl, type FetchLike } from "./client";
import { profile } from "$lib/stores/profile.svelte";
import { config } from "$lib/stores/config.svelte";
import { chats, type Conversation } from "$lib/stores/chats.svelte";
import { customAgents, type StoredAgent } from "$lib/stores/custom-agents.svelte";

/**
 * The user data the desktop app round-trips with the hosted backend. NO secrets:
 * never the session key, never the live ERC-7715 grant — those are per-device and
 * re-established by re-delegating on a new device. The 1Shot signing wallet IS synced
 * (a custodial address + id, NO key) so the same agent wallet follows the user across
 * devices instead of re-provisioning a new one on each sign-in.
 */
export type CloudUserData = {
  profile?: { displayName?: string; email?: string; avatarDataUrl?: string };
  signingWallet?: { address?: string; walletId?: string };
  chats?: Conversation[];
  automations?: StoredAgent[];
};

/** Snapshot the local stores into the cloud payload. */
export function collectLocalData(): CloudUserData {
  const p = profile.value;
  const c = config.value;
  return {
    profile: {
      displayName: p.displayName,
      email: p.email,
      ...(p.avatarDataUrl ? { avatarDataUrl: p.avatarDataUrl } : {}),
    },
    ...(c.signingWalletAddress || c.signingWalletId
      ? {
          signingWallet: {
            ...(c.signingWalletAddress ? { address: c.signingWalletAddress } : {}),
            ...(c.signingWalletId ? { walletId: c.signingWalletId } : {}),
          },
        }
      : {}),
    chats: chats.list,
    automations: customAgents.list,
  };
}

/** Hydrate the local stores from a cloud payload (restore on sign-in). */
export function applyCloudData(data: CloudUserData): void {
  if (data.profile) profile.update(data.profile);
  if (data.signingWallet) {
    config.update({
      ...(data.signingWallet.address ? { signingWalletAddress: data.signingWallet.address } : {}),
      ...(data.signingWallet.walletId ? { signingWalletId: data.signingWallet.walletId } : {}),
    });
  }
  if (Array.isArray(data.chats)) chats.hydrate(data.chats);
  if (Array.isArray(data.automations)) customAgents.hydrate(data.automations);
}

/** Fetch this user's data and hydrate the local stores. Returns true if data existed. */
export async function pullCloud(token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const res = await fetchImpl(cloudUrl("/api/user"), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`cloud pull failed (${res.status})`);
  const { data } = (await res.json()) as { data?: CloudUserData | null };
  if (!data) return false;
  applyCloudData(data);
  return true;
}

/** Push the current local data to the cloud. Returns true on success. */
export async function pushCloud(token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const res = await fetchImpl(cloudUrl("/api/user"), {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(collectLocalData()),
  });
  return res.ok;
}
