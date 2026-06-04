<script lang="ts">
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import GradientBackdrop from "$lib/components/brand/GradientBackdrop.svelte";
  import Logo from "$lib/components/brand/Logo.svelte";
  import { config } from "$lib/stores/config.svelte";
  import { chats } from "$lib/stores/chats.svelte";
  import { handoff } from "$lib/stores/handoff.svelte";
  import { buildTransport } from "$lib/agent/transport";
  import { MASTER_AGENT_PROMPT } from "$lib/agent/master-prompt";
  import SendHorizontal from "@lucide/svelte/icons/send-horizontal";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Play from "@lucide/svelte/icons/play";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Settings2 from "@lucide/svelte/icons/settings-2";

  let draft = $state("");
  let pending = $state(false);
  let showHistory = $state(false);

  const messages = $derived(chats.current?.messages ?? []);
  const started = $derived(messages.length > 0);
  const lastUserWorkflow = $derived(
    [...messages].reverse().find((m) => m.role === "user")?.content,
  );

  async function send() {
    const text = draft.trim();
    if (!text || pending || !config.ready) return;
    draft = "";
    chats.append({ role: "user", content: text });
    pending = true;
    try {
      const { transport, model } = buildTransport();
      const history = chats.current?.messages ?? [];
      const res = await transport.complete({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: MASTER_AGENT_PROMPT },
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ],
      });
      chats.append({ role: "assistant", content: res.text.trim() || "(no response)" });
    } catch (e) {
      chats.append({
        role: "assistant",
        content: `⚠️ Inference failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      pending = false;
    }
  }

  function runOnRuntime() {
    if (!lastUserWorkflow) return;
    handoff.set(lastUserWorkflow);
    goto("/runtime");
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const relTime = (t: number) => {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
</script>

{#snippet composer()}
  <div class="flex items-center gap-2 rounded-2xl border bg-card/80 p-2 shadow-sm backdrop-blur">
    <Textarea
      rows={1}
      bind:value={draft}
      onkeydown={onKeydown}
      disabled={!config.ready}
      placeholder={config.ready ? "Message the master agent…" : "Finish setup to chat…"}
      class="max-h-40 min-h-9 resize-none self-center border-0 bg-transparent py-1.5 shadow-none focus-visible:ring-0"
    />
    <Button size="icon" onclick={send} disabled={!draft.trim() || pending || !config.ready} aria-label="Send">
      {#if pending}<Loader2 class="size-4 animate-spin" />{:else}<SendHorizontal class="size-4" />{/if}
    </Button>
  </div>
{/snippet}

<div class="relative flex h-[calc(100vh-36px)] flex-col overflow-hidden">
  <GradientBackdrop fullscreen intensity={started ? "subtle" : "vivid"} />

  <!-- Transparent control bar (no clashing solid header) -->
  <div class="relative z-20 flex items-center justify-between gap-2 px-3 py-2">
    <Button variant="ghost" size="icon" onclick={() => (showHistory = !showHistory)} aria-label="Toggle history" title="Chat history">
      <PanelLeft class="size-4" />
    </Button>
    <Button variant="ghost" size="sm" onclick={() => chats.newChat()} title="New chat">
      <SquarePen class="size-4" /> New chat
    </Button>
  </div>

  <div class="relative z-10 flex flex-1 overflow-hidden">
    <!-- History sidebar -->
    {#if showHistory}
      <aside class="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-background/70 p-2 backdrop-blur">
        <button
          type="button"
          class="mb-1 flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted/60"
          onclick={() => chats.newChat()}
        >
          <SquarePen class="size-4" /> New chat
        </button>
        {#if chats.list.length === 0}
          <p class="px-2 py-4 text-center text-xs text-muted-foreground">No conversations yet.</p>
        {/if}
        {#each chats.list as c (c.id)}
          <div
            class="group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors {c.id === chats.currentId ? 'bg-muted' : 'hover:bg-muted/50'}"
          >
            <button type="button" class="min-w-0 flex-1 text-left" onclick={() => chats.select(c.id)}>
              <span class="block truncate">{c.title}</span>
              <span class="block text-[10px] text-muted-foreground">{relTime(c.createdAt)}</span>
            </button>
            <button
              type="button"
              class="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              onclick={() => chats.remove(c.id)}
              aria-label="Delete chat"
            >
              <Trash2 class="size-3.5" />
            </button>
          </div>
        {/each}
      </aside>
    {/if}

    <!-- Chat column -->
    <div class="flex flex-1 flex-col overflow-hidden">
      {#if !started}
        <!-- Empty state: greeting + input centered together over the gradient. -->
        <div class="flex flex-1 flex-col items-center justify-center px-6">
          <Logo size={52} wordmark={false} class="mb-5 opacity-95 drop-shadow-xl" />
          <h1 class="text-balance text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            What should your agents do?
          </h1>
          <p class="mt-2 max-w-md text-center text-sm text-muted-foreground">
            Describe a workflow in plain language — Frost compiles it into a bounded mandate and runs it.
          </p>
          <div class="mt-7 w-full max-w-2xl">
            {@render composer()}
          </div>
          {#if !config.ready}
            <a href="/setup" class="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Settings2 class="size-3.5" /> Finish setup to start chatting
            </a>
          {:else}
            <p class="mt-3 max-w-lg text-center text-xs text-muted-foreground/80">
              e.g. "Watch ETH and when it drops 5%, buy $200 of USDC across the cheapest DEX and tell me on Discord."
            </p>
          {/if}
        </div>
      {:else}
        <div class="flex-1 overflow-y-auto">
          <div class="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
            {#each messages as m, i (i)}
              <div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
                <div
                  class="max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm {m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'border bg-card/90 backdrop-blur'}"
                >
                  {m.content}
                </div>
              </div>
            {/each}
            {#if pending}
              <div class="flex justify-start">
                <div class="flex items-center gap-2 rounded-2xl border bg-card/90 px-4 py-2 text-sm text-muted-foreground backdrop-blur">
                  <Loader2 class="size-3.5 animate-spin" /> thinking…
                </div>
              </div>
            {/if}
          </div>
        </div>

        <div class="p-3">
          <div class="mx-auto max-w-2xl">
            {#if lastUserWorkflow}
              <div class="mb-2 flex justify-center">
                <Button variant="secondary" size="sm" onclick={runOnRuntime}>
                  <Play class="size-3.5" /> Run on Runtime Manager
                </Button>
              </div>
            {/if}
            {@render composer()}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
