/**
 * Venice inference client — the PAID thinking path.
 *
 * Venice's `/chat/completions` is OpenAI-compatible and draws the call's cost down
 * from the account's prepaid balance (USD / VCU / x402 wallet credits). It is the
 * "paid per call" inference the demo exercises so the no-free-lunch thesis is
 * demonstrable end-to-end. The locked decision (2026-05-28) keeps OpenRouter as the
 * DEFAULT thinking path; Venice is used for a bounded number of demo calls and then
 * the runtime switches back (see {@link SwitchingInferenceTransport}) so the small
 * Venice credit balance is never overspent.
 *
 * Implements the same {@link InferenceTransport} the planner/compiler depend on, so
 * it drops in anywhere OpenRouter does. `fetch` is injectable for offline tests.
 *
 * NOTE: this uses Bearer API-key auth. Swapping in `venice-x402-client` for true
 * wallet-based x402 settlement (SIWE + signed USDC payment) is the production
 * upgrade; the transport seam is identical, so nothing downstream changes.
 */

import type {
  InferenceTransport,
  CompletionRequest,
  CompletionResponse,
  FetchLike,
} from "./openrouter.js";

export interface VeniceInferenceConfig {
  apiKey: string;
  /** Default model when a request omits one. */
  model: string;
  /** Override for tests / self-hosting. Defaults to the Venice API base. */
  baseUrl?: string;
  /** Inject a fake in tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
}

const DEFAULT_BASE_URL = "https://api.venice.ai/api/v1";

export class VeniceInferenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "VeniceInferenceError";
  }
}

export class VeniceInferenceClient implements InferenceTransport {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: VeniceInferenceConfig) {
    if (!config.apiKey) throw new Error("VeniceInferenceClient: apiKey is required");
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const injected = config.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as FetchLike;
    } else {
      throw new Error("VeniceInferenceClient: no fetch available; pass config.fetchImpl");
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const body: Record<string, unknown> = {
      model: req.model || this.model,
      messages: req.messages,
      temperature: req.temperature ?? 0,
    };
    if (req.json) body["response_format"] = { type: "json_object" };

    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new VeniceInferenceError(
        `Venice inference request failed (${res.status})`,
        res.status,
        raw,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new VeniceInferenceError("Venice returned non-JSON body", res.status, raw);
    }

    const data = parsed as {
      id?: string;
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new VeniceInferenceError(
        "Venice response missing choices[0].message.content",
        res.status,
        raw,
      );
    }

    return {
      text,
      model: data.model ?? (req.model || this.model),
      id: data.id ?? "",
    };
  }
}
