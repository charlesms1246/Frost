import type { Hex } from "viem";

/**
 * Batched JSON-RPC transport for the pricer/monitor read path.
 *
 * Venice Crypto-RPC caps at 100 req/min/key, and — critically — a JSON-RPC batch
 * of N entries counts as ONE request (verified in Day-1 spike 2). So the pricer
 * MUST send its reads as a single batch to fit the demo cadence; per-request mode
 * does not. The {@link Pricer} depends only on {@link RpcTransport} so it is
 * unit-testable with a mock; {@link VeniceRpcClient} is the production impl, with
 * an injectable `fetch` so it too is testable without a live network.
 *
 * This is the read-side use of Venice that the architecture retains — NOT the
 * agent thinking path (that is OpenRouter) and NOT the executor write path (that
 * is 1Shot, threat T-21).
 */

export interface RpcCall {
  method: string;
  params: unknown[];
}

export interface RpcResult {
  /** The JSON-RPC `result` (for `eth_call`, the returned data) when successful. */
  result?: Hex;
  error?: { code: number; message: string };
}

/** The minimal read surface the pricer needs: one network round-trip per batch. */
export interface RpcTransport {
  batch(calls: RpcCall[]): Promise<RpcResult[]>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface VeniceRpcConfig {
  apiKey: string;
  /** Venice network slug, e.g. "base" (mainnet) or "base-sepolia". */
  network: string;
  /** Override for tests / self-hosting. */
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

const DEFAULT_BASE_URL = "https://api.venice.ai/api/v1/crypto/rpc";

export class VeniceRpcClient implements RpcTransport {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: VeniceRpcConfig) {
    if (!config.apiKey) throw new Error("VeniceRpcClient: apiKey is required");
    if (!config.network) throw new Error("VeniceRpcClient: network is required");
    this.apiKey = config.apiKey;
    this.url = `${config.baseUrl ?? DEFAULT_BASE_URL}/${config.network}`;
    const injected = config.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as FetchLike;
    } else {
      throw new Error("VeniceRpcClient: no fetch available; pass config.fetchImpl");
    }
  }

  async batch(calls: RpcCall[]): Promise<RpcResult[]> {
    if (calls.length === 0) return [];
    const body = calls.map((c, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: c.method,
      params: c.params,
    }));

    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();

    // Venice returns a non-array envelope (single error object) on transport-level
    // failures — notably 429 rate limits (spike 2). Surface that as one error per
    // requested call so the caller can classify every source uniformly.
    if (res.status >= 400 || !text.trim().startsWith("[")) {
      const message = extractError(text) ?? text.slice(0, 200);
      const err = { code: res.status, message };
      return calls.map(() => ({ error: err }));
    }

    const parsed = JSON.parse(text) as Array<{
      id: number;
      result?: Hex;
      error?: { code: number; message: string };
    }>;

    // JSON-RPC batch responses may arrive out of order — index by id.
    const byId = new Map(parsed.map((p) => [p.id, p]));
    return calls.map((_, i): RpcResult => {
      const p = byId.get(i);
      if (!p) return { error: { code: -1, message: `no response for call ${i}` } };
      if (p.error) return { error: p.error };
      // A successful JSON-RPC response with no `result` is treated as empty by
      // the caller; never set `result: undefined` (exactOptionalPropertyTypes).
      return p.result === undefined ? {} : { result: p.result };
    });
  }
}

function extractError(text: string): string | null {
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof j.error === "string") return j.error;
    return j.error?.message ?? null;
  } catch {
    return null;
  }
}
