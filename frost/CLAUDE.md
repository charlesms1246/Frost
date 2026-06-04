# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Frost is a Tauri 2 desktop application with a SvelteKit + TypeScript frontend. Currently scaffolded from the official Tauri+SvelteKit+TS template (a single `greet` Rust command wired to a Svelte page) — there is no project-specific business logic yet.

## Commands

All commands are run from the repo root (`D:\Frost\frost`).

- `npm run tauri dev` — run the full desktop app (starts Vite dev server on port 1420, then launches the Tauri shell). This is the primary dev loop.
- `npm run dev` — run the SvelteKit frontend only in the browser.
- `npm run tauri build` — produce a release desktop bundle.
- `npm run build` — build the frontend only (output goes to `build/`, consumed by Tauri via `frontendDist: "../build"`).
- `npm run check` — type-check Svelte + TypeScript (`svelte-kit sync && svelte-check`). Use `check:watch` for the watching variant.
- Rust side: `cargo check` / `cargo build` / `cargo test` from inside `src-tauri/`.
- `npm test` — vitest (config `vitest.config.ts`, `$lib` aliased). Currently runs the
  embedding e2e (`src/lib/agent/session.e2e.test.ts`): every boundary mocked, no GUI.

## Architecture

Two halves communicate over Tauri's IPC bridge:

- **Frontend** (`src/`): SvelteKit in SPA mode. `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: "index.html"` because Tauri has no Node SSR runtime. Routes live in `src/routes/`. Svelte 5 runes (`$state`, etc.) are in use.
- **Backend** (`src-tauri/`): Rust crate named `frost_lib` (the `_lib` suffix is intentional — see comment in `Cargo.toml`; it avoids a Windows-only bin/lib name collision). `src/lib.rs` defines `#[tauri::command]` handlers and registers them via `invoke_handler(tauri::generate_handler![...])` in `run()`. `src/main.rs` just calls `frost_lib::run()`.

To add a new IPC command: define a `#[tauri::command] fn ...` in `src-tauri/src/lib.rs`, add it to the `generate_handler!` macro list, then call it from Svelte with `invoke("name", { args })` from `@tauri-apps/api/core`.

## Agent embedding (webview)

The `@frost/agent` runtime is embedded **in the webview** (no sidecar) — `frost` depends
on it via `file:../agent`. Import from **`@frost/agent/browser`** (NOT the default barrel):
the browser barrel excludes the two Node-only 1Shot-SDK modules so `@1shotapi/client-sdk`
never enters the Vite bundle. The default `@frost/agent` barrel would break `vite build`.

- `src/lib/agent/session.ts` — `createEmbeddedSession(opts)` wires a `Session` from webview
  seams (OpenRouter/Venice/Discord over `fetch`). The CHAIN-WRITE seams (`issue`,
  `provisionHolder`) are injected and NOT live — gated on the wallet bridge + approval.
- `src/lib/agent/holders.ts` — `eoaProvisioner(keyStore)` (live, mints EOAs into the Rust
  key store) + `simulatedIssuer()` (no chain).
- `src/lib/agent/live.ts` — the LIVE chain-write path (PROVEN on Base Sepolia):
  `createLiveRootMandate({ spec })` issues a real root mandate (§10.1; caveats =
  `capabilityWhitelist([REDELEGATE,…])` + `encodeRootCaveats(spec)` — the whitelist is
  REQUIRED, `encodeRootCaveats` omits capabilities), and `liveSdkIssuer({ sessionPrivateKey,
  rpcUrl })` issues sub-mandates (§10.2). **Duplicate-viem gotcha:** frost, `@frost/agent`,
  and `@frost/sdk` each resolve their own `node_modules/viem` (file: links), so viem client
  types are nominally distinct — pass frost-built `WalletClient`/`PublicClient` into SDK
  functions via `as never` (structurally identical; the Vite build + live test confirm runtime).
- `src/lib/agent/executor-runner.ts` — `makeExecutorRunner(opts)`: the executor's live WRITE
  path. Runs the §10.3 preflight against the session CALLABLE_SURFACE, then submits via 1Shot's
  REST relay (`OneShotRestMethods`, webview-native — no Node SDK). Opt-in via the `executor?`
  option on `createEmbeddedSession`; needs a pre-registered 1Shot `contractMethodId` + funded
  server wallet (not yet exposed in the route — pending that one-time 1Shot setup).
