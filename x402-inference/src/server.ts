/**
 * x402-inference gateway — a self-deployed endpoint that EMULATES Venice's
 * native-x402 inference.
 *
 * Frost's thesis is "no API keys — pay per inference call in USDC over x402."
 * Venice is the reference provider for that model, but its 100 req/min cap +
 * per-call billing can't sustain continuous agent thinking, and the available
 * Venice credit balance is too small for the demo (HANDOFF "Locked decisions",
 * 2026-06-10 amendment). So this gateway puts a REAL x402 paywall in FRONT of
 * OpenRouter/Grok compute:
 *
 *   client → POST /v1/chat/completions (no payment) → 402 PAYMENT-REQUIRED
 *          → client signs an EIP-3009 USDC transferWithAuthorization on Base
 *          → POST again with X-PAYMENT → 1Shot facilitator verifies + settles
 *          → gateway proxies the call to OpenRouter (default) / Grok (fallback)
 *          → OpenAI-shaped completion returned, X-PAYMENT-RESPONSE attached.
 *
 * The /chat/completions interface is OpenAI/Venice-identical, so a client pointed
 * here via `baseUrl` (the agent's `VeniceInferenceClient`/`OpenRouterClient`
 * transport seam) needs no shape change — swapping back to real Venice is a
 * base-URL change. NOTE: the PAYMENT MODEL differs from Venice's — this gateway
 * gates PER CALL (one settlement per inference), whereas Venice uses a wallet
 * credit top-up that inference draws down. Per-call gating is the stronger demo
 * story (one visible on-chain USDC settlement per call) and closes gap IG-04.
 */

import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { Network } from "@x402/express";
import type { RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { create1ShotAPIFacilitatorClient } from "@1shotapi/x402-facilitator";
import { proxyCompletion, UpstreamError, type UpstreamConfig } from "./upstream.js";

// Best-effort .env load (Node ≥20.12). Env may also be supplied by the parent process.
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* no .env file — rely on the ambient environment */
}

const PORT = Number(process.env.PORT ?? 4021);
const NETWORK = (process.env.X402_NETWORK ?? "eip155:84532") as Network;
const PRICE = process.env.X402_PRICE ?? "$0.001";
const PAY_TO = process.env.EVM_ADDRESS ?? "";
const BYPASS = process.env.X402_BYPASS === "true";

const ONESHOT_API_KEY = process.env.ONESHOT_API_KEY ?? "";
const ONESHOT_API_SECRET = process.env.ONESHOT_API_SECRET ?? "";

const upstream: UpstreamConfig = {
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterModel: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
};

// The two OpenAI-compatible inference paths this gateway exposes (both gated).
const CHAT_PATHS = ["/v1/chat/completions", "/chat/completions"];

const app = express();
app.use(express.json({ limit: "2mb" }));

// Ungated liveness probe (never behind the paywall).
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    mode: BYPASS ? "bypass" : "x402",
    network: NETWORK,
    price: PRICE,
    payTo: PAY_TO || null,
    upstream: {
      openrouter: upstream.openRouterApiKey !== "",
      groq: upstream.groqApiKey !== "",
    },
  });
});

// Mount the x402 paywall over the chat paths — unless explicitly bypassed for dev.
if (!BYPASS) {
  if (!PAY_TO) {
    throw new Error("EVM_ADDRESS (x402 payTo) is required unless X402_BYPASS=true");
  }
  const facilitator = create1ShotAPIFacilitatorClient({
    apiKey: ONESHOT_API_KEY,
    apiSecret: ONESHOT_API_SECRET,
  });
  const resourceServer = new x402ResourceServer(facilitator).register(
    NETWORK,
    new ExactEvmScheme(),
  );
  const routes: RoutesConfig = Object.fromEntries(
    CHAT_PATHS.map((p) => [
      `POST ${p}`,
      {
        accepts: { scheme: "exact", price: PRICE, network: NETWORK, payTo: PAY_TO },
        description: "x402-gated LLM inference (OpenRouter/Grok compute)",
        mimeType: "application/json",
      },
    ]),
  );
  // Sync supported payment kinds from the facilitator on startup (default on).
  // Set X402_SYNC_ON_START=false to skip the network round-trip in dev/offline.
  const syncOnStart = process.env.X402_SYNC_ON_START !== "false";
  app.use(paymentMiddleware(routes, resourceServer, undefined, undefined, syncOnStart));
} else {
  console.warn("[x402-inference] X402_BYPASS=true — paywall DISABLED. Dev/test only.");
}

// The handler runs only AFTER payment has settled (or always, in bypass mode):
// proxy the OpenAI-compatible body to the compute and relay the response verbatim.
const handleChat: express.RequestHandler = async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { status, raw, servedBy } = await proxyCompletion(upstream, body);
    res.status(status).type("application/json").setHeader("x-frost-served-by", servedBy);
    res.send(raw);
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    res.status(status).json({ error: { message, type: "upstream_error" } });
  }
};
for (const p of CHAT_PATHS) app.post(p, handleChat);

app.listen(PORT, () => {
  console.log(
    `[x402-inference] listening on :${PORT} — mode=${BYPASS ? "bypass" : "x402"} ` +
      `network=${NETWORK} price=${PRICE} payTo=${PAY_TO || "(none)"}`,
  );
});
