<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { config } from "$lib/stores/config.svelte";
  import Wallet from "@lucide/svelte/icons/wallet";
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import TrendingUp from "@lucide/svelte/icons/trending-up";

  const addr = $derived(config.value.signingWalletAddress);
</script>

<div class="mx-auto max-w-4xl px-6 py-8">
  <header class="mb-6 flex items-center justify-between">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Wallet</h1>
      <p class="text-sm text-muted-foreground">Balances, transactions and prices on Base Sepolia.</p>
    </div>
    {#if addr}
      <Badge variant="outline" class="font-mono">{addr.slice(0, 8)}…{addr.slice(-4)}</Badge>
    {:else}
      <Badge variant="secondary">no signing wallet</Badge>
    {/if}
  </header>

  <div class="grid gap-4 sm:grid-cols-2">
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="flex items-center gap-2 text-base"><Wallet class="size-4 text-primary" /> Balance</Card.Title>
        <Card.Description>Signing-wallet holdings.</Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="text-2xl font-semibold text-muted-foreground">—</div>
        <p class="mt-1 text-xs text-muted-foreground">Live balances (ETH / USDC / WETH) via Venice RPC land here next.</p>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="flex items-center gap-2 text-base"><TrendingUp class="size-4 text-primary" /> Prices</Card.Title>
        <Card.Description>Quotes the pricer agents see.</Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="text-2xl font-semibold text-muted-foreground">—</div>
        <p class="mt-1 text-xs text-muted-foreground">WETH→USDC across DEXes + candles land here next.</p>
      </Card.Content>
    </Card.Root>

    <Card.Root class="sm:col-span-2">
      <Card.Header class="pb-2">
        <Card.Title class="flex items-center gap-2 text-base"><ArrowLeftRight class="size-4 text-primary" /> Recent transactions</Card.Title>
        <Card.Description>Issuance, swaps and audit commits from your sessions.</Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          No transactions yet. Live runs (via the custodial signing wallet) will list here with BaseScan links.
        </div>
      </Card.Content>
    </Card.Root>
  </div>
</div>
