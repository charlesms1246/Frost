"use client";

// /connect/commit/ — audit-root co-sign flow.
//
// Per contract-architecture.md §10.8, a session ends with the user (or master
// agent) co-signing the Merkle root of the session's audit log. The signature
// is later submitted to the audit/Settlement contract on-chain — but those
// contracts don't exist yet, so this page produces the EIP-712 signature only
// and POSTs it back to Tauri. The Tauri side will queue it for submission
// when the contract lands.
//
// Query params:
//   challenge, port      — Tauri callback frame (required for round-trip)
//   sessionId            — bytes32 (the session being closed)
//   auditRoot            — bytes32 (Merkle root of the session log)
//   sessionEnd           — uint64 unix-seconds (when the session ended)
//
// Domain: { name: "Frost", version: "0.1.0", chainId: 84532 }. No
// `verifyingContract` until the audit contract is deployed.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { detectMetaMask, type MMDetection } from "../_lib/detect-mm";

const BASE_SEPOLIA_CHAIN_HEX = "0x14a34";
const BASE_SEPOLIA_CHAIN_ID = 84532;

type Inputs = {
  sessionId: `0x${string}`;
  auditRoot: `0x${string}`;
  sessionEnd: number;
};

type State =
  | { kind: "parsing" }
  | { kind: "parse-error"; message: string }
  | { kind: "waiting-mm"; inputs: Inputs }
  | { kind: "no-flask"; inputs: Inputs; detection: MMDetection }
  | { kind: "ready"; inputs: Inputs; detection: Extract<MMDetection, { kind: "flask-ok" }> }
  | { kind: "signing"; inputs: Inputs }
  | { kind: "posting"; inputs: Inputs; signature: string; signer: string }
  | {
      kind: "done";
      inputs: Inputs;
      signature: string;
      signer: string;
      callbackStatus: number;
    }
  | { kind: "error"; message: string };

function parseInputs(params: URLSearchParams): Inputs {
  // Tauri bridge wraps inputs in ?params=<JSON>. Direct query params win if set.
  let bundled: Record<string, unknown> = {};
  const rawParams = params.get("params") ?? "";
  if (rawParams) {
    try {
      const obj = JSON.parse(rawParams) as unknown;
      if (obj && typeof obj === "object") bundled = obj as Record<string, unknown>;
    } catch {
      // params= wasn't JSON; ignore and fall through to direct fields
    }
  }
  const pick = (k: string): string => {
    const direct = params.get(k);
    if (direct) return direct;
    const v = bundled[k];
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    return "";
  };
  const sessionId = pick("sessionId");
  const auditRoot = pick("auditRoot");
  const sessionEndStr = pick("sessionEnd");
  if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId))
    throw new Error("sessionId must be a 0x-prefixed 32-byte hex string");
  if (!/^0x[0-9a-fA-F]{64}$/.test(auditRoot))
    throw new Error("auditRoot must be a 0x-prefixed 32-byte hex string");
  const sessionEnd = Number(sessionEndStr);
  if (!Number.isFinite(sessionEnd) || sessionEnd <= 0)
    throw new Error("sessionEnd must be a positive unix-seconds integer");
  return {
    sessionId: sessionId as `0x${string}`,
    auditRoot: auditRoot as `0x${string}`,
    sessionEnd,
  };
}

function buildTypedData(inputs: Inputs) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      AuditCommit: [
        { name: "sessionId", type: "bytes32" },
        { name: "auditRoot", type: "bytes32" },
        { name: "sessionEnd", type: "uint64" },
      ],
    },
    primaryType: "AuditCommit",
    domain: { name: "Frost", version: "0.1.0", chainId: BASE_SEPOLIA_CHAIN_ID },
    message: {
      sessionId: inputs.sessionId,
      auditRoot: inputs.auditRoot,
      sessionEnd: inputs.sessionEnd,
    },
  };
}

