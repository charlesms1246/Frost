import { env } from "$env/dynamic/public";

/**
 * Build-time feature flags from `PUBLIC_*` env vars (frost/.env).
 *
 * `VENICE_DISABLED` is a hard cost-control kill switch: when set, the app makes NO
 * Venice calls anywhere — inference routes to the fallback provider (OpenRouter/Groq),
 * RPC reads/quotes use a public Base RPC, and the Venice-only augment tools
 * (web_search / fetch_url) are disabled. Flip it back for the demo.
 */
export const VENICE_DISABLED = env.PUBLIC_DISABLE_VENICE === "true";

/** Public Base mainnet RPC used for reads/quotes when Venice is disabled or keyless. */
export const FALLBACK_BASE_RPC_URL = env.PUBLIC_FALLBACK_BASE_RPC_URL || "https://mainnet.base.org";
