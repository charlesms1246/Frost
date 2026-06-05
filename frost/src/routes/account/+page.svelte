<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import { profile } from "$lib/stores/profile.svelte";
  import { config } from "$lib/stores/config.svelte";
  import { signOut as performSignOut } from "$lib/sign-out";
  import { syncProfileToHosted, fileToDataUrl } from "$lib/profile-sync";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Camera from "@lucide/svelte/icons/camera";
  import Check from "@lucide/svelte/icons/check";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";

  let displayName = $state(profile.value.displayName);
  let email = $state(profile.value.email);
  let avatarDataUrl = $state(profile.value.avatarDataUrl);
  let walletAddress = $state(profile.value.walletAddress ?? "");
  let saved = $state(false);

  const initials = $derived((displayName || "").trim().slice(0, 2).toUpperCase() || "·");
  const dirty = $derived(
    displayName !== profile.value.displayName ||
      email !== profile.value.email ||
      avatarDataUrl !== profile.value.avatarDataUrl ||
      walletAddress !== (profile.value.walletAddress ?? ""),
  );

  async function onPickAvatar(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) avatarDataUrl = await fileToDataUrl(file);
  }

  async function save() {
    profile.update({
      displayName: displayName.trim(),
      email: email.trim(),
      avatarDataUrl,
      ...(walletAddress.trim() ? { walletAddress: walletAddress.trim() } : {}),
    });
    await profile.syncToHosted(syncProfileToHosted);
    saved = true;
    setTimeout(() => (saved = false), 2000);
  }

  let signingOut = $state(false);
  let signOutNote = $state("");

  async function signOut() {
    signingOut = true;
    signOutNote = config.value.metaMaskGrant ? "Revoking delegation in MetaMask…" : "Signing out…";
    try {
      const res = await performSignOut();
      // Local data is wiped regardless; warn if the on-chain revoke didn't complete.
      if (res.revokeError) {
        signOutNote = `Signed out. Note: couldn't revoke on-chain (${res.revokeError}); the grant lapses at its expiry.`;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      signingOut = false;
      goto("/signup");
    }
  }
</script>

<div class="flex h-[calc(100vh-36px)] flex-col px-6 py-5">
  <header class="mb-4 flex shrink-0 items-center justify-between">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Account</h1>
      <p class="text-sm text-muted-foreground">Your identity, synced with the Frost web app.</p>
    </div>
    {#if profile.synced}<Badge variant="secondary"><Check class="size-3" /> Synced</Badge>{/if}
  </header>

  <!-- Bento grid: fills the viewport, never scrolls. -->
  <div class="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-4">
    <!-- Profile (large, left) -->
    <Card.Root class="col-span-2 row-span-2 flex h-full flex-col">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">Profile</Card.Title>
        <Card.Description>Display name, email, and picture shown across Frost.</Card.Description>
      </Card.Header>
      <Card.Content class="flex min-h-0 flex-1 flex-col justify-center gap-4">
        <div class="flex items-center gap-4">
          <label class="group relative cursor-pointer">
            <span class="flex size-16 items-center justify-center overflow-hidden rounded-full bg-primary text-lg font-semibold text-primary-foreground">
              {#if avatarDataUrl}<img src={avatarDataUrl} alt="" class="size-full object-cover" />{:else}{initials}{/if}
            </span>
            <span class="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border-2 border-card bg-secondary text-secondary-foreground">
              <Camera class="size-3" />
            </span>
            <input type="file" accept="image/*" class="sr-only" onchange={onPickAvatar} />
          </label>
          <div class="text-xs text-muted-foreground">
            <p class="font-medium text-foreground">Profile picture</p>
            <p>PNG or JPG.</p>
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label for="name">Display name</Label>
          <Input id="name" bind:value={displayName} />
        </div>
        <div class="grid gap-1.5">
          <Label for="email">Email</Label>
          <Input id="email" type="email" bind:value={email} />
        </div>
        <div class="grid gap-1.5">
          <Label for="wallet">Wallet address</Label>
          <Input id="wallet" bind:value={walletAddress} class="font-mono text-xs" placeholder="0x…" />
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
        <Button onclick={save} disabled={!dirty && !saved}>
          {#if profile.syncing}<Loader2 class="size-4 animate-spin" />{/if}
          {saved ? "Saved" : "Save changes"}
        </Button>
      </Card.Footer>
    </Card.Root>

    <!-- MetaMask authority (right top) -->
    <Card.Root class="col-span-1 row-span-1 flex h-full flex-col">
      <Card.Header class="pb-2">
        <Card.Title class="flex items-center gap-2 text-base"><ShieldCheck class="size-4" /> Spending authority</Card.Title>
        <Card.Description>Scoped, revocable — granted from your MetaMask.</Card.Description>
      </Card.Header>
      <Card.Content class="flex min-h-0 flex-1 flex-col justify-center">
        {#if config.value.metaMaskGrant}
          <div class="grid gap-1 rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs">
            <div>delegate: <span class="font-mono text-foreground">{config.value.sessionAccount?.slice(0, 12)}…</span></div>
            <div>cap: <span class="text-foreground">${(Number(config.value.grantMaxAmount ?? 0) / 1e6).toFixed(2)} USDC</span> · revocable</div>
            {#if config.value.grantExpiryUnix}<div>expires: <span class="text-foreground">{new Date(config.value.grantExpiryUnix * 1000).toLocaleDateString()}</span></div>{/if}
          </div>
        {:else}
          <div class="flex flex-col gap-2 text-xs text-muted-foreground">
            <span>No authority granted yet.</span>
            <Button href="/setup" size="sm" variant="secondary" class="self-start">Connect in Setup</Button>
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Sync status (right bottom) -->
    <Card.Root class="col-span-1 row-span-1 flex h-full flex-col">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">Web app</Card.Title>
        <Card.Description>Profile sync state.</Card.Description>
      </Card.Header>
      <Card.Content class="flex min-h-0 flex-1 flex-col justify-center gap-2 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Status</span>
          {#if profile.synced}
            <Badge variant="secondary"><Check class="size-3" /> Synced</Badge>
          {:else}
            <Badge variant="outline">Local only</Badge>
          {/if}
        </div>
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Email</span>
          <span class="truncate font-medium">{email || "—"}</span>
        </div>
      </Card.Content>
    </Card.Root>
  </div>
</div>
