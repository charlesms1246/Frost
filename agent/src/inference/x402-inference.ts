/**
 * x402 inference transport — the CLIENT half of the native-x402 inference path.
 *
 * Points at an x402-gated, OpenAI-compatible `/chat/completions` (the self-hosted
 * `x402-inference` gateway, or real Venice). On the first `402 PAYMENT-REQUIRED`
 * it acquires an `X-PAYMENT` header (an EIP-3009 USDC `transferWithAuthorization`
 * signed by the agent's payment wallet) via the injected {@link X402PaymentSigner}
 * and retries — so the runtime pays per inference call in USDC, no API keys
 * (HANDOFF "Locked decisions", 2026-06-10 amendment).
 *
 * It implements the same {@link InferenceTransport} the planner/compiler depend on,
 * so it drops in as the `primary` leg of {@link SwitchingInferenceTransport} exactly
 * where {@link VeniceInferenceClient} sits today — base-URL is the only difference.
 *
 * SEAM DISCIPLINE: the EIP-712 signing + the x402 SDK live behind `X402PaymentSigner`
 * (see `x402-signer.ts` for the real EVM implementation). This file owns only the
 * HTTP handshake, so it is unit-testable with a fake signer and no key/RPC.
 */

import type {
  InferenceTransport,
  CompletionRequest,
  CompletionResponse,
} from "./openrouter.js";
import { parseUsage } from "./openrouter.js";

/** Minimal response shape we need — adds header access on top of {@link FetchLike}. */
export interface X402FetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** `fetch`-like that surfaces response headers (for `PAYMENT-REQUIRED` / settlement). */
export type X402FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<X402FetchResponse>;

/**
 * The payment seam. Given a `402` response's headers + parsed body, return the
 * request headers (e.g. `{ "X-PAYMENT": "..." }`) to retry the call with. The real
 * implementation signs an EIP-3009 USDC authorization; tests inject a fake.
 */
export interface X402PaymentSigner {
  paymentHeadersFor(input: {
    getHeader: (name: string) => string | null | undefined;
    body: unknown;
  }): Promise<Record<string, string>>;
}

/** Settlement telemetry (UI: "payment settled for call N"). Best-effort. */
export interface SettleInfo {
  /** Raw `X-PAYMENT-RESPONSE` header value, if the gateway returned one. */
  paymentResponse: string | null;
}

export interface X402InferenceConfig {
  /** Base URL of the x402-gated OpenAI-compatible API (no trailing `/chat/completions`). */
  baseUrl: string;
  /** Default model when a request omits one. */
  model: string;
  /** Acquires the `X-PAYMENT` header on a 402 (real impl signs EIP-3009). */
  signer: X402PaymentSigner;
  /** Inject a fake in tests; defaults to the global `fetch`. */
  fetchImpl?: X402FetchLike;
  /** Observer for each settled payment (UI / telemetry). */
  onSettle?: (info: SettleInfo) => void;
}

export class X402InferenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "X402InferenceError";
  }
}

export class X402InferenceClient implements InferenceTransport {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly signer: X402PaymentSigner;
  private readonly fetchImpl: X402FetchLike;
  private readonly onSettle: ((info: SettleInfo) => void) | undefined;

  constructor(config: X402InferenceConfig) {
    if (!config.baseUrl) throw new Error("X402InferenceClient: baseUrl is required");
    if (!config.signer) throw new Error("X402InferenceClient: signer is required");
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.signer = config.signer;
    const injected = config.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as X402FetchLike;
    } else {
      throw new Error("X402InferenceClient: no fetch available; pass config.fetchImpl");
    }
    this.onSettle = config.onSettle;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const payload: Record<string, unknown> = {
      model: req.model || this.model,
      messages: req.messages,
      temperature: req.temperature ?? 0,
    };
    if (req.json) payload["response_format"] = { type: "json_object" };
    const body = JSON.stringify(payload);
    const url = `${this.baseUrl}/chat/completions`;
    const baseHeaders = { "Content-Type": "application/json" };

    // First attempt — no payment.
    const first = await this.fetchImpl(url, { method: "POST", headers: baseHeaders, body });
    if (first.ok) return this.parse(first, req);

    if (first.status !== 402) {
      throw new X402InferenceError(
        `x402 inference request failed (${first.status})`,
        first.status,
        await first.text(),
      );
    }

    // 402 → acquire an X-PAYMENT header and retry once.
    const firstBodyText = await first.text();
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(firstBodyText);
    } catch {
      parsedBody = undefined;
    }
    const paymentHeaders = await this.signer.paymentHeadersFor({
      getHeader: (name) => first.headers.get(name),
      body: parsedBody,
    });

    const paid = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...baseHeaders, ...paymentHeaders },
      body,
    });

    if (!paid.ok) {
      throw new X402InferenceError(
        `x402 inference retry-with-payment failed (${paid.status})`,
        paid.status,
        await paid.text(),
      );
    }

    if (this.onSettle) {
      this.onSettle({ paymentResponse: paid.headers.get("x-payment-response") });
    }
    return this.parse(paid, req);
  }

  private async parse(res: X402FetchResponse, req: CompletionRequest): Promise<CompletionResponse> {
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new X402InferenceError("x402 inference returned non-JSON body", res.status, raw);
    }
    const data = parsed as {
      id?: string;
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new X402InferenceError(
        "x402 inference response missing choices[0].message.content",
        res.status,
        raw,
      );
    }
    const usage = parseUsage(data);
    return { text, model: data.model ?? (req.model || this.model), id: data.id ?? "", ...(usage ? { usage } : {}) };
  }
}
