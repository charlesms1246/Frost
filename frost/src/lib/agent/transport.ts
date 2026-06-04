import {
  OpenRouterClient,
  VeniceInferenceClient,
  SwitchingInferenceTransport,
} from "@frost/agent/browser";
import type { InferenceTransport, RouteInfo } from "@frost/agent/browser";
import { config, fallbackKeyOf } from "$lib/stores/config.svelte";

/**
 * Build the inference transport from the persisted config — the single place
 * every page (runtime, master chat, agent creator) turns config into a thinking
 * path. Venice (x402) is primary; the chosen provider (OpenRouter/Groq) is the
 * fallback. Returns the switcher too (when both are present) so callers can flip
 * the Venice kill switch.
 */
export type BuiltTransport = {
  transport: InferenceTransport;
  switcher?: SwitchingInferenceTransport;
  model: string;
};

export function buildTransport(opts?: {
  primaryEnabled?: boolean;
  onRoute?: (info: RouteInfo) => void;
}): BuiltTransport {
  const c = config.value;
  const primaryEnabled = opts?.primaryEnabled ?? true;
  const model = config.primaryModel;

  const makeFallback = (): InferenceTransport => {
    const isGroq = c.fallbackProvider === "groq";
    return new OpenRouterClient({
      apiKey: isGroq ? c.groqApiKey : c.openRouterApiKey,
      model: c.fallbackModels[0],
      ...(isGroq ? { baseUrl: "https://api.groq.com/openai/v1" } : {}),
    });
  };

  const hasVenice = c.veniceApiKey.trim() !== "" && c.veniceModels[0].trim() !== "";
  const hasFallback = fallbackKeyOf(c).trim() !== "" && c.fallbackModels[0].trim() !== "";

  if (hasVenice && hasFallback) {
    const venice = new VeniceInferenceClient({ apiKey: c.veniceApiKey, model: c.veniceModels[0] });
    const switcher = new SwitchingInferenceTransport({
      primary: venice,
      fallback: makeFallback(),
      primaryCallBudget: c.veniceCallBudget,
      primaryEnabled,
      ...(opts?.onRoute ? { onRoute: opts.onRoute } : {}),
    });
    return { transport: switcher, switcher, model };
  }

  const transport = hasVenice
    ? new VeniceInferenceClient({ apiKey: c.veniceApiKey, model: c.veniceModels[0] })
    : makeFallback();
  return { transport, model };
}
