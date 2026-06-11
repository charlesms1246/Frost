import {
  OpenRouterClient,
  VeniceInferenceClient,
  SwitchingInferenceTransport,
  X402InferenceClient,
  makeEvmX402Signer,
} from "@frost/agent/browser";
import type { InferenceTransport, RouteInfo, SettleInfo } from "@frost/agent/browser";
import type { LocalAccount } from "viem";
import { config, fallbackKeyOf } from "$lib/stores/config.svelte";
import { VENICE_DISABLED } from "$lib/flags";

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
  /**
   * When provided, the PRIMARY (paid) leg is the self-hosted x402 inference gateway
   * (Phase B): each call settles a real USDC-on-Base payment signed by `account`,
   * then proxies to OpenRouter/Grok. Replaces the Bearer-key Venice client as primary.
   * Supplied by callers that hold a signing account (e.g. `/runtime` with demo creds);
   * absent everywhere else, so the config-driven path is unchanged.
   */
  x402?: { baseUrl: string; account: LocalAccount; network: string; rpcUrl?: string };
  /** Settlement telemetry for the x402 primary (UI: "payment settled"). */
  onSettle?: (info: SettleInfo) => void;
}): BuiltTransport {
  const c = config.value;
  const primaryEnabled = opts?.primaryEnabled ?? true;

  // Each provider client is constructed with its OWN model; a caller-supplied
  // `model` is provider-specific (a Venice model id is invalid on Groq/OpenRouter
  // and vice-versa), so pin every leg to its constructed model — otherwise a Groq
  // fallback receives a Venice model id and errors. (`req.model || this.model`.)
  const pin = (t: InferenceTransport): InferenceTransport => ({
    complete: (req) => t.complete({ ...req, model: "" }),
  });

  const makeFallback = (): InferenceTransport => {
    const isGroq = c.fallbackProvider === "groq";
    return new OpenRouterClient({
      apiKey: isGroq ? c.groqApiKey : c.openRouterApiKey,
      model: c.fallbackModels[0],
      ...(isGroq ? { baseUrl: "https://api.groq.com/openai/v1" } : {}),
    });
  };

  // VENICE_DISABLED (cost control) forces the fallback path everywhere — no Venice calls.
  const hasVenice = !VENICE_DISABLED && c.veniceApiKey.trim() !== "" && c.veniceModels[0].trim() !== "";
  const hasFallback = fallbackKeyOf(c).trim() !== "" && c.fallbackModels[0].trim() !== "";
  // The model string must match the active leg (pinning makes it moot, but keep it honest).
  const model = hasVenice ? c.veniceModels[0] : c.fallbackModels[0];

  // Phase B: the x402 gateway is the PRIMARY paid leg when a signing account is supplied.
  // It pays per call in USDC and proxies to OpenRouter/Grok, so the budget guard + kill
  // switch still bound spend exactly as with the Bearer Venice primary.
  const x402 = opts?.x402;
  const makePrimary = (): InferenceTransport =>
    x402
      ? new X402InferenceClient({
          baseUrl: x402.baseUrl,
          model,
          signer: makeEvmX402Signer({
            // Duplicate-viem gotcha (see frost/CLAUDE.md): frost and @frost/agent
            // resolve separate viem copies, so the LocalAccount types are nominally
            // distinct though structurally identical — bridge with `as never`.
            account: x402.account as never,
            network: x402.network,
            ...(x402.rpcUrl ? { rpcUrl: x402.rpcUrl } : {}),
          }),
          ...(opts?.onSettle ? { onSettle: opts.onSettle } : {}),
        })
      : new VeniceInferenceClient({ apiKey: c.veniceApiKey, model: c.veniceModels[0] });

  if ((hasVenice || x402) && hasFallback) {
    const switcher = new SwitchingInferenceTransport({
      primary: pin(makePrimary()),
      fallback: pin(makeFallback()),
      primaryCallBudget: c.veniceCallBudget,
      primaryEnabled,
      ...(opts?.onRoute ? { onRoute: opts.onRoute } : {}),
    });
    return { transport: switcher, switcher, model };
  }

  const transport = pin(
    hasVenice || x402 ? makePrimary() : makeFallback(),
  );
  return { transport, model };
}
