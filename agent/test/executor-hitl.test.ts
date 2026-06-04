import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { callableSurface, hitlThreshold, type CallableSurfaceEntry } from "@frost/sdk";
import {
  Executor,
  type ExecutionRequest,
  type ExecutorMandate,
  type HitlApprovalRequest,
} from "../src/executor/executor.js";
import type { OnchainCall, SubmittedTx, TransactionSubmitter } from "../src/executor/submitter.js";

const ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481" as Address;
const SELECTOR = "0x04e45aaf" as Hex;
const MANDATE_ID = ("0x" + "ab".repeat(32)) as Hex;

const entry: CallableSurfaceEntry = { target: ROUTER, selector: SELECTOR, maxValue: 1_000_000_000n };
// HITL threshold $500; a $600 call is ≤ maxValue but trips the gate.
const mandate: ExecutorMandate = { id: MANDATE_ID, caveats: [callableSurface([entry]), hitlThreshold(500_000_000n)] };
const call: OnchainCall = { contractMethodId: "method-1", params: { amountIn: "1" } };
const overThreshold: ExecutionRequest = { target: ROUTER, selector: SELECTOR, notionalUsdc: 600_000_000n, call };

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

describe("Executor HITL gate", () => {
  it("submits after the human approves, passing the real action facts to the gate", async () => {
    const submitter = fakeSubmitter();
    const requestApproval = vi.fn<(r: HitlApprovalRequest) => Promise<boolean>>().mockResolvedValue(true);
    const res = await new Executor({ submitter, requestApproval }).execute(mandate, overThreshold);

    expect(res.status).toBe("submitted");
    expect(submitter.calls).toEqual([call]);
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(requestApproval.mock.calls[0]![0]).toMatchObject({
      mandateId: MANDATE_ID,
      target: ROUTER,
      selector: SELECTOR,
      notionalUsdc: 600_000_000n,
    });
  });

  it("rejects (no submit) when the human declines", async () => {
    const submitter = fakeSubmitter();
    const res = await new Executor({ submitter, requestApproval: async () => false }).execute(mandate, overThreshold);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.reason).toMatch(/human declined/);
    expect(submitter.calls).toEqual([]);
  });

  it("aborts (no submit) when the approval gate itself throws", async () => {
    const submitter = fakeSubmitter();
    const res = await new Executor({
      submitter,
      requestApproval: async () => {
        throw new Error("ui closed");
      },
    }).execute(mandate, overThreshold);
    expect(res.status).toBe("aborted");
    if (res.status === "aborted") expect(res.reason).toMatch(/approval request failed: ui closed/);
    expect(submitter.calls).toEqual([]);
  });

  it("still returns hitl_required (no gate) when no requestApproval is wired", async () => {
    const submitter = fakeSubmitter();
    const res = await new Executor({ submitter }).execute(mandate, overThreshold);
    expect(res.status).toBe("hitl_required");
    expect(submitter.calls).toEqual([]);
  });

  it("does not invoke the gate for a sub-threshold call (it just submits)", async () => {
    const submitter = fakeSubmitter();
    const requestApproval = vi.fn<(r: HitlApprovalRequest) => Promise<boolean>>().mockResolvedValue(true);
    const res = await new Executor({ submitter, requestApproval }).execute(mandate, {
      ...overThreshold,
      notionalUsdc: 100_000_000n, // under the $500 threshold
    });
    expect(res.status).toBe("submitted");
    expect(requestApproval).not.toHaveBeenCalled();
  });
});
