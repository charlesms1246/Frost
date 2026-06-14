<script lang="ts">
  import { goto } from "$app/navigation";
  import AuthShell from "$lib/components/brand/AuthShell.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { profile } from "$lib/stores/profile.svelte";
  import { config } from "$lib/stores/config.svelte";
  import { cloudSignInAndPull } from "$lib/cloud";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Wallet from "@lucide/svelte/icons/wallet";

  let email = $state(profile.value.email);
  let submitting = $state(false);
  let connecting = $state(false);
  let walletError = $state("");

  // Wallet-first, passwordless: signing a SIWE challenge proves identity and pulls
  // this user's profile / chats / automations back from the cloud (cross-device
  // restore). Delegation (the spending grant) is handled by the in-app gate.
  async function connectWallet() {
    if (connecting) return;
    connecting = true;
    walletError = "";
    try {
      const { address } = await cloudSignInAndPull();
      if (address) profile.update({ walletAddress: address });
      await goto(config.onboarded ? "/chat" : "/setup");
    } catch (e) {
      walletError = e instanceof Error ? e.message : String(e);
    } finally {
      connecting = false;
    }
  }

  const hasProfile = $derived(profile.signedIn);
  const initials = $derived((profile.value.displayName || "").trim().slice(0, 2).toUpperCase() || "·");

  async function continueIn() {
    submitting = true;
    if (email.trim()) profile.update({ email: email.trim() });
    await goto(config.onboarded ? "/chat" : "/setup");
  }
</script>

<AuthShell quote="Welcome back." subquote="Your mandates, agents, and audit trail are right where you left them.">
  <h1 class="text-2xl font-semibold tracking-tight">Sign in</h1>
  <p class="mt-1 text-sm text-muted-foreground">Sign in with your wallet to restore your account, or continue with a saved profile.</p>

  {#if hasProfile}
    <button
      type="button"
      class="mt-6 flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50"
      onclick={continueIn}
    >
      <span class="flex size-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {#if profile.value.avatarDataUrl}<img src={profile.value.avatarDataUrl} alt="" class="size-full object-cover" />{:else}{initials}{/if}
      </span>
      <span class="min-w-0">
        <span class="block truncate text-sm font-medium">{profile.value.displayName || "Your profile"}</span>
        <span class="block truncate text-xs text-muted-foreground">{profile.value.email || "Continue to dashboard"}</span>
      </span>
    </button>
    <p class="mt-2 text-center text-xs text-muted-foreground">Continue as above, or use a different email below.</p>
  {/if}

  <form class="mt-6 flex flex-col gap-4" onsubmit={(e) => { e.preventDefault(); continueIn(); }}>
    <Button type="button" size="lg" onclick={connectWallet} disabled={connecting}>
      {#if connecting}<Loader2 class="size-4 animate-spin" />{:else}<Wallet class="size-4" />{/if}
      Sign in with wallet
    </Button>

    <div class="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span class="h-px flex-1 bg-border"></span>or continue with a saved profile<span class="h-px flex-1 bg-border"></span>
    </div>

    <div class="grid gap-1.5">
      <Label for="email">Email</Label>
      <Input id="email" type="email" bind:value={email} placeholder="you@example.com" autocomplete="email" />
    </div>

    <Button type="submit" size="lg" variant="outline" disabled={submitting}>
      {#if submitting}<Loader2 class="size-4 animate-spin" />{/if}
      Continue
    </Button>
    {#if walletError}<p class="text-xs text-destructive break-all">{walletError}</p>{/if}
  </form>

  <p class="mt-6 text-center text-sm text-muted-foreground">
    Don't have a profile?
    <a href="/signup" class="font-medium text-primary hover:underline">Sign up</a>
  </p>
</AuthShell>
