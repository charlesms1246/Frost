<script lang="ts">
  import { browser } from "$app/environment";
  import { SvelteFlow, Background, type Node, type Edge } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import type { AgentSessionStore, NodeStatus } from "$lib/stores/agent-session.svelte";
  import AgentFlowNode, { type AgentNodeData, type FlowState } from "./AgentFlowNode.svelte";

  let { store, onRevoke, revoking = false }: { store: AgentSessionStore; onRevoke?: () => void; revoking?: boolean } = $props();

  const nodeTypes = { agent: AgentFlowNode };

  const BADGE: Record<NodeStatus, "default" | "secondary" | "outline" | "destructive"> = {
    planned: "outline",
    issued: "secondary",
    running: "default",
    done: "secondary",
    failed: "destructive",
  };
  function flowStateOf(status: NodeStatus, revoked = false): FlowState {
    if (revoked || status === "failed") return "disabled";
    if (status === "running") return "active";
    return "passive";
  }
  const usdc = (v?: bigint) => (v === undefined ? undefined : `$${(Number(v) / 1e6).toFixed(2)}`);

  // Build the flow graph from the live session store. Master at top; sub-agents fan out
  // below it. Recomputed whenever the store's nodes / statuses / revocation change.
  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);

  $effect(() => {
    const m = store.master;
    const revoked = store.spawningRevoked;
    const children = store.children;

    const masterData: AgentNodeData = {
      title: "Master agent",
      isMaster: true,
      statusLabel: revoked ? "spawning revoked" : m.status,
      flowState: flowStateOf(m.status, revoked),
      badge: revoked ? "destructive" : BADGE[m.status],
      revoked,
      ...(m.description ? { detail: m.description } : {}),
      ...(m.rootMandateId ? { mandateId: m.rootMandateId } : {}),
      ...(store.revokeTxHash ? { txHash: store.revokeTxHash } : {}),
      ...(onRevoke ? { onRevoke, revoking } : {}),
    };

    const n: Node[] = [
      { id: "master", type: "agent", position: { x: 0, y: 0 }, data: masterData as unknown as Record<string, unknown>, draggable: false },
    ];
    const e: Edge[] = [];

    const count = children.length;
    children.forEach((c, i) => {
      const fs = flowStateOf(c.status);
      const data: AgentNodeData = {
        title: c.role,
        statusLabel: c.status,
        flowState: fs,
        badge: BADGE[c.status],
        ...(c.behavior ? { behavior: c.behavior } : {}),
        ...(c.detail ? { detail: c.detail } : {}),
        ...(usdc(c.spendCapTotal) ? { cap: usdc(c.spendCapTotal) } : {}),
        ...(c.mandateId ? { mandateId: c.mandateId } : {}),
        ...(c.txHash ? { txHash: c.txHash } : {}),
      };
      const id = `child-${c.index}`;
      n.push({
        id,
        type: "agent",
        position: { x: (i - (count - 1) / 2) * 252, y: 200 },
        data: data as unknown as Record<string, unknown>,
        draggable: false,
      });
      e.push({
        id: `e-${id}`,
        source: "master",
        target: id,
        animated: c.status === "running",
        // Greyed when the spawn line is dead (revoked / failed leaf).
        style: revoked || c.status === "failed" ? "opacity:0.4" : "",
      });
    });

    nodes = n;
    edges = e;
  });
</script>

<div class="flex h-full min-h-[420px] flex-col gap-3">
  {#if store.bestRoute}
    <div class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
      <span class="font-medium">Best route:</span>
      {store.bestRoute.label} — ${(Number(store.bestRoute.amountOutUsdc) / 1e6).toFixed(2)}
      <span class="text-[10px] opacity-70">(best of {store.bestRoute.outOf} quote{store.bestRoute.outOf === 1 ? "" : "s"})</span>
    </div>
  {/if}

  <div class="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-background/20">
    {#if browser}
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        style="background: transparent;"
      >
        <Background gap={20} class="opacity-40" />
      </SvelteFlow>
    {/if}
  </div>

  {#if store.escalation}
    <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
      <span class="font-medium">Human review required.</span> {store.escalation}
    </div>
  {/if}
</div>
