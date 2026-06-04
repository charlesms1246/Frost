import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { callableSurface, hitlThreshold, type CallableSurfaceEntry } from "@frost/sdk";
import { Executor, type ExecutionRequest, type ExecutorMandate } from "../src/executor/executor.js";
import type { OnchainCall, SubmittedTx, TransactionSubmitter } from "../src/executor/submitter.js";

const ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481" as Address;
const SELECTOR = "0x04e45aaf" as Hex;
const MANDATE_ID = ("0x" + "ab".repeat(32)) as Hex;

const entry: CallableSurfaceEntry = { target: ROUTER, selector: SELECTOR, maxValue: 1_000_000_000n };

const mandate: ExecutorMandate = {
  id: MANDATE_ID,
  caveats: [callableSurface([entry]), hitlThreshold(500_000_000n)],
};

const call: OnchainCall = { contractMethodId: "method-1", params: { amountIn: "1" } };

function request(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return { target: ROUTER, selector: SELECTOR, notionalUsdc: 100_000_000n, call, ...overrides };
}

/** A submitter that records calls and returns a fixed receipt. */
function fakeSubmitter(): TransactionSubmitter & { calls: OnchainCall[] } {
  const calls: OnchainCall[] = [];
  return {
    calls,
    async submit(c): Promise<SubmittedTx> {
      calls.push(c);
      return { transactionId: "tx-1", status: "Submitted", txHash: ("0x" + "cd".repeat(32)) as Hex };
    },
  };
}

describe("Executor (§10.3 orchestration)", () => {
  it("submits through the relay when preflight passes", async () => {
    const submitter = fakeSubmitter();
    const res = await new Executor({ submitter }).execute(mandate, request());
    expect(res.status).toBe("submitted");
    expect(submitter.calls).toEqual([call]);
    if (res.status === "submitted") expect(res.tx.transactionId).toBe("tx-1");
  });

  it("rejects without touching the relay when preflight rejects", async () => {
    const submitter = fakeSubmitter();
    const res = await new Executor({ submitter }).execute(
      mandate,
      request({ notionalUsdc: 2_000_000_000n }), // over maxValue
    );
    expect(res.status).toBe("rejected");
    expect(submitter.calls).toEqual([]);
  });

  it("returns hitl_required without submitting when value exceeds the threshold", async () => {
    const submitter = fakeSubmitter();
    const res = await new Executor({ submitter }).execute(
      mandate,
      request({ notionalUsdc: 600_000_000n }), // ≤ maxValue, > HITL
    );
    expect(res.status).toBe("hitl_required");
    expect(submitter.calls).toEqual([]);
  });

  it("aborts (no submit) when an ancestor mandate is revoked", async () => {
    const submitter = fakeSubmitter();
    const revocation = { isAncestorRevoked: vi.fn().mockResolvedValue(true) };
    const res = await new Executor({ submitter, revocation }).execute(mandate, request());
    expect(res.status).toBe("aborted");
    expect(revocation.isAncestorRevoked).toHaveBeenCalledWith(MANDATE_ID);
    expect(submitter.calls).toEqual([]);
  });

  it("aborts when the revocation read itself fails (never act unverified)", async () => {
    const submitter = fakeSubmitter();
    const revocation = { isAncestorRevoked: vi.fn().mockRejectedValue(new Error("rpc down")) };
    const res = await new Executor({ submitter, revocation }).execute(mandate, request());
    expect(res.status).toBe("aborted");
    if (res.status === "aborted") expect(res.reason).toMatch(/revocation check failed: rpc down/);
    expect(submitter.calls).toEqual([]);
  });

  it("proceeds when an ancestor is not revoked", async () => {
    const submitter = fakeSubmitter();
    const revocation = { isAncestorRevoked: vi.fn().mockResolvedValue(false) };
    const res = await new Executor({ submitter, revocation }).execute(mandate, request());
    expect(res.status).toBe("submitted");
    expect(submitter.calls).toEqual([call]);
  });

  it("reports failed (not submitted) when the relay throws", async () => {
    const submitter: TransactionSubmitter = {
      async submit(): Promise<SubmittedTx> {
        throw new Error("relay 503");
      },
    };
    const res = await new Executor({ submitter }).execute(mandate, request());
    expect(res.status).toBe("failed");
    if (res.status === "failed") expect(res.reason).toMatch(/submission failed: relay 503/);
  });
});
