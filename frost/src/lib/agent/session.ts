import {
  Session,
  Planner,
  OpenRouterClient,
  VeniceInferenceClient,
  SwitchingInferenceTransport,
  VeniceRpcClient,
  Pricer,
  uniswapV3Source,
  Monitor,
  priceThresholdCondition,
  CommsAgent,
  DiscordWebhookPoster,
  encodeCommsTemplate,
  defaultCaveatEncoder,
  nonceCounter,
  sessionContextFrom,
  BASE_SEPOLIA_DEPLOYMENT,
  type CompiledSpec,
  type TaskSpec,
  type SessionConfig,
  type SessionState,
  type SessionContext,
  type SubAgentRunner,
  type SubMandateIssuer,
  type HolderProvisioner,
  type CustomAgentRegistry,
  type InferenceTransport,
  type RouteInfo,
  type SessionObserver,
} from "@frost/agent/browser";
import type { Address, Hex } from "viem";
import { makeExecutorRunner, type ExecutorRunnerOptions } from "./executor-runner";

/**
 * The webview embedding of the Frost master-agent runtime.
 *
 * `@frost/agent` is pure TypeScript with injectable seams, so it runs directly in
 * the Tauri webview — no sidecar. This factory assembles a {@link Session} from
 * browser-appropriate boundaries: the OpenRouter thinking path, the Venice read
 * path (pricer/monitor), and the Discord comms path all over the webview `fetch`;
 * EOA-holder keys via the Rust-backed key store (injected as `provisionHolder`).
 *
 * The CHAIN-WRITE seams (`issue` = sub-mandate issuance, and the executor's 1Shot
 * submit) stay injected and are NOT wired live here — they are gated on the wallet
 * bridge + explicit approval. The route passes a simulated issuer for the demo;
 * tests pass a mock. That keeps the embedding runnable end-to-end today without
 * moving funds, with one clean seam to flip when issuance goes live.
 */

/** A `fetch` shaped for the agent clients (satisfies OpenRouter/Venice/Discord). */
export type WebFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const BASE_MAINNET = {
  weth: "0x4200000000000000000000000000000000000006" as Address,
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  // QuoterV2 — confirm on BaseScan before relying on it (see ERRORS.MD).
  quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as Address,
};

export interface EmbeddedSessionOptions {
  /** The signed session spec (from the compiler). */
  spec: CompiledSpec;
  /** Session + root-mandate identifiers (from issuance; provided by the caller). */
  sessionId: Hex;
  rootMandateId: Hex;

  /** OpenRouter (thinking path / fallback). */
  openRouterApiKey: string;
  model: string;

  /**
   * Venice PAID inference (the demo's x402 thinking path). When set, the planner
   * routes its first `primaryCallBudget` calls through Venice, then auto-switches to
   * OpenRouter — so the small Venice balance is never overspent. Omitted ⇒ pure
   * OpenRouter (unchanged behavior).
   */
  veniceInferenceApiKey?: string;
  /** Venice inference model (defaults to `model`). */
  veniceInferenceModel?: string;
  /** Calls served by Venice before switching to OpenRouter. Default 3. */
  primaryCallBudget?: number;
  /** Master kill switch; `false` ⇒ OpenRouter only. Default `true`. */
  primaryEnabled?: boolean;
  /** Observer for each inference routing decision (UI badge / telemetry). */
  onInferenceRoute?: (info: RouteInfo) => void;

  /**
   * A pre-built thinking transport to use verbatim (e.g. a switcher already shared
   * with the compile step, so the Venice call budget spans compile + planning). When
   * given, the keys/budget options above are ignored for the planner. If it is a
   * `SwitchingInferenceTransport`, it is surfaced as `inferenceSwitch` for the UI.
   */
  inferenceTransport?: InferenceTransport;

  /** Venice (read path) — pricer + monitor. */
  veniceApiKey: string;
  veniceNetwork?: string;

  /** Discord comms (optional; the comms runner is wired only when present). */
  discordWebhookUrl?: string;
  /** Values for the comms template's variables at send time. */
  commsValues?: Record<string, string>;

  /** Saved custom agents, for routing custom role labels. */
  registry?: CustomAgentRegistry;

  /** Live event sink — the dashboard feeds this into the delegation-tree store. */
  observer?: SessionObserver;

  /**
   * Optional LIVE executor: 1Shot creds + a pre-registered contract method + the
   * swap to submit. When present, a planned `executor` role runs the §10.3 preflight
   * and submits through 1Shot's private mempool. Omitted ⇒ executor dispatches as
   * "no runner for behavior" (the prior default). `context`/`spec` are supplied here.
   */
  executor?: Omit<ExecutorRunnerOptions, "context" | "spec">;

  /**
   * A ready-made executor `SubAgentRunner` (e.g. the simulated HITL-demo runner).
   * Takes precedence over `executor` — used directly as the executor behavior runner.
   */
  executorRunner?: SubAgentRunner;

  // --- Deferred chain-write seams (injected; simulated in the demo, mocked in tests) ---
  /** Issues one sub-mandate. NOT wired live here — pending the wallet bridge + approval. */
  issue: SubMandateIssuer;
  /** Resolves/provisions the holder address for a sub-mandate (EOA via the key store). */
  provisionHolder: HolderProvisioner;

  /** Boundary override for tests; defaults to the webview `fetch`. */
  fetchImpl?: WebFetch;
}

