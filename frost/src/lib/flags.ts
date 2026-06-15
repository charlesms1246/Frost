import { env } from "$env/dynamic/public";

/**
 * Build-time feature flags from `PUBLIC_*` env vars (frost/.env).
 *
 * `VENICE_DISABLED` is the BUILD-TIME seed for the Venice cost-control kill switch:
 * when set, the app starts with NO Venice calls anywhere — inference routes to the
 * fallback provider (OpenRouter/Groq), RPC reads/quotes use a public Base RPC, and the
 * Venice-only augment tools (web_search / fetch_url) are disabled. The LIVE switch is
 * the `veniceKill` store (`$lib/stores/venice.svelte`), which the title-bar toggle
 * flips on camera during the demo — this const is only its initial value.
 */
export const VENICE_DISABLED = env.PUBLIC_DISABLE_VENICE === "true";

/** Public Base mainnet RPC used for reads/quotes when Venice is disabled or keyless. */
export const FALLBACK_BASE_RPC_URL =
  env.PUBLIC_FALLBACK_BASE_RPC_URL || "https://mainnet.base.org";

/**
 * Base URL of the self-hosted x402 inference gateway (the `x402-inference` package).
 * When set AND a signing account is available (demo creds loaded), `buildTransport`
 * routes the PRIMARY paid leg through it (pay-per-call USDC over x402) instead of the
 * Bearer-key Venice client. Empty ⇒ the x402 primary is off (config-driven path).
 */
export const X402_INFERENCE_URL = env.PUBLIC_X402_INFERENCE_URL || "";

/**
 * x402 payment mechanism for the inference primary. `"erc3009"` (default) signs an EIP-3009
 * USDC `transferWithAuthorization` (the proven IG-04 path, settled via 1Shot). `"erc7710"`
 * pays with a MetaMask Smart Account ERC-7710 delegation, settled via MetaMask's sentinel
 * facilitator — the purist "MetaMask Smart Accounts + x402 + delegation" path (spike 11). When
 * `erc7710`, the gateway must run with `X402_ASSET_TRANSFER_METHOD=erc7710` AND the agent
 * session key is 7702-upgraded to the gator at run start (`ensureSessionDelegated`).
 */
export const X402_ASSET_TRANSFER_METHOD: "erc3009" | "erc7710" =
  env.PUBLIC_X402_ASSET_TRANSFER_METHOD === "erc7710" ? "erc7710" : "erc3009";

/**
 * Base URL of the Frost hosted backend (the `web/` app: SIWE auth + MongoDB-backed
 * user sync of profile / chats / automations), deployed at xfrost.vercel.app. The
 * app uses the deployed backend in BOTH dev and release so a `tauri dev` build reads
 * the live DB. Set `PUBLIC_CLOUD_API_URL=http://localhost:3000` in `frost/.env` to
 * point at a locally-running `web/` server instead.
 */
export const CLOUD_API_URL = env.PUBLIC_CLOUD_API_URL || "https://xfrost.vercel.app";
