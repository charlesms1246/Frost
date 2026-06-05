import { describe, expect, it } from "vitest";
import {
  RelayerClient,
  relayerUrlForChain,
  toRelayerJson,
  RELAYER_MAINNET_URL,
  RELAYER_TESTNET_URL,
  type RelayerFetch,
} from "../src/browser.js";

interface Recorded {
  url: string;
  method: string;
  body: string | undefined;
}

/** A fetch that records requests and replies with the given JSON-RPC `result`. */
function fakeRelayer(recorded: Recorded[], result: unknown, ok = true, status = 200): RelayerFetch {
  return async (url, init) => {
    recorded.push({ url, method: init.method, body: init.body });
    return { ok, status, async json() { return { jsonrpc: "2.0", id: 1, result }; } };
  };
}

describe("relayerUrlForChain", () => {
  it("routes Sepolia + Base Sepolia to the testnet relayer, everything else to mainnet", () => {
    expect(relayerUrlForChain(84532)).toBe(RELAYER_TESTNET_URL);
    expect(relayerUrlForChain("11155111")).toBe(RELAYER_TESTNET_URL);
    expect(relayerUrlForChain(8453)).toBe(RELAYER_MAINNET_URL);
    expect(relayerUrlForChain(1)).toBe(RELAYER_MAINNET_URL);
  });
});

describe("toRelayerJson", () => {
  it("converts bigints and Uint8Arrays to 0x-hex, recursing through arrays/objects", () => {
    const out = toRelayerJson({
      maxAmount: 50_000_000n,
      salt: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
      nested: [{ n: 255n }],
      addr: "0xabc",
      keep: 7,
    });
    expect(out).toEqual({
      maxAmount: "0x2faf080",
      salt: "0xdeadbeef",
      nested: [{ n: "0xff" }],
      addr: "0xabc",
      keep: 7,
    });
  });
});

const caps = {
  "84532": {
    feeCollector: "0xE936e8FAf4A5655469182A49a505055B71C17604",
    targetAddress: "0xf1ef956eff4181Ce913b664713515996858B9Ca9",
    tokens: [{ address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", symbol: "USDC", decimals: "6" }],
  },
};

describe("RelayerClient", () => {
  it("defaults the URL by chain and POSTs a JSON-RPC getCapabilities", async () => {
    const recorded: Recorded[] = [];
    const client = new RelayerClient({ chainId: 84532, fetchImpl: fakeRelayer(recorded, caps) });

    const result = await client.getCapabilities(["84532"]);

    expect(recorded[0]!.url).toBe(RELAYER_TESTNET_URL);
    const sent = JSON.parse(recorded[0]!.body!);
    expect(sent).toMatchObject({ jsonrpc: "2.0", method: "relayer_getCapabilities", params: ["84532"] });
    expect(result["84532"]!.targetAddress).toBe("0xf1ef956eff4181Ce913b664713515996858B9Ca9");
  });

  it("sends a bundle and returns the task id", async () => {
    const recorded: Recorded[] = [];
    const client = new RelayerClient({ url: RELAYER_TESTNET_URL, fetchImpl: fakeRelayer(recorded, "task-123") });

    const taskId = await client.send7710Transaction({
      chainId: "84532",
      context: "0xlock",
      transactions: [{ permissionContext: [{ delegation: 1 }], executions: [] }],
    });

    expect(taskId).toBe("task-123");
    const sent = JSON.parse(recorded[0]!.body!);
    expect(sent.method).toBe("relayer_send7710Transaction");
    expect(sent.params.context).toBe("0xlock");
  });

  it("surfaces a JSON-RPC error with code + message", async () => {
    const errFetch: RelayerFetch = async () => ({
      ok: true,
      status: 200,
      async json() { return { jsonrpc: "2.0", id: 1, error: { code: 4200, message: "Insufficient Payment" } }; },
    });
    await expect(
      new RelayerClient({ url: RELAYER_TESTNET_URL, fetchImpl: errFetch }).getStatus({ id: "t" }),
    ).rejects.toThrow(/\[4200\] Insufficient Payment/);
  });

  it("throws on a non-2xx HTTP response", async () => {
    const client = new RelayerClient({ url: RELAYER_TESTNET_URL, fetchImpl: fakeRelayer([], {}, false, 503) });
    await expect(client.getCapabilities(["84532"])).rejects.toThrow(/HTTP 503/);
  });
});
