<script lang="ts">
  import { onMount } from "svelte";
  import * as Card from "$lib/components/ui/card";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { config } from "$lib/stores/config.svelte";
  import { profile } from "$lib/stores/profile.svelte";
  import {
    fetchBalances,
    fmtEth,
    fmtWeth,
    fmtUsdc,
    type WalletBalances,
  } from "$lib/agent/balances";
  import type { Address } from "viem";
  import Wallet from "@lucide/svelte/icons/wallet";
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import TrendingUp from "@lucide/svelte/icons/trending-up";
  import Fingerprint from "@lucide/svelte/icons/fingerprint";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";

  const ZERO = "0x0000000000000000000000000000000000000000";
  // The user's own wallet (from SIWE sign-in) vs. the agent's custodial signing wallet (1Shot).
  const userAddr = $derived(profile.value.walletAddress);
  const signAddrRaw = $derived(config.value.signingWalletAddress);
  const signAddr = $derived(signAddrRaw && signAddrRaw !== ZERO ? signAddrRaw : undefined);
  const short = (a?: string) => (a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "");

  // Live Base Sepolia balances, keyed by lowercased address. Fetched on mount + refresh.
  let balances = $state<Record<string, WalletBalances>>({});
  let loading = $state(false);
  let error = $state<string | null>(null);

  const bal = (a?: string) => (a ? balances[a.toLowerCase()] : undefined);
  const signBal = $derived(bal(signAddr));

  async function load() {
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

  onMount(load);
</script>

<div class="mx-auto max-w-4xl px-6 py-8">
  <header class="mb-6 flex items-center justify-between">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Wallet</h1>
      <p class="text-sm text-muted-foreground">Balances, transactions and prices on Base Sepolia.</p>
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
            <Button {...props} variant="outline" size="sm" onclick={load} disabled={loading}>
              <RefreshCw class="size-4 {loading ? 'animate-spin' : ''}" /> Refresh
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="bottom">Reload balances from Base Sepolia</Tooltip.Content>
      </Tooltip.Root>
    </div>
  </header>

  {#if error}
    <div class="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      Couldn't load balances: {error}
    </div>
  {/if}

  <!-- The two wallets, side by side: your sign-in identity + the agent's execution wallet. -->
  <div class="mb-4 grid gap-4 sm:grid-cols-2">
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="flex items-center gap-2 text-base"><Fingerprint class="size-4 text-primary" /> Your wallet</Card.Title>
        <Card.Description>The account you signed in with (identity + delegator).</Card.Description>
      </Card.Header>
      <Card.Content>
        {#if userAddr}
          <div class="font-mono text-sm break-all">{userAddr}</div>
          {@const b = bal(userAddr)}
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><span class="font-mono text-foreground">{b ? fmtEth(b.ethWei) : "—"}</span> ETH</span>
            <span><span class="font-mono text-foreground">{b ? fmtUsdc(b.usdcUnits) : "—"}</span> USDC</span>
            <span><span class="font-mono text-foreground">{b ? fmtWeth(b.wethWei) : "—"}</span> WETH</span>
          </div>
        {:else}
          <div class="text-sm text-muted-foreground">Not signed in with a wallet yet.</div>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="flex items-center gap-2 text-base"><Wallet class="size-4 text-primary" /> Signing wallet</Card.Title>
        <Card.Description>The agent's custodial 1Shot wallet that executes on-chain.</Card.Description>
      </Card.Header>
      <Card.Content>
        {#if signAddr}
          <div class="font-mono text-sm break-all">{signAddr}</div>
          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><span class="font-mono text-foreground">{signBal ? fmtEth(signBal.ethWei) : "—"}</span> ETH</span>
            <span><span class="font-mono text-foreground">{signBal ? fmtUsdc(signBal.usdcUnits) : "—"}</span> USDC</span>
            <span><span class="font-mono text-foreground">{signBal ? fmtWeth(signBal.wethWei) : "—"}</span> WETH</span>
          </div>
        {:else}
          <div class="text-sm text-muted-foreground">Not provisioned yet.</div>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>

  <div class="grid gap-4 sm:grid-cols-2">
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="flex items-center gap-2 text-base"><Wallet class="size-4 text-primary" /> Balance</Card.Title>
        <Card.Description>Signing-wallet holdings.</Card.Description>
      </Card.Header>
      <Card.Content>
        {#if !signAddr}
          <div class="text-sm text-muted-foreground">Provision a signing wallet to see balances.</div>
        {:else}
          <dl class="space-y-2">
            <div class="flex items-baseline justify-between">
              <dt class="text-xs text-muted-foreground">ETH</dt>
              <dd class="font-mono text-lg font-semibold tabular-nums">{signBal ? fmtEth(signBal.ethWei) : "—"}</dd>
            </div>
            <div class="flex items-baseline justify-between border-t pt-2">
              <dt class="text-xs text-muted-foreground">USDC</dt>
              <dd class="font-mono text-lg font-semibold tabular-nums">{signBal ? fmtUsdc(signBal.usdcUnits) : "—"}</dd>
            </div>
            <div class="flex items-baseline justify-between border-t pt-2">
              <dt class="text-xs text-muted-foreground">WETH</dt>
              <dd class="font-mono text-lg font-semibold tabular-nums">{signBal ? fmtWeth(signBal.wethWei) : "—"}</dd>
            </div>
          </dl>
        {/if}
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
