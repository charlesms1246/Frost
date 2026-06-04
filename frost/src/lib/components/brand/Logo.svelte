<script lang="ts" module>
  import { cn } from "$lib/utils.js";

  export type LogoProps = {
    class?: string;
    /** Show the "frost" wordmark next to the mark. */
    wordmark?: boolean;
    /** Mark size in px. */
    size?: number;
    /** Use the white mark (for dark/gradient panels) instead of the color one. */
    mono?: boolean;
  };
</script>

<script lang="ts">
  let {
    class: className = "",
    wordmark = true,
    size = 28,
    mono = false,
  }: LogoProps = $props();
</script>

<span
  class={cn(
    "inline-flex items-center justify-center gap-2 select-none",
    className,
  )}
>
  <!-- <img
		src={mono ? "/frost-icon.svg" : "/frost-logo.svg"}
		alt="Frost"
		width={size}
		height={size}
		style={`width:${size}px;height:${size}px`}
		class="block"
		draggable="false"
	/> -->
  {#if wordmark}
    <span class="font-title text-9xl font-semibold tracking-tight text-center"
      >FROST</span
    >
  {/if}
</span>
