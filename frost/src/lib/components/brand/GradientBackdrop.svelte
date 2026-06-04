<script lang="ts" module>
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils.js";

	export type BackdropIntensity = "subtle" | "vivid";

	export type GradientBackdropProps = {
		class?: string;
		/** Optional theme image dropped behind the gradient (e.g. /art/login.webp). */
		image?: string;
		/** How loud the drifting frost gradient is. */
		intensity?: BackdropIntensity;
		/** Pause the drift (also auto-paused under prefers-reduced-motion). */
		still?: boolean;
		/** Cover the whole viewport (position: fixed) so floating chrome hovers over it. */
		fullscreen?: boolean;
		children?: Snippet;
	};
</script>

<script lang="ts">
	let {
		class: className = "",
		image,
		intensity = "subtle",
		still = false,
		fullscreen = false,
		children,
	}: GradientBackdropProps = $props();
</script>

<!--
	Animated frost-gradient accent. The app theme stays generic shadcn "Blue"
	(layout.css tokens are untouched); this is a decorative accent layer using the
	logo's ice→indigo palette. Drop a theme image via `image=…`; it sits under the
	gradient so the gradient tints it. Respects prefers-reduced-motion.
-->
<div class={cn("backdrop", `i-${intensity}`, fullscreen && "fullscreen", still && "still", className)} aria-hidden="true">
	{#if image}
		<div class="art" style={`background-image:url(${image})`}></div>
	{/if}
	<div class="blob blob-a"></div>
	<div class="blob blob-b"></div>
	<div class="blob blob-c"></div>
	<div class="grain"></div>
</div>

{#if children}
	<div class="relative z-10">{@render children()}</div>
{/if}

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: var(--background);
		isolation: isolate;
	}
	/* Cover the whole viewport so the floating nav hovers over the gradient
	   (no flat strip beside it). Sits behind page content (z-10) + chrome. */
	.backdrop.fullscreen {
		position: fixed;
		inset: 0;
		z-index: 0;
	}
	.art {
		position: absolute;
		inset: 0;
		background-size: cover;
		background-position: center;
		opacity: 0.85;
	}
	.blob {
		position: absolute;
		border-radius: 9999px;
		filter: blur(64px);
		will-change: transform;
		/* Light theme: multiply tints the bright base into soft frost pastels. */
		mix-blend-mode: multiply;
	}
	/* Dark theme: screen makes the same blobs glow on the near-black base. */
	:global(.dark) .blob {
		mix-blend-mode: screen;
	}
	.i-subtle .blob {
		opacity: 0.55;
	}
	.i-vivid .blob {
		opacity: 0.8;
		filter: blur(56px);
	}
	:global(.dark) .i-subtle .blob {
		opacity: 0.45;
	}
	:global(.dark) .i-vivid .blob {
		opacity: 0.7;
	}
	/* frost palette: ice-cyan #B7F4FF · periwinkle #7694E6 · indigo #6377DF */
	.blob-a {
		top: -12%;
		left: -8%;
		width: 48%;
		height: 60%;
		background: radial-gradient(circle at 50% 50%, #b7f4ff, transparent 70%);
		animation: drift-a 22s ease-in-out infinite alternate;
	}
	.blob-b {
		bottom: -18%;
		right: -10%;
		width: 56%;
		height: 64%;
		background: radial-gradient(circle at 50% 50%, #6377df, transparent 70%);
		animation: drift-b 28s ease-in-out infinite alternate;
	}
	.blob-c {
		top: 28%;
		left: 34%;
		width: 40%;
		height: 50%;
		background: radial-gradient(circle at 50% 50%, #7694e6, transparent 72%);
		animation: drift-c 25s ease-in-out infinite alternate;
	}
	.grain {
		position: absolute;
		inset: 0;
		background-image: radial-gradient(var(--foreground) 0.5px, transparent 0.5px);
		background-size: 4px 4px;
		opacity: 0.015;
	}
	@keyframes drift-a {
		from {
			transform: translate3d(0, 0, 0) scale(1);
		}
		to {
			transform: translate3d(18%, 12%, 0) scale(1.15);
		}
	}
	@keyframes drift-b {
		from {
			transform: translate3d(0, 0, 0) scale(1.1);
		}
		to {
			transform: translate3d(-16%, -10%, 0) scale(1);
		}
	}
	@keyframes drift-c {
		from {
			transform: translate3d(0, 0, 0) scale(0.95);
		}
		to {
			transform: translate3d(-12%, 16%, 0) scale(1.2);
		}
	}
	.still .blob,
	:global(.reduce-motion) .blob {
		animation: none !important;
	}
	@media (prefers-reduced-motion: reduce) {
		.blob {
			animation: none !important;
		}
	}
</style>
