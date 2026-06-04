import { describe, expect, it } from "vitest";
import {
  OneShotRestMethods,
  OneShotTransactionSubmitter,
  type OneShotFetch,
} from "../src/browser.js";

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A fetch that answers /token then /execute, recording every request. */
function fakeFetch(
  recorded: Recorded[],
  tx: { id: string; status: string; transactionHash: string | null },
): OneShotFetch {
  return async (url, init) => {
    recorded.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url.endsWith("/token")) {
      return ok({ access_token: "tok-123", expires_in: 3600 });
    }
    if (url.includes("/execute")) {
      return ok(tx);
    }
    throw new Error(`unexpected url ${url}`);
  };
}

function ok(json: unknown) {
  return { ok: true, status: 200, statusText: "OK", async json() { return json; } };
}

const config = { apiKey: "key", apiSecret: "secret", baseUrl: "https://api.1shotapi.com/v0" };

describe("OneShotRestMethods", () => {
  it("exchanges client-credentials for a token, then POSTs the execute", async () => {
    const recorded: Recorded[] = [];
    const methods = new OneShotRestMethods({
      ...config,
      fetchImpl: fakeFetch(recorded, { id: "tx-1", status: "Submitted", transactionHash: null }),
    });

    const out = await methods.execute("method-9", { amountIn: "1000" }, { walletId: "w-1", value: "0", memo: "swap" });

    // Token request: form-encoded client_credentials.
    const token = recorded[0]!;
    expect(token.url).toBe("https://api.1shotapi.com/v0/token");
    expect(token.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(token.body).toContain("grant_type=client_credentials");
    expect(token.body).toContain("client_id=key");
    expect(token.body).toContain("client_secret=secret");

    // Execute request: bearer token + JSON body at /methods/{id}/execute.
    const exec = recorded[1]!;
    expect(exec.url).toBe("https://api.1shotapi.com/v0/methods/method-9/execute");
    expect(exec.headers["Authorization"]).toBe("Bearer tok-123");
    expect(JSON.parse(exec.body!)).toEqual({
      params: { amountIn: "1000" },
      walletId: "w-1",
      value: "0",
      memo: "swap",
    });

    expect(out).toEqual({ id: "tx-1", status: "Submitted", transactionHash: null });
  });

  it("caches the token across calls (one /token for two executes)", async () => {
    const recorded: Recorded[] = [];
    const methods = new OneShotRestMethods({
      ...config,
      fetchImpl: fakeFetch(recorded, { id: "tx", status: "Pending", transactionHash: null }),
    });
    await methods.execute("m", {}, { walletId: "w" });
    await methods.execute("m", {}, { walletId: "w" });
    expect(recorded.filter((r) => r.url.endsWith("/token"))).toHaveLength(1);
    expect(recorded.filter((r) => r.url.includes("/execute"))).toHaveLength(2);
  });

  it("throws on a failed token or execute response", async () => {
    const bad: OneShotFetch = async (url) =>
      url.endsWith("/token")
        ? { ok: false, status: 401, statusText: "Unauthorized", async json() { return {}; } }
        : ok({});
    await expect(new OneShotRestMethods({ ...config, fetchImpl: bad }).execute("m", {})).rejects.toThrow(
      /token request failed: 401/,
    );
  });

  it("composes with OneShotTransactionSubmitter as the executor relay", async () => {
    const recorded: Recorded[] = [];
    const methods = new OneShotRestMethods({
      ...config,
      fetchImpl: fakeFetch(recorded, { id: "tx-7", status: "Submitted", transactionHash: "0x" + "ab".repeat(32) }),
    });
    const submitter = new OneShotTransactionSubmitter(methods, "wallet-77");

    const receipt = await submitter.submit({ contractMethodId: "m-swap", params: { x: 1 }, valueWei: 5n });

    expect(receipt).toEqual({
      transactionId: "tx-7",
      status: "Submitted",
      txHash: "0x" + "ab".repeat(32),
    });
    // The submitter passed the wallet id and decimal value through to REST.
    expect(JSON.parse(recorded[1]!.body!)).toEqual({ params: { x: 1 }, walletId: "wallet-77", value: "5" });
  });
});
