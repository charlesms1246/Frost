/**
 * Upstream inference compute — the LLM work that happens AFTER an x402 payment
 * settles. OpenRouter is the default compute; Grok is the fallback (this mirrors
 * the agent runtime's locked compute choice: Venice's rate cap + per-call billing
 * can't sustain continuous thinking, so the x402 rail sits in FRONT of OpenRouter/
 * Grok rather than in front of Venice models — see HANDOFF "Locked decisions",
 * 2026-06-10 amendment).
 *
 * The gateway is OpenAI-compatible end-to-end: it accepts a standard
 * `/chat/completions` body and returns the upstream's JSON verbatim, so a client
 * pointed at this gateway via `baseUrl` (the `VeniceInferenceClient` /
 * `OpenRouterClient` transport seam) needs no shape changes.
 */

export interface UpstreamConfig {
  openRouterApiKey: string;
  openRouterModel: string;
  groqApiKey: string;
  groqModel: string;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const GROQ_BASE = "https://api.groq.com/openai/v1";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** One upstream leg. Pins the model to the leg's own id (a Venice/OpenRouter model
 *  id is invalid on Groq and vice-versa), exactly like the agent transport's `pin`. */
async function callUpstream(
  base: string,
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
): Promise<{ status: number; raw: string }> {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, model }),
  });
  return { status: res.status, raw: await res.text() };
}

/**
 * Proxy a chat-completions body to the compute. Tries OpenRouter; on any error
 * (or missing OpenRouter key) falls through to Grok. Returns the raw upstream body
 * + status so the gateway relays it verbatim (OpenAI-compatible).
 */
export async function proxyCompletion(
  cfg: UpstreamConfig,
  body: Record<string, unknown>,
): Promise<{ status: number; raw: string; servedBy: "openrouter" | "groq" }> {
  const canOpenRouter = cfg.openRouterApiKey.trim() !== "";
  const canGroq = cfg.groqApiKey.trim() !== "";

  if (canOpenRouter) {
    try {
      const out = await callUpstream(OPENROUTER_BASE, cfg.openRouterApiKey, cfg.openRouterModel, body);
      if (out.status >= 200 && out.status < 300) {
        return { ...out, servedBy: "openrouter" };
      }
      // Non-2xx from OpenRouter → fall through to Grok if we can.
      if (!canGroq) return { ...out, servedBy: "openrouter" };
    } catch (err) {
      if (!canGroq) {
        throw new UpstreamError(
          `OpenRouter request failed and no Groq fallback configured: ${String(err)}`,
          502,
          "",
        );
      }
    }
  }

  if (canGroq) {
    const out = await callUpstream(GROQ_BASE, cfg.groqApiKey, cfg.groqModel, body);
    return { ...out, servedBy: "groq" };
  }

  throw new UpstreamError("No upstream compute configured (set OPENROUTER_API_KEY or GROQ_API_KEY)", 500, "");
}
