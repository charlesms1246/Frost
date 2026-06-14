import {
  OpenRouterClient,
  VeniceInferenceClient,
  SwitchingInferenceTransport,
  X402InferenceClient,
  makeEvmX402Signer,
  makeDelegationInferenceClient,
} from "@frost/agent/browser";
import type { InferenceTransport, RouteInfo, SettleInfo } from "@frost/agent/browser";
import type { LocalAccount } from "viem";
import { baseSepolia } from "viem/chains";
import { config, fallbackKeyOf } from "$lib/stores/config.svelte";
import { veniceKill } from "$lib/stores/venice.svelte";

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
  x402?: {
    baseUrl: string;
    account: LocalAccount;
    network: string;
    rpcUrl?: string;
    /**
     * Payment mechanism for the x402 primary. "erc3009" (default) signs an EIP-3009 USDC
     * transferWithAuthorization; "erc7710" pays with a MetaMask Smart Account ERC-7710
     * delegation (the buyer account must be 7702-upgraded to the gator — see
     * `ensureSessionDelegated`). Proven end-to-end in spike 11 + the agent smoke.
     */
    assetTransferMethod?: "erc3009" | "erc7710";
    /**
     * (erc7710 only) The user's ERC-7715 permission context + granter. When set, each x402
     * payment REDELEGATES the user's granted budget (the agent spends the USER's USDC within
     * the grant's caveats) rather than the session account's own funds.
     */
    parentPermissionContext?: `0x${string}`;
    from?: `0x${string}`;
  };
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

  // The Venice kill switch (cost control / live title-bar toggle) forces the fallback
  // path everywhere — no Venice calls. Read at build time so a live toggle takes effect
  // on the next transport build.
  const hasVenice = !veniceKill.disabled && c.veniceApiKey.trim() !== "" && c.veniceModels[0].trim() !== "";
  const hasFallback = fallbackKeyOf(c).trim() !== "" && c.fallbackModels[0].trim() !== "";
  // The model string must match the active leg (pinning makes it moot, but keep it honest).
  const model = hasVenice ? c.veniceModels[0] : c.fallbackModels[0];

  // Phase B: the x402 gateway is the PRIMARY paid leg when a signing account is supplied.
  // It pays per call in USDC and proxies to OpenRouter/Grok, so the budget guard + kill
  // switch still bound spend exactly as with the Bearer Venice primary.
  const x402 = opts?.x402;
  const makePrimary = (): InferenceTransport => {
    if (!x402) return new VeniceInferenceClient({ apiKey: c.veniceApiKey, model: c.veniceModels[0] });
    // Duplicate-viem gotcha (see frost/CLAUDE.md): frost and @frost/agent resolve separate
    // viem copies, so the LocalAccount types are nominally distinct though structurally
    // identical — bridge with `as never`.
    if (x402.assetTransferMethod === "erc7710") {
      // MetaMask-Smart-Account native path: each call settles USDC via a signed ERC-7710
      // delegation (no EIP-3009 authorization). The gateway must run in erc7710 mode and the
      // account must be 7702-upgraded to the gator (ensured by the caller).
      return makeDelegationInferenceClient({
        baseUrl: x402.baseUrl,
        model,
        account: x402.account as never,
        chain: baseSepolia as never,
        ...(x402.rpcUrl ? { rpcUrl: x402.rpcUrl } : {}),
        ...(x402.parentPermissionContext && x402.from
          ? { parentPermissionContext: x402.parentPermissionContext, from: x402.from }
          : {}),
        ...(opts?.onSettle ? { onSettle: opts.onSettle } : {}),
      });
    }
    return new X402InferenceClient({
      baseUrl: x402.baseUrl,
      model,
      signer: makeEvmX402Signer({
        account: x402.account as never,
        network: x402.network,
        ...(x402.rpcUrl ? { rpcUrl: x402.rpcUrl } : {}),
      }),
      ...(opts?.onSettle ? { onSettle: opts.onSettle } : {}),
    });
  };

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
