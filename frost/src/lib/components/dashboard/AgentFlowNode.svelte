<script lang="ts" module>
  export type FlowState = "active" | "passive" | "disabled";

  /** Data carried by each delegation-tree node. */
  export type AgentNodeData = {
    title: string;
    /** Status label shown in the badge (planned/issued/running/done/failed/revoked). */
    statusLabel: string;
    /** Visual state: active (running), passive (idle/done), disabled (failed/revoked). */
    flowState: FlowState;
    badge: "default" | "secondary" | "outline" | "destructive";
    isMaster?: boolean;
    behavior?: string;
    detail?: string;
    cap?: string;
    mandateId?: string;
    txHash?: string;
    /** Master-only: revoke control. */
    onRevoke?: () => void;
    revoking?: boolean;
    revoked?: boolean;
  };
</script>

<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import Ban from "@lucide/svelte/icons/ban";

  let { data }: NodeProps = $props();
  const d = $derived(data as AgentNodeData);

  const DOT: Record<FlowState, string> = {
    active: "bg-amber-500 animate-pulse",
    passive: "bg-emerald-500",
    disabled: "bg-destructive",
  };
  const EXPLORER = "https://sepolia.basescan.org/tx/";
  const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
</script>

<!-- Top handle for every node except the master (the root). -->
{#if !d.isMaster}
  <Handle type="target" position={Position.Top} class="!size-2 !border-0 !bg-border" />
{/if}

<div
  class="w-56 rounded-xl border bg-card/80 p-3 text-left text-xs shadow-sm backdrop-blur-md transition-opacity
    {d.flowState === 'disabled' ? 'opacity-55' : ''}
    {d.flowState === 'active' ? 'border-amber-500/50 ring-1 ring-amber-500/30' : ''}"
>
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <span class="size-2.5 shrink-0 rounded-full {d.flowState === 'passive' && d.statusLabel !== 'done' ? 'bg-sky-500' : DOT[d.flowState]}"></span>
      <span class="font-medium {d.isMaster ? 'text-sm' : ''}">{d.title}</span>
      {#if d.behavior}<Badge variant="outline" class="text-[10px]">{d.behavior}</Badge>{/if}
    </div>
    {#if d.revoked}
      <Badge variant="destructive">revoked</Badge>
    {:else}
      <Badge variant={d.badge}>{d.statusLabel}</Badge>
    {/if}
  </div>

  {#if d.detail}
    <p class="mt-1.5 line-clamp-2 {d.flowState === 'disabled' && !d.revoked ? 'text-destructive' : 'text-muted-foreground'}">{d.detail}</p>
  {/if}

  <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
    {#if d.cap}<span>cap {d.cap}</span>{/if}
    {#if d.mandateId}<span class="font-mono">id {short(d.mandateId)}</span>{/if}
    {#if d.txHash}
      <a class="font-mono text-sky-600 hover:underline dark:text-sky-400" href={EXPLORER + d.txHash} target="_blank" rel="noreferrer" onclick={(e) => e.stopPropagation()}>
        tx {short(d.txHash)}
      </a>
    {/if}
  </div>

  {#if d.isMaster && d.onRevoke && !d.revoked}
    <Button size="sm" variant="outline" class="mt-2 h-6 px-2 text-[11px]" onclick={d.onRevoke} disabled={d.revoking}>
      <Ban class="mr-1 size-3" /> Revoke spawning
    </Button>
  {/if}
</div>

<!-- Bottom handle so children can connect (master + any non-leaf). -->
<Handle type="source" position={Position.Bottom} class="!size-2 !border-0 !bg-border" />
