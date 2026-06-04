<script lang="ts">
  import { onMount } from "svelte";
  import { AgentSessionStore } from "$lib/stores/agent-session.svelte";
  import { config, fallbackKeyOf } from "$lib/stores/config.svelte";
  import { handoff } from "$lib/stores/handoff.svelte";
  import DelegationTree from "$lib/components/dashboard/DelegationTree.svelte";
  import ActivityLog from "$lib/components/dashboard/ActivityLog.svelte";
  import { createEmbeddedSession } from "$lib/agent/session";
  import { eoaProvisioner, simulatedIssuer } from "$lib/agent/holders";
  import { makeSimulatedExecutorRunner } from "$lib/agent/executor-runner";
  import { revocableIssuer } from "$lib/agent/revocation";
  import { buildTransport } from "$lib/agent/transport";
  import { TauriKeyStore } from "$lib/key-store";
  import { customAgents, toDefinition } from "$lib/stores/custom-agents.svelte";
  import {
    Compiler,
    renderSpec,
    sessionContextFrom,
    BASE_SEPOLIA_DEPLOYMENT,
    buildReceipt,
    CustomAgentRegistry,
  } from "@frost/agent/browser";
  import type {
    CompiledSpec,
    CompileResult,
    SubMandateIssuer,
    SubAgentRunner,
    InferenceTransport,
    SwitchingInferenceTransport,
    SessionReceipt,
  } from "@frost/agent/browser";
  import HitlGate from "$lib/components/dashboard/HitlGate.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Play from "@lucide/svelte/icons/play";
  import Plus from "@lucide/svelte/icons/plus";
  import Settings2 from "@lucide/svelte/icons/settings-2";

  const store = new AgentSessionStore();

  type Tab = "workflow" | "tree" | "activity" | "receipt";
  let activeTab = $state<Tab>("workflow");
  const TABS: { id: Tab; label: string }[] = [
    { id: "workflow", label: "Workflow" },
    { id: "tree", label: "Tree" },
    { id: "activity", label: "Activity" },
    { id: "receipt", label: "Receipt" },
  ];

  // Runtime kill switch for the Venice paid path (not persisted config).
  let primaryEnabled = $state(true);

  let workflow = $state(
    "Compare WETH→USDC quotes across DEXes and report the best rate to Discord.",
  );

  // Executor (HITL demo): when on, a spawned executor runs the real preflight + HITL
  // gate against a simulated swap of this notional. Above the HITL threshold ⇒ it pauses.
  let enableExecutor = $state(true);
  let execNotionalStr = $state("12");
  let testingHitl = $state(false);
  let revoking = $state(false);

  /** Demo moment 3: revoke the master's spawning authority (simulated — live 1Shot path lands later). */
  function revoke() {
    if (store.spawningRevoked || revoking) return;
    revoking = true;
    try {
      store.markSpawningRevoked();
    } finally {
      revoking = false;
    }
  }

  /** Start a fresh session (clears revocation, tree, and compile review). */
  function newSession() {
    store.reset(workflow);
    compileResult = undefined;
    compiledSpec = undefined;
    review = [];
    transportRef = undefined;
    switcher = undefined;
    commitTx = undefined;
    commitSimulated = false;
    commitError = undefined;
    activeTab = "workflow";
  }

  function execNotional(): bigint {
    const n = Number.parseFloat(execNotionalStr);
    return BigInt(Math.round((Number.isFinite(n) ? n : 0) * 1e6));
  }
  /** Saved custom agents → a registry the planner can spawn from (proper agents). */
  function buildRegistry(): CustomAgentRegistry | undefined {
    if (customAgents.list.length === 0) return undefined;
    const reg = new CustomAgentRegistry();
    for (const a of customAgents.list) {
      try {
        reg.register(toDefinition(a));
      } catch {
        /* skip invalid stored agent */
      }
    }
    return reg;
  }

  function buildExecutorRunner(spec: CompiledSpec): SubAgentRunner {
    const context = sessionContextFrom(spec, BASE_SEPOLIA_DEPLOYMENT);
    return makeSimulatedExecutorRunner({
      context,
      spec,
      notionalUsdc: execNotional(),
      requestApproval: (req) => store.awaitApproval(req),
    });
  }

  let pending = $state(false);
  let compiling = $state(false);
  let lastResultText = $state("");
  let switcher: SwitchingInferenceTransport | undefined;
  let transportRef: InferenceTransport | undefined;

  // --- audit receipt (§10.7/§10.8): a live Merkle commitment over the session trail ---
  const receipt = $derived.by<SessionReceipt | undefined>(() => {
    if (store.children.length === 0 && store.phase !== "done") return undefined;
    try {
      return buildReceipt(store.receiptInput);
    } catch {
      return undefined;
    }
  });

  function downloadReceipt() {
    if (!receipt) return;
    const json = JSON.stringify(receipt, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `frost-receipt-${receipt.sessionId.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- audit anchor (§10.8). Live anchoring uses the custodial signing wallet (later); simulate for now. ---
  let committing = $state(false);
  let commitTx = $state<string | undefined>(undefined);
  let commitSimulated = $state(false);
  let commitError = $state<string | undefined>(undefined);

  async function commitAudit() {
    if (!receipt || committing) return;
    committing = true;
    commitError = undefined;
    try {
      // No raw key in the client — anchor is simulated until the custodial
      // signing wallet path is wired.
      commitTx = receipt.merkleRoot;
      commitSimulated = true;
    } catch (e) {
      commitError = e instanceof Error ? e.message : String(e);
    } finally {
      committing = false;
    }
  }

  // --- compile state (NL workflow → reviewable, signable spec) ---
  let compileResult = $state<CompileResult | undefined>(undefined);
  let compiledSpec = $state<CompiledSpec | undefined>(undefined);
  let review = $state<string[]>([]);
  let answers = $state<Record<string, string>>({});

  function toggleVenice() {
    primaryEnabled = !primaryEnabled;
    switcher?.setPrimaryEnabled(primaryEnabled);
  }

  /**
   * Build the shared thinking transport ONCE (Venice x402 primary → OpenRouter/Groq
   * fallback) from config, so the Venice budget spans compile + planning.
   */
  function ensureTransport(): InferenceTransport {
    if (transportRef) return transportRef;
    const built = buildTransport({ primaryEnabled, onRoute: (i) => store.onRoute(i) });
    transportRef = built.transport;
    switcher = built.switcher;
    return transportRef;
  }

  // Hand-off from the master-agent chat: prefill the workflow and auto-compile.
  onMount(() => {
    const w = handoff.take();
    if (w) {
      workflow = w;
      if (config.ready) compile();
    }
  });

  function safeRender(spec: CompiledSpec): string[] {
    try {
      return renderSpec(spec);
    } catch (e) {
      return [`(could not render review: ${e instanceof Error ? e.message : String(e)})`];
    }
  }

  /** Compile the NL workflow → reviewable, signable spec. */
  async function compile() {
    compiling = true;
    try {
      const transport = ensureTransport();
      const result = await new Compiler({ transport, model: config.primaryModel }).compile({
        description: workflow,
        answers,
      });
      compileResult = result;
      compiledSpec = result.spec;
      review = result.escalateToHITL ? [] : safeRender(result.spec);
    } catch (e) {
      compileResult = undefined;
      compiledSpec = undefined;
      review = [];
      store.markError(`compile failed: ${e instanceof Error ? e.message : String(e)}`);
      activeTab = "activity";
    } finally {
      compiling = false;
    }
  }

  /** Fallback sample spec when the user runs without compiling. */
  function buildSpec(): CompiledSpec {
    return {
      description: workflow,
      spendCapTotal: 50_000_000n,
      hitlThreshold: 5_000_000n,
      slippageBps: 50,
      expiryUnixSeconds: BigInt(Math.floor(Date.now() / 1000) + 86_400),
      redelegationBounds: { maxSubMandates: 6, maxAggregateBudget: 50_000_000n },
      rateLimit: { capacity: 10, refillRatePerSec: 1 },
      commsTemplate: { text: "Best WETH→USDC route reported (sample).", variables: [] },
    };
  }

  async function run() {
    pending = true;
    lastResultText = "";
    const spec = compiledSpec ?? buildSpec();
    store.beginCycle(spec.description); // preserves revocation across cycles
    activeTab = "tree"; // snap to the camera anchor while agents are live
    try {
      const transport = ensureTransport();
      // Issuance is simulated in the client (no raw key). The live path uses the
      // custodial signing wallet and lands in a later round.
      const inner: SubMandateIssuer = simulatedIssuer();
      const rootMandateId = (store.master.rootMandateId as `0x${string}` | undefined) ??
        (("0x" + "b".repeat(64)) as `0x${string}`);
      // Once revoked, every spawn attempt fails before any chain write (the cascade).
      const issue = revocableIssuer(inner, () => store.spawningRevoked);

      const registry = buildRegistry();
      const { session } = createEmbeddedSession({
        spec,
        sessionId: ("0x" + "a".repeat(64)) as `0x${string}`,
        rootMandateId,
        openRouterApiKey: fallbackKeyOf(config.value),
        model: config.primaryModel,
        veniceApiKey: config.value.veniceApiKey,
        inferenceTransport: transport,
        discordWebhookUrl: config.value.discordWebhookUrl || undefined,
        ...(registry ? { registry } : {}),
        ...(enableExecutor ? { executorRunner: buildExecutorRunner(spec) } : {}),
        issue,
        provisionHolder: eoaProvisioner(new TauriKeyStore()),
        observer: (e) => store.onEvent(e),
      });

      const res = await session.runCycle({ kind: "session-start" });
      lastResultText = JSON.stringify(res, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    } catch (e) {
      store.markError(e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e));
    } finally {
      pending = false;
    }
  }

  /** Deterministic HITL demo: drive one executor through the gate without the planner. */
  async function testHitl() {
    testingHitl = true;
    const spec = compiledSpec ?? buildSpec();
    store.reset(spec.description);
    activeTab = "tree";
    const mid = ("0x" + "e".repeat(64)) as `0x${string}`;
    store.onEvent({ type: "cycle-start", trigger: { kind: "condition-fired" } });
    store.onEvent({ type: "plan-decided", approved: [{ index: 0, role: "executor", spendCapTotal: execNotional() }], escalateToHITL: false });
    store.onEvent({ type: "sub-mandate", index: 0, role: "executor", status: "issued", mandateId: mid });
    store.onEvent({ type: "sub-agent-dispatched", role: "executor", behavior: "executor", mandateId: mid });
    try {
      const runner = buildExecutorRunner(spec);
      const res = await runner({ behavior: "executor", outcome: { role: "executor", status: "issued", mandateId: mid } as never });
      store.onEvent({ type: "sub-agent-result", role: "executor", behavior: "executor", mandateId: mid, ran: res.ran, ...(res.detail ? { detail: res.detail } : {}) });
      store.onEvent({ type: "cycle-complete", spawnedSubMandateIds: [mid], escalateToHITL: false });
    } catch (e) {
      store.markError(`HITL test failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      testingHitl = false;
    }
  }

  const usdc = (v?: bigint) => (v === undefined ? "—" : `$${(Number(v) / 1e6).toFixed(2)}`);
  const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);
  const phaseBadge = (): "default" | "secondary" | "outline" | "destructive" =>
    store.phase === "error" || store.phase === "escalated"
      ? "destructive"
      : store.phase === "done"
        ? "secondary"
        : store.phase === "idle"
          ? "outline"
          : "default";
