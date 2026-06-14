import { browser } from "$app/environment";

/**
 * The signed-in user's profile. Captured at signup, editable in settings, and
 * designed to SYNC with the hosted web app (xfrost.vercel.app). Persisted
 * locally so the desktop app remembers you between launches.
 *
 * Auth model (per 2026-06-04 direction): the functional gate is wallet-connect /
 * key entry (already core to the agent flow). This profile is the cosmetic
 * identity layer — display name, email, and a profile picture — that the hosted
 * page mirrors. `syncToHosted` is the seam to that mirror (no backend wired yet).
 */
export type Profile = {
  displayName: string;
  email: string;
  /** Profile picture as a small data URL (kept inline; no asset server needed). */
  avatarDataUrl?: string;
  /** Connected wallet, when present — the real auth identity. */
  walletAddress?: string;
};

const STORAGE_KEY = "frost.profile";

const EMPTY: Profile = { displayName: "", email: "" };

function load(): Profile {
  if (!browser) return { ...EMPTY };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

/** Injectable transport so the hosted-sync seam is unit-testable. */
export type ProfileSyncFn = (profile: Profile) => Promise<void>;

function createProfile() {
  let current = $state<Profile>(load());
  let synced = $state(false);
  let syncing = $state(false);

  function persist() {
    if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  }

  return {
    get value() {
      return current;
    },
    /** True once a non-empty profile has been captured. */
    get signedIn() {
      return current.displayName.trim().length > 0 || !!current.walletAddress;
    },
    get syncing() {
      return syncing;
    },
    get synced() {
      return synced;
    },
    /** Merge a partial update and persist. */
    update(patch: Partial<Profile>) {
      current = { ...current, ...patch };
      synced = false;
      persist();
    },
    clear() {
      current = { ...EMPTY };
      synced = false;
      persist();
    },
    /**
     * Push the profile to the hosted web app. The transport is injected so the
     * desktop app can wire it to the real endpoint (or a Tauri command) without
     * this store knowing the URL. Resolves true on success.
     */
    async syncToHosted(send: ProfileSyncFn): Promise<boolean> {
      syncing = true;
      try {
        await send(current);
        synced = true;
        return true;
      } catch {
        synced = false;
        return false;
      } finally {
        syncing = false;
      }
    },
  };
}

export const profile = createProfile();
