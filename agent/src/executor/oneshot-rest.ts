import type { OneShotContractMethodsApi } from "./oneshot-submitter.js";

/**
 * `fetch`-based 1Shot clients implementing the executor's submission seam via the
 * 1Shot REST API DIRECTLY — no `@1shotapi/client-sdk`, so they run in the webview
 * (the SDK is Node-only). REST shapes taken verbatim from the SDK's own HTTP layer
 * (`dist/client.js` + `dist/categories/{contractMethods,wallets}.js`):
 *   - OAuth2 client-credentials: `POST {base}/token` → `{ access_token, expires_in }`.
 *   - `POST {base}/methods/{id}/execute` → `Transaction` (server-wallet funds).
 *   - `POST {base}/methods/{id}/executeAsDelegator` → `Transaction` (delegator funds,
 *     i.e. the user's, via an ERC-7710 chain in `delegationData`).
 *   - `POST {base}/wallets/{id}/delegations/redelegate` → the redelegation chain.
 *
 * SECURITY: holds the 1Shot `apiKey`/`apiSecret` in the caller's context — in the
 * webview that is the renderer (demo-OK; PRODUCTION should proxy via a Rust command).
 */

export type OneShotFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; statusText: string; json(): Promise<unknown> }>;

export interface OneShotRestConfig {
  apiKey: string;
  apiSecret: string;
  /** Defaults to `https://api.1shotapi.com/v0`. */
  baseUrl?: string;
  fetchImpl?: OneShotFetch;
}

interface OneShotTransaction {
  id: string;
  status: string;
  transactionHash: string | null;
}

const DEFAULT_BASE_URL = "https://api.1shotapi.com/v0";
/** Refresh the token this many ms before it actually expires. */
const TOKEN_SAFETY_MS = 30_000;

/** Shared OAuth2 token management + resolved `fetch`/`baseUrl` for the REST clients. */
class OneShotAuth {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  readonly baseUrl: string;
  readonly fetchImpl: OneShotFetch;

  constructor(private readonly config: OneShotRestConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error("OneShotRest: apiKey and apiSecret are required");
    }
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const injected = config.fetchImpl;
    if (injected) {
      this.fetchImpl = injected;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as OneShotFetch;
    } else {
      throw new Error("OneShotRest: no fetch available; pass config.fetchImpl");
    }
  }

  async token(): Promise<string> {
    if (this.accessToken && this.tokenExpiresAt > Date.now()) return this.accessToken;
    const res = await this.fetchImpl(`${this.baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.config.apiKey,
        client_secret: this.config.apiSecret,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`1Shot token request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000 - TOKEN_SAFETY_MS;
    return this.accessToken;
  }
}

export class OneShotRestMethods implements OneShotContractMethodsApi {
  private readonly auth: OneShotAuth;

  constructor(config: OneShotRestConfig) {
    this.auth = new OneShotAuth(config);
  }

  private async post(path: string, body: Record<string, unknown>, label: string): Promise<OneShotTransaction> {
    const token = await this.auth.token();
    const res = await this.auth.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`1Shot ${label} failed: ${res.status} ${res.statusText}`);
    }
    const tx = (await res.json()) as OneShotTransaction;
    return { id: tx.id, status: tx.status, transactionHash: tx.transactionHash ?? null };
  }

  async execute(
    contractMethodId: string,
    params: Record<string, unknown>,
    options?: { walletId?: string; value?: string; memo?: string },
  ): Promise<OneShotTransaction> {
    const body: Record<string, unknown> = { params };
    if (options?.walletId !== undefined) body["walletId"] = options.walletId;
    if (options?.memo !== undefined) body["memo"] = options.memo;
    if (options?.value !== undefined) body["value"] = options.value;
    return this.post(`/methods/${contractMethodId}/execute`, body, "execute");
  }

  async executeAsDelegator(
    contractMethodId: string,
    params: Record<string, unknown>,
    options?: { walletId?: string; value?: string; memo?: string; delegationData?: string[] },
  ): Promise<OneShotTransaction> {
    const body: Record<string, unknown> = { params };
    if (options?.walletId !== undefined) body["walletId"] = options.walletId;
    if (options?.memo !== undefined) body["memo"] = options.memo;
    if (options?.value !== undefined) body["value"] = options.value;
    // 1Shot rejects empty delegationData — only send when populated.
    if (options?.delegationData && options.delegationData.length > 0) {
      body["delegationData"] = options.delegationData;
    }
    return this.post(`/methods/${contractMethodId}/executeAsDelegator`, body, "executeAsDelegator");
  }
}

