import { browser } from "$app/environment";
import { pullCloud, pushCloud } from "./sync";

/**
 * The hosted-backend session: holds the SIWE JWT and drives debounced sync.
 *
 * The token is persisted to localStorage for MVP (a Tauri webview loads only local
 * + the trusted bridge, so the XSS surface is low). Moving it to the OS keyring
 * (`TauriKeyStore`) is the hardening path — sign-out already wipes it either way.
 */
const STORAGE_KEY = "frost.cloud.jwt";
const PUSH_DEBOUNCE_MS = 1500;

function load(): string | null {
  if (!browser) return null;
  return localStorage.getItem(STORAGE_KEY);
}

function createCloudSession() {
  let token = $state<string | null>(load());
  let lastError = $state<string | null>(null);
  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    get token() {
      return token;
    },
    get signedIn() {
      return !!token;
    },
    get lastError() {
      return lastError;
    },
    setToken(next: string) {
      token = next;
      if (browser) localStorage.setItem(STORAGE_KEY, next);
    },
    clear() {
      token = null;
      if (pushTimer) clearTimeout(pushTimer);
      if (browser) localStorage.removeItem(STORAGE_KEY);
    },
    /** Pull cloud data into the local stores (restore on sign-in). */
    async pull(): Promise<boolean> {
      if (!token) return false;
      try {
        const existed = await pullCloud(token);
        lastError = null;
        return existed;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        return false;
      }
    },
    /** Debounced push of the local stores to the cloud — call after any local change. */
    schedulePush() {
      if (!token || !browser) return;
      const t = token;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        void pushCloud(t).then(
          () => {
            lastError = null;
          },
          (e: unknown) => {
            lastError = e instanceof Error ? e.message : String(e);
          },
        );
      }, PUSH_DEBOUNCE_MS);
    },
  };
}

export const cloudSession = createCloudSession();
