import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { FROST_BASE_SEPOLIA } from "@frost/sdk";
import {
  OneShotServerWalletProvider,
  oneShotProviderFromEnv,
  type OneShotLike,
} from "../src/wallet/oneshot.js";
import { WalletProvisioner } from "../src/wallet/provisioner.js";
import { InMemoryKeyStore } from "../src/wallet/key-store.js";
import type { SpawnDecision } from "../src/types.js";

const WALLET_ADDR = ("0x" + "ab".repeat(20)) as Address;

function fakeClient(): OneShotLike & {
  createCalls: Array<{ businessId: string; params: { chainId: number; name: string } }>;
  listCalls: Array<{ businessId: string; params: { pageSize?: number } | undefined }>;
} {
  const createCalls: Array<{ businessId: string; params: { chainId: number; name: string } }> = [];
  const listCalls: Array<{ businessId: string; params: { pageSize?: number } | undefined }> = [];
  return {
    createCalls,
    listCalls,
    wallets: {
      async create(businessId, params) {
        createCalls.push({ businessId, params });
        return { id: "wallet-uuid-1", accountAddress: WALLET_ADDR };
      },
      async list(businessId, params) {
        listCalls.push({ businessId, params });
        return { response: [], page: 1, pageSize: 1, totalResults: 0 };
      },
    },
  };
}

function decision(role: string): SpawnDecision {
  return {
    role,
    proposedCaveats: { capabilities: ["CAP_ONCHAIN_EXECUTION"], spendCapTotal: 1n },
    estimatedTokenCost: 0n,
    reasoning: "",
    decision: "spawned",
  };
}

describe("OneShotServerWalletProvider", () => {
  it("maps the 1Shot Wallet to {address, walletId} and passes the right create args", async () => {
    const client = fakeClient();
    const p = new OneShotServerWalletProvider(
      { apiKey: "k", apiSecret: "s", businessId: "biz" },
      client,
    );

    const res = await p.createServerWallet("frost:s1:executor");

    expect(res).toEqual({ address: WALLET_ADDR, walletId: "wallet-uuid-1" });
    expect(client.createCalls[0]).toEqual({
      businessId: "biz",
      params: { chainId: FROST_BASE_SEPOLIA.chainId, name: "frost:s1:executor" },
    });
  });

  it("defaults to Base Sepolia but honours a chainId override", async () => {
    const client = fakeClient();
    const p = new OneShotServerWalletProvider(
      { apiKey: "k", apiSecret: "s", businessId: "biz", chainId: 8453 },
      client,
    );
    await p.createServerWallet("x");
    expect(client.createCalls[0]?.params.chainId).toBe(8453);
  });

  it("verify() does a read-only list scoped to the business", async () => {
    const client = fakeClient();
    const p = new OneShotServerWalletProvider(
      { apiKey: "k", apiSecret: "s", businessId: "biz" },
      client,
    );
    await p.verify();
    expect(client.listCalls[0]).toEqual({ businessId: "biz", params: { pageSize: 1 } });
  });

  it("satisfies the ServerWalletProvider seam for the executor route", async () => {
    const client = fakeClient();
    const provisioner = new WalletProvisioner({
      keyStore: new InMemoryKeyStore(),
      serverWallets: new OneShotServerWalletProvider(
        { apiKey: "k", apiSecret: "s", businessId: "biz" },
        client,
      ),
      sessionId: "s1",
    });

    const addr = await provisioner.provisionHolder(decision("executor"));

    expect(addr).toBe(WALLET_ADDR);
    expect(provisioner.handleFor(addr)?.kind).toBe("server");
    expect(provisioner.handleFor(addr)?.ref).toBe("wallet-uuid-1");
    expect(client.createCalls[0]?.params.name).toBe("frost:s1:executor");
  });
});

describe("oneShotProviderFromEnv", () => {
  it("throws listing every missing credential", () => {
    expect(() => oneShotProviderFromEnv({})).toThrow(
      /missing env vars: ONESHOT_API_KEY, ONESHOT_API_SECRET, ONESHOT_BUSINESS_ID/,
    );
  });

  it("constructs when all credentials are present", () => {
    const p = oneShotProviderFromEnv({
      ONESHOT_API_KEY: "k",
      ONESHOT_API_SECRET: "s",
      ONESHOT_BUSINESS_ID: "b",
    });
    expect(p).toBeInstanceOf(OneShotServerWalletProvider);
  });
});
