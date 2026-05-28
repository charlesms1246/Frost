"use client";

// /connect/revoke/ — real revocation flow.
//
// Reads `?permissionContext=` (the blob returned by spike 8's grant flow) from
// the URL query, ABI-decodes it as `Delegation[]`, shows the user the root
// delegation they're about to disable, and on click submits
// `disableDelegation(Delegation)` to the on-chain Delegation Manager at
// `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` (Base Sepolia, locked).
//
// Gas is paid by the user's connected MetaMask account (no relayer). If the
// deployed ABI diverges from our pinned shape the transaction reverts and the
// page surfaces the revert reason.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  createWalletClient,
  custom,
  decodeAbiParameters,
  encodeFunctionData,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { detectMetaMask, type MMDetection } from "../_lib/detect-mm";
import {
  BASE_SEPOLIA_DELEGATION_MANAGER,
  DELEGATION_ARRAY_TYPE,
  DISABLE_DELEGATION_ABI,
  type Delegation,
} from "../_lib/delegation-manager";

const BASE_SEPOLIA_CHAIN_HEX = "0x14a34";

type State =
  | { kind: "parsing" }
  | { kind: "parse-error"; message: string }
  | { kind: "waiting-mm"; root: Delegation; all: readonly Delegation[] }
  | { kind: "no-flask"; root: Delegation; all: readonly Delegation[]; detection: MMDetection }
  | { kind: "ready"; root: Delegation; all: readonly Delegation[]; detection: Extract<MMDetection, { kind: "flask-ok" }> }
  | { kind: "submitting"; root: Delegation; all: readonly Delegation[] }
  | { kind: "mining"; root: Delegation; all: readonly Delegation[]; txHash: Hex }
  | { kind: "posting"; root: Delegation; all: readonly Delegation[]; txHash: Hex }
  | { kind: "done"; txHash: Hex; callbackStatus: number }
  | { kind: "error"; message: string };

function decodeContext(hex: string): readonly Delegation[] {
  if (!hex.startsWith("0x")) throw new Error("permissionContext must be 0x-prefixed hex");
  const [delegations] = decodeAbiParameters(DELEGATION_ARRAY_TYPE, hex as Hex);
  if (!Array.isArray(delegations) || delegations.length === 0) {
    throw new Error("decoded delegation array is empty");
  }
  return delegations as readonly Delegation[];
}

function shortHex(s: string, head = 6, tail = 4) {
  if (!s.startsWith("0x") || s.length <= head + tail + 2) return s;
  return `${s.slice(0, head + 2)}…${s.slice(-tail)}`;
}

function DelegationCard({ d, label }: { d: Delegation; label: string }) {
  return (
    <div className="border border-zinc-300 dark:border-zinc-700 rounded p-4 text-sm space-y-1 max-w-xl w-full">
      <div className="font-semibold mb-1">{label}</div>
      <Row k="delegate" v={shortHex(d.delegate)} />
      <Row k="delegator" v={shortHex(d.delegator)} />
      <Row k="authority" v={shortHex(d.authority, 6, 6)} />
      <Row k="caveats" v={`${d.caveats.length}`} />
      <Row k="salt" v={d.salt.toString()} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2 font-mono text-xs">
      <span className="text-zinc-500">{k}</span>
      <span className="break-all">{v}</span>
    </div>
  );
}

function extractContext(direct: string, rawParams: string): string {
  if (direct.startsWith("0x")) return direct;
  if (!rawParams) return direct;
  // Tauri bridge wraps inputs in ?params=<JSON>.
  try {
    const obj = JSON.parse(rawParams) as unknown;
    if (obj && typeof obj === "object" && "permissionContext" in obj) {
      const v = (obj as Record<string, unknown>).permissionContext;
      if (typeof v === "string") return v;
    }
  } catch {
    // not JSON — maybe a raw 0x blob passed as ?params=
    if (rawParams.startsWith("0x")) return rawParams;
  }
  return direct;
}

