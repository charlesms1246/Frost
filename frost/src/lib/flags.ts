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

/**
 * Base URL of the self-hosted x402 inference gateway (the `x402-inference` package).
 * When set AND a signing account is available (demo creds loaded), `buildTransport`
 * routes the PRIMARY paid leg through it (pay-per-call USDC over x402) instead of the
 * Bearer-key Venice client. Empty ⇒ the x402 primary is off (config-driven path).
 */
export const X402_INFERENCE_URL = env.PUBLIC_X402_INFERENCE_URL || "";