function CommitInner() {
  const params = useSearchParams();
  const challenge = params.get("challenge") ?? "";
  const port = params.get("port") ?? "";

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, inputs: parseInputs(params) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }, [params]);

  const [state, setState] = useState<State>(() =>
    parsed.ok
      ? { kind: "waiting-mm", inputs: parsed.inputs }
      : { kind: "parse-error", message: parsed.error },
  );

  useEffect(() => {
    if (!parsed.ok) return;
    detectMetaMask().then((det) => {
      if (det.kind === "flask-ok")
        setState({ kind: "ready", inputs: parsed.inputs, detection: det });
      else setState({ kind: "no-flask", inputs: parsed.inputs, detection: det });
    });
  }, [parsed]);

  async function sign() {
    if (state.kind !== "ready") return;
    const { inputs, detection } = state;
    setState({ kind: "signing", inputs });
    try {
      const provider = detection.detail.provider;
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const signer = accounts[0];

      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: BASE_SEPOLIA_CHAIN_HEX }],
        });
      } catch (e: unknown) {
        const code = (e as { code?: number })?.code;
        if (code !== 4902 && code !== -32603) throw e;
      }

      const typedData = buildTypedData(inputs);
      const signature = (await provider.request({
        method: "eth_signTypedData_v4",
        params: [signer, JSON.stringify(typedData)],
      })) as string;

      setState({ kind: "posting", inputs, signature, signer });

      if (challenge && port) {
        const res = await fetch(`http://localhost:${port}/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challenge,
            signature,
            signer,
            sessionId: inputs.sessionId,
            auditRoot: inputs.auditRoot,
            sessionEnd: inputs.sessionEnd,
            chainId: BASE_SEPOLIA_CHAIN_ID,
            domain: { name: "Frost", version: "0.1.0" },
            ts: Date.now(),
          }),
        });
        setState({ kind: "done", inputs, signature, signer, callbackStatus: res.status });
      } else {
        setState({ kind: "done", inputs, signature, signer, callbackStatus: 0 });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : JSON.stringify(e);
      setState({ kind: "error", message });
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-start gap-4 p-8 font-sans">
      <h1 className="text-2xl font-semibold">Frost · commit audit root</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xl text-center">
        Signs an EIP-712 commitment over the session&apos;s audit Merkle root. No
        on-chain transaction — the signature is held until the audit contract
        is deployed.
      </p>

      {state.kind === "parsing" && <p>Validating inputs…</p>}
      {state.kind === "parse-error" && (
        <pre className="text-xs text-red-700 max-w-2xl whitespace-pre-wrap">{state.message}</pre>
      )}

      {"inputs" in state && (
        <div className="border border-zinc-300 dark:border-zinc-700 rounded p-4 text-sm space-y-1 max-w-xl w-full font-mono text-xs">
          <Row k="sessionId" v={state.inputs.sessionId} />
          <Row k="auditRoot" v={state.inputs.auditRoot} />
          <Row k="sessionEnd" v={`${state.inputs.sessionEnd} (${new Date(state.inputs.sessionEnd * 1000).toISOString()})`} />
          <Row k="domain" v="Frost / 0.1.0 / chainId 84532" />
        </div>
      )}

      {state.kind === "waiting-mm" && <p>Detecting MetaMask Flask…</p>}
      {state.kind === "no-flask" && (
        <p className="text-sm text-red-700">MetaMask Flask required.</p>
      )}
      {state.kind === "ready" && (
        <button onClick={sign} className="px-4 py-2 rounded bg-zinc-900 text-white">
          Sign commitment
        </button>
      )}
      {state.kind === "signing" && <p>Awaiting MetaMask signature…</p>}
      {state.kind === "posting" && <p>Posting signature back to Frost…</p>}
      {state.kind === "done" && (
        <div className="text-center max-w-2xl">
          <p className="text-green-700 mb-2">Signed by {state.signer}.</p>
          <pre className="text-xs text-left bg-zinc-100 dark:bg-zinc-900 p-3 rounded overflow-auto break-all">
            {state.signature}
          </pre>
          {state.callbackStatus > 0 && (
            <p className="text-xs text-zinc-500 mt-2">Callback HTTP {state.callbackStatus}.</p>
          )}
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <span className="text-zinc-500">{k}</span>
      <span className="break-all">{v}</span>
    </div>
  );
}

export default function CommitPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading…</p>}>
      <CommitInner />
    </Suspense>
  );
}
