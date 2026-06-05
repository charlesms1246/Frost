<script lang="ts">
  import { goto } from "$app/navigation";
  import AuthShell from "$lib/components/brand/AuthShell.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { profile } from "$lib/stores/profile.svelte";
  import { config } from "$lib/stores/config.svelte";
  import { syncProfileToHosted, fileToDataUrl } from "$lib/profile-sync";
  import { captureMetaMaskAuthority } from "$lib/wallet-connect";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Camera from "@lucide/svelte/icons/camera";
  import Wallet from "@lucide/svelte/icons/wallet";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";

  let displayName = $state(profile.value.displayName);
  let email = $state(profile.value.email);
  let avatarDataUrl = $state(profile.value.avatarDataUrl);
  let walletAddress = $state(profile.value.walletAddress ?? "");
  let submitting = $state(false);
  let connecting = $state(false);
  let error = $state("");

  const granted = $derived(!!config.value.metaMaskGrant);

  async function connectWallet() {
    if (connecting) return;
    connecting = true;
    error = "";
    try {
      const { granter } = await captureMetaMaskAuthority();
      if (granter) walletAddress = granter;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      connecting = false;
    }
  }

  const emailOk = $derived(
    email.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()),
  );
  const canSubmit = $derived(
    displayName.trim().length > 1 && emailOk && !submitting,
  );

  async function onPickAvatar(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      avatarDataUrl = await fileToDataUrl(file);
    } catch {
      error = "Could not read that image.";
    }
  }

  async function createProfile() {
    if (!canSubmit) return;
    submitting = true;
    error = "";
    profile.update({
      displayName: displayName.trim(),
      email: email.trim(),
      avatarDataUrl,
      ...(walletAddress.trim() ? { walletAddress: walletAddress.trim() } : {}),
    });
    await profile.syncToHosted(syncProfileToHosted);
    submitting = false;
    await goto("/setup");
  }

  const initials = $derived(
    (displayName || "").trim().slice(0, 2).toUpperCase() || "·",
  );
</script>

<AuthShell
  quote="Web3 Native Agent Ecosystem"
  subquote="Set up your profile, connect a wallet, and let your agents do the work."
>
  <h1 class="text-2xl font-semibold tracking-tight">Create your profile</h1>
  <p class="mt-1 text-sm text-muted-foreground">
    It syncs with your Frost account on the web.
  </p>

  <form
    class="mt-7 flex flex-col gap-4"
    onsubmit={(e) => {
      e.preventDefault();
      createProfile();
    }}
  >
    <!-- Profile picture -->
    <div class="flex items-center gap-4">
      <label class="group relative cursor-pointer">
        <span
          class="flex size-16 items-center justify-center overflow-hidden rounded-full bg-primary text-lg font-semibold text-primary-foreground"
        >
          {#if avatarDataUrl}
            <img src={avatarDataUrl} alt="" class="size-full object-cover" />
          {:else}
            {initials}
          {/if}
        </span>
        <span
          class="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border-2 border-background bg-secondary text-secondary-foreground"
        >
          <Camera class="size-3" />
        </span>
        <input
          type="file"
          accept="image/*"
          class="sr-only"
          onchange={onPickAvatar}
        />
      </label>
      <div class="text-xs text-muted-foreground">
        <p class="font-medium text-foreground">Profile picture</p>
        <p>PNG or JPG. Optional.</p>
      </div>
    </div>

    <div class="grid gap-1.5">
      <Label for="name">Display name</Label>
      <Input
        id="name"
        bind:value={displayName}
        placeholder="Satoshi"
        autocomplete="name"
      />
    </div>

    <div class="grid gap-1.5">
      <Label for="email">Email</Label>
      <Input
        id="email"
        type="email"
        bind:value={email}
        placeholder="you@example.com"
        autocomplete="email"
        aria-invalid={!emailOk}
      />
      {#if !emailOk}<p class="text-xs text-destructive">
          Enter a valid email.
        </p>{/if}
    </div>

    <div class="grid gap-1.5">
      <Label for="wallet"
        >Wallet address <span class="text-muted-foreground">(optional)</span
        ></Label
      >
      <div class="flex gap-2">
        <Input
          id="wallet"
          bind:value={walletAddress}
          placeholder="0x… or connect"
          class="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="default"
          onclick={connectWallet}
          disabled={connecting}
        >
          {#if connecting}<Loader2 class="size-4 animate-spin" />{:else if granted}<ShieldCheck class="size-4 text-primary" />{:else}<Wallet class="size-4" />{/if}
          {granted ? "Connected" : "Connect"}
        </Button>
      </div>
      <p class="text-[10px] text-muted-foreground">
        {#if granted}
          Authorized — a scoped, revocable ${(Number(config.value.grantMaxAmount ?? 0) / 1e6).toFixed(0)} USDC spending grant from your MetaMask.
        {:else}
          Connect approves a scoped, revocable spending grant from your MetaMask Smart Account — no keys to hand over.
        {/if}
      </p>
    </div>

    {#if error}<p class="text-xs text-destructive">{error}</p>{/if}

    <Button type="submit" size="lg" disabled={!canSubmit} class="mt-1">
      {#if submitting}<Loader2 class="size-4 animate-spin" />{/if}
      Create profile
    </Button>
  </form>

  <p class="mt-6 text-center text-sm text-muted-foreground">
    Already have a profile?
    <a href="/login" class="font-medium text-primary hover:underline">Sign in</a
    >
  </p>
</AuthShell>