export interface EmbeddedSession {
  session: Session;
  context: SessionContext;
  /**
   * The inference switcher, present only when `veniceInferenceApiKey` was supplied.
   * The UI uses it to show "call N/budget → Venice" and to flip the kill switch
   * (`setPrimaryEnabled(false)`) if Venice credits run low mid-demo.
   */
  inferenceSwitch?: SwitchingInferenceTransport;
}

export function createEmbeddedSession(opts: EmbeddedSessionOptions): EmbeddedSession {
  const fetchImpl: WebFetch =
    opts.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  const network = opts.veniceNetwork ?? "base-mainnet";

  // Thinking path: OpenRouter by default. When a Venice inference key is supplied,
  // wrap both in the budget-aware switcher so the first few calls settle via Venice
  // (paid/x402) and the rest fall back to OpenRouter — protecting the Venice balance.
  let transport: InferenceTransport;
  let inferenceSwitch: SwitchingInferenceTransport | undefined;
  if (opts.inferenceTransport) {
    // Caller-shared transport (e.g. the compile/run switcher) — use as-is.
    transport = opts.inferenceTransport;
    if (opts.inferenceTransport instanceof SwitchingInferenceTransport) {
      inferenceSwitch = opts.inferenceTransport;
    }
  } else {
    const openRouter = new OpenRouterClient({ apiKey: opts.openRouterApiKey, model: opts.model, fetchImpl });
    transport = openRouter;
    if (opts.veniceInferenceApiKey) {
      const veniceInference = new VeniceInferenceClient({
        apiKey: opts.veniceInferenceApiKey,
        model: opts.veniceInferenceModel ?? opts.model,
        fetchImpl,
      });
      const switchConfig = {
        primary: veniceInference,
        fallback: openRouter,
        primaryCallBudget: opts.primaryCallBudget ?? 3,
        primaryEnabled: opts.primaryEnabled ?? true,
        ...(opts.onInferenceRoute ? { onRoute: opts.onInferenceRoute } : {}),
      };
      inferenceSwitch = new SwitchingInferenceTransport(switchConfig);
      transport = inferenceSwitch;
    }
  }

  const planner = new Planner({ transport, model: opts.model });

  const venice = new VeniceRpcClient({ apiKey: opts.veniceApiKey, network, fetchImpl });

  const context = sessionContextFrom(opts.spec, BASE_SEPOLIA_DEPLOYMENT);

  // --- Sub-agent runners (the live read/comms paths). Executor is omitted: its
  // 1Shot submit is the deferred live-write path, so a planned executor dispatches
  // as "no runner for behavior" rather than acting. ---
  const runners: NonNullable<SessionConfig["runners"]> = {
    pricer: async ({ outcome }) => {
      const sources = [500, 3000].map((fee) => uniswapV3Source({ quoter: BASE_MAINNET.quoter, fee }));
      const res = await new Pricer(venice).quote(
        { tokenIn: BASE_MAINNET.weth, tokenOut: BASE_MAINNET.usdc, amountIn: 10n ** 18n },
        sources,
      );
      return {
        role: outcome.role,
        ran: res.best !== null,
        detail: res.best
          ? `best ${res.best.source} → ${res.best.amountOut}`
          : `no quote (${res.failed.map((f) => f.error).join("; ")})`,
      };
    },
    monitor: async ({ outcome }) => {
      const condition = priceThresholdCondition({
        quoter: BASE_MAINNET.quoter,
        tokenIn: BASE_MAINNET.weth,
        tokenOut: BASE_MAINNET.usdc,
        amountIn: 10n ** 18n,
        fee: 500,
        threshold: 10n ** 30n,
        direction: "below",
      });
      const r = await new Monitor(venice).check(condition);
      return { role: outcome.role, ran: r.status !== "error", detail: r.status };
    },
  };

  if (opts.discordWebhookUrl && opts.spec.commsTemplate) {
    const template = opts.spec.commsTemplate;
    const poster = new DiscordWebhookPoster(opts.discordWebhookUrl, fetchImpl);
    runners.comms = async ({ outcome }) => {
      // Bind to the SAME committed template the mandate carries (H-14).
      const mandate = { caveats: [encodeCommsTemplate(template)] };
      const res = await new CommsAgent({ poster }).post(mandate, {
        template,
        values: opts.commsValues ?? {},
      });
      return {
        role: outcome.role,
        ran: res.status === "posted",
        detail: res.status === "posted" ? "posted" : (res as { reason?: string }).reason ?? res.status,
      };
    };
  }

  if (opts.executorRunner) {
    runners.executor = opts.executorRunner;
  } else if (opts.executor) {
    runners.executor = makeExecutorRunner({ ...opts.executor, context, spec: opts.spec });
  }

  const config: SessionConfig = {
    planner,
    context,
    translate: {
      issue: opts.issue,
      encodeCaveats: defaultCaveatEncoder,
      provisionHolder: opts.provisionHolder,
      nextNonce: nonceCounter(1n),
    },
    runners,
  };
  if (opts.registry) config.registry = opts.registry;
  if (opts.observer) config.observer = opts.observer;

  const spec: TaskSpec = {
    sessionId: opts.sessionId,
    rootMandateId: opts.rootMandateId,
    description: opts.spec.description,
    redelegationBounds: opts.spec.redelegationBounds,
  };
  const state: SessionState = {
    spec,
    redelegation: { subMandateCount: 0, aggregateSubMandateBudget: 0n },
    bucket: { available: opts.spec.rateLimit.capacity, capacity: opts.spec.rateLimit.capacity },
  };

  const embedded: EmbeddedSession = { session: new Session(config, state), context };
  if (inferenceSwitch) embedded.inferenceSwitch = inferenceSwitch;
  return embedded;
}
