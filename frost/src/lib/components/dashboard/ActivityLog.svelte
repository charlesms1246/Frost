<script lang="ts">
  import type { AgentSessionStore, ActivityLine } from "$lib/stores/agent-session.svelte";

  let { store }: { store: AgentSessionStore } = $props();

  const COLOR: Record<ActivityLine["kind"], string> = {
    info: "text-muted-foreground",
    spawn: "text-sky-600 dark:text-sky-400",
    run: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    error: "text-destructive",
    route: "text-violet-600 dark:text-violet-400",
  };
  const time = (t: number) =>
    new Date(t).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
</script>

<div class="flex flex-col gap-1 font-mono text-[11px]">
  {#each store.activity as line (line.t + line.text)}
    <div class="flex gap-2">
      <span class="shrink-0 text-muted-foreground/60">{time(line.t)}</span>
      <span class={COLOR[line.kind]}>{line.text}</span>
    </div>
  {:else}
    <p class="text-xs text-muted-foreground">No activity yet. Run a cycle to begin.</p>
  {/each}
</div>
