<script lang="ts">
	import './layout.css';
	import TitleBar from '$lib/chrome/TitleBar.svelte';
	import '$lib/stores/theme.svelte';

	const { children } = $props();
</script>

<TitleBar />

<div class="app-shell">
	{@render children()}
</div>

<style>
	.app-shell {
		min-height: 100vh;
		padding-top: 36px;
		background: var(--background);
		color: var(--foreground);
	}
</style>
