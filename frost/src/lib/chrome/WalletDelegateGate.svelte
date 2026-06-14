<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { config } from '$lib/stores/config.svelte';
	import { profile } from '$lib/stores/profile.svelte';
	import { captureMetaMaskAuthority } from '$lib/wallet-connect';
	import { cloudSignInAndPull } from '$lib/cloud';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';

	// Frost runs on a scoped, revocable ERC-7715 delegation. A user who signed up with
	// just an email/profile (or signed in on a new device) has no grant yet, so nothing
	// works until they connect + delegate. This gate makes that the required next step —
	// and connecting also restores their cloud data (profile / chats / automations).

	let dismissed = $state(false);
	let connecting = $state(false);
	let error = $state('');
	let restored = $state(false);

	const hasGrant = $derived(!!config.value.metaMaskGrant);
	const open = $derived(profile.signedIn && !hasGrant && !dismissed);

	async function connect() {
		if (connecting) return;
		connecting = true;
		error = '';
		try {
			const { granter } = await captureMetaMaskAuthority();
			if (granter) profile.update({ walletAddress: granter });
			// Decoupled, best-effort: cloud sign-in uses personal_sign (not the ERC-7715
			// snap), so a failure here never blocks the delegated app.
			try {
				const r = await cloudSignInAndPull();
				restored = r.restored;
			} catch {
				/* cloud sync optional */
			}
			dismissed = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			connecting = false;
		}
	}
</script>

<Dialog.Root bind:open={() => open, (v) => { if (!v) dismissed = true; }}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Connect your wallet to continue</Dialog.Title>
			<Dialog.Description>
				Frost acts only through a scoped, revocable spending delegation from your wallet — there's
				nothing it can do without one. Approve a grant to activate your agents. Connecting also
				restores your profile, chats, and automations from any other device.
			</Dialog.Description>
		</Dialog.Header>

		{#if error}<p class="text-destructive text-xs break-all">{error}</p>{/if}

		<Dialog.Footer class="gap-2 sm:justify-between">
			<Button variant="ghost" onclick={() => (dismissed = true)} disabled={connecting}>
				Maybe later
			</Button>
			<Button onclick={connect} disabled={connecting}>
				{#if connecting}<Loader2 class="size-4 animate-spin" />{:else}<ShieldCheck class="size-4" />{/if}
				Connect wallet &amp; delegate
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
