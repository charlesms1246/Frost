<script lang="ts">
	import './layout.css';
	import { page } from '$app/stores';
	import TitleBar from '$lib/chrome/TitleBar.svelte';
	import NavRail from '$lib/chrome/NavRail.svelte';
	import WalletDelegateGate from '$lib/chrome/WalletDelegateGate.svelte';
	import '$lib/stores/theme.svelte';
	import { profile } from '$lib/stores/profile.svelte';
	import { chats } from '$lib/stores/chats.svelte';
	import { customAgents } from '$lib/stores/custom-agents.svelte';
	import { cloudSession } from '$lib/cloud';

	const { children } = $props();

	// Debounced cloud sync: when signed in, any change to the synced stores schedules a
	// push. Reading the getters establishes the reactive dependency; the push itself is
	// debounced + best-effort inside the session store.
	$effect(() => {
		void profile.value;
		void chats.list;
		void customAgents.list;
		if (cloudSession.signedIn) cloudSession.schedulePush();
	});

	// `/` is the splash window / entry gate — no titlebar or rail.
	const noChrome = $derived($page.url.pathname === '/');

	// The nav rail shows on "app" routes; splash, auth, and the /setup wizard stay full-bleed.
	const appRoutes = ['/chat', '/runtime', '/wallet', '/agents', '/settings', '/account'];
	const showRail = $derived(
		!noChrome &&
			appRoutes.some((r) => $page.url.pathname === r || $page.url.pathname.startsWith(r + '/'))
	);
</script>

{#if !noChrome}
	<TitleBar />
{/if}
{#if showRail}
	<NavRail />
	<WalletDelegateGate />
{/if}

<div class="app-shell" class:with-rail={showRail} class:no-chrome={noChrome}>
	{@render children()}
</div>

<style>
	.app-shell {
		min-height: 100vh;
		padding-top: 36px;
		background: var(--background);
		color: var(--foreground);
	}
	.app-shell.with-rail {
		padding-left: 72px;
	}
	.app-shell.no-chrome {
		padding-top: 0;
	}
</style>
