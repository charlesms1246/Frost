<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import * as Card from "$lib/components/ui/card";
  import { theme } from "$lib/stores/theme.svelte";
  import { config, type ProviderId } from "$lib/stores/config.svelte";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Code from "@lucide/svelte/icons/code";
  import Wallet from "@lucide/svelte/icons/wallet";
  import Loader2 from "@lucide/svelte/icons/loader-2";

  // Local mirror of the persisted config — edits save live via config.update().
  const c = config.value;
  let discordWebhookUrl = $state(c.discordWebhookUrl);
  let rpcUrl = $state(c.rpcUrl);
  let basescanApiKey = $state(c.basescanApiKey);
  let fallbackProvider = $state<ProviderId>(c.fallbackProvider);
  let openRouterApiKey = $state(c.openRouterApiKey);
  let groqApiKey = $state(c.groqApiKey);
  let fallbackModel = $state(c.fallbackModels[0]);
  let veniceApiKey = $state(c.veniceApiKey);
  let veniceModel = $state(c.veniceModels[0]);
  let veniceCallBudgetStr = $state(String(c.veniceCallBudget));

  const signingAddr = $derived(config.value.signingWalletAddress);
  const ZERO = "0x0000000000000000000000000000000000000000";
  const hasSigning = $derived(!!signingAddr && signingAddr !== ZERO);

  // Persist helpers — each field writes straight to the config store on change.
  const saveFallbackModel = () =>
    config.update({ fallbackModels: [fallbackModel, c.fallbackModels[1], c.fallbackModels[2]] });
  const saveVeniceModel = () =>
    config.update({ veniceModels: [veniceModel, c.veniceModels[1], c.veniceModels[2]] });
  function saveBudget() {
    const n = Number(veniceCallBudgetStr);
    if (Number.isFinite(n) && n >= 0) config.update({ veniceCallBudget: Math.floor(n) });
  }
  function setProvider(p: ProviderId) {
    fallbackProvider = p;
    config.update({ fallbackProvider: p });
  }

  let provisioning = $state(false);
  async function provisionSigning() {
    if (provisioning) return;
    provisioning = true;
    try {
      const demo = await invoke<{ walletAddress?: string; walletId?: string }>("load_demo_credentials");
      if (demo?.walletAddress && /^0x[0-9a-fA-F]{40}$/.test(demo.walletAddress) && demo.walletAddress !== ZERO) {
        config.update({
          signingWalletAddress: demo.walletAddress,
          ...(demo.walletId ? { signingWalletId: demo.walletId } : {}),
        });
      }
    } catch {
      /* no demo creds — packaged build */
    } finally {
      provisioning = false;
    }
  }
</script>