function RevokeInner() {
  const params = useSearchParams();
  const challenge = params.get("challenge") ?? "";
  const port = params.get("port") ?? "";
  const rawContext = extractContext(
    params.get("permissionContext") ?? "",
    params.get("params") ?? "",
  );

  const decoded = useMemo(() => {
    try {
      const all = decodeContext(rawContext);
      return { ok: true as const, all, root: all[0] };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [rawContext]);

  const [state, setState] = useState<State>(() =>
    decoded.ok
      ? { kind: "waiting-mm", root: decoded.root, all: decoded.all }
      : { kind: "parse-error", message: decoded.error },
  );

  useEffect(() => {
    if (!decoded.ok) return;
    detectMetaMask().then((det) => {
      if (det.kind === "flask-ok")
        setState({ kind: "ready", root: decoded.root, all: decoded.all, detection: det });
      else setState({ kind: "no-flask", root: decoded.root, all: decoded.all, detection: det });
    });
  }, [decoded]);

  async function submit() {
    if (state.kind !== "ready") return;
    const { root, all, detection } = state;
    setState({ kind: "submitting", root, all });
    try {
      const provider = detection.detail.provider as unknown as {
        request: (a: { method: string; params?: unknown }) => Promise<unknown>;
      };
      await provider.request({ method: "eth_requestAccounts" });
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: BASE_SEPOLIA_CHAIN_HEX }],
        });
      } catch (switchErr: unknown) {
        const code = (switchErr as { code?: number })?.code;
        if (code === 4902 || code === -32603) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: BASE_SEPOLIA_CHAIN_HEX,
              chainName: "Base Sepolia",
              nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://sepolia.base.org"],
              blockExplorerUrls: ["https://sepolia.basescan.org"],
            }],
          });
        } else throw switchErr;
      }

      const data = encodeFunctionData({
        abi: DISABLE_DELEGATION_ABI,
        functionName: "disableDelegation",
        args: [root],
      });

      const client = createWalletClient({ chain: baseSepolia, transport: custom(provider) });
      const [account] = await client.getAddresses();
      const txHash = await client.sendTransaction({
        account,
        to: BASE_SEPOLIA_DELEGATION_MANAGER,
        data,
      });
      setState({ kind: "mining", root, all, txHash });

      // Best-effort receipt wait via the provider — no rpc fallback.
      try {
        await provider.request({
          method: "eth_getTransactionReceipt",
          params: [txHash],
        });
      } catch {
        // ignore — we'll still POST the hash; the Tauri side can verify later
      }

      setState({ kind: "posting", root, all, txHash });
      if (challenge && port) {
        const res = await fetch(`http://localhost:${port}/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challenge, txHash, status: "submitted", ts: Date.now() }),
        });
        setState({ kind: "done", txHash, callbackStatus: res.status });
      } else {
        setState({ kind: "done", txHash, callbackStatus: 0 });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : JSON.stringify(e);
      setState({ kind: "error", message });
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-start gap-4 p-8 font-sans">
      <h1 className="text-2xl font-semibold">Frost · revoke permission</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xl text-center">
        Submits <code className="text-xs">disableDelegation()</code> on the Base Sepolia
        Delegation Manager. Gas paid by your connected account.
      </p>

      {state.kind === "parsing" && <p>Decoding permission context…</p>}
      {state.kind === "parse-error" && (
        <pre className="text-xs text-red-700 max-w-2xl whitespace-pre-wrap">{state.message}</pre>
      )}

      {"root" in state && <DelegationCard d={state.root} label="root delegation (will be disabled)" />}
      {"all" in state && state.all.length > 1 && (
        <details className="max-w-xl w-full">
          <summary className="text-xs text-zinc-500 cursor-pointer">
            full chain ({state.all.length} delegations)
          </summary>
          <div className="space-y-2 mt-2">
            {state.all.slice(1).map((d, i) => (
              <DelegationCard key={i} d={d} label={`chain[${i + 1}]`} />
            ))}
          </div>
        </details>
      )}

      {state.kind === "waiting-mm" && <p>Detecting MetaMask Flask…</p>}
      {state.kind === "no-flask" && (
        <p className="text-sm text-red-700">MetaMask Flask required.</p>
      )}
      {state.kind === "ready" && (
        <button onClick={submit} className="px-4 py-2 rounded bg-red-700 text-white">
          Revoke in MetaMask
        </button>
      )}
      {state.kind === "submitting" && <p>Awaiting MetaMask approval…</p>}
      {state.kind === "mining" && <p>Submitted. tx <code className="text-xs">{state.txHash}</code></p>}
      {state.kind === "posting" && <p>Posting tx hash back to Frost…</p>}
      {state.kind === "done" && (
        <div className="text-center">
          <p className="text-green-700">Revoked. tx <a className="underline" target="_blank" rel="noreferrer"
            href={`https://sepolia.basescan.org/tx/${state.txHash}`}>{shortHex(state.txHash, 8, 6)}</a></p>
          {state.callbackStatus > 0 && (
            <p className="text-xs text-zinc-500">Callback HTTP {state.callbackStatus}.</p>
          )}
        </div>
      )}
      {state.kind === "error" && (
        <pre className="text-xs text-red-700 max-w-2xl whitespace-pre-wrap">{state.message}</pre>
      )}
    </main>
  );
}

export default function RevokePage() {
  return (
    <Suspense fallback={<p className="p-8">Loading…</p>}>
      <RevokeInner />
    </Suspense>
  );
}
