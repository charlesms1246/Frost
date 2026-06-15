<script lang="ts">
	import { onMount } from 'svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import Minus from '@lucide/svelte/icons/minus';
	import Square from '@lucide/svelte/icons/square';
	import Copy from '@lucide/svelte/icons/copy';
	import X from '@lucide/svelte/icons/x';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { isMacOS } from './platform';

	const win = getCurrentWindow();

	let maximized = $state(false);

	async function refresh() {
		try {
			maximized = await win.isMaximized();
		} catch {
			maximized = false;
		}
	}

	onMount(() => {
		refresh();
		const unlisten = win.onResized(() => refresh());
		return () => {
			unlisten.then((fn) => fn());
		};
	});
</script>

{#if !isMacOS}
	<div class="controls">
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button {...props} class="ctl" aria-label="Minimize" onclick={() => win.minimize()}>
						<Minus size={14} strokeWidth={2} />
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom">Minimize</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="ctl"
						aria-label={maximized ? 'Restore' : 'Maximize'}
						onclick={() => win.toggleMaximize()}
					>
						{#if maximized}
							<Copy size={12} strokeWidth={2} />
						{:else}
							<Square size={12} strokeWidth={2} />
						{/if}
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom">{maximized ? 'Restore' : 'Maximize'}</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button {...props} class="ctl close" aria-label="Close" onclick={() => win.close()}>
						<X size={14} strokeWidth={2} />
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom">Close</Tooltip.Content>
		</Tooltip.Root>
	</div>
{/if}

<style>
	.controls {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		-webkit-app-region: no-drag;
	}
	.ctl {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 28px;
		border: none;
		background: transparent;
		color: var(--foreground);
		opacity: 0.75;
		border-radius: 6px;
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease, opacity 120ms ease;
	}
	.ctl:hover {
		opacity: 1;
		background: color-mix(in oklab, var(--foreground) 10%, transparent);
	}
	.ctl.close:hover {
		background: #e81123;
		color: #fff;
		opacity: 1;
	}
</style>
