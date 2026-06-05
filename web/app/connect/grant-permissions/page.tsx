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
function specToKitRequest(req: PermissionRequest): Record<string, unknown> {
  const expiry = req.rules.find((r): r is ExpiryRule => r.type === "expiry");
  const d = req.permission.data as Partial<Erc20StreamData>;
  const data: Record<string, unknown> = {
    amountPerSecond: BigInt(d.amountPerSecond ?? "0x0"),
    maxAmount: BigInt(d.maxAmount ?? "0x0"),
    initialAmount: BigInt(d.initialAmount ?? "0x0"),
  };
  if (d.tokenAddress) data.tokenAddress = d.tokenAddress;
  if (typeof d.startTime === "number") data.startTime = d.startTime;
  if (d.justification) data.justification = d.justification;
  return {
    chainId: Number(req.chainId),
    to: req.to,
    ...(expiry ? { expiry: expiry.data.timestamp } : {}),
    permission: {
      type: req.permission.type,
      isAdjustmentAllowed: req.permission.isAdjustmentAllowed,
      data,
    },
  };
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
  const isErc20 = req.permission.type === "erc20-token-stream";
  const data = req.permission.data as Partial<Erc20StreamData>;

  return (
    <div className="connect-card">
      <div className="card-title">{req.permission.type}</div>
      <Row k="chain" v={chainName(req.chainId)} />
      <Row k="delegate" v={shortHex(req.to)} mono />
      {isErc20 && data.tokenAddress && <Row k="token" v={shortHex(data.tokenAddress)} mono />}
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

  async function approve() {
    if (state.kind !== "ready") return;
    const { spec, detection } = state;
    setState({ kind: "requesting", spec });
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
      if (!code || code === "0x") {
        setState({
          kind: "error",
          message:
            "This MetaMask account isn't a Smart Account yet. In MetaMask, switch this " +
            "account to a Smart Account (account menu → “Switch to smart account”), " +
            "then retry. Frost can't upgrade it for you — MetaMask must manage the upgrade " +
            "for the delegation grant to work.",
        });
        return;
      }

      // GRANT via the kit (correct request serialization for the installed MetaMask gator).
      setState({ kind: "requesting", spec });
      const wallet7715 = walletClient.extend(erc7715ProviderActions());
      const granted = await wallet7715.requestExecutionPermissions(
        spec.map(specToKitRequest) as never,
      );

      setState({ kind: "posting", granted });
      const res = await fetch(`http://localhost:${port}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge, granted, ts: Date.now() }),
      });
      setState({ kind: "done", granted, callbackStatus: res.status });
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : JSON.stringify(e);
      const isInternal = /internal account|sign delegations/i.test(raw);
      const message = isInternal
        ? `MetaMask refused to sign the delegation. This account couldn't be used as a Smart Account ` +
          `(EIP-7702 gator implementation). Try: in MetaMask, switch this account to a Smart Account ` +
          `and ensure it has a little Base Sepolia ETH for the one-time upgrade, then retry.\n\n(original: ${raw})`
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
        state.kind === "done") &&
        "spec" in state &&
        state.spec.map((req, i) => <PermissionPreview key={i} req={req} nowSecs={nowSecs} />)}

      {state.kind === "waiting-mm" && <p className="status-line">Detecting MetaMask Flask…</p>}

      {state.kind === "no-flask" && (
        <p className="status-line txt-err">
          MetaMask Flask required (detected: {state.detection.kind}).
        </p>
      )}

      {state.kind === "ready" && (
        <button onClick={approve} className="frost-btn">Approve in MetaMask</button>
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
