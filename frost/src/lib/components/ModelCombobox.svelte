<script lang="ts">
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import { Button } from "$lib/components/ui/button";
  import Check from "@lucide/svelte/icons/check";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";

  let {
    value = $bindable(""),
    options = [],
    placeholder = "Select a model…",
    id,
  }: { value?: string; options?: string[]; placeholder?: string; id?: string } = $props();

  let open = $state(false);
  let search = $state("");

  // Allow a custom id (the fetched list may not include every model the user wants).
  const showCustom = $derived(
    search.trim() !== "" && !options.some((o) => o.toLowerCase() === search.trim().toLowerCase()),
  );

  function choose(v: string) {
    value = v;
    open = false;
    search = "";
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        {id}
        variant="outline"
        role="combobox"
        aria-expanded={open}
        class="w-full justify-between font-normal"
      >
        <span class="truncate {value ? '' : 'text-muted-foreground'}">{value || placeholder}</span>
        <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-(--bits-popover-anchor-width) p-0" align="start">
    <Command.Root>
      <Command.Input placeholder="Search or type a model id…" bind:value={search} />
      <Command.List>
        <Command.Empty>{options.length === 0 ? "Load models, or type an id." : "No match — type to use a custom id."}</Command.Empty>
        {#if showCustom}
          <Command.Item value={search.trim()} onSelect={() => choose(search.trim())}>
            <Check class="size-4 text-transparent" />
            Use "{search.trim()}"
          </Command.Item>
        {/if}
        <Command.Group>
          {#each options as opt (opt)}
            <Command.Item value={opt} onSelect={() => choose(opt)}>
              <Check class="size-4 {value === opt ? '' : 'text-transparent'}" />
              <span class="truncate">{opt}</span>
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
