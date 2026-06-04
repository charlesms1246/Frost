import { describe, expect, it } from "vitest";
import { buildReceipt, merkleProof, verifyMerkleProof, type SessionEvent } from "@frost/agent/browser";
import { AgentSessionStore } from "../stores/agent-session.svelte";

/**
 * The audit receipt (§10.8) is computed from the live dashboard store. This drives the
 * store through a realistic cycle (plan → issue → dispatch → result), records a HITL
 * decision, then asserts the projected {@link AgentSessionStore.receiptInput} produces a
 * verifiable Merkle commitment that captures what the camera saw in the tree.
 */
function drive(store: AgentSessionStore): void {
  const mid = (`0x${"a1".repeat(32)}`) as `0x${string}`;
  const events: SessionEvent[] = [
    { type: "cycle-start", trigger: { kind: "manual" } } as SessionEvent,
    {
      type: "plan-decided",
      escalateToHITL: false,
      approved: [{ index: 0, role: "executor", spendCapTotal: 50_000_000n }],
    } as SessionEvent,
    { type: "sub-mandate", index: 0, role: "executor", status: "issued", mandateId: mid } as SessionEvent,
    {
      type: "state-advanced",
      subMandateCount: 1,
      aggregateSubMandateBudget: 50_000_000n,
      bucketAvailable: 9,
    } as SessionEvent,
    { type: "sub-agent-dispatched", mandateId: mid, role: "executor", behavior: "executor" } as SessionEvent,
    { type: "sub-agent-result", mandateId: mid, role: "executor", ran: true, detail: "submitted" } as SessionEvent,
    { type: "cycle-complete", escalateToHITL: false, spawnedSubMandateIds: [mid] } as SessionEvent,
  ];
  store.master.description = "Swap WETH→USDC when price < $2800";
  store.master.rootMandateId = (`0x${"cc".repeat(32)}`) as `0x${string}`;
  for (const e of events) store.onEvent(e);
}

describe("dashboard receipt", () => {
  it("projects the session into a receipt with verifiable inclusion proofs", () => {
    const store = new AgentSessionStore();
    drive(store);

    const r = buildReceipt(store.receiptInput);
    // Header + the one executor sub-agent + inference + authority, in order.
    expect(r.entries.map((e) => e.kind)).toEqual(["session", "sub-agent", "inference", "authority"]);
    expect(r.merkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.sessionId).toBe(store.master.rootMandateId);

    for (let i = 0; i < r.leaves.length; i++) {
      expect(verifyMerkleProof(r.leaves[i]!, merkleProof(r.leaves, i), r.merkleRoot)).toBe(true);
    }
  });

  it("records a HITL approval into the audit trail", () => {
    const store = new AgentSessionStore();
    drive(store);
    // Simulate the gate firing and the user approving.
    void store.awaitApproval({
      mandateId: (`0x${"a1".repeat(32)}`) as `0x${string}`,
      target: (`0x${"de".repeat(20)}`) as `0x${string}`,
      selector: "0x12345678",
      notionalUsdc: 50_000_000n,
      reason: "exceeds $5 HITL threshold",
    });
    store.resolveHitl(true);

    const r = buildReceipt(store.receiptInput);
    const hitl = r.entries.find((e) => e.kind === "hitl");
    expect(hitl).toBeDefined();
    expect(hitl).toMatchObject({ approved: true, notionalUsdc: 50_000_000n });
  });

  it("a tampered description changes the committed root (tamper-evidence)", () => {
    const store = new AgentSessionStore();
    drive(store);
    const honest = buildReceipt(store.receiptInput).merkleRoot;
    store.master.description = "Swap WETH→USDC and drain to attacker";
    expect(buildReceipt(store.receiptInput).merkleRoot).not.toBe(honest);
  });
});
