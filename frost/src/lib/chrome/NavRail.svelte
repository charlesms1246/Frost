<script lang="ts">
	import { page } from "$app/stores";
	import { profile } from "$lib/stores/profile.svelte";
	import * as Avatar from "$lib/components/ui/avatar";
	import * as Tooltip from "$lib/components/ui/tooltip";
	import MessageSquare from "@lucide/svelte/icons/message-square";
	import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
	import Wallet from "@lucide/svelte/icons/wallet";
	import Bot from "@lucide/svelte/icons/bot";
	import Settings from "@lucide/svelte/icons/settings";

	type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
	const items: NavItem[] = [
		{ href: "/chat", label: "Master agent", icon: MessageSquare },
		{ href: "/runtime", label: "Runtime manager", icon: LayoutDashboard },
		{ href: "/wallet", label: "Wallet", icon: Wallet },
		{ href: "/agents", label: "Agent manager", icon: Bot },
	];

	const pathname = $derived($page.url.pathname);
	const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
	const initials = $derived(
		(profile.value.displayName || "").trim().slice(0, 2).toUpperCase() || "·",
	);
</script>

<Tooltip.Provider delayDuration={250}>
	<nav class="rail" aria-label="Primary">
		<div class="pill">
			{#each items as item (item.href)}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<a
								{...props}
								href={item.href}
								class="rail-btn"
								class:active={isActive(item.href)}
								aria-label={item.label}
								aria-current={isActive(item.href) ? "page" : undefined}
							>
								<item.icon size={18} strokeWidth={2} />
							</a>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="right">{item.label}</Tooltip.Content>
				</Tooltip.Root>
			{/each}

			<span class="divider"></span>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<a {...props} href="/settings" class="rail-btn" class:active={isActive("/settings")} aria-label="Settings">
							<Settings size={18} strokeWidth={2} />
						</a>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="right">Settings</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<a {...props} href="/account" class="account" class:active={isActive("/account")} aria-label="Account">
							<Avatar.Root class="size-8">
								{#if profile.value.avatarDataUrl}
									<Avatar.Image src={profile.value.avatarDataUrl} alt="" />
								{/if}
								<Avatar.Fallback class="bg-sidebar-primary text-sidebar-primary-foreground text-[11px] font-semibold">
									{initials}
								</Avatar.Fallback>
							</Avatar.Root>
						</a>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="right">{profile.value.displayName || "Account"}</Tooltip.Content>
			</Tooltip.Root>
		</div>
	</nav>
</Tooltip.Provider>

<style>
	/* Full-height, click-through track that vertically centers the floating pill. */
	.rail {
		position: fixed;
		top: 36px;
		left: 0;
		bottom: 0;
		z-index: 90;
		display: flex;
		align-items: center;
		padding-left: 12px;
		pointer-events: none;
	}
	.pill {
		pointer-events: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 8px 6px;
		border-radius: 22px;
		background: color-mix(in oklab, var(--sidebar) 10%, transparent);
		border: 1px solid var(--sidebar-border);
		box-shadow: 0 12px 32px -12px rgb(0 0 0 / 0.4), 0 2px 6px -2px rgb(0 0 0 / 0.2);
		backdrop-filter: blur(12px);
	}
	.divider {
		width: 22px;
		height: 1px;
		margin: 2px 0;
		background: var(--sidebar-border);
	}
	.rail-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		color: var(--sidebar-foreground);
		opacity: 0.55;
		transition: background 120ms ease, opacity 120ms ease, color 120ms ease;
	}
	.rail-btn:hover {
		opacity: 1;
		background: color-mix(in oklab, var(--sidebar-foreground) 10%, transparent);
	}
	.rail-btn.active {
		opacity: 1;
		color: var(--sidebar-primary);
		background: color-mix(in oklab, var(--sidebar-primary) 14%, transparent);
	}
	.account {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		transition: box-shadow 120ms ease;
	}
	.account.active {
		box-shadow: 0 0 0 2px var(--sidebar-primary);
	}
</style>
