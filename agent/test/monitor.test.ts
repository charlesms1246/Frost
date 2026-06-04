import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { Monitor, type MonitorCondition } from "../src/monitor/monitor.js";
import type { RpcCall, RpcResult, RpcTransport } from "../src/pricer/venice-rpc.js";

/**
 * A transport that answers `eth_blockNumber` with a fixed head and routes every
 * other batch to a supplied condition handler. Records the block tags the condition
 * calls were pinned to, so tests can assert the monitor evaluated at head − N.
 */
function transport(
  head: bigint,
  onCondition: (calls: RpcCall[]) => RpcResult[],
): RpcTransport & { conditionBlocks: unknown[] } {
  const conditionBlocks: unknown[] = [];
  return {
    conditionBlocks,
    async batch(calls: RpcCall[]): Promise<RpcResult[]> {
      if (calls[0]?.method === "eth_blockNumber") {
        return [{ result: `0x${head.toString(16)}` as Hex }];
      }
      for (const c of calls) conditionBlocks.push(c.params[1]);
      return onCondition(calls);
    },
  };
}

/** A condition that holds iff `met`, recording the block it was asked to build for. */
function fakeCondition(met: boolean): MonitorCondition & { builtFor: unknown[] } {
  const builtFor: unknown[] = [];
  return {
    name: "fake",
    builtFor,
    buildCalls(block) {
      builtFor.push(block);
      return [{ method: "eth_call", params: [{ to: "0x", data: "0x" }, block] }];
    },
    evaluate() {
      return met;
    },
  };
}

describe("Monitor (T-23 multi-confirmation gate)", () => {
  it("fires when the condition holds at the N-confirmed block", async () => {
    const cond = fakeCondition(true);
    const res = await new Monitor(transport(100n, () => [{ result: "0x1" as Hex }])).check(cond);
    expect(res.status).toBe("fired");
    if (res.status === "fired") {
      expect(res.headBlock).toBe(100n);
      expect(res.confirmedBlock).toBe(97n); // 100 − 3
      expect(res.confirmations).toBe(3);
    }
    // It evaluated against block 97 (0x61), never the tip.
    expect(cond.builtFor).toEqual(["0x61"]);
  });

  it("reports not_met when the condition is false at confirmed depth", async () => {
    const res = await new Monitor(transport(100n, () => [{ result: "0x0" as Hex }])).check(
      fakeCondition(false),
    );
    expect(res.status).toBe("not_met");
    if (res.status === "not_met") expect(res.confirmedBlock).toBe(97n);
  });

  it("honors a custom confirmation depth", async () => {
    const cond = fakeCondition(true);
    const res = await new Monitor(transport(100n, () => [{ result: "0x1" as Hex }]), {
      confirmations: 10,
    }).check(cond);
    expect(res.status).toBe("fired");
    if (res.status === "fired") expect(res.confirmedBlock).toBe(90n);
    expect(cond.builtFor).toEqual(["0x5a"]); // 90
  });

  it("is pending when the chain is shorter than the confirmation depth", async () => {
    const res = await new Monitor(transport(2n, () => [{ result: "0x1" as Hex }])).check(
      fakeCondition(true),
    );
    expect(res.status).toBe("pending");
    if (res.status === "pending") expect(res.needed).toBe(3);
  });

  it("errors (never fires) when the head read fails", async () => {
    const rpc: RpcTransport = {
      async batch() {
        return [{ error: { code: 429, message: "rate limited" } }];
      },
    };
    const res = await new Monitor(rpc).check(fakeCondition(true));
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.reason).toMatch(/eth_blockNumber failed: rate limited/);
  });

  it("errors when a condition read returns an RPC error", async () => {
    const res = await new Monitor(
      transport(100n, () => [{ error: { code: -32000, message: "execution reverted" } }]),
    ).check(fakeCondition(true));
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.reason).toMatch(/execution reverted/);
  });

  it("errors when the condition evaluator throws (undecodable result)", async () => {
    const throwing: MonitorCondition = {
      name: "boom",
      buildCalls(block) {
        return [{ method: "eth_call", params: [{}, block] }];
      },
      evaluate() {
        throw new Error("bad data");
      },
    };
    const res = await new Monitor(transport(100n, () => [{ result: "0xdead" as Hex }])).check(
      throwing,
    );
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.reason).toMatch(/evaluate failed: bad data/);
  });

  it("rejects a non-positive confirmation depth at construction", () => {
    const rpc: RpcTransport = { async batch() { return []; } };
    expect(() => new Monitor(rpc, { confirmations: 0 })).toThrow(/positive integer/);
  });
});
