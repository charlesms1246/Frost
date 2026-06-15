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
	import { onMount } from "svelte";
	import { createMetaballField, frostTheme, type MetaballField } from "./metaball-field.js";

	let {
		class: className = "",
		image,
		intensity = "subtle",
		still = false,
		fullscreen = false,
		children,
	}: GradientBackdropProps = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	/** True once WebGL is up; otherwise the CSS gradient fallback stays visible. */
	let glReady = $state(false);

	function isDarkMode(): boolean {
		if (typeof document === "undefined") return false;
		return document.documentElement.classList.contains("dark");
	}

	/** Honor prefers-reduced-motion, the `still` prop, and an ancestor `.reduce-motion`. */
	function motionDisabled(): boolean {
		if (still) return true;
		if (typeof window === "undefined") return false;
		if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return true;
		if (canvas?.closest(".reduce-motion")) return true;
		return false;
	}

	onMount(() => {
		const el = canvas;
		if (!el) return;

		// Interactive pointer blob only makes sense when we cover the viewport.
		const field: MetaballField | null = createMetaballField(el, frostTheme(isDarkMode(), intensity), fullscreen);

		if (!field) {
			// WebGL unavailable / shader failed — keep the CSS gradient fallback.
			glReady = false;
			return;
		}
		glReady = true;

		const applyTheme = () => field.setTheme(frostTheme(isDarkMode(), intensity));

		if (motionDisabled()) {
			// Paint a single static frame (gradient + blobs), no rAF loop.
			applyTheme();
		} else {
			field.start();
		}

		// React to `.dark` class toggles on <html>.
		const themeObserver = new MutationObserver(applyTheme);
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

		// React to reduced-motion preference changes.
		const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
		const onMq = () => {
			if (motionDisabled()) field.stop();
			else field.start();
			applyTheme();
		};
		mq?.addEventListener?.("change", onMq);

		return () => {
			themeObserver.disconnect();
			mq?.removeEventListener?.("change", onMq);
			field.destroy();
		};
	});
</script>

<!--
	Animated frost-gradient accent — a WebGL "lava lamp": gaussian metaball blobs in the
	logo's ice→indigo→violet palette drift with random velocities and wrap around the
	screen edges, plus one gentle pointer-following blob. Purely decorative (aria-hidden,
	pointer-events:none) so it can sit behind any page without intercepting clicks.
	Respects prefers-reduced-motion / `still` / an ancestor `.reduce-motion` (static frame),
	and falls back to a pure-CSS gradient when WebGL is unavailable.
-->
<div
	class={cn("backdrop", `i-${intensity}`, fullscreen && "fullscreen", className)}
	aria-hidden="true"
>
	{#if image}
		<div class="art" style={`background-image:url(${image})`}></div>
	{/if}
	<!-- CSS gradient is always rendered as the WebGL fallback; the canvas paints over it. -->
	<div class="css-fallback" class:hidden={glReady}></div>
	<canvas bind:this={canvas} class="metaball"></canvas>
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
		pointer-events: none;
	}
	/* Cover the whole viewport so floating chrome hovers over the gradient (no flat
	   strip beside it). Sits behind page content (z-10) + chrome. */
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
	.metaball {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.i-subtle .metaball {
		opacity: 0.85;
	}
	.i-vivid .metaball {
		opacity: 1;
	}
	/* Static CSS gradient — shown until WebGL is confirmed (or forever if it fails). */
	.css-fallback {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(50% 60% at 14% 8%, #b7f4ff55, transparent 70%),
			radial-gradient(58% 66% at 88% 92%, #6377df55, transparent 70%),
			radial-gradient(44% 54% at 64% 36%, #9d6cff44, transparent 72%),
			linear-gradient(180deg, #fbfdff, #eef1fb);
	}
	:global(.dark) .css-fallback {
		background:
			radial-gradient(50% 60% at 14% 8%, #b7f4ff44, transparent 70%),
			radial-gradient(58% 66% at 88% 92%, #6377df66, transparent 70%),
			radial-gradient(44% 54% at 64% 36%, #9d6cff55, transparent 72%),
			linear-gradient(180deg, #0b0b14, #11101c);
	}
	.css-fallback.hidden {
		display: none;
	}
	.grain {
		position: absolute;
		inset: 0;
		background-image: radial-gradient(var(--foreground) 0.5px, transparent 0.5px);
		background-size: 4px 4px;
		opacity: 0.015;
	}
</style>
