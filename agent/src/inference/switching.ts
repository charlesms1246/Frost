/**
 * Budget-aware inference switcher.
 *
 * The demo wants to PROVE the paid (Venice/x402) inference path without burning the
 * small Venice credit balance: route the first N calls through `primary` (Venice),
 * then auto-switch to `fallback` (OpenRouter) for the rest of the session. A hard
 * master switch (`primaryEnabled`) forces `fallback` immediately — the kill switch
 * the UI toggles if credits run low mid-demo.
 *
 * It is itself an {@link InferenceTransport}, so the planner/compiler are oblivious:
 * they call `complete()` and the policy here decides who serves it. Every routing
 * decision is reported via `onRoute` so the UI can show "call 2/3 → Venice (paid)".
 *
 * Budget accounting is CONSERVATIVE — a call routed to `primary` consumes a budget
 * slot whether or not it succeeds (the goal is to cap potential charges, per the
 * "saves us from being overcharged" requirement). A `primary` error falls through to
 * `fallback` for that call (unless `fallbackOnError` is false) so a transient Venice
 * failure never breaks the cycle.
 */

import type {
  InferenceTransport,
  CompletionRequest,
  CompletionResponse,
  TokenUsage,
} from "./openrouter.js";

export type InferenceProvider = "primary" | "fallback";

export type RouteReason =
  | "primary" // within budget, primary enabled
  | "budget-exhausted" // primary budget spent → fallback
  | "disabled" // master switch off → fallback
  | "primary-error-fallback"; // primary threw → fallback for this call

export interface RouteInfo {
  provider: InferenceProvider;
  reason: RouteReason;
  /** Budget slots consumed so far (after this call). */
  primaryCallsUsed: number;
  primaryCallBudget: number;
  /** Present only when `reason === "primary-error-fallback"`. */
  primaryError?: string;
  /** The model that served this call (when known). */
  model?: string;
  /** Token/cost usage for this call, when the provider emitted it. */
  usage?: TokenUsage;
}

export interface SwitchingConfig {
  /** The paid path (e.g. Venice). */
  primary: InferenceTransport;
  /** The default path (e.g. OpenRouter). */
  fallback: InferenceTransport;
  /** How many calls route to `primary` before auto-switching. 0 ⇒ never use primary. */
  primaryCallBudget: number;
  /** Master switch; `false` ⇒ always `fallback`, ignoring budget. Default `true`. */
  primaryEnabled?: boolean;
  /** On a `primary` error, serve the call via `fallback`. Default `true`. */
  fallbackOnError?: boolean;
  /** Observer for every routing decision (UI / telemetry). */
  onRoute?: (info: RouteInfo) => void;
}

export interface SwitchingState {
  primaryCallsUsed: number;
  primaryCallBudget: number;
  primaryEnabled: boolean;
}

export class SwitchingInferenceTransport implements InferenceTransport {
  private readonly primary: InferenceTransport;
  private readonly fallback: InferenceTransport;
  private readonly budget: number;
  private readonly fallbackOnError: boolean;
  private readonly onRoute: ((info: RouteInfo) => void) | undefined;
  private enabled: boolean;
  private used = 0;

  constructor(config: SwitchingConfig) {
    if (!Number.isInteger(config.primaryCallBudget) || config.primaryCallBudget < 0) {
      throw new Error("SwitchingInferenceTransport: primaryCallBudget must be a non-negative integer");
    }
    this.primary = config.primary;
    this.fallback = config.fallback;
    this.budget = config.primaryCallBudget;
    this.enabled = config.primaryEnabled ?? true;
    this.fallbackOnError = config.fallbackOnError ?? true;
    this.onRoute = config.onRoute;
  }

  /** Runtime kill switch (the UI toggle). Disabling never re-enables silently. */
  setPrimaryEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get state(): SwitchingState {
    return {
      primaryCallsUsed: this.used,
      primaryCallBudget: this.budget,
      primaryEnabled: this.enabled,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (!this.enabled) {
      return this.serve(this.fallback, req, "fallback", "disabled");
    }
    if (this.used >= this.budget) {
      return this.serve(this.fallback, req, "fallback", "budget-exhausted");
    }

    // Routing to primary consumes a budget slot up front (conservative).
    this.used += 1;
    try {
      const out = await this.primary.complete(req);
      this.report("primary", "primary", out);
      return out;
    } catch (err) {
      if (!this.fallbackOnError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      return this.serve(this.fallback, req, "fallback", "primary-error-fallback", message);
    }
  }

  /** Serve via a transport, then report the route WITH the served call's model + usage. */
  private async serve(
    transport: InferenceTransport,
    req: CompletionRequest,
    provider: InferenceProvider,
    reason: RouteReason,
    primaryError?: string,
  ): Promise<CompletionResponse> {
    const out = await transport.complete(req);
    this.report(provider, reason, out, primaryError);
    return out;
  }

  private report(
    provider: InferenceProvider,
    reason: RouteReason,
    out?: CompletionResponse,
    primaryError?: string,
  ): void {
    if (!this.onRoute) return;
    const info: RouteInfo = {
      provider,
      reason,
      primaryCallsUsed: this.used,
      primaryCallBudget: this.budget,
    };
    if (primaryError !== undefined) info.primaryError = primaryError;
    if (out?.model) info.model = out.model;
    if (out?.usage) info.usage = out.usage;
    this.onRoute(info);
  }
}
