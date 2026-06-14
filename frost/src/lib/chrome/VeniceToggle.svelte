<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import { veniceKill } from '$lib/stores/venice.svelte';
</script>

<!-- Pressed ⇔ Venice ENABLED. The store is the source of truth (seeded from the env
     flag, shared across pages), so bind via a get/set function binding rather than a
     local copy. Toggling writes the inverse back to the kill switch. -->
<Toggle
	bind:pressed={() => veniceKill.enabled, (v) => veniceKill.set(!v)}
	size="sm"
	variant="outline"
	aria-label="Toggle Venice paid x402 inference"
	title={veniceKill.enabled
		? 'Venice paid x402 inference: ON — click to disable (route inference to the OpenRouter/Groq fallback)'
		: 'Venice paid x402 inference: OFF — click to enable Venice'}
	class="text-muted-foreground h-7 gap-1.5 px-2 text-[11px] font-medium data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
>
	<Sparkles class="size-3.5" />
	<span>Venice</span>
	<span class="text-[10px] font-bold tracking-wide">{veniceKill.enabled ? 'ON' : 'OFF'}</span>
</Toggle>
