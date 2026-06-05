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
  import { MASTER_AGENT_PROMPT, masterRuntimeContext } from "$lib/agent/master-prompt";
  import { runMasterTurn, type MasterStep } from "$lib/agent/master-loop";
  import { runMasterTool, readToolNames, toolCatalog, type ToolContext } from "$lib/agent/master-tools";
  import { Compiler, renderSpec } from "@frost/agent/browser";
  import type { CompiledSpec, CompileResult } from "@frost/agent/browser";
  import { VENICE_DISABLED, FALLBACK_BASE_RPC_URL } from "$lib/flags";
  import SendHorizontal from "@lucide/svelte/icons/send-horizontal";
  import PanelRight from "@lucide/svelte/icons/panel-right";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Play from "@lucide/svelte/icons/play";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Settings2 from "@lucide/svelte/icons/settings-2";

  let draft = $state("");
  let pending = $state(false);
  let showHistory = $state(false);

  // Master-loop turn state (scoped to the active conversation).
  let answers = $state<Record<string, string>>({});
  let readySpec = $state<CompiledSpec | undefined>(undefined);
  let readyResult = $state<CompileResult | undefined>(undefined);
  let readyWorkflow = $state<string | undefined>(undefined);

  const messages = $derived(chats.current?.messages ?? []);
  const started = $derived(messages.length > 0);
  const lastUserWorkflow = $derived(
    [...messages].reverse().find((m) => m.role === "user")?.content,
  );

  function resetTurnState() {
    answers = {};
    readySpec = undefined;
    readyResult = undefined;
    readyWorkflow = undefined;
  }
  function newChat() {
    chats.newChat();
    resetTurnState();
    showHistory = false;
  }
  function selectChat(id: string) {
    chats.select(id);
    resetTurnState();
    showHistory = false;
  }

  /** Render a read-tool step as a compact chat message. */
  function formatTool(step: Extract<MasterStep, { kind: "tool" }>): string {
    return `${step.ok ? "🔧" : "⚠️"} ${step.tool}: ${step.summary}`;
  }

  /** Render a compile tool step as a chat message (byte-tied review + warnings). */
  function formatCompiled(step: Extract<MasterStep, { kind: "compiled" }>): string {
    const { result, review } = step;
    if (result.escalateToHITL) {
      return `⚠️ I couldn't compile this safely: ${result.hitlReason ?? "the request was unclear or too broad"}.`;
    }
    const lines = ["Compiled — here's what you'd authorize:", ...review.map((r) => "• " + r)];
    if (result.warnings.length > 0) {
      lines.push("", "Please confirm:", ...result.warnings.map((w) => "• " + w));
    }
    return lines.join("\n");
  }

  async function send() {
    const text = draft.trim();
    if (!text || pending || !config.ready) return;
    draft = "";
    chats.append({ role: "user", content: text });
    pending = true;
    try {
      const { transport, model } = buildTransport();
      const compiler = new Compiler({ transport, model });
      const history = (chats.current?.messages ?? []).map((m) => ({ role: m.role, content: m.content }));
      const system =
        MASTER_AGENT_PROMPT + "\n\nTOOLS:\n" + toolCatalog() + "\n\n" + masterRuntimeContext(config.value, VENICE_DISABLED);
      const ctx: ToolContext = {
        veniceApiKey: config.value.veniceApiKey,
        veniceNetwork: "base-mainnet",
        basescanApiKey: config.value.basescanApiKey,
        discordWebhookUrl: config.value.discordWebhookUrl,
        veniceDisabled: VENICE_DISABLED,
        fallbackRpcUrl: FALLBACK_BASE_RPC_URL,
        chainId: 8453,
      };
      const res = await runMasterTurn(system, history, answers, {
        infer: async (msgs) =>
          (await transport.complete({ model, temperature: 0.3, json: true, messages: msgs })).text,
        compile: (wf, ans) => compiler.compile({ description: wf, answers: ans }),
        renderSpec,
        runTool: (name, args) => runMasterTool(name, args, ctx),
        readToolNames: readToolNames(),
      });
      answers = res.answers;
      for (const step of res.steps) {
        if (step.kind === "say") {
          if (step.text) chats.append({ role: "assistant", content: step.text });
        } else if (step.kind === "compiled") {
          chats.append({ role: "assistant", content: formatCompiled(step) });
        } else {
          chats.append({ role: "assistant", content: formatTool(step) });
        }
      }
      if (res.ready) {
        readySpec = res.ready.spec;
        readyResult = res.ready.result;
        readyWorkflow = res.ready.workflow;
      }
    } catch (e) {
      chats.append({ role: "assistant", content: inferenceErrorMessage(e) });
    } finally {
      pending = false;
    }
  }

  /** Build a diagnosable failure message — the raw provider body + a config hint. */
  function inferenceErrorMessage(e: unknown): string {
    const c = config.value;
    const status = (e as { status?: number })?.status;
    const body = (e as { body?: string })?.body;
    const base = e instanceof Error ? e.message : String(e);
    const lines = [`⚠️ Inference failed: ${base}`];
    if (body) lines.push(body.length > 300 ? body.slice(0, 300) + "…" : body);
    if (status === 429) {
      lines.push("Rate limited — wait a moment and retry (the provider's free tier is throttling).");
    }
    lines.push(`(primary Venice "${c.veniceModels[0] || "—"}" → fallback ${c.fallbackProvider} "${c.fallbackModels[0] || "—"}")`);
    return lines.join("\n");
  }

  function runOnRuntime() {
    if (readySpec && readyResult) {
      handoff.set({
        workflow: readyWorkflow ?? lastUserWorkflow ?? "",
        spec: readySpec,
        compileResult: readyResult,
        answers,
      });
    } else if (lastUserWorkflow) {
      handoff.set({ workflow: lastUserWorkflow, answers });
    } else {
      return;
    }
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

  <!-- Control bar: history toggle on the right, hovering over the gradient -->
  <div class="relative z-30 flex items-center justify-end gap-1 px-3 py-2">
    <Button variant="ghost" size="icon" onclick={() => (showHistory = !showHistory)} aria-label="Toggle history" title="Chat history">
      <PanelRight class="size-4" />
    </Button>
  </div>

  <!-- Floating translucent history panel (hovers over the gradient, right side) -->
  {#if showHistory}
    <!-- svelte-ignore a11y_consider_explicit_label -->
    <button type="button" class="absolute inset-0 z-20 cursor-default" aria-label="Close history" onclick={() => (showHistory = false)}></button>
    <aside class="absolute right-3 top-14 z-30 flex max-h-[min(70vh,28rem)] w-72 flex-col gap-1 overflow-hidden rounded-2xl border bg-background/70 p-2 shadow-xl backdrop-blur-xl">
      <button
        type="button"
        class="mb-1 flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium hover:bg-muted/60"
        onclick={newChat}
      >
        <SquarePen class="size-4" /> New chat
      </button>
      <div class="flex flex-col gap-1 overflow-y-auto">
        {#if chats.list.length === 0}
          <p class="px-2 py-4 text-center text-xs text-muted-foreground">No conversations yet.</p>
        {/if}
        {#each chats.list as c (c.id)}
          <div
            class="group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors {c.id === chats.currentId ? 'bg-muted' : 'hover:bg-muted/50'}"
          >
            <button type="button" class="min-w-0 flex-1 text-left" onclick={() => selectChat(c.id)}>
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
      </div>
    </aside>
  {/if}

  <!-- Chat column -->
  <div class="relative z-10 flex flex-1 flex-col overflow-hidden">
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
                <Button variant={readySpec ? "default" : "secondary"} size="sm" onclick={runOnRuntime}>
                  <Play class="size-3.5" /> {readySpec ? "Run compiled workflow" : "Run on Runtime Manager"}
                </Button>
              </div>
            {/if}
            {@render composer()}
          </div>
        </div>
      {/if}
    </div>
</div>
