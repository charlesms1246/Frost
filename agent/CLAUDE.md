# CLAUDE.md

Guidance for the `agent/` package — the Frost master-agent runtime.

## What this is

The TypeScript runtime that drives Frost's master agent: it decides, at runtime,
which specialist sub-agents to spawn for a workflow. This is the **Day-14
checkpoint surface** — the single non-negotiable build item per HANDOFF (general
LLM-driven planning, no pattern-matched fallback).

Built as a standalone Node package (like `sdk/`) so the planning logic is
unit-testable in isolation. It will later be embedded into the Tauri app as a
sidecar or webview bundle — that embedding decision (HANDOFF "Build conventions")
is deferred; nothing here depends on it.

## Commands

From `D:\Frost\agent\`:

- `npm test` — run the vitest suite (`node node_modules/vitest/vitest.mjs run` if
  the `.bin` shims aren't resolving under git bash on Windows).
- `npm run typecheck` — `tsc --noEmit` (use `node node_modules/typescript/bin/tsc`
  if `npx tsc` resolves to the wrong binary).
- `npm run build` — emit `dist/`.
- `npm run test:integration` — the on-chain suite (anvil fork of Base Sepolia).
  `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts`.
  Needs foundry's `anvil` and network access; reads `BASE_SEPOLIA_HTTP` from
  `../spikes/.env`. Takes ~40s (real txs against the fork).
- `npm run test:live` — external-API smoke tests (1Shot, later OpenRouter). Each
  test self-skips when its creds are absent in `../spikes/.env`.

**Three vitest configs.** `vitest.config.ts` (default) — **pure unit tests**, no
anvil, no network, LLM mocked; EXCLUDES `*.integration.test.ts` and
`*.live.test.ts`. `vitest.integration.config.ts` — only `*.integration.test.ts`,
with `test/global-setup.ts` (spawns/kills anvil) + `test/fixtures.ts` (mirrors
`sdk/test/fixtures.ts`); LLM still mocked, only the chain is real.
`vitest.live.config.ts` — only `*.live.test.ts`, no setup; hits real external APIs
when creds exist, skips otherwise.

## Layout

- `src/inference/openrouter.ts` — `OpenRouterClient implements InferenceTransport`.
  OpenRouter is the locked inference provider (HANDOFF, flipped 2026-05-28). The
  planner depends only on the `InferenceTransport` interface; `fetch` is injectable
  so the client is testable without a live network. **Do not route the thinking
  path through Venice** — Venice stays read-side RPC + the x402-paid demo path.
- `src/planner/prompt.ts` — the versioned planning prompt (`PLANNING_PROMPT_VERSION`,
  recorded in every `PlanningEntry`) + `parsePlannerOutput` (tolerant, never throws —
  returns `null` so the planner can escalate).
- `src/planner/planner.ts` — the planning loop. **The LLM proposes; the runtime
  disposes.** `Planner.plan` re-validates every candidate against the signed
  `CAP_REDELEGATE` bounds (§2.6) and the unified rate-limit bucket (§2.4) before
  approving it. The `Mandate` contract enforces the same bounds at issuance — this
  is the off-chain half of a two-layer guard, never the sole one.
- `src/translate/translate.ts` — the plan→action layer. `translatePlan` issues a
  plan's **runtime-approved** decisions on-chain (only `plan.approved`, never the
  raw LLM list), sequentially, and writes `spawnedSubMandateIds` back into the
  §10.7 entry. The on-chain call (`mandate.issueSubMandate`) and the
  ProposedCaveats→`Caveat[]` encoding are both **injected seams**
  (`SubMandateIssuer`, `CaveatEncoder`) so orchestration is testable without viem
  clients and the encoder can be built independently. `makeSdkIssuer` wires the
  real SDK call; `nonceCounter` is a monotonic nonce source.
- `src/translate/caveat-encoder.ts` — `encodeProposedCaveats` (the `CaveatEncoder`
  seam, also exported as `defaultCaveatEncoder`). Maps `ProposedCaveats` → on-chain
  `Caveat[]` via the SDK builders. Does NOT pre-intersect against the parent (the
  contract does, §2.5); throws on malformed input (unknown/empty capability,
  negative amount, out-of-range slippage, bad address/selector) so `translatePlan`
  records a `failed` outcome instead of issuing a meaningless sub-mandate. Covers
  every `ProposedCaveats` field, including the structural ones (TTL_EXPIRY,
  PROVIDER_WHITELIST, CALLABLE_SURFACE, COMMS_TEMPLATE).
- `src/orchestrate/enrich.ts` — sub-agent orchestration. `enrichDecision(d, ctx)`
  (pure) + `makeEnricher(ctx)` stamp the role-appropriate STRUCTURAL caveats onto
  an approved decision from the `SessionContext` (the signed spec + deployment
  config), keyed by CAPABILITY: TTL_EXPIRY for all, CALLABLE_SURFACE for
  `CAP_ONCHAIN_EXECUTION`, COMMS_TEMPLATE for `CAP_COMMS_POST`, PROVIDER_WHITELIST
  for x402-spending caps (`CAP_INFERENCE_CALL`/`CAP_RPC_READ`). Runtime values are
  authoritative (overwrite anything on the decision — the LLM never reaches
  issuance with an address). Wired into `translatePlan` via the optional `enrich`
  seam, applied inside the per-decision try/catch (a misconfigured spawn fails just
  itself). **The LLM proposes intent; this layer disposes the structure.**
- `src/orchestrate/session-context.ts` — `sessionContextFrom(spec, config)` assembles
  the enricher's `SessionContext` from the SIGNED `CompiledSpec` (expiry, comms
  template) + a `DeploymentConfig` (approved providers, DEX-router call surface). The
  thin adapter between the compiler's output and the orchestrator's input.
- `src/orchestrate/deployment.ts` — the REAL Base `DeploymentConfig`
  (`BASE_SEPOLIA_DEPLOYMENT`, `deploymentConfigFor(chainId)`). CALLABLE_SURFACE =
  Uniswap v3 SwapRouter02 (`exactInputSingle`/`exactInput`); **selectors are derived
  from signatures via `toFunctionSelector`, never hand-typed 4-byte literals** (H-15).
  `maxValue` (`DEFAULT_PER_CALL_CAP_USDC`) is a structural per-call backstop, not the
  user's cap. `approvedProviders` (`BASE_SEPOLIA_PROVIDERS`) mirrors the on-chain
  ProviderRegistry's seeded **placeholder** addresses verbatim — swap them in lockstep
  with the registry when real Venice addresses land. These are deployment facts the LLM
  must never supply. **Confirm the Sepolia router on BaseScan before live settlement**
  (ERRORS.MD).
- `src/session/` — the **session-loop conductor** that ties the runtime together for one
  trigger. `session.ts` `Session.runCycle(trigger)`: PLAN (`Planner.plan` vs current
  authority state; escalation leaves state intact, T-35) → enrich+ISSUE (`translatePlan` +
  `makeEnricher`) → **advance authority state by what was actually issued** (the cumulative
  redelegation count/budget + rate-limit bucket the planner re-reads each cycle — the glue
  no single brick owned) → DISPATCH each issued sub-agent to an injected per-behavior
  `SubAgentRunner`. `dispatch.ts` `resolveBehavior(role, registry?)` routes a role to its
  behavior (custom agents via the registry, built-ins by label prefix). All seams injected;
  whole cycle is offline-testable. Remaining: real runners driving the built-in runtimes
  with live event data, behind the existing seams.
- `src/agents/` — **user-created custom agents** (design note: `custom-agents.md`). A
  custom agent is a reusable `SpawnCandidate` template, so it reuses the whole
  planner→translate→enrich pipeline. `definition.ts` — `CustomAgentDefinition` +
  `validateDefinition` + `toSpawnCandidate` (structural caveats NOT set here — the enricher
  stamps them; the definition is intent-level and carries no addresses) + in-memory
  `CustomAgentRegistry`. `designer.ts` — `AgentDesigner.design(nl)`, the **agent that
  creates agents** (decision: agent-driven creation, not a form). Same propose/dispose
  discipline as `compile/compiler.ts`: drops unknown caps, strips CAP_REDELEGATE (a
  specialist is a leaf), guarantees the behavior's required capability, paranoid spend
  default, escalates to HITL on bad output. `prompt.ts` fences the request (T-24),
  versioned. **Arbitrary user-CODE agents are deferred to Phase 2** (need sandboxing).
- `src/comms/` — the comms sub-agent runtime (§10.4; threats **T-25 / I-15**, hotspot
  **H-14**). `comms.ts` `CommsAgent.post(mandate, req)`: (1) BINDING — require
  `keccak256(canonicalCommsJson(req.template)) === ` the mandate's on-chain
  COMMS_TEMPLATE `templateHash` (a tampered off-chain template, e.g. relabeling
  untrusted→trusted, is rejected); (2) resolve+escape each declared var; (3) render
  `${name}` (undeclared placeholder rejected; >2000 chars rejected); (4) post via the
  `CommsPoster` seam. `escape.ts` is the security core (pure): `escapeForSource` ENFORCES
  the declared variable type (trusted typed sources must match shape or are rejected,
  H-14; `untrusted-text`/`internal` are escaped to inert Discord text — control/zero-width
  stripped by code point, markdown + mention delimiters backslash-escaped, length-capped).
  `discord.ts` `DiscordWebhookPoster` ALWAYS sends `allowed_mentions: { parse: [] }` (the
  authoritative no-ping guarantee backing the escaping); webhook URL is a secret (T-27).
  **The LLM proposes the template at compile time; the runtime renders exactly that signed
  template — never free-form text.**
- `src/monitor/` — the monitor sub-agent runtime (read path; threat **T-23**). `monitor.ts`
  `Monitor.check(condition)` is the **multi-confirmation gate**: read head, compute
  `confirmedBlock = head − confirmations` (default **3** on Base), evaluate the condition
  pinned to that confirmed block in one batch. A tip-block manipulation (the T-23 attack)
  is invisible until N-deep. Result `fired | not_met | pending | error`; any unreadable
  read → `error`, never a fire (never act on unverified data). Stateless/idempotent —
  latching + rate-limiting are the caller's / rate-limit-caveat's job. `MonitorCondition`
  is pluggable like the pricer's `QuoteSource` (`buildCalls(block)` pins to the confirmed
  block, NOT "latest"; `evaluate` throws on undecodable → error). Reuses the batched
  `RpcTransport` (Venice read path, §7.4). `conditions/price-threshold.ts` is the canonical
  T-23 example on Uniswap v3 QuoterV2 (reuses `QUOTER_V2_ABI`, now exported from
  `pricer/sources/uniswap-v3.ts`); TWAP-window conditions are the compilation-side T-23
  complement and a richer source for later.
- `src/executor/` — the executor sub-agent runtime (on-chain write path). `preflight.ts`
  `preflightExecution(caveats, proposed)` is the PURE contract-architecture **§10.3**
  pre-submission safety boundary (the off-chain half of a two-layer guard; the contract
  enforces the same caveats): decision `submit | reject | hitl`. Enforces CALLABLE_SURFACE
  (no surface ⇒ reject; target+selector match; value ≤ maxValue), SLIPPAGE_TOLERANCE
  (uint16), MAX_GAS_PRICE (**uint64**), and HITL_THRESHOLD (uint256, checked last — a hard
  reject beats a HITL pause). **T-32 posture:** a signed slippage/gas caveat with an
  undeclared value REJECTS, never submits blind. `submitter.ts` is the
  `TransactionSubmitter` seam — `OnchainCall` (`contractMethodId` + named `params`, 1Shot's
  real method-registry primitive, NOT raw calldata) → `SubmittedTx`. `executor.ts`
  `Executor.execute(mandate, req)` orchestrates §10.3: optional `RevocationGuard` (revoked
  OR failed read ⇒ `aborted`) → preflight → private-mempool submit (relay throw ⇒
  `failed`). `oneshot-submitter.ts` `OneShotTransactionSubmitter` maps an `OnchainCall` to
  `execute(methodId, params, {walletId, value, memo})` (threat T-21); **browser-safe**
  (interface-only, no SDK → lives in `browser.ts`). `oneshot-rest.ts` `OneShotRestMethods`
  implements that interface via the 1Shot REST API directly (OAuth2 `POST /token` →
  `POST /methods/{id}/execute`, shapes lifted from the SDK's `dist/client.js`) — no
  `@1shotapi/client-sdk`, so the executor submit runs in the webview. Only `wallet/oneshot.ts`
  is truly Node-only. **Live submit needs a registered 1Shot method + funded server wallet**
  (real write — explicit approval only).
  Everything outward is a seam; fully offline-testable. **The LLM proposes, the runtime
  disposes** — the validated (target, selector) are facts about the call that executes,
  matched against the signed allow-list.
- `src/pricer/` — the pricer sub-agent runtime (Venice read path). `venice-rpc.ts`
  `VeniceRpcClient implements RpcTransport` — batched JSON-RPC (one POST per batch;
  spike 2: a batch of N counts as ONE Venice request — this is mandatory, not an
  optimization), injectable `fetch`, surfaces 429. `pricer.ts` `Pricer.quote(req,
  sources)` sends exactly one batch for N `QuoteSource`s, ranks by `amountOut`,
  isolates per-source failures. `sources/uniswap-v3.ts` `uniswapV3Source({quoter,
  fee})` — real QuoterV2 `eth_call`. Aggregators (1inch/Paraswap) don't fit a pure-RPC
  batch (off-chain routing) — `QuoteSource` is pluggable for API-backed sources later.
  Venice here is the RETAINED read path ONLY — never the thinking path (OpenRouter)
  or write path (1Shot).
- `src/wallet/key-store.ts` — `KeyStore` interface (mirrors the Tauri Rust
  `key_store_*` commands) + `InMemoryKeyStore` for tests.
- `src/wallet/provisioner.ts` — `WalletProvisioner`, whose `provisionHolder` is the
  `HolderProvisioner` seam `translatePlan` takes. Routes per role: executor → 1Shot
  server wallet (`ServerWalletProvider`, injected); everyone else → a fresh
  in-process EOA (`viem` `generatePrivateKey`) whose key is stored in the injected
  `KeyStore`. Records a `WalletHandle` per address; `signerFor(address)` recovers
  the EOA signer post-issuance.
- `src/wallet/oneshot.ts` — `OneShotServerWalletProvider implements
  ServerWalletProvider`, wrapping the official `@1shotapi/client-sdk`. Auth is
  `{ apiKey, apiSecret }` (Auth0 client-credentials; token fetched lazily, no
  network at construction); `businessId` + `chainId` (default Base Sepolia) scope
  `wallets.create(businessId, { chainId, name })`, mapping `Wallet.accountAddress`
  →`address` and `Wallet.id`→`walletId`. SDK client injectable for offline unit
  tests. `oneShotProviderFromEnv` reads `ONESHOT_API_KEY`/`_SECRET`/`_BUSINESS_ID`/
  `_API_BASE`. `verify()` does a read-only `wallets.list` (creates nothing).
- `src/compile/` — the compilation pipeline (NL workflow → signable session
  authority), the layer in FRONT of the planner. Like the planner, **the LLM
  proposes, the runtime disposes.** `compiler.ts` (`Compiler.compile`) calls the
  `InferenceTransport` (OpenRouter, NOT Venice), then deterministic code applies
  `defaults.ts` `PARANOID_DEFAULTS` (a missing field never becomes unlimited
  authority — T-24/T-32), collects clarifications for model-flagged missing
  fields, validates the comms template (untrusted-text → opt-in clarification,
  T-25/I-15), and flags high-risk shapes (T-24). Bad model output escalates to
  HITL, never throws (T-30/T-35). `encode.ts` (`encodeRootCaveats`) is the
  canonical signed `Caveat[]` (SDK builders); `render.ts` (`renderCaveats`)
  produces the plain-language review copy by **decoding those same bytes** — the
  display is provably a function of the signed encoding, not a parallel string
  (I-16). `prompt.ts` fences the untrusted user description (T-24) and is versioned
  (`COMPILE_PROMPT_VERSION`). The on-chain *issuance* of the root mandate is the
  deferred seam (`encodeRootCaveats` is its input).
- `src/types.ts` — `TaskSpec`, `SpawnCandidate`/`SpawnDecision`, `PlanningEntry`
  (matches contract-architecture §10.7 verbatim), `PlanResult`.
- `test/spawn-flow.integration.test.ts` — the full stack: mocked-LLM planning →
  `translatePlan` → real `issueSubMandate` on a forked deployment, with a real
  `WalletProvisioner` minting the EOA holders. Verifies each sub-mandate on-chain.

## Conventions / invariants to preserve

- **Never trust the LLM's arithmetic.** Bounds and bucket checks live in
  `guardReject`, applied greedily in candidate order. Over-budget / over-count /
  bucket-exhausted candidates are recorded as `rejected` with a reason, not
  silently dropped.
- **Escalate, don't guess (T-35).** Unparseable output, a failed inference call,
  an invalid amount, the model asking to escalate, OR every candidate blocked by
  the bounds → `escalateToHITL: true`. The planner never throws on bad model
  output; the caller surfaces a HITL prompt.
- **Caveats here are high-level (`ProposedCaveats`), not ABI-encoded.** Encoding to
  on-chain caveats and calling `issueSubMandate` is the job of the next brick (the
  plan→action translation layer) using `@frost/sdk`'s `mandate` helpers. The
  planner stops at the decision; `PlanningEntry.spawnedSubMandateIds` is filled by
  that layer after issuance.
- `@frost/sdk` is a `file:../sdk` dependency and must be built (`npm run build` in
  `sdk/`) for its `dist/` to resolve. The planner reuses the SDK's `CAPABILITY`
  vocabulary so the role/capability names stay single-sourced.
- Same tsconfig as `sdk/`: strict, `verbatimModuleSyntax`, `.js` extensions on
  relative imports, `exactOptionalPropertyTypes` (set optional fields
  conditionally, never `field: undefined`).

## What's NOT here yet

- ~~Richer caveats in `ProposedCaveats`~~ — DONE 2026-06-02. `ProposedCaveats` now
  carries `ttlExpiry`, `providerWhitelist`, `callableSurface` (executor), and
  `commsTemplate` (comms) alongside the spend caps/HITL/slippage, and
  `encodeProposedCaveats` has a validated branch for each (reusing
  `compile/encode.ts`'s `encodeCommsTemplate` for the comms hash binding). **These
  structural fields are runtime/compilation-supplied, NOT LLM-proposed** — the
  planner emits intent + spend caps; the LLM never invents on-chain addresses or
  selectors. The planner prompt is therefore unchanged. What remains is the
  sub-agent orchestration that *populates* these fields per role (Week 3).
- **1Shot live authorization** — RESOLVED 2026-06-02. The 403 on
  `wallets.list(businessId)` was a dashboard-side authz issue (business id / key
  permissions), fixed by the user. `npm run test:live` (oneshot) now passes —
  read-only `verify()` succeeds. `createServerWallet` is still unexercised against
  the live API (creates a real wallet); run only with explicit approval.
- **The Tauri-backed `KeyStore`** — the interface mirrors the Rust `key_store_*`
  commands, but the `invoke`-bridging implementation lives in the desktop app and
  isn't written here. Tests/integration use `InMemoryKeyStore`.
- ~~The compilation pipeline~~ — DONE 2026-06-02 (`src/compile/`, below). The
  on-chain root-mandate *issuance* (user signs → `mandate.issueMandate`) is the
  remaining seam, deferred like `translatePlan` was; `encodeRootCaveats` is its
  clean input.
- ~~Sub-agent capability implementations~~ — **ALL DONE** (Week 3, 2026-06-02/03):
  pricer (`src/pricer/`), executor (`src/executor/`, §10.3 preflight + 1Shot submit seam,
  live submit unexercised), monitor (`src/monitor/`, T-23 multi-confirmation gate), comms
  (`src/comms/`, T-25/I-15 template-binding + untrusted-text escaping + Discord webhook).
  What remains is integration: a runtime that wires planner → enricher → provisioner →
  translate → these four sub-agents into one session loop, and the live writes
  (1Shot submit, root-mandate issuance) — all currently behind seams.
- ~~Live OpenRouter wiring with a real key~~ — DONE 2026-06-02.
  `test/openrouter.live.test.ts` runs `Planner.plan` end-to-end against the real
  API (self-skips without creds). Covers BOTH OpenRouter (`OPENROUTER_MODEL`,
  default `openai/gpt-4o-mini`) and Groq (`GROQ_MODEL`, default
  `llama-3.3-70b-versatile`, hit via the OpenRouter client with a Groq baseUrl).
  Three scenarios per provider: a clear cross-DEX workflow (expects schema-valid
  JSON + proposed pricers, no escalation), an off-template request (expects
  escalation, not hallucinated sub-agents), and tight bounds (guard never exceeds
  `maxSubMandates`). Run: `npm run test:live`. Both models passed the Day-14
  prompt-quality bar.
