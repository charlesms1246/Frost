<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import { theme } from "$lib/stores/theme.svelte";
  import { config } from "$lib/stores/config.svelte";
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import Code from "@lucide/svelte/icons/code";

  const cfg = $derived(config.value);
</script>

<div class="mx-auto max-w-2xl px-6 py-10">
  <header class="mb-6">
    <h1 class="text-xl font-semibold tracking-tight">Settings</h1>
    <p class="text-sm text-muted-foreground">App preferences and configuration.</p>
  </header>

  <div class="flex flex-col gap-5">
    <!-- Appearance -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-base">Appearance</Card.Title>
        <Card.Description>Theme used across the app.</Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="flex gap-2">
          <Button variant={theme.value === "light" ? "default" : "outline"} size="sm" onclick={() => theme.set("light")}>
            <Sun class="size-4" /> Light
          </Button>
          <Button variant={theme.value === "dark" ? "default" : "outline"} size="sm" onclick={() => theme.set("dark")}>
            <Moon class="size-4" /> Dark
          </Button>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Configuration summary -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-base">Configuration</Card.Title>
        <Card.Description>Models, providers and integrations from onboarding.</Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-2 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Primary model (Venice)</span>
          <Badge variant="outline">{cfg.veniceModels[0] || "—"}</Badge>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Fallback provider</span>
          <Badge variant="secondary">{cfg.fallbackProvider} · {cfg.fallbackModels[0] || "—"}</Badge>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Venice (x402)</span>
          <span>{cfg.veniceApiKey ? "configured" : "off"}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Discord</span>
          <span>{cfg.discordWebhookUrl ? "configured" : "off"}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Signing wallet</span>
          <span class="font-mono">{cfg.signingWalletAddress ? cfg.signingWalletAddress.slice(0, 10) + "…" : "not provisioned"}</span>
        </div>
      </Card.Content>
      <Card.Footer>
        <Button href="/setup" variant="secondary" size="sm"><Settings2 class="size-4" /> Edit configuration</Button>
      </Card.Footer>
    </Card.Root>

    <!-- Developer -->
    <Card.Root>
      <Card.Header class="pb-3">
        <Card.Title class="text-base">Developer</Card.Title>
        <Card.Description>Low-level surfaces for testing the runtime and wallet bridge.</Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-wrap gap-2">
        <Button href="/agent" variant="outline" size="sm"><Code class="size-4" /> Agent debug</Button>
        <Button href="/bridge" variant="outline" size="sm"><Code class="size-4" /> Wallet bridge</Button>
      </Card.Content>
    </Card.Root>

    <p class="text-center text-[10px] text-muted-foreground">Frost v0.1.0 · Port-42 runtime</p>
  </div>
</div>
