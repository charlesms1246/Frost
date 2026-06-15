"use client";

// /connect/grant-permissions/ — production UX.
//
// Reads the permission spec from `?params=` (URL-encoded JSON array produced by
// the Tauri permission_spec builders). Renders a human-readable preview, then
// — only on explicit user click — calls `wallet_requestExecutionPermissions`.
//
// If `?params=` is missing or malformed, the page reports the error rather
// than auto-submitting a default. (The earlier spike-8 fallback is gone;
// the Tauri caller is now expected to build a typed spec.)

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { baseSepolia } from "viem/chains";
import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
import { detectMetaMask, type MMDetection } from "../_lib/detect-mm";
import ConnectShell from "../_components/ConnectShell";

const BASE_SEPOLIA_CHAIN_HEX = "0x14a34"; // 84532

type ExpiryRule = { type: "expiry"; data: { timestamp: number } };
type Rule = ExpiryRule | { type: string; data: unknown };

type NativeStreamData = {
  amountPerSecond: string;
  maxAmount: string;
  initialAmount: string;
  startTime: number;
  justification: string;
};
type Erc20StreamData = NativeStreamData & { tokenAddress: string };

type PermissionRequest = {
  chainId: string;
  to: string;
  permission: {
    type: "native-token-stream" | "erc20-token-stream" | string;
    data: NativeStreamData | Erc20StreamData | Record<string, unknown>;
    isAdjustmentAllowed: boolean;
  };
  rules: Rule[];
};

type State =
  | { kind: "parsing" }
  | { kind: "spec-error"; message: string }
  | { kind: "waiting-mm"; spec: PermissionRequest[] }
  | { kind: "no-flask"; spec: PermissionRequest[]; detection: MMDetection }
  | { kind: "ready"; spec: PermissionRequest[]; detection: Extract<MMDetection, { kind: "flask-ok" }> }
  | { kind: "checking"; spec: PermissionRequest[] }
  | { kind: "requesting"; spec: PermissionRequest[] }
  | { kind: "posting"; granted: unknown }
  | { kind: "done"; granted: unknown; callbackStatus: number }
  | {
      kind: "snap-error";
      spec: PermissionRequest[];
      detection: Extract<MMDetection, { kind: "flask-ok" }>;
      raw: string;
    }
  | { kind: "error"; message: string };

