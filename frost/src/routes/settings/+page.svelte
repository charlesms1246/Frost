<script lang="ts">
  import { untrack } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import ModelCombobox from "$lib/components/ModelCombobox.svelte";
  import { config, type ProviderId } from "$lib/stores/config.svelte";
  import { fetchModelCatalog, type CatalogProvider } from "$lib/agent/model-catalog";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import ListChecks from "@lucide/svelte/icons/list-checks";

  // Local mirror of the persisted config — edits save live via config.update().
  const c = config.value;
  let veniceApiKey = $state(c.veniceApiKey);
  let veniceModels = $state<[string, string, string]>([...c.veniceModels]);
  let veniceCallBudgetStr = $state(String(c.veniceCallBudget));
  let fallbackProvider = $state<ProviderId>(c.fallbackProvider);
  let openRouterApiKey = $state(c.openRouterApiKey);
  let groqApiKey = $state(c.groqApiKey);
  let fallbackModels = $state<[string, string, string]>([...c.fallbackModels]);
  let discordWebhookUrl = $state(c.discordWebhookUrl);
  let commsEmail = $state(c.commsEmail);
  let rpcUrl = $state(c.rpcUrl);
  let basescanApiKey = $state(c.basescanApiKey);

  // Models persist on change (ModelCombobox is bind-only). The write goes through
  // `untrack` so `config.update`'s internal read of the store's state isn't tracked
  // as a dependency of THIS effect — otherwise the read→write cycle on the same
  // state throws `effect_update_depth_exceeded` and freezes the page's inputs.
  $effect(() => {
    const m: [string, string, string] = [veniceModels[0], veniceModels[1], veniceModels[2]];
    untrack(() => config.update({ veniceModels: m }));
  });
  $effect(() => {
    const m: [string, string, string] = [fallbackModels[0], fallbackModels[1], fallbackModels[2]];
    untrack(() => config.update({ fallbackModels: m }));
  });
  function saveBudget() {
    const n = Number(veniceCallBudgetStr);
    if (Number.isFinite(n) && n >= 0) config.update({ veniceCallBudget: Math.floor(n) });
  }
  function setProvider(p: ProviderId) {
    fallbackProvider = p;
    config.update({ fallbackProvider: p });
  }

  // Live model catalogs (pick from the provider's list, don't hand-type model ids).
  const fallbackKey = $derived(fallbackProvider === "groq" ? groqApiKey : openRouterApiKey);
  let veniceModelOpts = $state<string[]>([]);
  let fallbackModelOpts = $state<string[]>([]);
  let loadingModels = $state<"venice" | "fallback" | "">("");
  let modelError = $state("");
  async function loadModels(which: "venice" | "fallback") {
    loadingModels = which;
    modelError = "";
    try {
      const provider: CatalogProvider = which === "venice" ? "venice" : fallbackProvider;
      const key = which === "venice" ? veniceApiKey : fallbackKey;
      const ids = (await fetchModelCatalog(provider, key)).map((m) => m.id);
      if (which === "venice") veniceModelOpts = ids;
      else fallbackModelOpts = ids;
      if (ids.length === 0) modelError = `${provider} returned no models.`;
    } catch (e) {
      modelError = e instanceof Error ? e.message : String(e);
    } finally {
      loadingModels = "";
    }
  }
</script>

