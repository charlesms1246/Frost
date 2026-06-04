<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Input } from "$lib/components/ui/input";
  import { config } from "$lib/stores/config.svelte";
  import { customAgents } from "$lib/stores/custom-agents.svelte";
  import { buildTransport } from "$lib/agent/transport";
  import { AgentDesigner } from "@frost/agent/browser";
  import type { DesignResult } from "@frost/agent/browser";
  import Bot from "@lucide/svelte/icons/bot";
  import Plus from "@lucide/svelte/icons/plus";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Check from "@lucide/svelte/icons/check";
  import Settings2 from "@lucide/svelte/icons/settings-2";

  const builtins = [
    { role: "pricer", behavior: "pricer", blurb: "Quotes routes across DEXes via Venice RPC." },
    { role: "monitor", behavior: "monitor", blurb: "Watches on-chain conditions and triggers." },
    { role: "executor", behavior: "executor", blurb: "Submits swaps through 1Shot's private mempool." },
    { role: "comms", behavior: "comms", blurb: "Posts updates from the signed template." },
  ];

  let creating = $state(false);
  let description = $state("");
  let answers = $state<Record<string, string>>({});
  let designing = $state(false);
  let result = $state<DesignResult | undefined>(undefined);
  let saved = $state(false);

  const usdc = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;

  async function design() {
    if (!description.trim() || designing || !config.ready) return;
    designing = true;
    saved = false;
    try {
      const { transport, model } = buildTransport();
      result = await new AgentDesigner({ transport, model }).design({ description, answers });
    } catch (e) {
      result = undefined;
      console.error(e);
    } finally {
      designing = false;
    }
  }

  function save() {
    if (!result || !result.readyToUse) return;
    customAgents.save(result.definition);
    saved = true;
    // reset the creator
    setTimeout(() => {
      creating = false;
      description = "";
      answers = {};
      result = undefined;
      saved = false;
    }, 900);
  }

  function startNew() {
    creating = true;
    description = "";
    answers = {};
    result = undefined;
    saved = false;
  }
</script>

