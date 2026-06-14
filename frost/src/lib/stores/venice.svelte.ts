import { browser } from "$app/environment";
import { VENICE_DISABLED } from "$lib/flags";

const STORAGE_KEY = "frost.venice.disabled";

/**
 * Runtime Venice kill switch — the live, toggleable form of the build-time
 * `PUBLIC_DISABLE_VENICE` flag (`$lib/flags`). When `disabled` is true the app makes
 * NO Venice calls anywhere: inference routes to the fallback provider (OpenRouter/Groq),
 * RPC reads/quotes use a public Base RPC, and the Venice-only augment tools are off.
 *
 * It exists as a store (not just the env const) so the title-bar toggle can flip Venice
 * on/off ON CAMERA during the demo — showing the "no-API-keys x402 inference" story
 * without editing `.env` and restarting. The env flag is the initial seed; a runtime
 * toggle persists in localStorage so it survives a reload.
 */
function load(): boolean {
  if (!browser) return VENICE_DISABLED;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return VENICE_DISABLED; // no runtime override yet → seed from the env flag
}

function createVeniceKill() {
  let disabled = $state<boolean>(load());

  return {
    /** True ⇒ NO Venice calls anywhere (cost-control kill switch). */
    get disabled() {
      return disabled;
    },
    /** True ⇒ Venice is the live paid x402 inference + RPC provider. */
    get enabled() {
      return !disabled;
    },
    set(next: boolean) {
      disabled = next;
      if (browser) localStorage.setItem(STORAGE_KEY, String(next));
    },
    toggle() {
      this.set(!disabled);
    },
  };
}

export const veniceKill = createVeniceKill();