function parseSpec(rawParams: string): PermissionRequest[] {
  if (!rawParams) throw new Error("missing ?params= — Tauri caller must supply a permission spec");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawParams);
  } catch (e) {
    throw new Error(`?params= is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("spec must be a non-empty array of permission requests");
  }
  for (const [i, req] of parsed.entries()) {
    if (!req || typeof req !== "object") throw new Error(`spec[${i}] is not an object`);
    const r = req as Record<string, unknown>;
    if (typeof r.chainId !== "string") throw new Error(`spec[${i}].chainId missing`);
    if (typeof r.to !== "string") throw new Error(`spec[${i}].to missing`);
    if (!r.permission || typeof r.permission !== "object") throw new Error(`spec[${i}].permission missing`);
    const p = r.permission as Record<string, unknown>;
    if (typeof p.type !== "string") throw new Error(`spec[${i}].permission.type missing`);
    if (!Array.isArray(r.rules)) throw new Error(`spec[${i}].rules must be an array`);
  }
  return parsed as PermissionRequest[];
}

/**
 * Map our Flask-13.32 raw spec (hex amounts, chainId hex, expiry-in-rules) to the
 * smart-accounts-kit `requestExecutionPermissions` input (bigint amounts, chainId
 * number, top-level expiry). Using the kit serializes the request the way the
 * installed MetaMask gator expects — the raw `provider.request` path was being
 * rejected with "cannot sign delegations for internal accounts".
 */
// Ensure a value is a lowercase 0x-prefixed hex address. A bare 40-char hex (no 0x) is the
// one input that trips the kit's "tokenAddress is not a valid hex value" validator.
function normalizeAddress(a: string): string {
  const hex = /^0x/i.test(a) ? a : `0x${a}`;
  return hex.toLowerCase();
}

// The ERC-7715 grant response carries bigint fields (echoed amounts). A plain JSON.stringify
// of it throws "Do not know how to serialize a BigInt", so every serialization (callback POST,
// logging) routes through this bigint→hex replacer.
function jsonBigIntSafe(obj: unknown): string {
  return JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v));
}

function specToKitRequest(req: PermissionRequest): Record<string, unknown> {
  const expiry = req.rules.find((r): r is ExpiryRule => r.type === "expiry");
  const raw = req.permission.data as Record<string, unknown>;
  const type = req.permission.type;
  const data: Record<string, unknown> = {};

  // Periodic types take periodAmount + periodDuration; stream types take
  // amountPerSecond + maxAmount + initialAmount. Every official MetaMask example uses
  // `erc20-token-periodic`, so we now support both shapes (this experiment tests whether
  // the installed wallet accepts periodic where it rejected stream).
  if (type === "erc20-token-periodic" || type === "native-token-periodic") {
    data.periodAmount = BigInt((raw.periodAmount as string) ?? "0x0");
    data.periodDuration = Number(raw.periodDuration ?? 0);
  } else {
    data.amountPerSecond = BigInt((raw.amountPerSecond as string) ?? "0x0");
    data.maxAmount = BigInt((raw.maxAmount as string) ?? "0x0");
    data.initialAmount = BigInt((raw.initialAmount as string) ?? "0x0");
  }
  // Normalize the token address: the kit's toHexOrThrow rejects a string that isn't
  // 0x-prefixed hex with "tokenAddress is not a valid hex value", so guarantee the 0x
  // prefix (a bare 40-char hex slips through otherwise) and lowercase it (case-insensitive
  // on-chain; sidesteps any downstream case-strict validator).
  if (raw.tokenAddress) data.tokenAddress = normalizeAddress(raw.tokenAddress as string);
  if (typeof raw.startTime === "number") data.startTime = raw.startTime;
  if (raw.justification) data.justification = raw.justification;
  return {
    chainId: Number(req.chainId),
    to: req.to,
    ...(expiry ? { expiry: expiry.data.timestamp } : {}),
    permission: {
      type,
      isAdjustmentAllowed: req.permission.isAdjustmentAllowed,
      data,
    },
  };
}

// EIP-7702 sets an account's code to a "designator": 0xef0100 ‖ <20-byte impl address>.
// A non-empty getCode only proves the account has SOME code — NOT that it's a MetaMask
// gator smart account. requestExecutionPermissions can only sign an ERC-7710 delegation
// when the code delegates to the framework's EIP7702StatelessDeleGatorImpl; against any
// other target (or a plain EOA) MetaMask refuses with "External signature requests cannot
// sign delegations for internal accounts". Pull the impl the account actually points at so
// we can tell the user precisely WHY a grant was refused instead of echoing the raw string.
function delegatedImpl(code: string | undefined): `0x${string}` | undefined {
  if (!code || !code.toLowerCase().startsWith("0xef0100") || code.length < 48) return undefined;
  return `0x${code.slice(8, 48)}` as `0x${string}`;
}

function expectedGatorImpl(): `0x${string}` | undefined {
  try {
    return getSmartAccountsEnvironment(baseSepolia.id).implementations
      .EIP7702StatelessDeleGatorImpl as `0x${string}`;
  } catch {
    return undefined;
  }
}

function shortHex(s: string, head = 6, tail = 4): string {
  if (!s.startsWith("0x") || s.length <= head + tail + 2) return s;
  return `${s.slice(0, head + 2)}…${s.slice(-tail)}`;
}

function formatDuration(secs: number): string {
  if (secs < 0) return "expired";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

function chainName(hex: string): string {
  if (hex === BASE_SEPOLIA_CHAIN_HEX) return "Base Sepolia";
  return `chain ${hex}`;
}

function PermissionPreview({ req, nowSecs }: { req: PermissionRequest; nowSecs: number | null }) {
  const expiry = req.rules.find((r): r is ExpiryRule => r.type === "expiry");
  const expirySecs = expiry && nowSecs !== null ? expiry.data.timestamp - nowSecs : null;
  const isErc20 = req.permission.type.startsWith("erc20-");
  const data = req.permission.data as Partial<Erc20StreamData> & {
    periodAmount?: string;
    periodDuration?: number;
  };

  return (
    <div className="connect-card">
      <div className="card-title">{req.permission.type}</div>
      <Row k="chain" v={chainName(req.chainId)} />
      <Row k="delegate" v={shortHex(req.to)} mono />
      {isErc20 && data.tokenAddress && <Row k="token" v={shortHex(data.tokenAddress)} mono />}
      {data.periodAmount && <Row k="per period" v={data.periodAmount} mono />}
      {data.periodDuration && <Row k="period" v={formatDuration(Number(data.periodDuration))} />}
      {data.amountPerSecond && <Row k="rate" v={`${data.amountPerSecond} / sec`} mono />}
      {data.maxAmount && <Row k="max total" v={data.maxAmount} mono />}
      {data.initialAmount && data.initialAmount !== "0x0" && (
        <Row k="initial" v={data.initialAmount} mono />
      )}
      {expirySecs !== null && <Row k="expires in" v={formatDuration(expirySecs)} />}
      <Row k="adjustable" v={req.permission.isAdjustmentAllowed ? "yes" : "no"} />
      {data.justification && (
        <p className="app-quote" style={{ marginTop: 8 }}>“{data.justification}”</p>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={mono ? "v mono" : "v"}>{v}</span>
    </div>
  );
}

// Inline remediation for MetaMask's snap-sandbox init failure. This error is
// environment-side (the `permissions-kernel-snap` iframe from execution.metamask.io
// couldn't load) — the grant request itself is correct. The checklist mirrors
// ERRORS.MD's ordered remediation so a live attempt doesn't dead-end on the raw string.
const SNAP_REMEDIATION = [
  "Reload this page and click Approve again — the snap sandbox load is timing-sensitive and often succeeds on a retry.",
  "Don't use Incognito/Private mode — snap storage is partitioned there and the sandbox can't initialize.",
  "Unblock execution.metamask.io for this tab: disable ad-block / privacy extensions / Brave Shields, and allow third-party cookies & storage.",
  "Update MetaMask Flask to the latest version, then fully restart your browser.",
  "In MetaMask → Settings → Snaps, confirm the permissions / smart-accounts snap is enabled.",
  "If it still fails, try a clean browser profile (fresh MetaMask Flask install).",
];

function SnapRemediation({ raw, onRetry }: { raw: string; onRetry: () => void }) {
  return (
    <div className="connect-sub">
      <p className="txt-err">
        MetaMask couldn’t start its permissions snap, so the grant can’t be signed yet. This is a
        MetaMask environment issue, not a problem with the request. Work through these, then retry:
      </p>
      <ol className="connect-card" style={{ marginTop: 10, paddingLeft: 28 }}>
        {SNAP_REMEDIATION.map((step, i) => (
          <li key={i} style={{ marginBottom: 6 }}>{step}</li>
        ))}
      </ol>
      <button onClick={onRetry} className="frost-btn" style={{ marginTop: 12 }}>
        Retry grant
      </button>
      <details className="connect-debug" style={{ marginTop: 10 }}>
        <summary>original error</summary>
        <pre className="code-block err" style={{ marginTop: 8 }}>{raw}</pre>
      </details>
    </div>
  );
}

function GrantInner() {
  const params = useSearchParams();
  const challenge = params.get("challenge") ?? "";
  const port = params.get("port") ?? "";
  const rawParams = params.get("params") ?? "";

  const parsedSpec = useMemo(() => {
    try {
      return { ok: true as const, spec: parseSpec(rawParams) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [rawParams]);

  const [state, setState] = useState<State>(() =>
    parsedSpec.ok
      ? { kind: "waiting-mm", spec: parsedSpec.spec }
      : { kind: "spec-error", message: parsedSpec.error },
  );
  // Client-only — computing the clock during SSR makes the rendered "expires in"
  // text differ from the client render (hydration mismatch). Stay null until mounted.
  const [nowSecs, setNowSecs] = useState<number | null>(null);
  useEffect(() => {
    // Defer out of the effect body (react-hooks/set-state-in-effect); client-only so
    // SSR and first client render both omit the clock-derived "expires in" text.
    queueMicrotask(() => setNowSecs(Math.floor(Date.now() / 1000)));
  }, []);

  useEffect(() => {
    if (!parsedSpec.ok) return;
    detectMetaMask().then((det) => {
      if (det.kind === "flask-ok") setState({ kind: "ready", spec: parsedSpec.spec, detection: det });
      else setState({ kind: "no-flask", spec: parsedSpec.spec, detection: det });
    });
  }, [parsedSpec]);

  async function runGrant(
    spec: PermissionRequest[],
    detection: Extract<MMDetection, { kind: "flask-ok" }>,
  ) {
    setState({ kind: "requesting", spec });
    // On-chain account diagnosis, filled in during the "checking" phase below and reused in
    // the catch so the "internal account" rejection reports the ACTUAL reason (no code vs.
    // wrong impl vs. correct gator) rather than the cryptic MetaMask string alone.
    let accountDiag = "";
    try {
      const provider = detection.detail.provider;
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
      const account = accounts?.[0];
      if (!account) throw new Error("No account selected in MetaMask.");
      const targetChain = spec[0]?.chainId ?? BASE_SEPOLIA_CHAIN_HEX;
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: targetChain }],
        });
      } catch (switchErr: unknown) {
        const code = (switchErr as { code?: number })?.code;
        if (code === 4902 || code === -32603) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: targetChain,
              chainName: "Base Sepolia",
              nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://sepolia.base.org"],
              blockExplorerUrls: ["https://sepolia.basescan.org"],
            }],
          });
        } else {
          throw switchErr;
        }
      }

      const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
      const walletClient = createWalletClient({ account, chain: baseSepolia, transport: custom(provider) });

      // CHECK ONLY — never dapp-upgrade. MetaMask owns the smart-account upgrade UX:
      // a raw EIP-7702 authorization tx sets the account's code but does NOT register it
      // as a MetaMask-managed Smart Account, which makes requestExecutionPermissions hang
      // or fail. So we only detect whether the account is already upgraded (presence of
      // 7702 code) and let MetaMask drive the grant; if it's a plain EOA, we ask the user
      // to switch to a Smart Account in MetaMask (the only reliable upgrade path).
      setState({ kind: "checking", spec });
      const code = await publicClient.getCode({ address: account }).catch(() => undefined);
      const impl = delegatedImpl(code);
      const gator = expectedGatorImpl();
      const isGator = !!impl && !!gator && impl.toLowerCase() === gator.toLowerCase();
      accountDiag =
        !code || code === "0x"
          ? "this account has no code (it's a plain EOA, not a Smart Account)"
          : isGator
            ? `this account delegates to the expected MetaMask gator (${gator})`
            : `this account's 7702 code delegates to ${impl ?? "an unrecognized target"}, ` +
              `not the MetaMask gator implementation${gator ? ` (${gator})` : ""}`;
      // Ground-truth diagnosis in the console: the connected account, its on-chain code, the
      // impl its 7702 designator points at, the expected gator, and whether they match. If
      // MetaMask still refuses with "internal accounts" while isGator=true, the limitation is
      // MetaMask-side (the account isn't registered/selected as a signable smart account).
      console.log(
        "[grant] account diagnosis:",
        JSON.stringify({ account, code, impl, expectedGator: gator, isGator }),
      );

      // EXPERIMENT (ERC-7715 from a non-upgraded account): we NO LONGER hard-block a plain EOA
      // or a non-gator account. Hypothesis: MetaMask's Advanced Permissions (ERC-7715) flow is
      // meant to manage smart-account/delegation creation ITSELF, and forcing a 7702 "Switch to
      // smart account" first put the account into the exact state MetaMask said "isn't supported
      // at this stage". So we now ALWAYS attempt requestExecutionPermissions and let MetaMask's
      // grant UI decide; the catch reports the precise on-chain account state if it still refuses.
      // (Was: a hard error that told plain EOAs to switch to a Smart Account before granting.)
      if (!code || code === "0x") {
        console.log("[grant] account has no code (plain EOA) — attempting ERC-7715 grant anyway (experiment).");
      }

      // GRANT via the kit (correct request serialization for the installed MetaMask gator).
      setState({ kind: "requesting", spec });
      const wallet7715 = walletClient.extend(erc7715ProviderActions());

      // PRE-FLIGHT PROBE (ERC-7715 spec): ask the wallet which permission types/rules it
      // actually supports on this chain BEFORE requesting. If a type we send isn't in this
      // list, requestExecutionPermissions can fall through to the generic signTypedData path
      // (→ the "internal accounts" block). This tells us definitively what's available.
      try {
        const supported = await (
          wallet7715 as unknown as { getSupportedExecutionPermissions: () => Promise<unknown> }
        ).getSupportedExecutionPermissions();
        console.log(
          "[grant] getSupportedExecutionPermissions:",
          JSON.stringify(supported, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
        );
      } catch (e) {
        console.log(
          "[grant] getSupportedExecutionPermissions threw:",
          e instanceof Error ? e.message : String(e),
        );
      }

      const kitRequests = spec.map(specToKitRequest);
      // Diagnostic: the exact payload handed to the kit (bigints → hex so it's JSON-loggable).
      // Lets us see the precise tokenAddress/amounts if MetaMask rejects the parameters.
      console.log(
        "[grant] requestExecutionPermissions payload:",
        JSON.stringify(kitRequests, (_k, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v)),
      );
      const granted = await wallet7715.requestExecutionPermissions(kitRequests as never);
      // GRANT SUCCEEDED. The response contains bigint fields (echoed amounts), so every
      // serialization of it MUST use a bigint-safe replacer — a plain JSON.stringify throws
      // "Do not know how to serialize a BigInt".
      console.log("[grant] GRANTED ✓:", jsonBigIntSafe(granted));

      setState({ kind: "posting", granted });
      // The grant is already done; the callback POST is a separate step. If it fails (e.g. the
      // dummy test port with no bridge listening), still report the GRANT as successful rather
      // than masking it behind a network error.
      try {
        const res = await fetch(`http://localhost:${port}/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: jsonBigIntSafe({ challenge, granted, ts: Date.now() }),
        });
        setState({ kind: "done", granted, callbackStatus: res.status });
      } catch (postErr) {
        console.log(
          "[grant] grant succeeded; callback POST failed (expected on the dummy test port):",
          postErr instanceof Error ? postErr.message : String(postErr),
        );
        setState({ kind: "done", granted, callbackStatus: 0 });
      }
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : JSON.stringify(e);
      // MetaMask's ERC-7715 grant runs inside the `permissions-kernel-snap` sandbox
      // (an iframe served from execution.metamask.io). When that sandbox can't load,
      // the kit throws a snap-executor init error that is environment-side, not ours —
      // show the user the targeted remediation checklist + a one-click retry instead of
      // the raw internal string. See ERRORS.MD (2026-06-06 snap-sandbox blocker).
      const isSnapInit =
        /permissions-kernel-snap|failed to initialize|(iframe|webview|worker) failed to load/i.test(raw);
      if (isSnapInit) {
        setState({ kind: "snap-error", spec, detection, raw });
        return;
      }
      // MetaMask deliberately disables signing a delegation whose delegator is an internal
      // MetaMask account (confirmed by MetaMask: too powerful to sign blind). The supported
      // path is ERC-7715 Advanced Permissions — which we use — BUT MetaMask does not yet
      // support Advanced Permissions from an EIP-7702 "stateless" smart account, which is what
      // a "Switch to smart account" upgrade produces. So this grant cannot complete on the
      // current MetaMask build regardless of account type. Don't tell the user to switch
      // accounts (that loops them back here) — state the real platform limitation.
      const isInternal = /internal account|sign delegations/i.test(raw);
      const message = isInternal
        ? `MetaMask blocked the delegation signature${accountDiag ? ` — ${accountDiag}` : ""}. ` +
          `MetaMask disables signing a delegation from an internal MetaMask account for security, ` +
          `and does not yet support ERC-7715 Advanced Permissions from an EIP-7702 "stateless" smart ` +
          `account (which this account is). So this grant can't complete on the current MetaMask build ` +
          `— it's a MetaMask platform limitation, not a Frost issue, and switching account types won't ` +
          `change it. Frost continues via its session-key execution path.\n\n(original: ${raw})`
        : raw;
      setState({ kind: "error", message });
    }
  }

  return (
    <ConnectShell
      eyebrow="Bridge · Permission"
      title="Review request"
      subtitle="Frost is requesting a delegated execution permission. Review the terms below, then approve in MetaMask Flask."
    >
      {state.kind === "parsing" && <p className="status-line">Parsing spec…</p>}

      {state.kind === "spec-error" && <pre className="code-block err">{state.message}</pre>}

      {(state.kind === "waiting-mm" ||
        state.kind === "no-flask" ||
        state.kind === "ready" ||
        state.kind === "checking" ||
        state.kind === "requesting" ||
        state.kind === "posting" ||
        state.kind === "done" ||
        state.kind === "snap-error") &&
        "spec" in state &&
        state.spec.map((req, i) => <PermissionPreview key={i} req={req} nowSecs={nowSecs} />)}

      {state.kind === "waiting-mm" && <p className="status-line">Detecting MetaMask Flask…</p>}

      {state.kind === "no-flask" && (
        <p className="status-line txt-err">
          MetaMask Flask required (detected: {state.detection.kind}).
        </p>
      )}

      {state.kind === "ready" && (
        <button onClick={() => runGrant(state.spec, state.detection)} className="frost-btn">
          Approve in MetaMask
        </button>
      )}

      {state.kind === "checking" && <p className="status-line">Checking smart-account status…</p>}
      {state.kind === "requesting" && <p className="status-line">Awaiting MetaMask approval…</p>}
      {state.kind === "posting" && <p className="status-line">Posting signed permission back to Frost…</p>}

      {state.kind === "done" && (
        <div className="connect-sub">
          <p className="txt-ok">Done. Callback HTTP {state.callbackStatus}.</p>
          <p className="txt-muted">You can close this tab.</p>
        </div>
      )}

      {state.kind === "snap-error" && (
        <SnapRemediation raw={state.raw} onRetry={() => runGrant(state.spec, state.detection)} />
      )}

      {state.kind === "error" && <pre className="code-block err">{state.message}</pre>}

      <details className="connect-debug">
        <summary>debug</summary>
        <div className="connect-card" style={{ marginTop: 10 }}>
          <div className="kv"><span className="k">challenge</span><span className="v mono">{challenge || "(missing)"}</span></div>
          <div className="kv"><span className="k">port</span><span className="v mono">{port || "(missing)"}</span></div>
          <div className="kv"><span className="k">state</span><span className="v mono">{state.kind}</span></div>
        </div>
      </details>
    </ConnectShell>
  );
}

export default function GrantPermissionsPage() {
  return (
    <Suspense fallback={<p className="connect-main">Loading…</p>}>
      <GrantInner />
    </Suspense>
  );
}