- `src/routes/agent/+page.svelte` — the original debug surface: run one planning cycle. A
  **session key field toggles LIVE issuance** (empty ⇒ simulated; a funded Base Sepolia key ⇒
  real root + sub mandates, shown with their tx hashes).
- `src/routes/dashboard/+page.svelte` — the **demo dashboard** (3-column terminal shell). LEFT
  task queue, CENTER tabs [Setup | Tree | Activity | Receipt], RIGHT AI-stats + authority-state
  telemetry. Driven by `AgentSessionStore` (`src/lib/stores/agent-session.svelte.ts`), which
  consumes the agent `SessionEvent` spine (`createEmbeddedSession({ observer })`) + inference
  `RouteInfo` (`onInferenceRoute`) so the delegation tree grows live. Auto-focuses the Tree tab
  during a run. Setup exposes the **Venice paid-inference budget guard** (`veniceInferenceApiKey`
  + `primaryCallBudget` + an ON/OFF kill switch via `inferenceSwitch.setPrimaryEnabled`): first
  N calls settle through Venice (x402), then auto-fall back to OpenRouter so the ~100-credit
  Venice balance is never overspent. Tree/Activity components live in
  `src/lib/components/dashboard/`. The **Setup tab compiles** the NL workflow via the agent
  `Compiler` and shows the byte-tied `renderSpec` review ("You are authorizing…", I-16) plus
  warnings / assumptions / answerable clarifications before Run. The compile + planning calls
  share ONE transport (`ensureTransport()` → `createEmbeddedSession({ inferenceTransport })`)
  so the Venice budget spans both. The **HITL gate** (`HitlGate.svelte`, store `awaitApproval`/
  `resolveHitl`) pauses a spawned executor whose action trips HITL_THRESHOLD: the executor's
  `requestApproval` seam resolves on the user's Approve/Reject. The Setup "Executor & HITL" card
  toggles a `makeSimulatedExecutorRunner` (real preflight, simulated submit — no funds) and has a
  "Test HITL gate" button to drive the gate deterministically. **Revocation** (demo moment 3,
  `src/lib/agent/revocation.ts`): the master node's "Revoke spawning" button calls `liveRevoke`
  (on-chain `Revocation.revoke` when a session key is set, else simulated); `run()` wraps the issuer
  with `revocableIssuer` so post-revocation spawns fail (the cascade) and the tree greys the master.
  `store.beginCycle()` preserves revocation across cycles; the left "New" button (`newSession()`)
  is a full reset. The **Receipt tab** (closing shot, §10.8) renders a live bytes32 Merkle root
  over the session audit trail via the agent runtime's `buildReceipt(store.receiptInput)`
  (`agent/src/audit/receipt.ts`), with an audit-entry table (per-leaf hashes) and a downloadable
  proof-bearing JSON. The Merkle is commutative/sorted-pair (OZ-style) so any entry's inclusion is
  verifiable (`merkleProof`/`verifyMerkleProof`). NOTE: the **on-chain anchor is not built** — no
  audit/commitment contract is deployed; the root is surfaced "ready to commit," not anchored.

Keys: `D:\Frost\.env` (copied from `spikes/.env`, gitignored) holds OpenRouter/Venice/1Shot creds
and the funded `BASE_SEPOLIA_PK` for live runs.

Testing `.svelte.ts` rune modules (e.g. the dashboard store): `vitest.config.ts` registers the
`svelte()` plugin + `conditions: ["browser"]` so `$state`/`$derived` compile under vitest.

After editing `agent/src`, run its `npm run build` so `dist/browser.js` is fresh before the
webview picks it up.

## Capabilities & permissions

`src-tauri/capabilities/default.json` is the allowlist for what the main window can do. Currently only `core:default` and `opener:default` (from `tauri-plugin-opener`) are granted. New Tauri APIs / plugins must be added here or IPC calls from the frontend will be rejected at runtime.

## Tauri config notes

- `tauri.conf.json` pins `devUrl` to `http://localhost:1420` — `vite.config.js` must keep serving on that port for `tauri dev` to attach.
- `frontendDist` is `../build`, matching `adapter-static`'s default output.
- Bundle identifier is `app.vercel.port42`.