<div class="mx-auto max-w-3xl px-6 py-6">
  <header class="mb-6">
    <h1 class="text-xl font-semibold tracking-tight">Settings</h1>
    <p class="text-sm text-muted-foreground">App preferences and configuration — changes save automatically.</p>
  </header>

  <div class="flex flex-col gap-4">
    <!-- Appearance -->
    <Card.Root>
      <Card.Header class="pb-3"><Card.Title class="text-base">Appearance</Card.Title></Card.Header>
      <Card.Content class="flex gap-2">
        <Button variant={theme.value === "light" ? "default" : "outline"} size="sm" onclick={() => theme.set("light")}>
          <Sun class="size-4" /> Light
        </Button>
        <Button variant={theme.value === "dark" ? "default" : "outline"} size="sm" onclick={() => theme.set("dark")}>
          <Moon class="size-4" /> Dark
        </Button>
      </Card.Content>
    </Card.Root>

    <!-- Inference -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-base">Inference</Card.Title>
        <Card.Description>The thinking path. Fallback runs when Venice is off/over budget.</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="grid gap-1.5">
          <Label>Fallback provider</Label>
          <div class="flex gap-2">
            <Button variant={fallbackProvider === "openrouter" ? "default" : "outline"} size="sm" onclick={() => setProvider("openrouter")}>OpenRouter</Button>
            <Button variant={fallbackProvider === "groq" ? "default" : "outline"} size="sm" onclick={() => setProvider("groq")}>Groq</Button>
          </div>
        </div>
        {#if fallbackProvider === "openrouter"}
          <div class="grid gap-1.5">
            <Label for="or-key">OpenRouter API key</Label>
            <Input id="or-key" type="password" bind:value={openRouterApiKey} onchange={() => config.update({ openRouterApiKey })} placeholder="sk-or-…" />
          </div>
        {:else}
          <div class="grid gap-1.5">
            <Label for="groq-key">Groq API key</Label>
            <Input id="groq-key" type="password" bind:value={groqApiKey} onchange={() => config.update({ groqApiKey })} placeholder="gsk_…" />
          </div>
        {/if}
        <div class="grid gap-1.5">
          <Label for="fb-model">Fallback model</Label>
          <Input id="fb-model" bind:value={fallbackModel} onchange={saveFallbackModel} placeholder="openai/gpt-4o-mini" class="font-mono text-xs" />
        </div>
        <div class="grid gap-1.5 border-t pt-4">
          <Label for="venice-key">Venice API key (x402 paid path — optional)</Label>
          <Input id="venice-key" type="password" bind:value={veniceApiKey} onchange={() => config.update({ veniceApiKey })} placeholder="leave empty to disable Venice" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-1.5">
            <Label for="venice-model">Venice model</Label>
            <Input id="venice-model" bind:value={veniceModel} onchange={saveVeniceModel} placeholder="llama-3.3-70b" class="font-mono text-xs" />
          </div>
          <div class="grid gap-1.5">
            <Label for="budget">Venice call budget</Label>
            <Input id="budget" type="number" min="0" bind:value={veniceCallBudgetStr} onchange={saveBudget} />
          </div>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Integrations -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-base">Integrations</Card.Title>
        <Card.Description>Chain RPC, explorer, and notifications.</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="grid gap-1.5">
          <Label for="rpc">Base Sepolia RPC URL</Label>
          <Input id="rpc" bind:value={rpcUrl} onchange={() => config.update({ rpcUrl })} class="font-mono text-xs" />
        </div>
        <div class="grid gap-1.5">
          <Label for="discord">Discord webhook URL</Label>
          <Input id="discord" type="password" bind:value={discordWebhookUrl} onchange={() => config.update({ discordWebhookUrl })} placeholder="https://discord.com/api/webhooks/…" />
        </div>
        <div class="grid gap-1.5">
          <Label for="basescan">BaseScan API key (for contract_abi lookups)</Label>
          <Input id="basescan" type="password" bind:value={basescanApiKey} onchange={() => config.update({ basescanApiKey })} placeholder="optional" />
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Signing wallet -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="flex items-center gap-2 text-base"><Wallet class="size-4 text-primary" /> Signing wallet</Card.Title>
        <Card.Description>The agent's custodial 1Shot wallet that executes on-chain.</Card.Description>
      </Card.Header>
      <Card.Content class="flex items-center justify-between gap-3">
        {#if hasSigning}
          <span class="font-mono text-xs break-all">{signingAddr}</span>
        {:else}
          <span class="text-sm text-muted-foreground">Not provisioned.</span>
        {/if}
        <Button variant="outline" size="sm" onclick={provisionSigning} disabled={provisioning}>
          {#if provisioning}<Loader2 class="size-4 animate-spin" />{/if}
          {hasSigning ? "Refresh" : "Provision"}
        </Button>
      </Card.Content>
    </Card.Root>

    <!-- Developer -->
    <Card.Root>
      <Card.Header class="pb-3"><Card.Title class="text-base">Developer</Card.Title></Card.Header>
      <Card.Content class="flex flex-wrap items-center gap-2">
        <Button href="/agent" variant="outline" size="sm"><Code class="size-4" /> Agent debug</Button>
        <Button href="/bridge" variant="outline" size="sm"><Code class="size-4" /> Wallet bridge</Button>
        <span class="ml-auto text-[10px] text-muted-foreground">Frost v0.1.0 · Port-42 runtime</span>
      </Card.Content>
    </Card.Root>
  </div>
</div>
