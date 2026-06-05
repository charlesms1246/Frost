/**
 * Client for the 1Shot PUBLIC RELAYER (EIP-7710 gas-abstracted delegated txs).
 *
 * This is the KEYLESS execution path: the user's MetaMask ERC-7715 grant is signed
 * `to` the relayer's `targetAddress`; the relayer redeems the delegation on-chain and
 * is paid a per-tx fee in an ERC-20 stablecoin (USDC on Base). NO custodial server
 * wallet, no API key, no business account — the "no keys to manage" thesis end-to-end.
 *
 * Pure JSON-RPC over `fetch` (injectable), so it runs in the webview and is unit
 * testable offline. The decode of the grant's `context` into `permissionContext`
 * (`@metamask/smart-accounts-kit/utils` `decodeDelegations`) and the calldata encoding
 * are the CALLER's job — this client only speaks the `relayer_*` methods.
 *
 * Endpoints (by chain): mainnets → relayer.1shotapi.com; Sepolia / Base Sepolia →
 * relayer.1shotapi.dev. See the `public-relayer` skill for the full protocol.
 */

export type RelayerFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const RELAYER_MAINNET_URL = "https://relayer.1shotapi.com/relayers";
export const RELAYER_TESTNET_URL = "https://relayer.1shotapi.dev/relayers";

/** Sepolia (11155111) and Base Sepolia (84532) use the testnet relayer; others mainnet. */
export function relayerUrlForChain(chainId: string | number): string {
  const id = String(chainId);
  return id === "11155111" || id === "84532" ? RELAYER_TESTNET_URL : RELAYER_MAINNET_URL;
}

export interface ChainCapabilities {
  feeCollector: `0x${string}`;
  /** The address the grant delegation MUST be signed `to` so the relayer can redeem. */
  targetAddress: `0x${string}`;
  tokens: { address: `0x${string}`; symbol?: string; decimals: number | string }[];
}

export interface RelayerFeeData {
  gasPrice: `0x${string}`;
  rate: number;
  minFee: string;
  expiry?: number;
  context?: string;
  feeCollector: `0x${string}`;
  targetAddress?: `0x${string}`;
  token: { address: `0x${string}`; decimals: number };
}

export interface Estimate7710Result {
  success: boolean;
  requiredPaymentAmount?: string;
  gasUsed?: Record<string, string>;
  context?: string;
  contextByChainId?: Record<string, string>;
  paymentTokenAddress?: `0x${string}`;
  paymentChain?: number;
  error?: string;
}

export interface RelayerExecution {
  target: `0x${string}`;
  value: string;
  data: `0x${string}`;
}

export interface RelayerTransaction {
  /** Decoded delegations (grant `context` → `decodeDelegations` → `toRelayerJson`). */
  permissionContext: unknown[];
  executions: RelayerExecution[];
}

export interface Send7710Params {
  chainId: string;
  /** Signed price-lock context from the matching estimate (required on send). */
  context?: string;
  destinationUrl?: string;
  memo?: string;
  authorizationList?: unknown[];
  transactions: RelayerTransaction[];
}

export interface RelayerStatus {
  status: 100 | 110 | 200 | 400 | 500;
  memo?: string;
  hash?: string;
  receipt?: object;
  message?: string;
  data?: unknown;
}

type JsonRpcResponse<T> =
  | { jsonrpc: "2.0"; id: number | string; result: T }
  | { jsonrpc: "2.0"; id: number | string; error: { code: number; message: string; data?: unknown } };

export interface RelayerConfig {
  /** Override the JSON-RPC URL; defaults to `relayerUrlForChain(chainId)`. */
  url?: string;
  /** Chain used to pick the default URL when `url` is omitted. */
  chainId?: string | number;
  fetchImpl?: RelayerFetch;
}

/** Convert delegation bigints / Uint8Arrays into JSON-safe shapes for the relayer. */
export function toRelayerJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (value instanceof Uint8Array) {
    let hex = "0x";
    for (const b of value) hex += b.toString(16).padStart(2, "0");
    return hex;
  }
  if (Array.isArray(value)) return value.map(toRelayerJson);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toRelayerJson(v);
    return out;
  }
  return value;
}

export class RelayerClient {
  private readonly url: string;
  private readonly fetchImpl: RelayerFetch;
  private id = 0;

  constructor(config: RelayerConfig = {}) {
    this.url = config.url ?? relayerUrlForChain(config.chainId ?? 84532);
    const injected = config.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as RelayerFetch;
    } else {
      throw new Error("RelayerClient: no fetch available; pass config.fetchImpl");
    }
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    const json = (await res.json()) as JsonRpcResponse<T>;
    if (!res.ok) throw new Error(`relayer ${method} HTTP ${res.status}: ${JSON.stringify(json)}`);
    if ("error" in json) {
      throw new Error(`relayer ${method} [${json.error.code}] ${json.error.message} ${JSON.stringify(json.error.data ?? "")}`);
    }
    return json.result;
  }

  /** Discover `targetAddress`, `feeCollector`, and accepted tokens per chain (cache it). */
  getCapabilities(chainIds: string[]): Promise<Record<string, ChainCapabilities>> {
    return this.rpc("relayer_getCapabilities", chainIds);
  }

  /** Rough fee quote before the signed bundle exists (price display / permission UX). */
  getFeeData(params: { chainId: string; token: `0x${string}` }): Promise<RelayerFeeData> {
    return this.rpc("relayer_getFeeData", params);
  }

  /** Simulate the signed bundle: returns `requiredPaymentAmount` + a signed price-lock `context`. */
  estimate7710Transaction(params: Send7710Params): Promise<Estimate7710Result> {
    return this.rpc("relayer_estimate7710Transaction", params);
  }

  /** Submit the bundle (pass `context` from the matching estimate). Returns the task id. */
  send7710Transaction(params: Send7710Params): Promise<string> {
    return this.rpc("relayer_send7710Transaction", params);
  }

  getStatus(params: { id: string; logs?: boolean }): Promise<RelayerStatus> {
    return this.rpc("relayer_getStatus", params);
  }
}
