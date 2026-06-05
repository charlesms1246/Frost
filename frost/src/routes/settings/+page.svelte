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

<div class="flex h-[calc(100vh-36px)] flex-col px-6 py-5">
  <header class="mb-4 shrink-0">
    <h1 class="text-xl font-semibold tracking-tight">Settings</h1>
    <p class="text-sm text-muted-foreground">App preferences and configuration.</p>
  </header>

  <!-- Bento grid: fills the viewport, never scrolls. -->
  <div class="grid min-h-0 flex-1 grid-cols-6 grid-rows-2 gap-4">
    <!-- Appearance (top-left) -->
    <Card.Root class="col-span-2 row-span-1 h-full">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">Appearance</Card.Title>
        <Card.Description>Theme used across the app.</Card.Description>
      </Card.Header>
      <Card.Content class="flex gap-2">
        <Button variant={theme.value === "light" ? "default" : "outline"} size="sm" onclick={() => theme.set("light")}>
          <Sun class="size-4" /> Light
        </Button>
        <Button variant={theme.value === "dark" ? "default" : "outline"} size="sm" onclick={() => theme.set("dark")}>
          <Moon class="size-4" /> Dark
        </Button>
      </Card.Content>
    </Card.Root>

    <!-- Configuration (right, full height) -->
    <Card.Root class="col-span-4 row-span-2 flex h-full flex-col">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">Configuration</Card.Title>
        <Card.Description>Models, providers and integrations from onboarding.</Card.Description>
      </Card.Header>
      <Card.Content class="flex min-h-0 flex-1 flex-col justify-center gap-3 text-xs">
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

    <!-- Developer (bottom-left) -->
    <Card.Root class="col-span-2 row-span-1 flex h-full flex-col">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">Developer</Card.Title>
        <Card.Description>Low-level runtime &amp; bridge surfaces.</Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-wrap gap-2">
        <Button href="/agent" variant="outline" size="sm"><Code class="size-4" /> Agent debug</Button>
        <Button href="/bridge" variant="outline" size="sm"><Code class="size-4" /> Wallet bridge</Button>
      </Card.Content>
      <Card.Footer class="mt-auto">
        <p class="text-[10px] text-muted-foreground">Frost v0.1.0 · Port-42 runtime</p>
      </Card.Footer>
    </Card.Root>
  </div>
</div>
