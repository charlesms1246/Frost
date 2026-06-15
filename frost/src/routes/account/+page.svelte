<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import { profile } from "$lib/stores/profile.svelte";
  import { config } from "$lib/stores/config.svelte";
  import { grants, statusOf, type DelegationStatus } from "$lib/stores/grants.svelte";
  import { signOut as performSignOut, revokeActiveGrant } from "$lib/sign-out";
  import { syncProfileToHosted, fileToDataUrl } from "$lib/profile-sync";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Camera from "@lucide/svelte/icons/camera";
  import Check from "@lucide/svelte/icons/check";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import ShieldOff from "@lucide/svelte/icons/shield-off";

  let displayName = $state(profile.value.displayName);
  let email = $state(profile.value.email);
  let avatarDataUrl = $state(profile.value.avatarDataUrl);
  let saved = $state(false);

  // The connected wallet is the sign-in identity — shown, never edited here.
  const walletAddress = $derived(profile.value.walletAddress);
  const initials = $derived((displayName || "").trim().slice(0, 2).toUpperCase() || "·");
  const short = (a?: string) => (a ? `${a.slice(0, 10)}…${a.slice(-6)}` : "");

  async function onPickAvatar(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) avatarDataUrl = await fileToDataUrl(file);
  }

  async function syncNow() {
    profile.update({ displayName: displayName.trim(), email: email.trim(), avatarDataUrl });
    await profile.syncToHosted(syncProfileToHosted);
    saved = true;
    setTimeout(() => (saved = false), 2000);
  }

  // --- Spending authority: the full delegation history (active / expired / revoked). ---
  type Delegation = {
    id: string;
    label: string;
    delegate?: string;
    token: string;
    capUsdc: string;
    expiryUnix?: number;
    status: DelegationStatus;
  };
  const nowUnix = Math.floor(Date.now() / 1000);
  const delegations = $derived.by((): Delegation[] =>
    grants.list.map((r) => ({
      id: r.id,
      label: r.label,
      delegate: r.delegate,
      token: r.tokenSymbol ?? short(r.tokenAddress) ?? "—",
      capUsdc: (Number(r.capBaseUnits ?? 0) / 1e6).toFixed(2),
      expiryUnix: r.expiryUnix,
      status: statusOf(r, nowUnix),
    })),
  );

  // --- Per-delegation revoke: kill one grant's authority from here. ---
  let revokingId = $state<string | null>(null);
  let revokeError = $state<string | null>(null);

  async function revokeDelegation(d: Delegation) {
    if (revokingId) return;
    revokingId = d.id;
    revokeError = null;
    try {
      // When this record is the live config grant, revoke it on-chain (MetaMask
      // `disableDelegation` via the bridge) and clear the redeemable blob from config.
      const live =
        !!config.value.metaMaskGrant &&
        !!d.delegate &&
        d.delegate.toLowerCase() === config.value.sessionAccount?.toLowerCase();
      if (live) {
        await revokeActiveGrant();
        config.update({
          metaMaskGrant: undefined,
          sessionAccount: undefined,
          grantTokenAddress: undefined,
          grantMaxAmount: undefined,
          grantExpiryUnix: undefined,
        });
      }
      grants.markRevokedById(d.id);
    } catch (e) {
      revokeError = e instanceof Error ? e.message : String(e);
    } finally {
      revokingId = null;
    }
  }

  let signingOut = $state(false);
  let signOutNote = $state("");
  async function signOut() {
    signingOut = true;
    signOutNote = config.value.metaMaskGrant ? "Revoking delegation in MetaMask…" : "Signing out…";
    try {
      const res = await performSignOut();
      if (res.revokeError) {
        signOutNote = `Signed out. Couldn't revoke on-chain (${res.revokeError}); the grant lapses at its expiry.`;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      signingOut = false;
      goto("/signup");
    }
  }
</script>

<div class="flex h-[calc(100vh-36px)] flex-col px-6 py-5">
  <header class="mb-4 shrink-0">
    <h1 class="text-xl font-semibold tracking-tight">Account</h1>
    <p class="text-sm text-muted-foreground">Your identity and the authority you've delegated.</p>
  </header>

  <!-- Two columns: identity (left) · spending authority + delegations (right). -->
  <div class="grid min-h-0 flex-1 grid-cols-3 gap-4">
    <!-- Left: profile -->
    <Card.Root class="col-span-2 flex h-full flex-col">
      <Card.Header class="flex items-start justify-between gap-2 pb-2">
        <div>
          <Card.Title class="text-base">Profile</Card.Title>
          <Card.Description>Your identity, synced with the Frost web app.</Card.Description>
        </div>
        {#if profile.synced}
          <Badge variant="secondary"><Check class="size-3" /> Synced</Badge>
        {:else}
          <Badge variant="outline">Local only</Badge>
        {/if}
      </Card.Header>

      <Card.Content class="flex min-h-0 flex-1 items-center gap-8">
        <!-- Large profile picture (click to change). -->
        <label class="group relative shrink-0 cursor-pointer">
          <span class="flex size-40 items-center justify-center overflow-hidden rounded-3xl bg-primary text-5xl font-semibold text-primary-foreground">
            {#if avatarDataUrl}<img src={avatarDataUrl} alt="" class="size-full object-cover" />{:else}{initials}{/if}
          </span>
          <span class="absolute -bottom-2 -right-2 flex size-9 items-center justify-center rounded-full border-2 border-card bg-secondary text-secondary-foreground transition-colors group-hover:bg-accent">
            <Camera class="size-4" />
          </span>
          <input type="file" accept="image/*" class="sr-only" onchange={onPickAvatar} />
        </label>

        <!-- Identity fields. Wallet is the sign-in identity — read-only. -->
        <div class="grid flex-1 gap-3">
          <div class="grid gap-1.5">
            <Label for="name">Display name</Label>
            <Input id="name" bind:value={displayName} />
          </div>
          <div class="grid gap-1.5">
            <Label for="email">Email</Label>
            <Input id="email" type="email" bind:value={email} placeholder="you@example.com" />
          </div>
          <div class="grid gap-1.5">
            <Label>Connected wallet</Label>
            {#if walletAddress}
              <div class="flex h-9 items-center rounded-md border bg-muted/40 px-3 font-mono text-xs text-muted-foreground">
                {walletAddress}
              </div>
            {:else}
              <div class="flex h-9 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                No wallet connected.
              </div>
            {/if}
          </div>
        </div>
      </Card.Content>

      <Card.Footer class="justify-between gap-2">
        <div class="flex items-center gap-2">
          <Button variant="destructive" onclick={signOut} disabled={signingOut}>
            {#if signingOut}<Loader2 class="size-4 animate-spin" />{/if}
            Sign out
          </Button>
          {#if signingOut && signOutNote}<span class="text-xs text-muted-foreground">{signOutNote}</span>{/if}
        </div>
        <Button onclick={syncNow} disabled={profile.syncing}>
          {#if profile.syncing}<Loader2 class="size-4 animate-spin" />{:else}<RefreshCw class="size-4" />{/if}
          {saved ? "Synced" : "Sync now"}
        </Button>
      </Card.Footer>
    </Card.Root>

    <!-- Right: spending authority + delegations -->
    <Card.Root class="col-span-1 flex h-full flex-col">
      <Card.Header class="pb-2">
        <Card.Title class="flex items-center gap-2 text-base"><ShieldCheck class="size-4 text-primary" /> Spending authority</Card.Title>
        <Card.Description>Scoped, revocable delegations from your wallet.</Card.Description>
      </Card.Header>
      <Card.Content class="min-h-0 flex-1 overflow-y-auto">
        {#if revokeError}
          <div class="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
            Couldn't revoke: {revokeError}
          </div>
        {/if}
        {#if delegations.length === 0}
          <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p class="text-sm text-muted-foreground">No delegations granted yet.</p>
            <Button href="/setup" size="sm" variant="secondary">Connect in Setup</Button>
          </div>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each delegations as d (d.id)}
              <li class="rounded-lg border p-3 text-xs {d.status === 'active' ? 'border-primary/40 bg-primary/5' : 'opacity-60'}">
                <div class="mb-1.5 flex items-center justify-between">
                  <span class="font-medium text-foreground">{d.label}</span>
                  {#if d.status === "active"}
                    <Badge variant="secondary" class="text-emerald-600 dark:text-emerald-400">Active</Badge>
                  {:else if d.status === "revoked"}
                    <Badge variant="destructive">Revoked</Badge>
                  {:else}
                    <Badge variant="outline">Expired</Badge>
                  {/if}
                </div>
                <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
                  <dt>delegate</dt>
                  <dd class="truncate text-right font-mono text-foreground">{short(d.delegate)}</dd>
                  <dt>cap</dt>
                  <dd class="text-right text-foreground">${d.capUsdc} {d.token} / period</dd>
                  {#if d.expiryUnix}
                    <dt>{d.status === "expired" ? "expired" : "expires"}</dt>
                    <dd class="text-right text-foreground">{new Date(d.expiryUnix * 1000).toLocaleDateString()}</dd>
                  {/if}
                </dl>
                {#if d.status === "active"}
                  <Button
                    variant="outline"
                    size="sm"
                    class="mt-2.5 h-7 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onclick={() => revokeDelegation(d)}
                    disabled={revokingId !== null}
                  >
                    {#if revokingId === d.id}<Loader2 class="size-3.5 animate-spin" />{:else}<ShieldOff class="size-3.5" />{/if}
                    Revoke
                  </Button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
</div>
