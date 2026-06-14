import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@frost/agent/browser";
import { AgentSessionStore } from "./agent-session.svelte";

const MID = (n: number) => (`0x${n.toString(16).padStart(64, "0")}`) as `0x${string}`;

/**
 * Drives the store with the SAME `SessionEvent` spine the embedded session emits, so
 * we lock two demo-load-bearing behaviours without a network:
 *  - the delegation tree MUTATES live through plan → issue → run → done (IG-03);
 *  - the cross-source "best route" ranks the parallel pricers' quotes (IG-01).
 */
describe("AgentSessionStore — live tree + best-route ranking", () => {
  it("grows the tree through the lifecycle and picks the best pricer quote", () => {
    const store = new AgentSessionStore();
    const feed = (e: SessionEvent) => store.onEvent(e);

    feed({ type: "cycle-start", trigger: { kind: "session-start" } });
    expect(store.master.status).toBe("running");
    expect(store.phase).toBe("planning");

    feed({
      type: "plan-decided",
      escalateToHITL: false,
      approved: [
        { index: 0, role: "pricer-uniswap", spendCapTotal: 0n },
        { index: 1, role: "pricer-1inch", spendCapTotal: 0n },
      ],
    });
    expect(store.children.map((c) => c.status)).toEqual(["planned", "planned"]);

    feed({ type: "sub-mandate", index: 0, role: "pricer-uniswap", status: "issued", mandateId: MID(1) });
    feed({ type: "sub-mandate", index: 1, role: "pricer-1inch", status: "issued", mandateId: MID(2) });
    expect(store.children.map((c) => c.status)).toEqual(["issued", "issued"]);

    feed({ type: "sub-agent-dispatched", role: "pricer-uniswap", behavior: "pricer", mandateId: MID(1) });
    expect(store.agentsRunning).toBe(1);

    // Uniswap quotes lower, the aggregator quotes higher → the aggregator wins.
    feed({ type: "sub-agent-result", role: "pricer-uniswap", behavior: "pricer", mandateId: MID(1), ran: true,
      detail: "Uniswap v3 (0.30%) → $1652.30", quote: { label: "Uniswap v3 (0.30%)", amountOutUsdc: "1652300000" } });
    feed({ type: "sub-agent-dispatched", role: "pricer-1inch", behavior: "pricer", mandateId: MID(2) });
    feed({ type: "sub-agent-result", role: "pricer-1inch", behavior: "pricer", mandateId: MID(2), ran: true,
      detail: "Paraswap (aggregator) → $1656.90", quote: { label: "Paraswap (aggregator)", amountOutUsdc: "1656900000" } });

    expect(store.agentsDone).toBe(2);
    expect(store.bestRoute).toMatchObject({
      role: "pricer-1inch",
      label: "Paraswap (aggregator)",
      amountOutUsdc: 1656900000n,
      outOf: 2,
    });

    feed({ type: "cycle-complete", spawnedSubMandateIds: [MID(1), MID(2)], escalateToHITL: false });
    expect(store.phase).toBe("done");
    expect(store.master.status).toBe("done");
  });

  it("has no best route until a pricer reports a quote", () => {
    const store = new AgentSessionStore();
    store.onEvent({ type: "cycle-start", trigger: { kind: "session-start" } });
    store.onEvent({ type: "plan-decided", escalateToHITL: false, approved: [{ index: 0, role: "comms", spendCapTotal: 0n }] });
    expect(store.bestRoute).toBeUndefined();
  });

  it("greys the master when spawning is revoked (demo moment 3)", () => {
    const store = new AgentSessionStore();
    store.onEvent({ type: "cycle-start", trigger: { kind: "session-start" } });
    store.markSpawningRevoked("0xdead");
    expect(store.spawningRevoked).toBe(true);
    expect(store.revokeTxHash).toBe("0xdead");
  });
});

const hitlReq = (n: bigint) => ({
  mandateId: ("0x" + "ab".repeat(32)) as `0x${string}`,
  target: ("0x" + "cd".repeat(20)) as `0x${string}`,
  selector: "0x12345678" as `0x${string}`,
  notionalUsdc: n,
  reason: "over HITL threshold",
});

describe("AgentSessionStore — HITL rate-limit + approval binding (IG-07)", () => {
  it("binds an approval to the prompt that fired — a stale id is ignored (H-12)", async () => {
    const store = new AgentSessionStore();
    const p = store.awaitApproval(hitlReq(10_000_000n));
    const realId = store.hitl.approvalId!;

    // A resolve for a DIFFERENT id (stale/replayed click) must NOT resolve the prompt.
    store.resolveHitl(true, realId + 99);
    expect(store.hitl.pending).toBe(true); // still pending

    // The matching id resolves it.
    store.resolveHitl(true, realId);
    expect(await p).toBe(true);
    expect(store.hitl.pending).toBe(false);
  });

  it("auto-rejects once the per-session prompt limit is reached (T-28b)", async () => {
    const store = new AgentSessionStore();
    // Exhaust the limit, approving each, so none stays pending.
    for (let i = 0; i < AgentSessionStore.HITL_PROMPT_LIMIT; i++) {
      const p = store.awaitApproval(hitlReq(1_000_000n));
      store.resolveHitl(true, store.hitl.approvalId);
      expect(await p).toBe(true);
    }
    expect(store.hitlPromptCount).toBe(AgentSessionStore.HITL_PROMPT_LIMIT);

    // The next prompt is auto-denied WITHOUT surfacing a dialog.
    const denied = store.awaitApproval(hitlReq(1_000_000n));
    expect(store.hitl.pending).toBe(false);
    expect(await denied).toBe(false);
  });

  it("preserves the prompt count across cycles but resets on a full session reset", () => {
    const store = new AgentSessionStore();
    void store.awaitApproval(hitlReq(1_000_000n));
    store.beginCycle("next cycle");
    expect(store.hitlPromptCount).toBe(1); // session-level budget persists
    store.reset("brand new");
    expect(store.hitlPromptCount).toBe(0);
  });
});
