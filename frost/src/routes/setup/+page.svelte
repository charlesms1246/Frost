<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { config, fallbackKeyOf, type ProviderId } from "$lib/stores/config.svelte";
  import { syncConfigToHosted } from "$lib/config-sync";
  import { provisionSigningWallet } from "$lib/signing-wallet";
  import { oneShotTauriFetch } from "$lib/tauri-fetch";
  import { captureMetaMaskAuthority } from "$lib/wallet-connect";
  import AuthShell from "$lib/components/brand/AuthShell.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Wallet from "@lucide/svelte/icons/wallet";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import Check from "@lucide/svelte/icons/check";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ListChecks from "@lucide/svelte/icons/list-checks";
  import ModelCombobox from "$lib/components/ModelCombobox.svelte";
  import { fetchModelCatalog, type CatalogProvider } from "$lib/agent/model-catalog";

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
  let basescanApiKey = $state(c.basescanApiKey);
  let signingWalletId = $state(c.signingWalletId);
  let signingWalletAddress = $state(c.signingWalletAddress);
  // The ERC-7715 authority lives in the config store (set at sign-in or here); read it live.
  const grant = $derived(config.value);
  let connecting = $state(false);
  let connectError = $state("");

  let provisioning = $state(false);
  let saving = $state(false);

  // Model lists fetched from the provider APIs (so the user picks, not types).
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

  const STEPS = [
    { key: "primary", label: "Primary", quote: "Venice first.", sub: "Your primary x402 inference models." },
    { key: "fallback", label: "Fallback", quote: "A backup you trust.", sub: "OpenRouter or Groq, when Venice is busy." },
    { key: "comms", label: "Comms", quote: "Stay in the loop.", sub: "Where your agents report in." },
    { key: "review", label: "Review", quote: "Confirm and go.", sub: "Review your configuration before finishing." },
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
      basescanApiKey: basescanApiKey.trim(),
      ...(signingWalletId ? { signingWalletId } : {}),
      ...(signingWalletAddress ? { signingWalletAddress } : {}),
      ...extra,
    });
  }

  /** Capture a real ERC-7715 grant from the user's MetaMask (the session root authority). */
  async function connectMetaMask() {
    if (connecting) return;
    connecting = true;
    connectError = "";
    try {
      await captureMetaMaskAuthority();
    } catch (e) {
      connectError = e instanceof Error ? e.message : String(e);
    } finally {
      connecting = false;
    }
  }

  function next() {
    persist();
    if (step < STEPS.length - 1) step += 1;
  }
  function back() {
    if (step > 0) step -= 1;
  }

  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
  const isRealAddr = (a?: string) => !!a && /^0x[0-9a-fA-F]{40}$/.test(a) && a !== ZERO_ADDR;

  /**
   * Demo auto-provision: use the pre-funded 1Shot executor wallet from the repo `.env`
   * (`load_demo_credentials`) as the agent's signing wallet, instead of the no-creds
   * placeholder (`0x000…`). Stores it in config so it syncs to the cloud and follows the
   * user across devices. Returns true if it set a real wallet.
   */
  async function autoProvisionFromDemo(): Promise<boolean> {
    try {
      const demo = await invoke<{ walletAddress?: string; walletId?: string }>("load_demo_credentials");
      if (isRealAddr(demo?.walletAddress)) {
        signingWalletAddress = demo!.walletAddress!;
        if (demo!.walletId) signingWalletId = demo!.walletId;
        config.update({
          signingWalletAddress,
          ...(signingWalletId ? { signingWalletId } : {}),
        });
        return true;
      }
    } catch {
      /* packaged build / no demo creds — fall through to the real provisioner */
    }
    return false;
  }

  // Auto-provision the signing wallet on first arrival (signup). If the user signed in and
  // restored a signing wallet from the cloud, this is a no-op (already set).
  onMount(() => {
    if (!isRealAddr(config.value.signingWalletAddress)) void autoProvisionFromDemo();
  });

  async function provision() {
    if (provisioning) return;
    provisioning = true;
    try {
      // Prefer the funded demo wallet; else create/reuse a real 1Shot custodial wallet for
      // this user via the business creds (HTTP routed through Rust — no webview CORS, secrets
      // stay server-side); else the honest placeholder.
      if (await autoProvisionFromDemo()) return;
      const creds = await invoke<{ apiKey?: string; apiSecret?: string; businessId?: string }>(
        "load_demo_credentials",
      ).catch(() => ({}) as { apiKey?: string; apiSecret?: string; businessId?: string });
      const w =
        creds.apiKey && creds.apiSecret && creds.businessId
          ? await provisionSigningWallet({
              apiKey: creds.apiKey,
              apiSecret: creds.apiSecret,
              businessId: creds.businessId,
              fetchImpl: oneShotTauriFetch,
            })
          : await provisionSigningWallet();
      signingWalletId = w.walletId;
      signingWalletAddress = w.address;
      config.update({
        ...(isRealAddr(w.address) ? { signingWalletAddress: w.address } : {}),
        ...(w.walletId ? { signingWalletId: w.walletId } : {}),
      });
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
        <div class="flex items-center justify-between">
          <Label>Venice models — in order of preference</Label>
          <Button type="button" variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => loadModels("venice")} disabled={loadingModels !== "" || !veniceApiKey.trim()}>
            {#if loadingModels === "venice"}<Loader2 class="size-3.5 animate-spin" />{:else}<ListChecks class="size-3.5" />{/if}
            Load models
          </Button>
        </div>
        {#each [0, 1, 2] as i (i)}
          <ModelCombobox bind:value={veniceModels[i]} options={veniceModelOpts} placeholder={i === 0 ? "primary model" : `choice ${i + 1} (optional)`} />
        {/each}
        {#if veniceModelOpts.length > 0}<p class="text-[10px] text-muted-foreground">{veniceModelOpts.length} models loaded.</p>{/if}
        {#if modelError}<p class="text-[10px] text-destructive">{modelError}</p>{/if}
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
        <div class="flex items-center justify-between">
          <Label>Fallback models — in order of preference</Label>
          <Button type="button" variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => loadModels("fallback")} disabled={loadingModels !== "" || (fallbackProvider === "groq" && !groqApiKey.trim())}>
            {#if loadingModels === "fallback"}<Loader2 class="size-3.5 animate-spin" />{:else}<ListChecks class="size-3.5" />{/if}
            Load models
          </Button>
        </div>
        {#each [0, 1, 2] as i (i)}
          <ModelCombobox bind:value={fallbackModels[i]} options={fallbackModelOpts} placeholder={i === 0 ? (fallbackProvider === "groq" ? "llama-3.3-70b-versatile" : "openai/gpt-4o-mini") : `choice ${i + 1} (optional)`} />
        {/each}
        {#if fallbackModelOpts.length > 0}<p class="text-[10px] text-muted-foreground">{fallbackModelOpts.length} models loaded.</p>{/if}
        {#if modelError}<p class="text-[10px] text-destructive">{modelError}</p>{/if}
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
      <!-- Review & confirm -->
      <div class="flex flex-col gap-2 text-xs">
        <div class="flex items-center justify-between rounded-lg border bg-card p-2.5">
          <span class="text-muted-foreground">Primary (Venice)</span>
          <span class="font-mono">{veniceModels[0] || "—"}</span>
        </div>
        <div class="flex items-center justify-between rounded-lg border bg-card p-2.5">
          <span class="text-muted-foreground">Fallback</span>
          <span class="font-mono">{fallbackProvider} · {fallbackModels[0] || "—"}</span>
        </div>
        <div class="flex items-center justify-between rounded-lg border bg-card p-2.5">
          <span class="text-muted-foreground">Discord</span>
          <span>{discordWebhookUrl.trim() ? "configured" : "off"}</span>
        </div>

        {#if grant.metaMaskGrant}
          <div class="rounded-lg border border-primary/40 bg-primary/5 p-2.5">
            <div class="mb-1 flex items-center gap-2 font-medium text-primary"><ShieldCheck class="size-4" /> Spending authority granted</div>
            <div class="text-muted-foreground">
              ${(Number(grant.grantMaxAmount ?? 0) / 1e6).toFixed(2)} USDC · revocable · delegate
              <span class="font-mono text-foreground">{grant.sessionAccount?.slice(0, 12)}…</span>
            </div>
          </div>
        {:else}
          <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-300">
            <p class="mb-2">No MetaMask authority yet — connect to let your agents act under a scoped, revocable grant (you can also do this later from Account).</p>
            <Button type="button" size="sm" onclick={connectMetaMask} disabled={connecting}>
              {#if connecting}<Loader2 class="size-4 animate-spin" />{:else}<Wallet class="size-4" />{/if}
              Connect MetaMask
            </Button>
            {#if connectError}<p class="mt-1 break-all text-destructive">{connectError}</p>{/if}
          </div>
        {/if}
      </div>

      <details class="rounded-lg border bg-card px-3 py-2">
        <summary class="cursor-pointer text-xs font-medium">Advanced</summary>
        <div class="mt-2 grid gap-1.5">
          <Label for="rpc">Base Sepolia RPC URL</Label>
          <Input id="rpc" bind:value={rpcUrl} />
        </div>
        <div class="mt-2 grid gap-1.5">
          <Label for="basescan">BaseScan API key <span class="text-muted-foreground">(optional — enables the agent's contract lookups)</span></Label>
          <Input id="basescan" bind:value={basescanApiKey} placeholder="BaseScan / Etherscan-v2 key" />
        </div>
        <div class="mt-3 grid gap-1.5">
          <span class="text-[10px] uppercase tracking-wide text-muted-foreground">Custodial signing wallet (optional)</span>
          {#if signingWalletAddress}
            <div class="font-mono text-[11px] break-all">{signingWalletAddress}</div>
          {:else}
            <Button type="button" variant="secondary" size="sm" class="w-fit" onclick={provision} disabled={provisioning}>
              {#if provisioning}<Loader2 class="size-4 animate-spin" />{:else}<Wallet class="size-4" />{/if}
              Provision signing wallet
            </Button>
          {/if}
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
