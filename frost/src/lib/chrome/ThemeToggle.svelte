<script lang="ts">
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { theme } from '$lib/stores/theme.svelte';
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				class="chrome-btn"
				aria-label="Toggle theme"
				onclick={() => theme.toggle()}
			>
				{#if theme.value === 'dark'}
					<Sun size={14} strokeWidth={2} />
				{:else}
					<Moon size={14} strokeWidth={2} />
				{/if}
			</button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content side="bottom">Toggle theme</Tooltip.Content>
</Tooltip.Root>

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