/**
 * Server-wallet creation/listing via the 1Shot REST API (webview-safe — no Node SDK).
 * Creates a CUSTODIAL wallet (1Shot holds the key) scoped to a business + chain.
 *
 * Path A use: the SESSION wallet that becomes the DELEGATE (`to`) of the user's
 * ERC-7715 grant. 1Shot can then sign the redelegation to the executor
 * (`redelegateWithDelegationData` requires the wallet to BE the grant's delegate).
 * Routes mirror the SDK's `wallets.create`/`wallets.list`
 * (`POST/GET /business/{businessId}/wallets`).
 */
export interface CreatedWallet {
  walletId: string;
  accountAddress: string;
  name?: string;
}

export class OneShotRestWallets {
  private readonly auth: OneShotAuth;

  constructor(config: OneShotRestConfig) {
    this.auth = new OneShotAuth(config);
  }

  async create(
    businessId: string,
    params: { chainId: number; name: string; description?: string },
  ): Promise<CreatedWallet> {
    const token = await this.auth.token();
    const body: Record<string, unknown> = { chainId: params.chainId, name: params.name };
    if (params.description !== undefined) body["description"] = params.description;
    const res = await this.auth.fetchImpl(`${this.auth.baseUrl}/business/${businessId}/wallets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`1Shot create wallet failed: ${res.status} ${res.statusText}`);
    }
    const w = (await res.json()) as { id: string; accountAddress: string; name?: string };
    return { walletId: w.id, accountAddress: w.accountAddress, ...(w.name !== undefined ? { name: w.name } : {}) };
  }

  /** Read-only list (paginated `{ response: Wallet[] }`) — used to keep provisioning idempotent. */
  async list(businessId: string): Promise<CreatedWallet[]> {
    const token = await this.auth.token();
    const res = await this.auth.fetchImpl(`${this.auth.baseUrl}/business/${businessId}/wallets`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`1Shot list wallets failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { response?: Array<{ id: string; accountAddress: string; name?: string }> };
    return (body.response ?? []).map((w) => ({
      walletId: w.id,
      accountAddress: w.accountAddress,
      ...(w.name !== undefined ? { name: w.name } : {}),
    }));
  }
}

/**
 * The redelegation step of the ERC-7710 chain. The session wallet (holding the
 * user's ERC-7715 grant) redelegates to the executor's address; the returned chain
 * (root→leaf) is passed as `delegationData` to `executeAsDelegator`.
 */
export interface RedelegateResult {
  /** Parent + child delegations as serialized JSON strings (root→leaf). */
  delegationData: string[];
}

export class OneShotRestDelegations {
  private readonly auth: OneShotAuth;

  constructor(config: OneShotRestConfig) {
    this.auth = new OneShotAuth(config);
  }

  async redelegate(
    sessionWalletId: string,
    parentDelegationData: string,
    delegateAddress: string,
  ): Promise<RedelegateResult> {
    const token = await this.auth.token();
    const res = await this.auth.fetchImpl(
      `${this.auth.baseUrl}/wallets/${sessionWalletId}/delegations/redelegate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ delegationData: parentDelegationData, delegateAddress }),
      },
    );
    if (!res.ok) {
      throw new Error(`1Shot redelegate failed: ${res.status} ${res.statusText}`);
    }
    const r = (await res.json()) as { parent?: string; redelegation?: string };
    const delegationData = [r.parent, r.redelegation].filter((x): x is string => typeof x === "string");
    return { delegationData };
  }
}
