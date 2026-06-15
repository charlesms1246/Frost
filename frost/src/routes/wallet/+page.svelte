<script lang="ts">
  import { onMount } from "svelte";
  import * as Card from "$lib/components/ui/card";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import CandleChart from "$lib/components/dashboard/CandleChart.svelte";
  import { config } from "$lib/stores/config.svelte";
  import { profile } from "$lib/stores/profile.svelte";
  import { fetchBalances, fmtEth, fmtWeth, fmtUsdc, type WalletBalances } from "$lib/agent/balances";
  import { fetchOhlc, fmtUsd, CHARTABLE, type Candle } from "$lib/agent/token-prices";
  import type { Address } from "viem";
  import Wallet from "@lucide/svelte/icons/wallet";
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import Fingerprint from "@lucide/svelte/icons/fingerprint";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";

  const ZERO = "0x0000000000000000000000000000000000000000";
  const userAddr = $derived(profile.value.walletAddress);
  const signAddrRaw = $derived(config.value.signingWalletAddress);
  const signAddr = $derived(signAddrRaw && signAddrRaw !== ZERO ? signAddrRaw : undefined);
  const short = (a?: string) => (a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "");

  // --- Live Base Sepolia balances (user wallet + signing wallet) ---
  let balances = $state<Record<string, WalletBalances>>({});
  let loading = $state(false);
  let error = $state<string | null>(null);
  const bal = (a?: string) => (a ? balances[a.toLowerCase()] : undefined);

  async function loadBalances() {
    if (loading) return;
    loading = true;
    error = null;
    const rpc = config.value.rpcUrl;
    const targets = [userAddr, signAddr].filter((a): a is string => !!a);
    try {
      const results = await Promise.all(
        targets.map(async (a) => [a.toLowerCase(), await fetchBalances(rpc, a as Address)] as const),
      );
      balances = Object.fromEntries(results);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // --- Market: live OHLC candles for a selected major token + timeframe ---
  let chartSymbol = $state<string>("ETH");
  let days = $state(1);
  const TIMEFRAMES = [
    { label: "1D", days: 1 },
    { label: "7D", days: 7 },
    { label: "30D", days: 30 },
  ];
  let candles = $state<Candle[]>([]);
  let candlesErr = $state(false);
  const lastPrice = $derived(candles.at(-1)?.close);
  const change = $derived.by(() => {
    if (candles.length < 2) return undefined;
    const first = candles[0]!.open;
    const last = candles.at(-1)!.close;
    return first === 0 ? undefined : ((last - first) / first) * 100;
  });

  // Reload candles whenever the symbol or timeframe changes (race-safe).
  $effect(() => {
    const sym = chartSymbol;
    const d = days;
    let cancelled = false;
    (async () => {
      try {
        const c = await fetchOhlc(sym, d);
        if (!cancelled) {
          candles = c;
          candlesErr = false;
        }
      } catch {
        if (!cancelled) candlesErr = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  onMount(loadBalances);
</script>

{#snippet walletCard(title: string, icon: typeof Wallet, desc: string, addr: string | undefined, missing: string)}
  <Card.Root>
    <Card.Header class="pb-2">
      {@const Icon = icon}
      <Card.Title class="flex items-center gap-2 text-base"><Icon class="size-4 text-primary" /> {title}</Card.Title>
      <Card.Description class="text-xs">{desc}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if addr}
        {@const b = bal(addr)}
        <div class="font-mono text-xs break-all text-muted-foreground">{addr}</div>
        <dl class="mt-3 space-y-2">
          <div class="flex items-baseline justify-between">
            <dt class="text-xs text-muted-foreground">ETH</dt>
            <dd class="font-mono text-base font-semibold tabular-nums">{b ? fmtEth(b.ethWei) : "—"}</dd>
          </div>
          <div class="flex items-baseline justify-between border-t pt-2">
            <dt class="text-xs text-muted-foreground">USDC</dt>
            <dd class="font-mono text-base font-semibold tabular-nums">{b ? fmtUsdc(b.usdcUnits) : "—"}</dd>
          </div>
          <div class="flex items-baseline justify-between border-t pt-2">
            <dt class="text-xs text-muted-foreground">WETH</dt>
            <dd class="font-mono text-base font-semibold tabular-nums">{b ? fmtWeth(b.wethWei) : "—"}</dd>
          </div>
        </dl>
      {:else}
        <div class="text-sm text-muted-foreground">{missing}</div>
      {/if}
    </Card.Content>
  </Card.Root>
{/snippet}

<div class="flex h-[calc(100vh-36px)] flex-col gap-4 p-6">
  <header class="flex shrink-0 items-center justify-between">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Wallet</h1>
      <p class="text-sm text-muted-foreground">Balances on Base Sepolia · live markets · session activity.</p>
    </div>
    <div class="flex items-center gap-2">
      {#if signAddr}
        <Badge variant="outline" class="font-mono">{short(signAddr)}</Badge>
      {:else}
        <Badge variant="secondary">no signing wallet</Badge>
      {/if}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="sm" onclick={loadBalances} disabled={loading}>
              <RefreshCw class="size-4 {loading ? 'animate-spin' : ''}" /> Refresh
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">Reload balances from Base Sepolia</Tooltip.Content>
      </Tooltip.Root>
    </div>
  </header>

  {#if error}
    <div class="shrink-0 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      Couldn't load balances: {error}
    </div>
  {/if}

  <!-- Narrow left: wallets · wide right: market + transactions. -->
  <div class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[300px_1fr]">
    <!-- LEFT -->
    <div class="flex min-h-0 flex-col gap-4 overflow-y-auto">
      {@render walletCard("Your wallet", Fingerprint, "Your sign-in identity + delegator.", userAddr, "Not signed in with a wallet yet.")}
      {@render walletCard("Signing wallet", Wallet, "The agent's custodial 1Shot wallet.", signAddr, "Not provisioned yet.")}
    </div>

    <!-- RIGHT -->
    <div class="grid min-h-0 grid-rows-[1fr_auto] gap-4">
      <Card.Root class="flex min-h-0 flex-col">
        <Card.Header class="gap-3 pb-2">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-baseline gap-3">
              <Card.Title class="text-base">{chartSymbol} / USD</Card.Title>
              {#if lastPrice !== undefined}
                <span class="font-mono text-lg font-semibold tabular-nums">{fmtUsd(lastPrice)}</span>
                {#if change !== undefined}
                  <span class="text-xs font-medium {change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}">
                    {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                  </span>
                {/if}
              {/if}
            </div>
            <div class="flex items-center gap-1">
              {#each CHARTABLE as sym (sym)}
                <Button variant={chartSymbol === sym ? "default" : "ghost"} size="sm" class="h-7 px-2 text-xs" onclick={() => (chartSymbol = sym)}>{sym}</Button>
              {/each}
              <span class="mx-1 h-4 w-px bg-border"></span>
              {#each TIMEFRAMES as tf (tf.days)}
                <Button variant={days === tf.days ? "secondary" : "ghost"} size="sm" class="h-7 px-2 text-xs" onclick={() => (days = tf.days)}>{tf.label}</Button>
              {/each}
            </div>
          </div>
          <Card.Description class="text-xs">Live OHLC from public market data — the real-time price the pricer agents track.</Card.Description>
        </Card.Header>
        <Card.Content class="min-h-0 flex-1">
          {#if candlesErr}
            <div class="flex h-full items-center justify-center text-xs text-muted-foreground">Couldn't load market data.</div>
          {:else if candles.length === 0}
            <div class="flex h-full items-center justify-center text-xs text-muted-foreground">Loading {chartSymbol} candles…</div>
          {:else}
            <div class="h-full min-h-[240px]"><CandleChart {candles} /></div>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Title class="flex items-center gap-2 text-base"><ArrowLeftRight class="size-4 text-primary" /> Recent transactions</Card.Title>
          <Card.Description class="text-xs">Issuance, swaps and audit commits from your sessions.</Card.Description>
        </Card.Header>
        <Card.Content>
          <div class="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
            No transactions yet. Live runs (via the custodial signing wallet) will list here with BaseScan links.
          </div>
        </Card.Content>
      </Card.Root>
    </div>
  </div>
</div>
