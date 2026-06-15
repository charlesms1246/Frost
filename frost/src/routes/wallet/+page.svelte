<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import * as Card from "$lib/components/ui/card";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import CandleChart from "$lib/components/dashboard/CandleChart.svelte";
  import { config } from "$lib/stores/config.svelte";
  import { profile } from "$lib/stores/profile.svelte";
  import { fetchBalances, fmtEth, fmtWeth, fmtUsdc, type WalletBalances } from "$lib/agent/balances";
  import { fetchOhlc, fmtUsd, CHARTABLE, type Candle } from "$lib/agent/token-prices";
  import { fetchTransactions, type WalletTx } from "$lib/agent/transactions";
  import type { Address } from "viem";
  import Wallet from "@lucide/svelte/icons/wallet";
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import ArrowDownLeft from "@lucide/svelte/icons/arrow-down-left";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import Fingerprint from "@lucide/svelte/icons/fingerprint";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";

  const ZERO = "0x0000000000000000000000000000000000000000";
  const userAddr = $derived(profile.value.walletAddress);
  const signAddrRaw = $derived(config.value.signingWalletAddress);
  const signAddr = $derived(signAddrRaw && signAddrRaw !== ZERO ? signAddrRaw : undefined);
  const short = (a?: string) => (a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "");
  const isRealAddr = (a?: string) => !!a && /^0x[0-9a-fA-F]{40}$/.test(a) && a !== ZERO;

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

  // --- Recent transactions: user (delegated authority) + agent signing wallet ---
  // The Etherscan-v2 key comes from the demo `.env` (or Setup → Advanced); the v2 API
  // rejects keyless calls, so without one we prompt instead of erroring.
  let etherscanKey = $state("");
  let txns = $state<Array<WalletTx & { wallet: "you" | "signer" }>>([]);
  let txLoading = $state(false);
  let txError = $state<string | null>(null);
  const hasExplorerKey = $derived(!!(etherscanKey || config.value.basescanApiKey));

  // One-shot demo bootstrap: pick up the Etherscan key and, if no signing wallet is set
  // yet, adopt the funded 1Shot demo wallet so the Signing-wallet card populates (mirrors
  // Setup's auto-provision). No-op in a packaged build without `.env`.
  async function initFromDemo() {
    try {
      const demo = await invoke<{ walletAddress?: string; walletId?: string; etherscanApi?: string }>(
        "load_demo_credentials",
      );
      if (demo?.etherscanApi) etherscanKey = demo.etherscanApi;
      if (!isRealAddr(config.value.signingWalletAddress) && isRealAddr(demo?.walletAddress)) {
        config.update({
          signingWalletAddress: demo!.walletAddress!,
          ...(demo!.walletId ? { signingWalletId: demo!.walletId } : {}),
        });
      }
    } catch {
      /* packaged build / no demo creds — leave as-is */
    }
  }

  async function loadTxns() {
    if (txLoading) return;
    const key = etherscanKey || config.value.basescanApiKey;
    if (!key) {
      txns = [];
      txError = null;
      return;
    }
    txLoading = true;
    txError = null;
    try {
      const jobs: Promise<Array<WalletTx & { wallet: "you" | "signer" }>>[] = [];
      if (userAddr)
        jobs.push(fetchTransactions(userAddr, key).then((r) => r.map((t) => ({ ...t, wallet: "you" as const }))));
      if (signAddr)
        jobs.push(fetchTransactions(signAddr, key).then((r) => r.map((t) => ({ ...t, wallet: "signer" as const }))));
      const all = (await Promise.all(jobs)).flat();
      all.sort((a, b) => b.timeStamp - a.timeStamp);
      txns = all.slice(0, 25);
    } catch (e) {
      txError = e instanceof Error ? e.message : String(e);
    } finally {
      txLoading = false;
    }
  }

  async function refresh() {
    await Promise.all([loadBalances(), loadTxns()]);
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

  onMount(async () => {
    await initFromDemo();
    await refresh();
  });
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
            <Button {...props} variant="outline" size="sm" onclick={refresh} disabled={loading || txLoading}>
              <RefreshCw class="size-4 {loading || txLoading ? 'animate-spin' : ''}" /> Refresh
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">Reload balances + transactions from Base Sepolia</Tooltip.Content>
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
          <Card.Description class="text-xs">Your delegated-authority wallet and the agent's signing wallet, on Base Sepolia.</Card.Description>
        </Card.Header>
        <Card.Content class="max-h-72 overflow-y-auto">
          {#if txError}
            <div class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Couldn't load transactions: {txError}
            </div>
          {:else if !hasExplorerKey}
            <div class="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              Add a BaseScan API key in Settings → Advanced to list on-chain transactions.
            </div>
          {:else if txLoading && txns.length === 0}
            <div class="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">Loading transactions…</div>
          {:else if txns.length === 0}
            <div class="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              No transactions yet for either wallet.
            </div>
          {:else}
            <ul class="divide-y">
              {#each txns as t (t.wallet + t.hash + t.amount)}
                {@const incoming = t.direction === "in"}
                <li class="flex items-center gap-3 py-2">
                  <span class="flex size-7 shrink-0 items-center justify-center rounded-full {incoming ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}">
                    {#if incoming}<ArrowDownLeft class="size-3.5" />{:else}<ArrowUpRight class="size-3.5" />{/if}
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-xs font-medium text-foreground">{t.kind}</span>
                      <Badge variant="outline" class="shrink-0 text-[10px]">{t.wallet === "you" ? "Delegated" : "Signer"}</Badge>
                    </div>
                    <a class="font-mono text-[11px] text-muted-foreground hover:text-primary hover:underline" href={t.link} target="_blank" rel="noopener noreferrer">{short(t.hash)}</a>
                  </div>
                  <div class="shrink-0 text-right">
                    <div class="font-mono text-xs tabular-nums {incoming ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}">
                      {t.direction === "out" ? "−" : incoming ? "+" : ""}{t.amount}
                    </div>
                    {#if t.timeStamp}
                      <div class="text-[10px] text-muted-foreground">{new Date(t.timeStamp * 1000).toLocaleDateString()}</div>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>
    </div>
  </div>
</div>
