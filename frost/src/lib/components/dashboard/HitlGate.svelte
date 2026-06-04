<script lang="ts">
  import type { AgentSessionStore } from "$lib/stores/agent-session.svelte";
  import { Button } from "$lib/components/ui/button";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";

  let { store }: { store: AgentSessionStore } = $props();

  const usd = (v?: bigint) => (v === undefined ? "—" : `$${(Number(v) / 1e6).toFixed(2)}`);
  const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
</script>

{#if store.hitl.pending && store.hitl.request}
  {@const r = store.hitl.request}
  <div class="flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-3">
    <ShieldAlert class="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
        Approval required — {usd(r.notionalUsdc)} action
      </p>
      <p class="truncate text-xs text-amber-700/80 dark:text-amber-300/80">
        {r.reason} · to {short(r.target)} · fn {r.selector}
      </p>
    </div>
    <div class="flex shrink-0 gap-2">
      <Button size="sm" variant="outline" onclick={() => store.resolveHitl(false)}>Reject</Button>
      <Button size="sm" onclick={() => store.resolveHitl(true)}>Approve</Button>
    </div>
  </div>
{/if}
