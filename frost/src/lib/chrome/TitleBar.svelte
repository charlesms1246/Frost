<script lang="ts">
	import ThemeToggle from './ThemeToggle.svelte';
	import WindowControls from './WindowControls.svelte';
	import { isMacOS } from './platform';
</script>

<header
	class="titlebar"
	class:mac={isMacOS}
	data-tauri-drag-region
>
	<div class="left" data-tauri-drag-region>
		<img src="/frost-icon.svg" alt="Frost" class="logo" data-tauri-drag-region />
		<span class="title" data-tauri-drag-region>frost</span>
	</div>

	<div class="right">
		<ThemeToggle />
		<WindowControls />
	</div>
</header>

<style>
	.titlebar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 6px 0 12px;
		z-index: 100;
		user-select: none;
		-webkit-user-select: none;
		background: transparent;
	}
	.titlebar.mac {
		padding-left: 80px;
	}
	.left {
		display: flex;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}
	.logo {
		width: 16px;
		height: 16px;
		display: block;
	}
	.title {
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.02em;
		color: var(--foreground);
		opacity: 0.6;
	}
	.right {
		display: flex;
		align-items: center;
		gap: 4px;
	}
</style>
