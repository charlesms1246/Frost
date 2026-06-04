import type { Address } from "viem";
import { OneShotClient } from "@1shotapi/client-sdk";
import { FROST_BASE_SEPOLIA } from "@frost/sdk";
import type { ServerWalletProvider } from "./provisioner.js";

/**
 * Real 1Shot-backed {@link ServerWalletProvider} for executor sub-agents.
 *
 * Wraps the official `@1shotapi/client-sdk`. 1Shot holds the keys for these
 * server wallets and provides private-mempool submission + gas sponsorship —
 * the reasons the executor uses a server wallet rather than an in-process EOA
 * (HANDOFF wallet model; threat T-21).
 *
 * Auth is `{ apiKey, apiSecret }` (Auth0 client-credentials under the hood); the
 * `businessId` scopes wallet creation. The SDK client is injectable so the
 * mapping logic is unit-testable offline — the concrete `OneShotClient` makes no
 * network call at construction (the token is fetched lazily on first request).
 */

/** The slice of the 1Shot client this provider uses (injectable for tests). */
export interface OneShotWalletsApi {
  create(
    businessId: string,
    params: { chainId: number; name: string; description?: string },
  ): Promise<{ id: string; accountAddress: string }>;
  list(businessId: string, params?: { pageSize?: number }): Promise<unknown>;
}

export interface OneShotLike {
  wallets: OneShotWalletsApi;
}

export interface OneShotConfig {
  apiKey: string;
  apiSecret: string;
  businessId: string;
  /** Chain to create server wallets on. Defaults to Base Sepolia (84532). */
  chainId?: number;
  /** Override the API base URL. */
  baseUrl?: string;
}

export class OneShotServerWalletProvider implements ServerWalletProvider {
  private readonly client: OneShotLike;
  private readonly businessId: string;
  private readonly chainId: number;

  /**
   * @param config 1Shot credentials + the business and chain to provision under.
   * @param client Inject a fake in tests; omit to use the real `OneShotClient`.
   */
  constructor(config: OneShotConfig, client?: OneShotLike) {
    this.businessId = config.businessId;
    this.chainId = config.chainId ?? FROST_BASE_SEPOLIA.chainId;
    if (client) {
      this.client = client;
    } else {
      const clientConfig: { apiKey: string; apiSecret: string; baseUrl?: string } = {
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
      };
      if (config.baseUrl) clientConfig.baseUrl = config.baseUrl;
      // Narrow the full SDK client to the slice we use; the real Wallet is a
      // superset of { id, accountAddress }, so this is sound at the boundary.
      this.client = new OneShotClient(clientConfig) as unknown as OneShotLike;
    }
  }

  async createServerWallet(
    label: string,
  ): Promise<{ address: Address; walletId: string }> {
    const wallet = await this.client.wallets.create(this.businessId, {
      chainId: this.chainId,
      name: label,
    });
    return { address: wallet.accountAddress as Address, walletId: wallet.id };
  }

  /**
   * Read-only auth check: lists one wallet. Throws if the credentials or
   * business id are wrong. Creates no resources — safe to call in a smoke test.
   */
  async verify(): Promise<void> {
    await this.client.wallets.list(this.businessId, { pageSize: 1 });
  }
}

/**
 * Build a provider from environment variables: `ONESHOT_API_KEY`,
 * `ONESHOT_API_SECRET`, `ONESHOT_BUSINESS_ID`, optional `ONESHOT_API_BASE`.
 * Throws listing any that are missing.
 */
export function oneShotProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: { chainId?: number } = {},
): OneShotServerWalletProvider {
  const apiKey = env["ONESHOT_API_KEY"];
  const apiSecret = env["ONESHOT_API_SECRET"];
  const businessId = env["ONESHOT_BUSINESS_ID"];

  const missing = (
    [
      ["ONESHOT_API_KEY", apiKey],
      ["ONESHOT_API_SECRET", apiSecret],
      ["ONESHOT_BUSINESS_ID", businessId],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`1Shot config missing env vars: ${missing.join(", ")}`);
  }

  const config: OneShotConfig = {
    apiKey: apiKey!,
    apiSecret: apiSecret!,
    businessId: businessId!,
  };
  const baseUrl = env["ONESHOT_API_BASE"];
  if (baseUrl) config.baseUrl = baseUrl;
  if (overrides.chainId !== undefined) config.chainId = overrides.chainId;

  return new OneShotServerWalletProvider(config);
}