<div class="flex h-[calc(100vh-36px)] flex-col gap-3 overflow-hidden p-4">
  <header class="shrink-0">
    <h1 class="text-lg font-semibold tracking-tight">Settings</h1>
    <p class="text-xs text-muted-foreground">Inference, comms and chain config — changes save automatically.</p>
  </header>

  <!-- Bento grid: the two inference providers are the hero tiles; comms + chain config below. -->
  <div class="grid min-h-0 flex-1 grid-cols-4 grid-rows-3 gap-3">
    <!-- Primary inference: Venice (x402) -->
    <Card.Root size="sm" class="col-span-2 row-span-2 min-h-0 gap-2 py-3">
      <Card.Header class="pb-0">
        <Card.Title>Primary inference · Venice <span class="text-muted-foreground">(x402)</span></Card.Title>
        <Card.Description class="text-[11px]">Pay-per-call. The first N calls (budget) route here, then fall back.</Card.Description>
      </Card.Header>
      <Card.Content class="flex min-h-0 flex-1 flex-col gap-2">
        <div class="grid gap-1">
          <Label for="venice-key" class="text-xs">Venice API key</Label>
          <Input id="venice-key" type="password" class="h-8" bind:value={veniceApiKey} onchange={() => config.update({ veniceApiKey })} placeholder="empty = Venice off" />
        </div>
        <div class="grid gap-1">
          <div class="flex items-center justify-between">
            <Label class="text-xs">Models — order of preference</Label>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button {...props} type="button" variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => loadModels("venice")} disabled={loadingModels !== "" || !veniceApiKey.trim()}>
                    {#if loadingModels === "venice"}<Loader2 class="size-3.5 animate-spin" />{:else}<ListChecks class="size-3.5" />{/if}
                    Load
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom">Load models from provider</Tooltip.Content>
            </Tooltip.Root>
          </div>
          {#each [0, 1, 2] as i (i)}
            <ModelCombobox bind:value={veniceModels[i]} options={veniceModelOpts} placeholder={i === 0 ? "primary model" : `choice ${i + 1} (optional)`} />
          {/each}
        </div>
        <div class="flex items-end justify-between gap-2">
          <div class="grid w-28 gap-1">
            <Label for="budget" class="text-xs">Call budget</Label>
            <Input id="budget" type="number" min="0" class="h-8" bind:value={veniceCallBudgetStr} onchange={saveBudget} />
          </div>
          {#if veniceModelOpts.length > 0}<p class="text-[10px] text-muted-foreground">{veniceModelOpts.length} models</p>{/if}
        </div>
        {#if modelError}<p class="text-[10px] break-all text-destructive">{modelError}</p>{/if}
      </Card.Content>
    </Card.Root>

    <!-- Fallback inference: OpenRouter / Groq -->
    <Card.Root size="sm" class="col-span-2 row-span-2 min-h-0 gap-2 py-3">
      <Card.Header class="pb-0">
        <div class="flex items-center justify-between gap-2">
          <Card.Title>Fallback inference</Card.Title>
          <div class="flex gap-1.5">
            <Button variant={fallbackProvider === "openrouter" ? "default" : "outline"} size="sm" class="h-7" onclick={() => setProvider("openrouter")}>OpenRouter</Button>
            <Button variant={fallbackProvider === "groq" ? "default" : "outline"} size="sm" class="h-7" onclick={() => setProvider("groq")}>Groq</Button>
          </div>
        </div>
        <Card.Description class="text-[11px]">Used when Venice is unavailable or over budget.</Card.Description>
      </Card.Header>
      <Card.Content class="flex min-h-0 flex-1 flex-col gap-2">
        {#if fallbackProvider === "openrouter"}
          <div class="grid gap-1">
            <Label for="or-key" class="text-xs">OpenRouter API key</Label>
            <Input id="or-key" type="password" class="h-8" bind:value={openRouterApiKey} onchange={() => config.update({ openRouterApiKey })} placeholder="sk-or-…" />
          </div>
        {:else}
          <div class="grid gap-1">
            <Label for="groq-key" class="text-xs">Groq API key</Label>
            <Input id="groq-key" type="password" class="h-8" bind:value={groqApiKey} onchange={() => config.update({ groqApiKey })} placeholder="gsk_…" />
          </div>
        {/if}
        <div class="grid gap-1">
          <div class="flex items-center justify-between">
            <Label class="text-xs">Models — order of preference</Label>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <Button {...props} type="button" variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => loadModels("fallback")} disabled={loadingModels !== "" || (fallbackProvider === "groq" && !groqApiKey.trim())}>
                    {#if loadingModels === "fallback"}<Loader2 class="size-3.5 animate-spin" />{:else}<ListChecks class="size-3.5" />{/if}
                    Load
                  </Button>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Content side="bottom">Load models from provider</Tooltip.Content>
            </Tooltip.Root>
          </div>
          {#each [0, 1, 2] as i (i)}
            <ModelCombobox bind:value={fallbackModels[i]} options={fallbackModelOpts} placeholder={i === 0 ? (fallbackProvider === "groq" ? "llama-3.3-70b-versatile" : "openai/gpt-4o-mini") : `choice ${i + 1} (optional)`} />
          {/each}
        </div>
        {#if fallbackModelOpts.length > 0}<p class="text-[10px] text-muted-foreground">{fallbackModelOpts.length} models</p>{/if}
      </Card.Content>
    </Card.Root>

    <!-- Comms -->
    <Card.Root size="sm" class="col-span-2 min-h-0 gap-2 py-3">
      <Card.Header class="pb-0">
        <Card.Title>Comms</Card.Title>
        <Card.Description class="text-[11px]">Where your agents report in.</Card.Description>
      </Card.Header>
      <Card.Content class="grid min-h-0 flex-1 grid-cols-2 content-center gap-2">
        <div class="grid gap-1">
          <Label for="discord" class="text-xs">Discord webhook URL</Label>
          <Input id="discord" type="password" class="h-8" bind:value={discordWebhookUrl} onchange={() => config.update({ discordWebhookUrl })} placeholder="https://discord.com/api/webhooks/…" />
        </div>
        <div class="grid gap-1">
          <Label for="comms-email" class="text-xs">Email</Label>
          <Input id="comms-email" type="email" class="h-8" bind:value={commsEmail} onchange={() => config.update({ commsEmail })} placeholder="you@example.com" />
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Advanced -->
    <Card.Root size="sm" class="col-span-2 min-h-0 gap-2 py-3">
      <Card.Header class="pb-0">
        <Card.Title>Advanced</Card.Title>
        <Card.Description class="text-[11px]">Chain RPC and explorer.</Card.Description>
      </Card.Header>
      <Card.Content class="grid min-h-0 flex-1 grid-cols-2 content-center gap-2">
        <div class="grid gap-1">
          <Label for="rpc" class="text-xs">Base Sepolia RPC URL</Label>
          <Input id="rpc" class="h-8 font-mono text-xs" bind:value={rpcUrl} onchange={() => config.update({ rpcUrl })} />
        </div>
        <div class="grid gap-1">
          <Label for="basescan" class="text-xs">BaseScan API key</Label>
          <Input id="basescan" type="password" class="h-8" bind:value={basescanApiKey} onchange={() => config.update({ basescanApiKey })} placeholder="optional" />
        </div>
      </Card.Content>
    </Card.Root>
  </div>
</div>
