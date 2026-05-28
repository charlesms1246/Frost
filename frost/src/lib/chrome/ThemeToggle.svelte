<script lang="ts">
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import { theme } from '$lib/stores/theme.svelte';
</script>

<button
	type="button"
	class="chrome-btn"
	aria-label="Toggle theme"
	title={theme.value === 'dark' ? 'Switch to light' : 'Switch to dark'}
	onclick={() => theme.toggle()}
>
	{#if theme.value === 'dark'}
		<Sun size={14} strokeWidth={2} />
	{:else}
		<Moon size={14} strokeWidth={2} />
	{/if}
</button>

<style>
	.chrome-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 28px;
		border: none;
		background: transparent;
		color: var(--foreground);
		opacity: 0.75;
		border-radius: 6px;
		cursor: pointer;
		transition: background 120ms ease, opacity 120ms ease;
		-webkit-app-region: no-drag;
	}
	.chrome-btn:hover {
		opacity: 1;
		background: color-mix(in oklab, var(--foreground) 10%, transparent);
	}
</style>
