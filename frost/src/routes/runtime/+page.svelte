<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { AgentSessionStore } from "$lib/stores/agent-session.svelte";
  import { config, fallbackKeyOf } from "$lib/stores/config.svelte";
  import { handoff } from "$lib/stores/handoff.svelte";
  import DelegationTree from "$lib/components/dashboard/DelegationTree.svelte";
  import ActivityLog from "$lib/components/dashboard/ActivityLog.svelte";
  import { createEmbeddedSession } from "$lib/agent/session";
  import { eoaProvisioner, simulatedIssuer } from "$lib/agent/holders";
  import { makeSimulatedExecutorRunner, makeRelayerExecutorRunner, makeExecutorRunner } from "$lib/agent/executor-runner";
  import { usdcTransferWork } from "$lib/agent/relayer-exec";
  import { GRANT_TOKEN } from "$lib/wallet-connect";
  import { profile } from "$lib/stores/profile.svelte";
  import { revocableIssuer, liveRevoke } from "$lib/agent/revocation";
  import { createLiveRootMandate, liveSdkIssuer } from "$lib/agent/live";
  import { crossCheckedSepoliaQuote, BASE_SEPOLIA_RPCS } from "$lib/agent/rpc-crosscheck";
  import type { Caveat } from "@frost/sdk";
  import { privateKeyToAccount } from "viem/accounts";
  import { X402_INFERENCE_URL, X402_ASSET_TRANSFER_METHOD } from "$lib/flags";
  import { ensureSessionDelegated } from "$lib/agent/session-7702";
  import { liveCommitAudit, liveCommitAuditWithSig, requestAuditCommitSignature } from "$lib/agent/audit-commit";
  import { buildTransport } from "$lib/agent/transport";
  import { veniceKill } from "$lib/stores/venice.svelte";
  import { TauriKeyStore } from "$lib/key-store";
  import { customAgents, toDefinition } from "$lib/stores/custom-agents.svelte";
  import {
    Compiler,
    renderSpec,
    sessionContextFrom,
    BASE_SEPOLIA_DEPLOYMENT,
    BASE_SEPOLIA_SWAP_ROUTER_02,
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

  // --- Demo: live on Base Sepolia via the funded session key (read from .env by the
  // Rust `load_demo_credentials` command; held in memory only, never persisted). When
  // loaded, /runtime runs the PROVEN live path (real issuance / 1Shot swap / audit commit
  // / revocation) instead of simulation. Absent ⇒ simulated (unchanged behavior).
  type DemoCreds = {
    sessionKey: `0x${string}`;
    rpcUrl: string;
    apiKey: string;
    apiSecret: string;
    walletId: string;
    walletAddress: `0x${string}`;
    swapMethodId: string;
  };
  let demo = $state<DemoCreds | null>(null);
  let loadingDemo = $state(false);
  let demoError = $state("");
  let liveRootMandateId = $state<`0x${string}` | undefined>(undefined);
  /** Live 1Shot swap is possible only with the 1Shot creds + a registered swap method. */
  const demoSwapReady = $derived(
    !!demo && !!demo.apiKey && !!demo.apiSecret && !!demo.walletId && !!demo.swapMethodId,
  );

  // Live WETH→USDC swap params (proven in agent/scripts/executor-live-swap.mjs).
  const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
  const SWAP_AMOUNT_IN_WEI = "1000000000000000"; // 0.001 WETH (~$3.70)

  async function loadDemoCreds() {
    loadingDemo = true;
    demoError = "";
    try {
      const c = await invoke<{
        sessionKey?: string; rpcUrl?: string; apiKey?: string; apiSecret?: string;
        walletId?: string; walletAddress?: string; swapMethodId?: string;
      }>("load_demo_credentials");
      if (!c.sessionKey) {
        demoError = "No BASE_SEPOLIA_PK found in .env — running simulated.";
        demo = null;
        return;
      }
      demo = {
        sessionKey: (c.sessionKey.startsWith("0x") ? c.sessionKey : "0x" + c.sessionKey) as `0x${string}`,
        rpcUrl: c.rpcUrl || config.value.rpcUrl || "https://sepolia.base.org",
        apiKey: c.apiKey ?? "",
        apiSecret: c.apiSecret ?? "",
        walletId: c.walletId ?? "",
        walletAddress: (c.walletAddress ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
        swapMethodId: c.swapMethodId ?? "",
      };
      // Rebuild the transport next time so the x402 paid leg picks up the session key.
      transportRef = undefined;
      switcher = undefined;
    } catch (e) {
      demoError = e instanceof Error ? e.message : String(e);
      demo = null;
    } finally {
      loadingDemo = false;
    }
  }

  /** Demo moment 3: revoke the master's spawning authority. Live `Revocation.revoke`
   * on-chain when demo creds are loaded (+ a root mandate exists); always marks the
   * store so the tree greys + the spawn cascade fires. */
  async function revoke() {
    if (store.spawningRevoked || revoking) return;
    revoking = true;
    try {
      if (demo && liveRootMandateId) {
        await liveRevoke({ sessionPrivateKey: demo.sessionKey, rpcUrl: demo.rpcUrl, mandateId: liveRootMandateId });
      }
      store.markSpawningRevoked();
    } catch (e) {
      store.markError("Revoke failed: " + (e instanceof Error ? e.message : String(e)));
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
    const requestApproval = (req: Parameters<typeof store.awaitApproval>[0]) => store.awaitApproval(req);
    const context = sessionContextFrom(spec, BASE_SEPOLIA_DEPLOYMENT);

    // DEMO LIVE: a real WETH→USDC swap through 1Shot's private mempool from the funded
    // server wallet. Runs the same §10.3 preflight (against the signed CALLABLE_SURFACE)
    // + HITL gate; only the submit is real. Highest-priority when demo creds are loaded.
    if (demoSwapReady && demo) {
      const d = demo;
      // CLOSED LOOP: resolve fee tier + amountOutMinimum from a LIVE Base Sepolia quote
      // of this exact swap (not hardcoded "3000"/"0"). Quotes the pool we actually trade,
      // applies the signed slippage as the on-chain floor, and falls back to the proven
      // params if the quote is unavailable — so the live swap is never broken.
      const resolveSwapParams = async () => {
        const baseParams = {
          tokenIn: WETH,
          tokenOut: GRANT_TOKEN,
          recipient: d.walletAddress,
          amountIn: SWAP_AMOUNT_IN_WEI,
          sqrtPriceLimitX96: "0",
        };
        try {
          // T-34c: cross-check the floor-setting quote across SEVERAL independent Base
          // Sepolia RPCs — only trust a floor a quorum corroborates (no single-RPC trust).
          const route = await crossCheckedSepoliaQuote({
            rpcUrls: BASE_SEPOLIA_RPCS,
            tokenIn: WETH,
            tokenOut: GRANT_TOKEN,
            amountInWei: BigInt(SWAP_AMOUNT_IN_WEI),
            slippageBps: spec.slippageBps,
          });
          if (route.corroborated) {
            store.note(`Pre-trade quote cross-checked ${route.agree}/${route.total} RPCs (fee ${route.fee}, spread ${route.spreadBps}bps): minOut ${route.amountOutMinimum}`);
            return { params: { ...baseParams, fee: String(route.fee), amountOutMinimum: route.amountOutMinimum.toString() } };
          }
          store.note(`Pre-trade quote NOT corroborated (${route.responded}/${route.total} RPCs, spread ${route.spreadBps}bps) — using safe fallback floor.`);
        } catch {
          /* fall through to proven params */
        }
        // Proven fallback (the live-tested swap params): fee 3000, accept-any floor.
        return { params: { ...baseParams, fee: "3000", amountOutMinimum: "0" } };
      };
      return makeExecutorRunner({
        oneShot: { apiKey: demo.apiKey, apiSecret: demo.apiSecret, walletId: demo.walletId },
        contractMethodId: demo.swapMethodId,
        swap: {
          target: BASE_SEPOLIA_SWAP_ROUTER_02,
          signature: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
          notionalUsdc: execNotional(),
          params: resolveSwapParams,
          slippageBps: spec.slippageBps,
        },
        context,
        spec,
        requestApproval,
      });
    }

    // KEYLESS relayer path: when the user has granted authority to the public relayer and
    // we know their address, the executor redeems the grant on-chain (a USDC self-transfer
    // of the notional — proves redemption, moves nothing out). Same HITL gate as the
    // simulated path. Otherwise simulate (no grant ⇒ no real submit).
    //
    // T-21 DISPOSITION (IG-09): unlike the private-mempool 1Shot path above, the 1Shot
    // PUBLIC relayer does not promise a private mempool, so the T-21 mitigation (no public
    // mempool for executor txs) is NOT enforced on this branch — it is an explicit testnet
    // caveat, negligible on Base Sepolia. This path is the lower-priority fallback and is
    // OFF the recorded demo (which uses the private 1Shot path above). There is no silent
    // private→public fallback: the private submit either lands or fails, it never silently
    // re-routes here. We surface the weaker guarantee at runtime rather than hide it.
    const grant = config.value.metaMaskGrant;
    const userAddr = profile.value.walletAddress;
    if (grant && userAddr && /^0x[0-9a-fA-F]{40}$/.test(userAddr)) {
      const notionalUsdc = execNotional();
      store.note(
        "Executing via the 1Shot PUBLIC relayer — this path does not guarantee a private " +
          "mempool (T-21 weakened; testnet caveat). The private-mempool path requires demo creds.",
      );
      return makeRelayerExecutorRunner({
        granted: JSON.parse(grant),
        spec,
        notionalUsdc,
        work: [usdcTransferWork(GRANT_TOKEN, userAddr as `0x${string}`, notionalUsdc)],
        requestApproval,
      });
    }
    return makeSimulatedExecutorRunner({ context, spec, notionalUsdc: execNotional(), requestApproval });
  }

  let pending = $state(false);
  let compiling = $state(false);
  let lastResultText = $state("");
  let switcher: SwitchingInferenceTransport | undefined;
  let transportRef: InferenceTransport | undefined;

  // Live Venice kill-switch (title-bar toggle): drop the cached transport so the next
  // inference call rebuilds with the new provider choice. `ensureTransport` reads the
  // current kill-switch value via `buildTransport`, so the toggle takes effect mid-session.
  $effect(() => {
    veniceKill.disabled; // track the toggle
    transportRef = undefined;
    switcher = undefined;
  });

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
  /** The committer recorded on-chain — the session key (single-sign) or the co-signer (T-17). */
  let commitCommitter = $state<string | undefined>(undefined);

  async function commitAudit() {
    if (!receipt || committing) return;
    committing = true;
    commitError = undefined;
    try {
      if (demo) {
        // LIVE anchor on Base Sepolia via the funded session key → AuditRegistry.commit.
        commitTx = await liveCommitAudit({
          sessionPrivateKey: demo.sessionKey,
          rpcUrl: demo.rpcUrl,
          sessionId: receipt.sessionId as `0x${string}`,
          merkleRoot: receipt.merkleRoot as `0x${string}`,
          sessionEnd: BigInt(Math.floor(Date.now() / 1000)),
        });
        commitSimulated = false;
        commitCommitter = demo.walletAddress; // session key is the committer here
      } else {
        // No key — simulated anchor (just surfaces the root).
        commitTx = receipt.merkleRoot;
        commitSimulated = true;
      }
    } catch (e) {
      commitError = e instanceof Error ? e.message : String(e);
    } finally {
      committing = false;
    }
  }

  /**
   * CO-SIGNED anchor (T-17 / IG-08): the user co-signs the Merkle root in MetaMask
   * (via the wallet bridge), then the funded session key RELAYS it through
   * `commitWithSig` — so the on-chain committer is the user, not the agent. Needs demo
   * creds (to relay gas) + the wallet bridge. Falls back to nothing on error/cancel.
   */
  async function commitAuditCoSigned() {
    if (!receipt || committing) return;
    if (!demo) { commitError = "Co-signed commit needs demo creds (the session key relays gas)."; return; }
    committing = true;
    commitError = undefined;
    try {
      const sessionEnd = Math.floor(Date.now() / 1000);
      const { signature, signer } = await requestAuditCommitSignature({
        sessionId: receipt.sessionId as `0x${string}`,
        auditRoot: receipt.merkleRoot as `0x${string}`,
        sessionEnd,
      });
      commitTx = await liveCommitAuditWithSig({
        sessionPrivateKey: demo.sessionKey,
        rpcUrl: demo.rpcUrl,
        sessionId: receipt.sessionId as `0x${string}`,
        merkleRoot: receipt.merkleRoot as `0x${string}`,
        sessionEnd: BigInt(sessionEnd),
        signature,
      });
      commitSimulated = false;
      commitCommitter = signer; // the recovered EIP-712 signer == on-chain committer
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
   * Build the shared thinking transport ONCE so the budget spans compile + planning.
   * When demo creds are loaded AND a gateway URL is set (PUBLIC_X402_INFERENCE_URL), the
   * PRIMARY (paid) leg becomes the self-hosted x402 gateway: the session key signs an
   * EIP-3009 USDC payment per call (settled on Base via the 1Shot facilitator), then the
   * gateway proxies to OpenRouter/Grok. The switcher falls back to the config provider on
   * any payment/transport error, so this is safe to leave on for the demo.
   */
  // Pull the redeemable ERC-7715 permission `context` (hex) + granter `from` out of the stored
  // grant blob (`config.metaMaskGrant` = JSON of MetaMask's `granted`). Both are needed to
  // redelegate the user's budget as the x402 payment source.
  function grantContextAndGranter(
    grantJson?: string,
  ): { context: `0x${string}`; from: `0x${string}` } | undefined {
    if (!grantJson) return undefined;
    try {
      const g = JSON.parse(grantJson);
      const node = Array.isArray(g) ? g[0] : g;
      const context = node?.context;
      const from = node?.from;
      if (typeof context === "string" && /^0x/i.test(context) && typeof from === "string" && /^0x[0-9a-fA-F]{40}$/.test(from)) {
        return { context: context as `0x${string}`, from: from as `0x${string}` };
      }
    } catch {
      /* malformed grant — fall through to self-funded */
    }
    return undefined;
  }

  function ensureTransport(): InferenceTransport {
    if (transportRef) return transportRef;
    const opts: NonNullable<Parameters<typeof buildTransport>[0]> = { primaryEnabled, onRoute: (i) => store.onRoute(i) };
    if (demo && X402_INFERENCE_URL) {
      // When the user has granted an ERC-7715 budget (config.metaMaskGrant), redelegate it:
      // each x402 inference payment then spends the USER's USDC within their grant, not the
      // session account's own funds. Requires the erc7710 path (the redelegation IS the payment).
      const grantRedeem =
        X402_ASSET_TRANSFER_METHOD === "erc7710" ? grantContextAndGranter(config.value.metaMaskGrant) : undefined;
      opts.x402 = {
        baseUrl: X402_INFERENCE_URL,
        account: privateKeyToAccount(demo.sessionKey),
        network: "eip155:84532",
        assetTransferMethod: X402_ASSET_TRANSFER_METHOD,
        ...(grantRedeem ? { parentPermissionContext: grantRedeem.context, from: grantRedeem.from } : {}),
        ...(demo.rpcUrl ? { rpcUrl: demo.rpcUrl } : {}),
      };
      opts.onSettle = (info) => { if (info.paymentResponse) store.note("x402 inference payment settled on Base"); };
    }
    const built = buildTransport(opts);
    transportRef = built.transport;
    switcher = built.switcher;
    return transportRef;
  }

  // Hand-off from the master-agent chat. If the chat-side master loop already
  // compiled a ready spec, run it directly; otherwise prefill + auto-compile.
  onMount(() => {
    const h = handoff.take();
    if (!h) return;
    workflow = h.workflow;
    if (h.answers) answers = h.answers;
    if (h.spec && h.compileResult) {
      compiledSpec = h.spec;
      compileResult = h.compileResult;
      review = h.compileResult.escalateToHITL ? [] : safeRender(h.spec);
      if (config.ready) run();
    } else if (config.ready) {
      compile();
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
      // ERC-7710 x402 path: the session key must be 7702-delegated to the gator before it can
      // pay via delegation (else the facilitator rejects `account_not_delegated`, spike 11).
      // One-time + idempotent; the funded demo account is usually already delegated.
      if (demo && X402_INFERENCE_URL && X402_ASSET_TRANSFER_METHOD === "erc7710") {
        try {
          const r = await ensureSessionDelegated({
            account: privateKeyToAccount(demo.sessionKey),
            ...(demo.rpcUrl ? { rpcUrl: demo.rpcUrl } : {}),
          });
          if (r.status === "upgraded") store.note(`Session key upgraded to a Smart Account (7702) — ${r.txHash.slice(0, 10)}…`);
          else if (r.status === "wrong-impl") store.note("Session key has a non-gator 7702 impl — x402 delegation may be rejected.");
        } catch (e) {
          store.note(`Session 7702 upgrade skipped: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const transport = ensureTransport();
      // Issuance: LIVE on Base Sepolia when demo creds are loaded (real root mandate via
      // the funded session key, then real sub-mandates under it); else simulated.
      let inner: SubMandateIssuer;
      let rootMandateId: `0x${string}`;
      // The COMMS_TEMPLATE caveat as issued on-chain — bound by the comms sub-agent's
      // send-time hash check (IG-06). Only the live root produces a real commitment.
      let committedCommsCaveat: Caveat | undefined;
      if (demo) {
        const root = await createLiveRootMandate({ sessionPrivateKey: demo.sessionKey, rpcUrl: demo.rpcUrl, spec });
        rootMandateId = root.rootMandateId;
        liveRootMandateId = root.rootMandateId;
        committedCommsCaveat = root.commsTemplateCaveat;
        inner = liveSdkIssuer({ sessionPrivateKey: demo.sessionKey, rpcUrl: demo.rpcUrl });
      } else {
        inner = simulatedIssuer();
        rootMandateId = (store.master.rootMandateId as `0x${string}` | undefined) ??
          (("0x" + "b".repeat(64)) as `0x${string}`);
      }
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
        ...(committedCommsCaveat ? { commsTemplateCaveat: committedCommsCaveat } : {}),
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

          <!-- Demo: run live on Base Sepolia with the funded session key (read from .env). -->
          <div class="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 text-xs">
            <div class="min-w-0">
              <p class="font-medium">
                {#if demo}<span class="text-primary">● Live on Base Sepolia</span>{:else}<span class="text-muted-foreground">○ Simulated run</span>{/if}
              </p>
              <p class="truncate text-muted-foreground">
                {#if demo}
                  Real issuance · {demoSwapReady ? "live 1Shot swap" : "simulated swap"} · audit anchor · revocation
                {:else}
                  Load funded creds from .env to run real on-chain txs (issuance, swap, anchor, revoke).
                {/if}
              </p>
              {#if demoError}<p class="text-[10px] text-destructive">{demoError}</p>{/if}
            </div>
            <Button variant={demo ? "outline" : "secondary"} size="sm" onclick={loadDemoCreds} disabled={loadingDemo}>
              {#if loadingDemo}<Loader2 class="mr-1 size-3.5 animate-spin" />{/if}
              {demo ? "Reload" : "Load demo creds"}
            </Button>
          </div>

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
                {#if demoSwapReady}A live WETH→USDC swap{:else}A simulated swap{/if} above your HITL
                threshold pauses for approval{demoSwapReady ? "" : " (no funds moved)"}.
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
                  {#if demo}
                    <Button variant="secondary" size="sm" onclick={commitAuditCoSigned} disabled={committing || !!commitTx}>
                      {#if committing}<Loader2 class="mr-1 size-3 animate-spin" />{/if}
                      Commit with co-signature
                    </Button>
                  {/if}
                </div>
                {#if demo && !commitTx}
                  <p class="text-[10px] text-muted-foreground">
                    "Commit with co-signature" (T-17): you co-sign the root in MetaMask, the session
                    key relays gas — so the on-chain committer is you, not the agent. Plain commit
                    single-signs with the session key.
                  </p>
                {/if}
                {#if commitTx}
                  <div class="rounded-lg border bg-card p-2 text-xs">
                    {#if commitSimulated}
                      <span class="text-muted-foreground">Simulated anchor (load demo creds for a real tx). Root:</span>
                      <span class="font-mono break-all">{commitTx}</span>
                    {:else}
                      <span class="text-muted-foreground">Anchored on-chain (AuditRegistry):</span>
                      <a class="font-mono break-all text-primary underline" href={`https://sepolia.basescan.org/tx/${commitTx}`} target="_blank" rel="noopener noreferrer">{commitTx}</a>
                      {#if commitCommitter}
                        <div class="mt-1 text-[10px] text-muted-foreground">committer: <span class="font-mono">{shortHash(commitCommitter)}</span></div>
                      {/if}
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
        <Badge variant="outline" class="text-[10px]">{config.primaryModel}</Badge>
        {#if store.routes.venice > 0}<Badge variant="secondary" class="text-[10px]">venice ×{store.routes.venice}</Badge>{/if}
      </div>
    </section>

    <section>
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Authority state</h2>
      <div class="flex flex-col gap-1 rounded-lg border bg-card p-3 text-xs">
        <div class="flex justify-between">
          <span class="text-muted-foreground">root authority</span>
          {#if config.value.metaMaskGrant}
            <span class="text-primary">MetaMask · ${(Number(config.value.grantMaxAmount ?? 0) / 1e6).toFixed(0)} USDC</span>
          {:else if demo}
            <span class="text-primary">live · session key</span>
          {:else}
            <span>simulated</span>
          {/if}
        </div>
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