</script>

<div class="grid h-[calc(100vh-36px)] grid-cols-[240px_1fr_300px] gap-px bg-border text-sm">
  <!-- LEFT: task queue -->
  <aside class="flex flex-col gap-3 overflow-y-auto bg-background p-3">
    <div class="flex items-center justify-between">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tasks</h2>
      <Button variant="ghost" size="sm" class="h-6 px-2" onclick={newSession}>
        <Plus class="size-3.5" /> New
      </Button>
    </div>

    <button
      type="button"
      class="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50"
      onclick={() => (activeTab = "tree")}
    >
      <div class="flex items-center justify-between gap-2">
        <span class="font-medium">Session #1</span>
        <Badge variant={phaseBadge()}>{store.phase}</Badge>
      </div>
      <p class="mt-1 line-clamp-3 text-xs text-muted-foreground">{store.master.description || workflow}</p>
      <div class="mt-2 flex gap-3 text-[10px] text-muted-foreground">
        <span>{store.agentsTotal} agents</span>
        <span>{store.agentsRunning} running</span>
        <span>{store.agentsDone} done</span>
      </div>
    </button>

    <p class="px-1 text-[10px] text-muted-foreground">
      Multi-session queue, condition triggers and refill cycles land here next.
    </p>
  </aside>

  <!-- CENTER: focus area with tabs -->
  <main class="flex flex-col overflow-hidden bg-background">
    <HitlGate {store} />
    <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
      <div class="flex gap-1">
        {#each TABS as tab (tab.id)}
          <button
            type="button"
            class="rounded-md px-3 py-1 text-xs font-medium transition-colors {activeTab === tab.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'}"
            onclick={() => (activeTab = tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      <div class="flex items-center gap-2">
        {#if compiledSpec && !compileResult?.escalateToHITL}
          <Badge variant="outline" class="text-[10px]">compiled spec</Badge>
        {:else}
          <Badge variant="ghost" class="text-[10px] text-muted-foreground">sample spec</Badge>
        {/if}
        <Button size="sm" class="h-7" onclick={run} disabled={pending || compiling || !config.ready || (compileResult?.escalateToHITL ?? false)}>
          {#if pending}<Loader2 class="mr-1 size-3.5 animate-spin" />{:else}<Play class="mr-1 size-3.5" />{/if}
          Run cycle
        </Button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      {#if activeTab === "workflow"}
        <div class="mx-auto flex max-w-xl flex-col gap-3">
          {#if !config.ready}
            <div class="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <span>Finish configuration (an OpenRouter key + a primary model) before running.</span>
              <Button href="/setup" size="sm" variant="secondary"><Settings2 class="size-3.5" /> Open setup</Button>
            </div>
          {/if}

          <div class="grid gap-1.5">
            <Label for="wf">Workflow (natural language)</Label>
            <Textarea id="wf" rows={3} bind:value={workflow} />
          </div>

          <div class="flex items-center gap-2">
            <Button variant="secondary" size="sm" onclick={compile} disabled={compiling || !config.ready || !workflow.trim()}>
              {#if compiling}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
              Compile workflow
            </Button>
            {#if compileResult}
              {#if compileResult.escalateToHITL}
                <Badge variant="destructive">needs human review</Badge>
              {:else if compileResult.readyToSign}
                <Badge variant="secondary">ready to sign</Badge>
              {:else}
                <Badge variant="default">{compileResult.clarifications.length} question(s)</Badge>
              {/if}
            {/if}
          </div>

          {#if compileResult}
            {#if compileResult.escalateToHITL}
              <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <span class="font-medium">Could not compile this safely.</span> {compileResult.hitlReason}
              </div>
            {:else}
              <Card.Root>
                <Card.Header class="pb-2">
                  <Card.Title class="text-sm">You are authorizing</Card.Title>
                  <Card.Description class="text-xs">
                    Plain-language review decoded from the exact bytes you sign — no second description that could drift (I-16).
                  </Card.Description>
                </Card.Header>
                <Card.Content>
                  <ul class="list-disc space-y-1 pl-4 text-xs">
                    {#each review as line (line)}<li>{line}</li>{/each}
                  </ul>
                </Card.Content>
              </Card.Root>

              {#if compileResult.warnings.length > 0}
                <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <p class="mb-1 font-medium">Please confirm:</p>
                  <ul class="list-disc space-y-0.5 pl-4">
                    {#each compileResult.warnings as w (w)}<li>{w}</li>{/each}
                  </ul>
                </div>
              {/if}

              {#if compileResult.assumptions.length > 0}
                <div class="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p class="mb-1 font-medium">Assumptions applied (conservative defaults):</p>
                  <ul class="list-disc space-y-0.5 pl-4">
                    {#each compileResult.assumptions as a (a.field)}<li><span class="font-medium">{a.field}</span>: {a.assumed} — {a.note}</li>{/each}
                  </ul>
                </div>
              {/if}

              {#if compileResult.clarifications.length > 0}
                <Card.Root>
                  <Card.Header class="pb-2"><Card.Title class="text-sm">A few questions before signing</Card.Title></Card.Header>
                  <Card.Content class="flex flex-col gap-2">
                    {#each compileResult.clarifications as cl (cl.field)}
                      <div class="grid gap-1">
                        <Label for={"clar-" + cl.field} class="text-xs">{cl.question}</Label>
                        <input id={"clar-" + cl.field} class="rounded-md border bg-input/30 px-2 py-1 text-xs" bind:value={answers[cl.field]} />
                        <p class="text-[10px] text-muted-foreground">{cl.reason}</p>
                      </div>
                    {/each}
                    <Button size="sm" variant="secondary" onclick={compile} disabled={compiling}>Re-compile with answers</Button>
                  </Card.Content>
                </Card.Root>
              {/if}

              <p class="text-[10px] text-muted-foreground">model: {compileResult.modelUsed} · prompt: {compileResult.promptTemplate}</p>
            {/if}
          {/if}

          <!-- Paid inference (Venice x402) runtime kill switch — keys live in Setup. -->
          {#if config.value.veniceApiKey}
            <div class="flex items-center justify-between rounded-lg border bg-card p-3 text-xs">
              <div>
                <p class="font-medium">Paid inference (Venice x402)</p>
                <p class="text-muted-foreground">{store.routes.venice} paid · {store.routes.openrouter} fallback</p>
              </div>
              <Button variant={primaryEnabled ? "default" : "outline"} size="sm" onclick={toggleVenice}>
                Venice {primaryEnabled ? "ON" : "OFF"}
              </Button>
            </div>
          {/if}

          <Card.Root>
            <Card.Header class="pb-2">
              <Card.Title class="text-sm">Executor & human-in-the-loop</Card.Title>
              <Card.Description class="text-xs">
                A spawned executor runs the real §10.3 preflight against your signed CALLABLE_SURFACE.
                A simulated swap above your HITL threshold pauses for approval (no funds moved).
              </Card.Description>
            </Card.Header>
            <Card.Content class="flex flex-col gap-3">
              <div class="flex items-end gap-3">
                <Button variant={enableExecutor ? "default" : "outline"} size="sm" onclick={() => (enableExecutor = !enableExecutor)}>
                  Executor {enableExecutor ? "ON" : "OFF"}
                </Button>
                <div class="grid w-32 gap-1.5">
                  <Label for="notional">Swap notional (USDC)</Label>
                  <input id="notional" type="number" min="0" step="0.01" class="rounded-md border bg-input/30 px-2 py-1 text-xs" bind:value={execNotionalStr} />
                </div>
                <Button variant="secondary" size="sm" onclick={testHitl} disabled={testingHitl || pending}>
                  {#if testingHitl}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
                  Test HITL gate
                </Button>
              </div>
              <p class="text-[10px] text-muted-foreground">
                Tip: HITL fires when the notional exceeds the compiled HITL threshold
                (sample default $5). "Test HITL gate" drives one executor through the gate directly.
              </p>
            </Card.Content>
          </Card.Root>
        </div>
      {:else if activeTab === "tree"}
        <DelegationTree {store} onRevoke={revoke} {revoking} />
      {:else if activeTab === "activity"}
        <ActivityLog {store} />
      {:else if activeTab === "receipt"}
        {#if receipt}
          <div class="flex flex-col gap-3">
            <Card.Root>
              <Card.Header class="pb-2">
                <Card.Title class="text-sm">Session audit commitment</Card.Title>
                <Card.Description class="text-xs">
                  Merkle root over the full session trail (§10.8). Tamper-evident: any altered
                  entry breaks the root. On-chain anchoring via the custodial signing wallet lands next.
                </Card.Description>
              </Card.Header>
              <Card.Content class="flex flex-col gap-2">
                <div class="rounded-lg border bg-muted/40 p-3">
                  <div class="text-[10px] uppercase tracking-wide text-muted-foreground">Merkle root (bytes32)</div>
                  <div class="break-all font-mono text-xs text-foreground">{receipt.merkleRoot}</div>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div class="rounded-lg border bg-card p-2">
                    <div class="text-[10px] text-muted-foreground">session id</div>
                    <div class="font-mono">{shortHash(receipt.sessionId)}</div>
                  </div>
                  <div class="rounded-lg border bg-card p-2">
                    <div class="text-[10px] text-muted-foreground">audit entries</div>
                    <div>{receipt.entries.length}</div>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onclick={downloadReceipt}>
                    Download receipt JSON
                  </Button>
                  <Button size="sm" onclick={commitAudit} disabled={committing || !!commitTx}>
                    {#if committing}<Loader2 class="mr-1 size-3 animate-spin" />{/if}
                    {commitTx ? "Committed" : "Commit on-chain"}
                  </Button>
                </div>
                {#if commitTx}
                  <div class="rounded-lg border bg-card p-2 text-xs">
                    <span class="text-muted-foreground">Simulated anchor (signing wallet path lands next). Root:</span>
                    <span class="font-mono break-all">{commitTx}</span>
                  </div>
                {/if}
                {#if commitError}
                  <p class="text-xs text-destructive">Commit failed: {commitError}</p>
                {/if}
              </Card.Content>
            </Card.Root>

            <div class="rounded-lg border">
              <div class="grid grid-cols-[1fr_auto] gap-2 border-b bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>audit entry</span>
                <span>leaf hash</span>
              </div>
              {#each receipt.entries as entry, i}
                <div class="grid grid-cols-[1fr_auto] items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0">
                  <span class="flex items-center gap-2">
                    <Badge variant="secondary" class="text-[10px]">{entry.kind}</Badge>
                    {#if entry.kind === "sub-agent"}<span class="text-muted-foreground">{entry.role}</span>{/if}
                    {#if entry.kind === "hitl"}<span class="text-muted-foreground">{entry.approved ? "approved" : "rejected"} · {usdc(entry.notionalUsdc)}</span>{/if}
                  </span>
                  <span class="font-mono text-[10px] text-muted-foreground">{shortHash(receipt.leaves[i] ?? "")}</span>
                </div>
              {/each}
            </div>

            {#if lastResultText}
              <details class="text-xs">
                <summary class="cursor-pointer text-muted-foreground">Raw cycle outcome (JSON)</summary>
                <Textarea class="mt-2 font-mono text-[11px]" rows={16} readonly value={lastResultText} />
              </details>
            {/if}
          </div>
        {:else}
          <p class="text-xs text-muted-foreground">Run a cycle to produce a receipt.</p>
        {/if}
      {/if}
    </div>
  </main>

  <!-- RIGHT: telemetry -->
  <aside class="flex flex-col gap-3 overflow-y-auto bg-background p-3">
    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI stats</h2>
      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-lg border bg-card p-2">
          <div class="text-lg font-semibold">{store.agentsRunning}</div>
          <div class="text-[10px] text-muted-foreground">agents running</div>
        </div>
        <div class="rounded-lg border bg-card p-2">
          <div class="text-lg font-semibold">{store.agentsTotal}</div>
          <div class="text-[10px] text-muted-foreground">agents total</div>
        </div>
        <div class="rounded-lg border bg-card p-2">
          <div class="text-lg font-semibold">{store.inferenceCalls}</div>
          <div class="text-[10px] text-muted-foreground">inference calls</div>
        </div>
        <div class="rounded-lg border bg-card p-2">
          <div class="text-lg font-semibold">{store.agentsDone}/{store.agentsFailed}</div>
          <div class="text-[10px] text-muted-foreground">done / failed</div>
        </div>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        <Badge variant="outline" class="text-[10px]">{config.primaryModel}</Badge>
        {#if store.routes.venice > 0}<Badge variant="secondary" class="text-[10px]">venice ×{store.routes.venice}</Badge>{/if}
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Authority state</h2>
      <div class="flex flex-col gap-1 rounded-lg border bg-card p-3 text-xs">
        <div class="flex justify-between"><span class="text-muted-foreground">sub-mandates</span><span>{store.authority?.subMandateCount ?? 0}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">aggregate budget</span><span>{usdc(store.authority?.aggregateSubMandateBudget)}</span></div>
        <div class="flex justify-between"><span class="text-muted-foreground">rate-limit tokens</span><span>{store.authority?.bucketAvailable ?? "—"}</span></div>
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Blockchain</h2>
      <a href="/wallet" class="block rounded-lg border bg-card p-3 text-xs text-muted-foreground transition-colors hover:bg-muted/50">
        Wallet balance, recent txns and price details live on the Wallet page →
      </a>
    </section>
  </aside>
</div>
