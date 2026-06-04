import { describe, expect, it } from "vitest";
import {
  OneShotTransactionSubmitter,
  type OneShotContractMethodsApi,
} from "../src/executor/oneshot-submitter.js";
import type { OnchainCall } from "../src/executor/submitter.js";

interface RecordedExecute {
  contractMethodId: string;
  params: Record<string, unknown>;
  options: { walletId?: string; value?: string; memo?: string; delegationData?: string[] } | undefined;
}

function fakeMethods(
  tx: { id: string; status: string; transactionHash: string | null },
): OneShotContractMethodsApi & { recorded: RecordedExecute[]; delegatorCalls: RecordedExecute[] } {
  const recorded: RecordedExecute[] = [];
  const delegatorCalls: RecordedExecute[] = [];
  return {
    recorded,
    delegatorCalls,
    async execute(contractMethodId, params, options) {
      recorded.push({ contractMethodId, params, options });
      return tx;
    },
    async executeAsDelegator(contractMethodId, params, options) {
      delegatorCalls.push({ contractMethodId, params, options });
      return tx;
    },
  };
}

const baseCall: OnchainCall = { contractMethodId: "m-1", params: { amountIn: "1000" } };

describe("OneShotTransactionSubmitter", () => {
  it("maps an OnchainCall to contractMethods.execute with the wallet id", async () => {
    const methods = fakeMethods({ id: "tx-1", status: "Pending", transactionHash: null });
    const out = await new OneShotTransactionSubmitter(methods, "wallet-9").submit(baseCall);

    expect(methods.recorded).toEqual([
      { contractMethodId: "m-1", params: { amountIn: "1000" }, options: { walletId: "wallet-9" } },
    ]);
    expect(out).toEqual({ transactionId: "tx-1", status: "Pending" });
  });

  it("passes value as a decimal string and the memo when present", async () => {
    const methods = fakeMethods({ id: "tx-2", status: "Submitted", transactionHash: null });
    await new OneShotTransactionSubmitter(methods, "wallet-9").submit({
      ...baseCall,
      valueWei: 1_000_000_000_000_000_000n,
      memo: "best-rate swap",
    });
    expect(methods.recorded[0]?.options).toEqual({
      walletId: "wallet-9",
      value: "1000000000000000000",
      memo: "best-rate swap",
    });
  });

  it("surfaces the on-chain hash once the relay knows it", async () => {
    const hash = "0x" + "ef".repeat(32);
    const methods = fakeMethods({ id: "tx-3", status: "Completed", transactionHash: hash });
    const out = await new OneShotTransactionSubmitter(methods, "wallet-9").submit(baseCall);
    expect(out).toEqual({ transactionId: "tx-3", status: "Completed", txHash: hash });
  });

  it("routes to executeAsDelegator (not execute) when a delegation chain is present", async () => {
    const methods = fakeMethods({ id: "tx-4", status: "Submitted", transactionHash: null });
    await new OneShotTransactionSubmitter(methods, "wallet-9").submit({
      ...baseCall,
      delegationData: ["0xparent", "0xredelegation"],
    });
    expect(methods.recorded).toEqual([]); // plain execute NOT used
    expect(methods.delegatorCalls).toEqual([
      {
        contractMethodId: "m-1",
        params: { amountIn: "1000" },
        options: { walletId: "wallet-9", delegationData: ["0xparent", "0xredelegation"] },
      },
    ]);
  });
});
