<script lang="ts">
	import './layout.css';
	import { page } from '$app/stores';
	import TitleBar from '$lib/chrome/TitleBar.svelte';
	import NavRail from '$lib/chrome/NavRail.svelte';
	import '$lib/stores/theme.svelte';

	const { children } = $props();

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
