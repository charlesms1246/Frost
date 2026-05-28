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
import { detectMetaMask, type MMDetection } from "../_lib/detect-mm";

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

function PermissionPreview({ req }: { req: PermissionRequest }) {
  const expiry = req.rules.find((r): r is ExpiryRule => r.type === "expiry");
  const expirySecs = expiry ? expiry.data.timestamp - Math.floor(Date.now() / 1000) : null;
  const isErc20 = req.permission.type === "erc20-token-stream";
  const data = req.permission.data as Partial<Erc20StreamData>;

  return (
    <div className="border border-zinc-300 dark:border-zinc-700 rounded p-4 text-sm space-y-1.5 max-w-xl w-full">
      <div className="font-semibold text-base mb-2">{req.permission.type}</div>
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
        <div className="pt-2 text-xs text-zinc-600 dark:text-zinc-400 italic">
          “{data.justification}”
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <span className="text-zinc-500">{k}</span>
      <span className={mono ? "font-mono break-all" : "break-words"}>{v}</span>
    </div>
  );
}

function GrantInner() {
  const params = useSearchParams();
  const challenge = params.get("challenge") ?? "";
  const port = params.get("port") ?? "";
  const rawParams = params.get("params") ?? "";

  const [state, setState] = useState<State>({ kind: "parsing" });

  const parsedSpec = useMemo(() => {
    try {
      return { ok: true as const, spec: parseSpec(rawParams) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [rawParams]);

  useEffect(() => {
    if (!parsedSpec.ok) {
      setState({ kind: "spec-error", message: parsedSpec.error });
      return;
    }
    setState({ kind: "waiting-mm", spec: parsedSpec.spec });
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
      await provider.request({ method: "eth_requestAccounts" });
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
      const granted = await provider.request({
        method: "wallet_requestExecutionPermissions",
        params: spec,
      });
      setState({ kind: "posting", granted });
      const res = await fetch(`http://localhost:${port}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge, granted, ts: Date.now() }),
      });
      setState({ kind: "done", granted, callbackStatus: res.status });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : JSON.stringify(e);
      setState({ kind: "error", message });
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-start gap-4 p-8 font-sans">
      <h1 className="text-2xl font-semibold">Frost · review permission request</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xl text-center">
        Frost is requesting a delegated execution permission. Review the terms below,
        then approve in MetaMask Flask.
      </p>

      {state.kind === "parsing" && <p>Parsing spec…</p>}

      {state.kind === "spec-error" && (
        <pre className="text-xs text-red-700 max-w-2xl whitespace-pre-wrap">{state.message}</pre>
      )}

      {(state.kind === "waiting-mm" ||
        state.kind === "no-flask" ||
        state.kind === "ready" ||
        state.kind === "requesting" ||
        state.kind === "posting" ||
        state.kind === "done") &&
        "spec" in state &&
        state.spec.map((req, i) => <PermissionPreview key={i} req={req} />)}

      {state.kind === "waiting-mm" && <p>Detecting MetaMask Flask…</p>}

      {state.kind === "no-flask" && (
        <p className="text-sm text-red-700">
          MetaMask Flask required (detected: {state.detection.kind}).
        </p>
      )}

      {state.kind === "ready" && (
        <button onClick={approve} className="px-4 py-2 rounded bg-zinc-900 text-white">
          Approve in MetaMask
        </button>
      )}

      {state.kind === "requesting" && <p>Awaiting MetaMask approval…</p>}
      {state.kind === "posting" && <p>Posting signed permission back to Frost…</p>}

      {state.kind === "done" && (
        <div className="text-center max-w-2xl">
          <p className="text-green-700 mb-2">Done. Callback HTTP {state.callbackStatus}.</p>
          <p className="text-xs text-zinc-500">You can close this tab.</p>
        </div>
      )}

      {state.kind === "error" && (
        <pre className="text-xs text-red-700 max-w-2xl whitespace-pre-wrap">{state.message}</pre>
      )}

      <details className="mt-4 max-w-2xl w-full">
        <summary className="text-xs text-zinc-500 cursor-pointer">debug</summary>
        <dl className="text-xs grid grid-cols-[max-content_1fr] gap-x-3 break-all mt-2">
          <dt className="text-zinc-500">challenge</dt><dd>{challenge || "(missing)"}</dd>
          <dt className="text-zinc-500">port</dt><dd>{port || "(missing)"}</dd>
          <dt className="text-zinc-500">state</dt><dd>{state.kind}</dd>
        </dl>
      </details>
    </main>
  );
}

export default function GrantPermissionsPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading…</p>}>
      <GrantInner />
    </Suspense>
  );
}
