<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import { profile } from "$lib/stores/profile.svelte";
  import { config } from "$lib/stores/config.svelte";
  import { syncProfileToHosted, fileToDataUrl } from "$lib/profile-sync";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Camera from "@lucide/svelte/icons/camera";
  import Check from "@lucide/svelte/icons/check";

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

  function signOut() {
    profile.clear();
    goto("/");
  }
</script>

<div class="mx-auto max-w-2xl px-6 py-10">
  <header class="mb-6 flex items-center justify-between">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">Account</h1>
      <p class="text-sm text-muted-foreground">Your identity, synced with the Frost web app.</p>
    </div>
    {#if profile.synced}<Badge variant="secondary"><Check class="size-3" /> Synced</Badge>{/if}
  </header>

  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">Profile</Card.Title>
      <Card.Description>Display name, email, and picture shown across Frost.</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
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
    <Card.Footer class="justify-between">
      <Button variant="destructive" onclick={signOut}>Sign out</Button>
      <Button onclick={save} disabled={!dirty && !saved}>
        {#if profile.syncing}<Loader2 class="size-4 animate-spin" />{/if}
        {saved ? "Saved" : "Save changes"}
      </Button>
    </Card.Footer>
  </Card.Root>

  <Card.Root class="mt-5">
    <Card.Header>
      <Card.Title class="text-base">Signing wallet</Card.Title>
      <Card.Description>The custodial wallet Frost provisions for you — no private key to manage.</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if config.value.signingWalletAddress}
        <div class="rounded-lg border bg-muted/40 p-3 text-xs">
          <div class="text-[10px] uppercase tracking-wide text-muted-foreground">Address</div>
          <div class="font-mono break-all">{config.value.signingWalletAddress}</div>
        </div>
      {:else}
        <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Not provisioned yet.</span>
          <Button href="/setup" size="sm" variant="secondary">Provision in Setup</Button>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
