<script lang="ts">
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { veniceKill } from '$lib/stores/venice.svelte';
</script>

<!-- Checked ⇔ Venice ENABLED. The store stores `disabled`, so the binding inverts. -->
<div class="flex items-center gap-1.5">
	<span class="text-[11px] font-medium text-muted-foreground">Venice</span>
	<Switch
		size="sm"
		checked={veniceKill.enabled}
		onCheckedChange={(v) => veniceKill.set(!v)}
		aria-label="Toggle Venice paid x402 inference"
	/>
</div>
