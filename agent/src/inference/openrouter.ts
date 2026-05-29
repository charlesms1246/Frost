/**
 * OpenRouter inference client.
 *
 * OpenRouter is the locked inference provider for the master agent and sub-agent
 * runtime (HANDOFF "Locked decisions", flipped 2026-05-28). Venice is NOT called
 * from the thinking path — it stays as read-side RPC + the x402-paid demo path.
 *
 * The planner depends only on the {@link InferenceTransport} interface, so unit
 * tests inject a deterministic mock. {@link OpenRouterClient} is the production
 * implementation; its `fetch` is injectable so it, too, is testable without a
 * live network.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  /** 0 = deterministic. Planning runs cool. */
  temperature?: number;
  /** Ask the model to emit a single JSON object. */
  json?: boolean;
}

export interface CompletionResponse {
  /** The assistant message content. */
  text: string;
  /** Model that actually served the request (OpenRouter may reroute). */
  model: string;
  /** Generation id — used as the PlanningEntry `inferenceCallId` cross-reference. */
  id: string;
}

/** The minimal inference surface the planner needs. */
export interface InferenceTransport {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}

/** Minimal `fetch` shape we rely on — lets tests inject a fake. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface OpenRouterConfig {
  apiKey: string;
  /** Default model when a request omits one. */
  model: string;
  /** Override for tests / self-hosting. */
  baseUrl?: string;
  /** Inject a fake in tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export class OpenRouterClient implements InferenceTransport {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: OpenRouterConfig) {
    if (!config.apiKey) throw new Error("OpenRouterClient: apiKey is required");
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const injected = config.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as FetchLike;
    } else {
      throw new Error(
        "OpenRouterClient: no fetch available; pass config.fetchImpl",
      );
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
      throw new OpenRouterError(
        `OpenRouter request failed (${res.status})`,
        res.status,
        raw,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new OpenRouterError(
        "OpenRouter returned non-JSON body",
        res.status,
        raw,
      );
    }

    const data = parsed as {
      id?: string;
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new OpenRouterError(
        "OpenRouter response missing choices[0].message.content",
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
