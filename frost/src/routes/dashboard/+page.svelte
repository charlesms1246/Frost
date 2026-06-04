<script lang="ts">
  import { AgentSessionStore } from "$lib/stores/agent-session.svelte";
  import DelegationTree from "$lib/components/dashboard/DelegationTree.svelte";
  import ActivityLog from "$lib/components/dashboard/ActivityLog.svelte";
  import { createEmbeddedSession } from "$lib/agent/session";
  import { eoaProvisioner, simulatedIssuer } from "$lib/agent/holders";
  import { createLiveRootMandate, liveSdkIssuer } from "$lib/agent/live";
  import { makeSimulatedExecutorRunner } from "$lib/agent/executor-runner";
  import { revocableIssuer, liveRevoke } from "$lib/agent/revocation";
  import { liveCommitAudit, auditRegistryConfigured } from "$lib/agent/audit-commit";
  import { TauriKeyStore } from "$lib/key-store";
  import {
    Compiler,
    renderSpec,
    OpenRouterClient,
    VeniceInferenceClient,
    SwitchingInferenceTransport,
    sessionContextFrom,
    BASE_SEPOLIA_DEPLOYMENT,
    buildReceipt,
  } from "@frost/agent/browser";
  import type {
    CompiledSpec,
    CompileResult,
    SubMandateIssuer,
    SubAgentRunner,
    InferenceTransport,
    SessionReceipt,
  } from "@frost/agent/browser";
  import HitlGate from "$lib/components/dashboard/HitlGate.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import Play from "@lucide/svelte/icons/play";
  import Plus from "@lucide/svelte/icons/plus";

  const store = new AgentSessionStore();

  type Tab = "setup" | "tree" | "activity" | "receipt";
  let activeTab = $state<Tab>("setup");
  const TABS: { id: Tab; label: string }[] = [
    { id: "setup", label: "Setup" },
    { id: "tree", label: "Tree" },
    { id: "activity", label: "Activity" },
    { id: "receipt", label: "Receipt" },
  ];

  // --- credentials & controls ---
  let openRouterApiKey = $state("");
  let model = $state("openai/gpt-4o-mini");
  let veniceApiKey = $state("");
  let veniceInferenceApiKey = $state("");
  let veniceInferenceModel = $state("llama-3.3-70b");
  let primaryBudgetStr = $state("3");
  let primaryEnabled = $state(true);
  let discordWebhookUrl = $state("");
  let workflow = $state(
    "Compare WETH→USDC quotes across DEXes and report the best rate to Discord.",
  );
  let sessionKey = $state("");
  let rpcUrl = $state("https://base-sepolia.publicnode.com");

  // Executor (HITL demo): when on, a spawned executor runs the real preflight + HITL
  // gate against a simulated swap of this notional. Above the HITL threshold ⇒ it pauses.
  let enableExecutor = $state(true);
  let execNotionalStr = $state("12");
  let testingHitl = $state(false);
  let revoking = $state(false);

  /** Demo moment 3: revoke the master's spawning authority (on-chain when live). */
  async function revoke() {
    if (store.spawningRevoked || revoking) return;
    revoking = true;
    try {
      if (sessionKey.trim() && store.master.rootMandateId) {
        const pk = (sessionKey.startsWith("0x") ? sessionKey : "0x" + sessionKey) as `0x${string}`;
        const tx = await liveRevoke({ sessionPrivateKey: pk, rpcUrl, mandateId: store.master.rootMandateId as `0x${string}` });
        store.markSpawningRevoked(tx);
      } else {
        store.markSpawningRevoked();
      }
    } catch (e) {
      store.markError(`revoke failed: ${e instanceof Error ? e.message : String(e)}`);
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
    activeTab = "setup";
  }

  function execNotional(): bigint {
    const n = Number.parseFloat(execNotionalStr);
    return BigInt(Math.round((Number.isFinite(n) ? n : 0) * 1e6));
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

  // --- on-chain commit of the audit root (§10.8) ---
  let committing = $state(false);
  let commitTx = $state<string | undefined>(undefined);
  let commitSimulated = $state(false);
  let commitError = $state<string | undefined>(undefined);

  async function commitAudit() {
    if (!receipt || committing) return;
    committing = true;
    commitError = undefined;
    try {
      const sessionEnd = BigInt(Math.floor(Date.now() / 1000));
      if (sessionKey.trim() && auditRegistryConfigured()) {
        const pk = (sessionKey.startsWith("0x") ? sessionKey : "0x" + sessionKey) as `0x${string}`;
        commitTx = await liveCommitAudit({
          sessionPrivateKey: pk,
          rpcUrl,
          sessionId: receipt.sessionId,
          merkleRoot: receipt.merkleRoot,
          sessionEnd,
        });
        commitSimulated = false;
      } else {
        // No funded key or AuditRegistry not deployed yet → simulate the anchor.
        commitTx = receipt.merkleRoot;
        commitSimulated = true;
      }
    } catch (e) {
      commitError = e instanceof Error ? e.message : String(e);
    } finally {
      committing = false;
    }
  }

  // --- compile state (the Setup → review → sign flow) ---
  let compileResult = $state<CompileResult | undefined>(undefined);
  let compiledSpec = $state<CompiledSpec | undefined>(undefined);
  let review = $state<string[]>([]);
  let answers = $state<Record<string, string>>({});

  function toggleVenice() {
    primaryEnabled = !primaryEnabled;
    switcher?.setPrimaryEnabled(primaryEnabled);
  }

  /** Build the shared thinking transport ONCE, so the Venice budget spans compile + planning. */
  function ensureTransport(): InferenceTransport {
    if (transportRef) return transportRef;
    const openRouter = new OpenRouterClient({ apiKey: openRouterApiKey, model });
    if (!veniceInferenceApiKey) {
      transportRef = openRouter;
      switcher = undefined;
      return transportRef;
    }
    const venice = new VeniceInferenceClient({ apiKey: veniceInferenceApiKey, model: veniceInferenceModel });
    const budget = Number.parseInt(primaryBudgetStr, 10);
    switcher = new SwitchingInferenceTransport({
      primary: venice,
      fallback: openRouter,
      primaryCallBudget: Number.isFinite(budget) ? budget : 3,
      primaryEnabled,
      onRoute: (i) => store.onRoute(i),
    });
    transportRef = switcher;
    return transportRef;
  }

  function safeRender(spec: CompiledSpec): string[] {
    try {
      return renderSpec(spec);
    } catch (e) {
      return [`(could not render review: ${e instanceof Error ? e.message : String(e)})`];
    }
  }

  /** Compile the NL workflow → reviewable, signable spec (the demo's opening). */
  async function compile() {
    compiling = true;
    try {
      const transport = ensureTransport();
      const result = await new Compiler({ transport, model }).compile({ description: workflow, answers });
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
      let inner: SubMandateIssuer;
      let rootMandateId = (store.master.rootMandateId as `0x${string}` | undefined) ?? (("0x" + "b".repeat(64)) as `0x${string}`);

      if (store.spawningRevoked) {
        // Spawning authority revoked — the wrapper refuses below; don't touch the chain.
        inner = simulatedIssuer();
      } else if (sessionKey.trim()) {
        const pk = (sessionKey.startsWith("0x") ? sessionKey : "0x" + sessionKey) as `0x${string}`;
        const root = await createLiveRootMandate({ sessionPrivateKey: pk, rpcUrl, spec });
        rootMandateId = root.rootMandateId;
        store.master.rootMandateId = root.rootMandateId;
        inner = liveSdkIssuer({ sessionPrivateKey: pk, rpcUrl });
      } else {
        inner = simulatedIssuer();
      }
      // Once revoked, every spawn attempt fails before any chain write (the cascade).
      const issue = revocableIssuer(inner, () => store.spawningRevoked);

      const { session } = createEmbeddedSession({
        spec,
        sessionId: ("0x" + "a".repeat(64)) as `0x${string}`,
        rootMandateId,
        openRouterApiKey,
        model,
        veniceApiKey,
        inferenceTransport: transport,
        discordWebhookUrl: discordWebhookUrl || undefined,
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
        <Button size="sm" class="h-7" onclick={run} disabled={pending || compiling || !openRouterApiKey || (compileResult?.escalateToHITL ?? false)}>
          {#if pending}<Loader2 class="mr-1 size-3.5 animate-spin" />{:else}<Play class="mr-1 size-3.5" />{/if}
          Run cycle
        </Button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      {#if activeTab === "setup"}
        <div class="mx-auto flex max-w-xl flex-col gap-3">
          <div class="grid gap-1.5">
            <Label for="wf">Workflow (natural language)</Label>
            <Textarea id="wf" rows={3} bind:value={workflow} />
          </div>

          <div class="flex items-center gap-2">
            <Button variant="secondary" size="sm" onclick={compile} disabled={compiling || !openRouterApiKey || !workflow.trim()}>
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
                    {#each compileResult.clarifications as c (c.field)}
                      <div class="grid gap-1">
                        <Label for={"clar-" + c.field} class="text-xs">{c.question}</Label>
                        <Input id={"clar-" + c.field} bind:value={answers[c.field]} />
                        <p class="text-[10px] text-muted-foreground">{c.reason}</p>
                      </div>
                    {/each}
                    <Button size="sm" variant="secondary" onclick={compile} disabled={compiling}>Re-compile with answers</Button>
                  </Card.Content>
                </Card.Root>
              {/if}

              <p class="text-[10px] text-muted-foreground">model: {compileResult.modelUsed} · prompt: {compileResult.promptTemplate}</p>
            {/if}
          {/if}

          <div class="grid gap-1.5">
            <Label for="or">OpenRouter API key (thinking / fallback)</Label>
            <Input id="or" type="password" bind:value={openRouterApiKey} placeholder="sk-or-…" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="grid gap-1.5">
              <Label for="model">Model</Label>
              <Input id="model" bind:value={model} />
            </div>
            <div class="grid gap-1.5">
              <Label for="vmodel">Venice model</Label>
              <Input id="vmodel" bind:value={veniceInferenceModel} />
            </div>
          </div>

          <Card.Root>
            <Card.Header class="pb-2">
              <Card.Title class="text-sm">Paid inference (Venice x402) — budget guard</Card.Title>
              <Card.Description class="text-xs">
                Route the first N calls through Venice (paid), then auto-switch to OpenRouter so
                the small Venice balance is never overspent. The kill switch forces OpenRouter now.
              </Card.Description>
            </Card.Header>
            <Card.Content class="flex flex-col gap-3">
              <div class="grid gap-1.5">
                <Label for="vkey">Venice inference key (optional)</Label>
                <Input id="vkey" type="password" bind:value={veniceInferenceApiKey} placeholder="empty ⇒ OpenRouter only" />
              </div>
              <div class="flex items-end gap-3">
                <div class="grid w-28 gap-1.5">
                  <Label for="budget">Venice calls</Label>
                  <Input id="budget" type="number" min="0" bind:value={primaryBudgetStr} />
                </div>
                <Button variant={primaryEnabled ? "default" : "outline"} size="sm" onclick={toggleVenice}>
                  Venice {primaryEnabled ? "ON" : "OFF"}
                </Button>
                <span class="text-xs text-muted-foreground">
                  {store.routes.venice} paid · {store.routes.openrouter} fallback
                </span>
              </div>
            </Card.Content>
          </Card.Root>

          <div class="grid gap-1.5">
            <Label for="venice">Venice RPC key (pricer / monitor reads)</Label>
            <Input id="venice" type="password" bind:value={veniceApiKey} />
          </div>
          <div class="grid gap-1.5">
            <Label for="discord">Discord webhook (optional)</Label>
            <Input id="discord" bind:value={discordWebhookUrl} placeholder="https://discord.com/api/webhooks/…" />
          </div>
          <div class="grid gap-1.5">
            <Label for="sk">Session key — LIVE issuance on Base Sepolia (optional)</Label>
            <Input id="sk" type="password" bind:value={sessionKey} placeholder="empty ⇒ simulated; funded key ⇒ real root + sub mandates" />
          </div>
          {#if sessionKey.trim()}
            <div class="grid gap-1.5">
              <Label for="rpc">Base Sepolia RPC</Label>
              <Input id="rpc" bind:value={rpcUrl} />
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
                  <Input id="notional" type="number" min="0" step="0.01" bind:value={execNotionalStr} />
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
            <!-- The closing shot: a 32-byte Merkle commitment over the session's audit trail. -->
            <Card.Root>
              <Card.Header class="pb-2">
                <Card.Title class="text-sm">Session audit commitment</Card.Title>
                <Card.Description class="text-xs">
                  Merkle root over the full session trail (§10.8). Tamper-evident: any altered
                  entry breaks the root. On-chain anchoring via the commitment service is the next seam.
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
                    {#if commitSimulated}
                      <span class="text-muted-foreground">Simulated anchor (no funded session key / AuditRegistry not deployed). Root:</span>
                      <span class="font-mono break-all">{commitTx}</span>
                    {:else}
                      <span class="text-muted-foreground">Anchored on Base Sepolia:</span>
                      <a class="font-mono text-primary underline" href={`https://sepolia.basescan.org/tx/${commitTx}`} target="_blank" rel="noreferrer">{shortHash(commitTx)}</a>
                    {/if}
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
        <Badge variant="outline" class="text-[10px]">{model}</Badge>
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
      <div class="rounded-lg border bg-card p-3 text-xs text-muted-foreground">
        Wallet balance, last 5 txns and price candles land here next (Base Sepolia).
      </div>
    </section>
  </aside>
</div>
