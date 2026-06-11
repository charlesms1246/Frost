<script lang="ts">
  import type { AgentSessionStore, NodeStatus } from "$lib/stores/agent-session.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import Ban from "@lucide/svelte/icons/ban";

  let { store, onRevoke, revoking = false }: { store: AgentSessionStore; onRevoke?: () => void; revoking?: boolean } = $props();

  const STATUS: Record<NodeStatus, { label: string; badge: "default" | "secondary" | "outline" | "destructive"; dot: string }> = {
    planned: { label: "planned", badge: "outline", dot: "bg-muted-foreground/40" },
    issued: { label: "issued", badge: "secondary", dot: "bg-sky-500" },
    running: { label: "running", badge: "default", dot: "bg-amber-500 animate-pulse" },
    done: { label: "done", badge: "secondary", dot: "bg-emerald-500" },
    failed: { label: "failed", badge: "destructive", dot: "bg-destructive" },
  };

  const usdc = (v?: bigint) => (v === undefined ? "" : `$${(Number(v) / 1e6).toFixed(2)}`);
  const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
  const EXPLORER = "https://sepolia.basescan.org/tx/";
</script>

<div class="flex flex-col gap-3">
  <!-- Master node -->
  <div class="rounded-lg border bg-card p-3 {store.spawningRevoked ? 'opacity-60' : ''}">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <span class="size-2.5 rounded-full {store.spawningRevoked ? 'bg-destructive' : STATUS[store.master.status].dot}"></span>
        <span class="font-medium">Master agent</span>
      </div>
      <div class="flex items-center gap-2">
        {#if store.spawningRevoked}
          <Badge variant="destructive">spawning revoked</Badge>
        {:else}
          <Badge variant={STATUS[store.master.status].badge}>{STATUS[store.master.status].label}</Badge>
          {#if onRevoke}
            <Button size="sm" variant="outline" class="h-6 px-2 text-[11px]" onclick={onRevoke} disabled={revoking}>
              <Ban class="mr-1 size-3" /> Revoke spawning
            </Button>
          {/if}
        {/if}
      </div>
    </div>
    <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{store.master.description || "No session yet."}</p>
    {#if store.master.rootMandateId}
      <p class="mt-1 font-mono text-[10px] text-muted-foreground">root {short(store.master.rootMandateId)}</p>
    {/if}
    {#if store.spawningRevoked}
      <p class="mt-1 text-[10px] text-destructive">
        CAP_REDELEGATE revoked — new sub-agents are refused; in-flight ones finish.
        {#if store.revokeTxHash}
          <a class="font-mono hover:underline" href={EXPLORER + store.revokeTxHash} target="_blank" rel="noreferrer">tx {short(store.revokeTxHash)}</a>
        {/if}
      </p>
    {/if}
  </div>

  {#if store.bestRoute}
    <div class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
      <span class="font-medium">Best route:</span>
      {store.bestRoute.label} — {usdc(store.bestRoute.amountOutUsdc)}
      <span class="text-[10px] opacity-70">(best of {store.bestRoute.outOf} quote{store.bestRoute.outOf === 1 ? "" : "s"})</span>
    </div>
  {/if}

  {#if store.children.length > 0}
    <div class="relative ml-3 flex flex-col gap-2 border-l pl-5">
      {#each store.children as node (node.index)}
        <div class="relative rounded-lg border bg-card p-3">
          <!-- connector -->
          <span class="absolute -left-5 top-5 h-px w-5 bg-border"></span>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="size-2.5 rounded-full {STATUS[node.status].dot}"></span>
              <span class="font-medium">{node.role}</span>
              {#if node.behavior}
                <Badge variant="outline" class="text-[10px]">{node.behavior}</Badge>
              {/if}
            </div>
            <Badge variant={STATUS[node.status].badge}>{STATUS[node.status].label}</Badge>
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            {#if node.spendCapTotal !== undefined}
              <span>cap {usdc(node.spendCapTotal)}</span>
            {/if}
            {#if node.mandateId}
              <span class="font-mono">id {short(node.mandateId)}</span>
            {/if}
            {#if node.txHash}
              <a class="font-mono text-sky-600 hover:underline dark:text-sky-400" href={EXPLORER + node.txHash} target="_blank" rel="noreferrer">
                tx {short(node.txHash)}
              </a>
            {/if}
          </div>
          {#if node.detail}
            <p class="mt-1 text-[10px] {node.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}">{node.detail}</p>
          {/if}
        </div>
      {/each}
    </div>
  {:else if store.phase !== "idle"}
    <p class="ml-3 text-xs text-muted-foreground">Waiting for the planner to decide sub-agents…</p>
  {/if}

  {#if store.escalation}
    <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
      <span class="font-medium">Human review required.</span> {store.escalation}
    </div>
  {/if}
</div>
