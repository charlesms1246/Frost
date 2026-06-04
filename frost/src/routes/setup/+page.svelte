<script lang="ts">
  import { goto } from "$app/navigation";
  import { config, fallbackKeyOf, type ProviderId } from "$lib/stores/config.svelte";
  import { syncConfigToHosted } from "$lib/config-sync";
  import { provisionSigningWallet } from "$lib/signing-wallet";
  import AuthShell from "$lib/components/brand/AuthShell.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Wallet from "@lucide/svelte/icons/wallet";
  import Check from "@lucide/svelte/icons/check";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";

  const c = config.value;

  // Local mirror of the config; persisted on each step + on finish.
  let discordWebhookUrl = $state(c.discordWebhookUrl);
  let veniceApiKey = $state(c.veniceApiKey);
  let veniceModels = $state<[string, string, string]>([...c.veniceModels]);
  let veniceCallBudgetStr = $state(String(c.veniceCallBudget));
  let fallbackProvider = $state<ProviderId>(c.fallbackProvider);
  let openRouterApiKey = $state(c.openRouterApiKey);
  let groqApiKey = $state(c.groqApiKey);
  let fallbackModels = $state<[string, string, string]>([...c.fallbackModels]);
  let rpcUrl = $state(c.rpcUrl);
  let signingWalletId = $state(c.signingWalletId);
  let signingWalletAddress = $state(c.signingWalletAddress);

  let provisioning = $state(false);
  let saving = $state(false);

  const STEPS = [
    { key: "primary", label: "Primary", quote: "Venice first.", sub: "Your primary x402 inference models." },
    { key: "fallback", label: "Fallback", quote: "A backup you trust.", sub: "OpenRouter or Groq, when Venice is busy." },
    { key: "comms", label: "Comms", quote: "Stay in the loop.", sub: "Where your agents report in." },
    { key: "wallet", label: "Wallet", quote: "No keys to manage.", sub: "Frost runs a funded wallet for you." },
  ] as const;
  let step = $state(0);
  const current = $derived(STEPS[step]);

  const fallbackKey = $derived(fallbackProvider === "groq" ? groqApiKey : openRouterApiKey);
  const ready = $derived(
    (veniceApiKey.trim() !== "" && veniceModels[0].trim() !== "") ||
      (fallbackKey.trim() !== "" && fallbackModels[0].trim() !== ""),
  );

  function persist(extra: Record<string, unknown> = {}) {
    const budget = Number.parseInt(veniceCallBudgetStr, 10);
    config.update({
      discordWebhookUrl: discordWebhookUrl.trim(),
      veniceApiKey: veniceApiKey.trim(),
      veniceModels,
      veniceCallBudget: Number.isFinite(budget) ? budget : 3,
      fallbackProvider,
      openRouterApiKey: openRouterApiKey.trim(),
      groqApiKey: groqApiKey.trim(),
      fallbackModels,
      rpcUrl: rpcUrl.trim(),
      ...(signingWalletId ? { signingWalletId } : {}),
      ...(signingWalletAddress ? { signingWalletAddress } : {}),
      ...extra,
    });
  }

  function next() {
    persist();
    if (step < STEPS.length - 1) step += 1;
  }
  function back() {
    if (step > 0) step -= 1;
  }

  async function provision() {
    if (provisioning) return;
    provisioning = true;
    try {
      const w = await provisionSigningWallet();
      signingWalletId = w.walletId;
      signingWalletAddress = w.address;
    } finally {
      provisioning = false;
    }
  }

  async function finish() {
    if (!ready || saving) return;
    saving = true;
    persist({ onboarded: true });
    await config.syncToHosted(syncConfigToHosted);
    saving = false;
    await goto("/chat");
  }

  const providers: { id: ProviderId; label: string }[] = [
    { id: "openrouter", label: "OpenRouter" },
    { id: "groq", label: "Groq" },
  ];
</script>