<div class="mx-auto max-w-4xl px-6 py-8">
  <header class="mb-6 flex items-center justify-between">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Agent manager</h1>
      <p class="text-sm text-muted-foreground">Explore your agents and create custom ones.</p>
    </div>
    <Button size="sm" onclick={startNew}>
      <Plus class="size-4" /> New custom agent
    </Button>
  </header>

  {#if creating}
    <Card.Root class="mb-6 border-primary/40">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">Create a custom agent</Card.Title>
        <Card.Description>
          Describe what you want in plain language; the Agent Designer proposes a bounded definition
          (behavior, capabilities, spend caps) you review before saving.
        </Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-3">
        {#if !config.ready}
          <div class="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <span>Finish configuration before designing an agent.</span>
            <Button href="/setup" size="sm" variant="secondary"><Settings2 class="size-3.5" /> Open setup</Button>
          </div>
        {/if}

        <div class="grid gap-1.5">
          <Label for="desc">What should this agent do?</Label>
          <Textarea id="desc" rows={3} bind:value={description} placeholder="e.g. Watch the ETH/USDC pool and alert me on Discord when the price moves more than 3% in an hour." />
        </div>
        <div class="flex items-center gap-2">
          <Button size="sm" onclick={design} disabled={designing || !description.trim() || !config.ready}>
            {#if designing}<Loader2 class="size-4 animate-spin" />{/if}
            {result ? "Re-design" : "Design agent"}
          </Button>
          <Button size="sm" variant="ghost" onclick={() => (creating = false)}>Cancel</Button>
        </div>

        {#if result}
          {#if result.escalateToHITL}
            <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <span class="font-medium">Needs human review.</span> {result.hitlReason}
            </div>
          {:else}
            <!-- Proposed definition -->
            <div class="rounded-lg border bg-muted/30 p-3 text-xs">
              <div class="mb-2 flex items-center gap-2">
                <Badge variant="secondary">{result.definition.behavior}</Badge>
                <span class="font-mono font-medium">{result.definition.role}</span>
                {#if result.readyToUse}<Badge variant="default" class="ml-auto">ready</Badge>{/if}
              </div>
              <p class="mb-2 text-muted-foreground">{result.definition.description}</p>
              <div class="flex flex-wrap gap-1">
                {#each result.definition.capabilities as cap (cap)}
                  <Badge variant="outline" class="text-[10px]">{cap}</Badge>
                {/each}
              </div>
              <div class="mt-2 flex gap-4 text-[11px] text-muted-foreground">
                <span>spend cap: <span class="text-foreground">{usdc(result.definition.spendCapTotal)}</span></span>
                {#if result.definition.hitlThreshold !== undefined}
                  <span>HITL ≥ <span class="text-foreground">{usdc(result.definition.hitlThreshold)}</span></span>
                {/if}
              </div>
            </div>

            {#if result.warnings.length > 0}
              <ul class="list-disc space-y-0.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 pl-6 text-[11px] text-amber-700 dark:text-amber-300">
                {#each result.warnings as w (w)}<li>{w}</li>{/each}
              </ul>
            {/if}

            {#if result.clarifications.length > 0}
              <div class="flex flex-col gap-2 rounded-lg border p-3">
                <p class="text-xs font-medium">A few questions:</p>
                {#each result.clarifications as cl (cl.field)}
                  <div class="grid gap-1">
                    <Label for={"cl-" + cl.field} class="text-xs">{cl.question}</Label>
                    <Input id={"cl-" + cl.field} class="h-8 text-xs" bind:value={answers[cl.field]} />
                  </div>
                {/each}
                <Button size="sm" variant="secondary" onclick={design} disabled={designing}>Re-design with answers</Button>
              </div>
            {/if}

            <Button size="sm" onclick={save} disabled={!result.readyToUse || saved}>
              {#if saved}<Check class="size-4" /> Saved{:else}Save agent{/if}
            </Button>
          {/if}
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- Saved custom agents -->
  {#if customAgents.list.length > 0}
    <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your agents</h2>
    <div class="mb-6 grid gap-3 sm:grid-cols-2">
      {#each customAgents.list as a (a.role)}
        <Card.Root>
          <Card.Header class="pb-2">
            <Card.Title class="flex items-center gap-2 text-sm">
              <Bot class="size-4 text-primary" /> <span class="font-mono">{a.role}</span>
              <Badge variant="secondary" class="ml-auto text-[10px]">{a.behavior}</Badge>
            </Card.Title>
          </Card.Header>
          <Card.Content class="flex flex-col gap-2">
            <p class="text-xs text-muted-foreground">{a.description}</p>
            <div class="flex flex-wrap gap-1">
              {#each a.capabilities as cap (cap)}<Badge variant="outline" class="text-[10px]">{cap}</Badge>{/each}
            </div>
            <div class="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>spend cap: <span class="text-foreground">{usdc(BigInt(a.spendCapTotal))}</span></span>
              <Button variant="ghost" size="icon-xs" onclick={() => customAgents.remove(a.role)} aria-label="Delete agent">
                <Trash2 class="size-3.5" />
              </Button>
            </div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {/if}

  <!-- Built-in specialists -->
  <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Built-in specialists</h2>
  <div class="grid gap-3 sm:grid-cols-2">
    {#each builtins as a (a.role)}
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Title class="flex items-center gap-2 text-sm">
            <Bot class="size-4 text-primary" /> {a.role}
            <Badge variant="secondary" class="ml-auto text-[10px]">{a.behavior}</Badge>
          </Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-2">
          <p class="text-xs text-muted-foreground">{a.blurb}</p>
          <div class="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>model: <span class="font-mono">{config.primaryModel || "—"}</span></span>
          </div>
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
</div>
