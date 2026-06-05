import { describe, it, expect, vi } from "vitest";
import { grantContext, usdcTransferWork, submitViaRelayer } from "./relayer-exec";
import { RelayerClient } from "@frost/agent/browser";
import { decodeFunctionData, erc20Abi } from "viem";

const TARGET = "0xf1ef956eff4181Ce913b664713515996858B9Ca9" as const;
const FEE_COLLECTOR = "0xE936e8FAf4A5655469182A49a505055B71C17604" as const;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

const caps = {
  "84532": { feeCollector: FEE_COLLECTOR, targetAddress: TARGET, tokens: [{ address: USDC, symbol: "USDC", decimals: "6" }] },
};

/** A RelayerClient whose JSON-RPC methods are stubbed (no network). */
function fakeClient(over: Partial<Record<string, unknown>> = {}): RelayerClient {
  const c = new RelayerClient({ url: "http://test", fetchImpl: async () => ({ ok: true, status: 200, async json() { return {}; } }) });
  Object.assign(c, {
    getCapabilities: vi.fn(async () => caps),
    estimate7710Transaction: vi.fn(async () => ({ success: true, requiredPaymentAmount: "12000", context: "0xlock" })),
    send7710Transaction: vi.fn(async () => "0x" + "ab".repeat(32)),
    ...over,
  });
  return c;
}

describe("grantContext", () => {
  it("reads granted[0].context (array form) and granted.context (object form)", () => {
    expect(grantContext([{ context: "0xdead" }])).toBe("0xdead");
    expect(grantContext({ context: "0xbeef" })).toBe("0xbeef");
  });
  it("throws when there is no 0x context", () => {
    expect(() => grantContext({})).toThrow(/no 0x .*context/i);
    expect(() => grantContext([{ context: 123 }])).toThrow(/context/);
  });
});

describe("usdcTransferWork", () => {
  it("encodes an ERC-20 transfer to the destination", () => {
    const exec = usdcTransferWork(USDC, "0x1111111111111111111111111111111111111111", 20_000n);
    expect(exec.target).toBe(USDC);
    expect(exec.value).toBe("0");
    const decoded = decodeFunctionData({ abi: erc20Abi, data: exec.data });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args).toEqual(["0x1111111111111111111111111111111111111111", 20_000n]);
  });
});

describe("submitViaRelayer", () => {
  const granted = [{ context: "0xCAFE" }];
  const decode = () => [{ delegate: TARGET, salt: 1n }]; // stub: skip the real kit decode

  it("decodes the grant, prepends a fee transfer, estimates, and sends", async () => {
    const client = fakeClient();
    const work = [usdcTransferWork(USDC, "0x2222222222222222222222222222222222222222", 50_000n)];
    const res = await submitViaRelayer({ granted, work, memo: "demo" }, { client, decode });

    expect(res.taskId).toBe("0x" + "ab".repeat(32));
    expect(res.feeAmount).toBe("12000");
    expect(res.paymentToken).toBe(USDC);

    // The bundle: fee transfer to feeCollector FIRST, then the work.
    const sent = (client.send7710Transaction as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.context).toBe("0xlock");
    expect(sent.memo).toBe("demo");
    const execs = sent.transactions[0].executions;
    expect(execs).toHaveLength(2);
    const fee = decodeFunctionData({ abi: erc20Abi, data: execs[0].data });
    expect(fee.args).toEqual([FEE_COLLECTOR, 12_000n]); // floored to requiredPaymentAmount
    // bigint salt serialized to 0x-hex via toRelayerJson
    expect(sent.transactions[0].permissionContext[0].salt).toBe("0x1");
  });

  it("re-estimates when the required fee differs from the mock", async () => {
    const estimate = vi
      .fn()
      .mockResolvedValueOnce({ success: true, requiredPaymentAmount: "30000", context: "0xa" })
      .mockResolvedValueOnce({ success: true, requiredPaymentAmount: "30000", context: "0xb" });
    const client = fakeClient({ estimate7710Transaction: estimate });
    await submitViaRelayer({ granted, work: [], mockFeeAtoms: 10_000n }, { client, decode });
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it("throws the relayer error when estimate fails", async () => {
    const client = fakeClient({ estimate7710Transaction: vi.fn(async () => ({ success: false, error: "minimum fee" })) });
    await expect(submitViaRelayer({ granted, work: [] }, { client, decode })).rejects.toThrow(/minimum fee/);
  });
});