<AuthShell quote={current.quote} subquote={current.sub}>
  <!-- Step indicator (compact dots) -->
  <div class="mb-6 flex items-center gap-2">
    {#each STEPS as s, i (s.key)}
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold {i < step
          ? 'bg-primary text-primary-foreground'
          : i === step
            ? 'border-2 border-primary text-primary'
            : 'border text-muted-foreground'}"
      >
        {#if i < step}<Check class="size-3" />{:else}{i + 1}{/if}
      </span>
      {#if i < STEPS.length - 1}<span class="h-px flex-1 bg-border"></span>{/if}
    {/each}
  </div>

  <h1 class="text-2xl font-semibold tracking-tight">Set up Frost</h1>
  <p class="mt-1 text-sm text-muted-foreground">
    Step {step + 1} of {STEPS.length} · {current.label} — change anything later in Settings.
  </p>

  <div class="mt-6 flex flex-col gap-4">
    {#if current.key === "primary"}
      <!-- Primary: Venice (x402) -->
      <div class="grid gap-1.5">
        <Label for="venice">Venice API key <span class="text-muted-foreground">(x402)</span></Label>
        <Input id="venice" type="password" bind:value={veniceApiKey} placeholder="your Venice inference key" />
      </div>
      <div class="grid gap-1.5">
        <Label>Venice models — in order of preference</Label>
        {#each [0, 1, 2] as i (i)}
          <Input bind:value={veniceModels[i]} placeholder={i === 0 ? "llama-3.3-70b (primary)" : `choice ${i + 1}`} />
        {/each}
      </div>
      <div class="grid w-32 gap-1.5">
        <Label for="vbudget">Venice call budget</Label>
        <Input id="vbudget" type="number" min="0" bind:value={veniceCallBudgetStr} />
      </div>
      <p class="text-[10px] text-muted-foreground">
        Venice is your primary, pay-per-call inference provider. The runtime routes the first N calls
        here (your budget), then falls back. Order = preference.
      </p>
    {:else if current.key === "fallback"}
      <!-- Fallback: OpenRouter / Groq -->
      <div class="grid gap-1.5">
        <Label>Fallback provider</Label>
        <div class="mt-1.5 flex gap-2">
          {#each providers as p (p.id)}
            <Button
              type="button"
              variant={fallbackProvider === p.id ? "default" : "outline"}
              size="sm"
              onclick={() => (fallbackProvider = p.id)}
            >
              {p.label}
            </Button>
          {/each}
        </div>
      </div>
      {#if fallbackProvider === "openrouter"}
        <div class="grid gap-1.5">
          <Label for="orkey">OpenRouter API key</Label>
          <Input id="orkey" type="password" bind:value={openRouterApiKey} placeholder="sk-or-…" />
        </div>
      {:else}
        <div class="grid gap-1.5">
          <Label for="groqkey">Groq API key</Label>
          <Input id="groqkey" type="password" bind:value={groqApiKey} placeholder="gsk_…" />
        </div>
      {/if}
      <div class="grid gap-1.5">
        <Label>Fallback models — in order of preference</Label>
        {#each [0, 1, 2] as i (i)}
          <Input bind:value={fallbackModels[i]} placeholder={fallbackProvider === "groq" ? "llama-3.3-70b-versatile" : "openai/gpt-4o-mini"} />
        {/each}
      </div>
      <p class="text-[10px] text-muted-foreground">
        Used when Venice is unavailable or out of budget. Either Venice or a fallback is enough to finish.
      </p>
    {:else if current.key === "comms"}
      <div class="grid gap-1.5">
        <Label for="discord">Discord webhook URL</Label>
        <Input id="discord" bind:value={discordWebhookUrl} placeholder="https://discord.com/api/webhooks/…" />
        <p class="text-[10px] text-muted-foreground">Where agents post updates. Optional — you can add it later.</p>
      </div>
    {:else}
      <!-- Wallet -->
      {#if signingWalletAddress}
        <div class="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-xs">
          <Check class="size-4 text-primary" />
          <div>
            <div class="text-[10px] uppercase tracking-wide text-muted-foreground">Signing wallet</div>
            <div class="font-mono break-all">{signingWalletAddress}</div>
          </div>
        </div>
      {:else}
        <p class="text-sm text-muted-foreground">
          Frost runs a funded custodial wallet for your live actions — you never see or hold a private key.
          We provision and fund it for you.
        </p>
        <Button type="button" variant="secondary" class="w-fit" onclick={provision} disabled={provisioning}>
          {#if provisioning}<Loader2 class="size-4 animate-spin" />{:else}<Wallet class="size-4" />{/if}
          Provision signing wallet
        </Button>
        <p class="text-[10px] text-muted-foreground">Optional now — you can provision it later from Settings.</p>
      {/if}
      <details class="rounded-lg border bg-card px-3 py-2">
        <summary class="cursor-pointer text-xs font-medium">Advanced</summary>
        <div class="mt-2 grid gap-1.5">
          <Label for="rpc">Base Sepolia RPC URL</Label>
          <Input id="rpc" bind:value={rpcUrl} />
        </div>
      </details>
    {/if}
  </div>

  <!-- Footer nav -->
  <div class="mt-7 flex items-center justify-between">
    {#if step > 0}
      <Button variant="ghost" size="sm" onclick={back}><ArrowLeft class="size-4" /> Back</Button>
    {:else}
      <span></span>
    {/if}
    {#if step < STEPS.length - 1}
      <Button size="sm" onclick={next}>Next <ArrowRight class="size-4" /></Button>
    {:else}
      <Button size="sm" onclick={finish} disabled={!ready || saving}>
        {#if saving}<Loader2 class="size-4 animate-spin" />{/if}
        Finish setup
      </Button>
    {/if}
  </div>

  {#if step === STEPS.length - 1 && !ready}
    <p class="mt-2 text-right text-[10px] text-muted-foreground">
      Add a Venice key + model (or a fallback provider key + model) to finish.
    </p>
  {/if}

  <p class="mt-6 text-center">
    <button type="button" class="text-xs text-muted-foreground hover:underline" onclick={() => goto("/chat")}>Skip for now</button>
  </p>
</AuthShell>
