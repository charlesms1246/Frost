"use client";

// /connect/login/ — Frost's login flow.
//
// Two modes:
//   1. Bridge mode: invoked by the Tauri app with `?challenge=…&port=…`.
//      User clicks Connect → we request accounts via Flask, read the
//      selected chain id, then POST { challenge, address, chainId,
//      flaskVersion, providerInfo } back to the local callback server.
//   2. Standalone visit (no challenge/port): we still run detection so the
//      user can verify Flask works, but there is nothing to POST back.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  detectMetaMask,
  FLASK_REQUIRED_VERSION,
  type MMDetection,
  type Eip6963ProviderDetail,
} from "../_lib/detect-mm";
import ConnectShell from "../_components/ConnectShell";

type State =
  | { kind: "detecting" }
  | { kind: "no-flask"; detection: MMDetection }
  | { kind: "ready"; detection: Extract<MMDetection, { kind: "flask-ok" }> }
  | { kind: "connecting" }
  | { kind: "posting"; address: string; chainId: string }
  | {
      kind: "done";
      address: string;
      chainId: string;
      callbackStatus: number;
      flaskVersion: string;
    }
  | { kind: "error"; message: string };

async function readAddress(detail: Eip6963ProviderDetail): Promise<string> {
  const accounts = (await detail.provider.request({
    method: "eth_requestAccounts",
  })) as unknown;
  if (!Array.isArray(accounts) || accounts.length === 0 || typeof accounts[0] !== "string") {
    throw new Error("MetaMask returned no accounts");
  }
  return accounts[0];
}

async function readChainId(detail: Eip6963ProviderDetail): Promise<string> {
  const raw = (await detail.provider.request({ method: "eth_chainId" })) as unknown;
  if (typeof raw !== "string") throw new Error("eth_chainId did not return a string");
  return raw;
}

function LoginInner() {
  const params = useSearchParams();
  const challenge = params.get("challenge") ?? "";
  const port = params.get("port") ?? "";
  const isBridgeMode = challenge !== "" && port !== "";

  const [state, setState] = useState<State>({ kind: "detecting" });

  useEffect(() => {
    detectMetaMask()
      .then((det) => {
        if (det.kind === "flask-ok") setState({ kind: "ready", detection: det });
        else setState({ kind: "no-flask", detection: det });
      })
      .catch((e) => setState({ kind: "error", message: String(e) }));
  }, []);

  async function connect() {
    if (state.kind !== "ready") return;
    const { detection } = state;
    setState({ kind: "connecting" });
    try {
      const address = await readAddress(detection.detail);
      const chainId = await readChainId(detection.detail);

      if (!isBridgeMode) {
        // Standalone visit — just display the result, nothing to POST back.
        setState({
          kind: "done",
          address,
          chainId,
          callbackStatus: 0,
          flaskVersion: detection.version,
        });
        return;
      }

      setState({ kind: "posting", address, chainId });
      const res = await fetch(`http://localhost:${port}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge,
          address,
          chainId,
          flaskVersion: detection.version,
          providerInfo: detection.detail.info,
          ts: Date.now(),
        }),
      });
      setState({
        kind: "done",
        address,
        chainId,
        callbackStatus: res.status,
        flaskVersion: detection.version,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : JSON.stringify(e);
      setState({ kind: "error", message });
    }
  }

  return (
    <ConnectShell
      eyebrow="Bridge · Connect"
      title="Connect MetaMask"
      subtitle="Link your MetaMask Flask wallet so Frost can request scoped, signed permissions."
    >
      <div className="connect-card">
        <div className="card-title">Session</div>
        <div className="kv"><span className="k">mode</span><span className="v">{isBridgeMode ? "bridge (Tauri callback)" : "standalone"}</span></div>
        {isBridgeMode && (
          <>
            <div className="kv"><span className="k">challenge</span><span className="v mono">{challenge}</span></div>
            <div className="kv"><span className="k">port</span><span className="v mono">{port}</span></div>
          </>
        )}
        <div className="kv"><span className="k">state</span><span className="v mono">{state.kind}</span></div>
      </div>

      {state.kind === "detecting" && <p className="status-line">Detecting MetaMask Flask…</p>}

      {state.kind === "no-flask" && (
        <div className="connect-sub">
          {state.detection.kind === "no-metamask" && (
            <p className="txt-err">MetaMask Flask is not installed.</p>
          )}
          {state.detection.kind === "stable-only" && (
            <p className="txt-err">
              Stable MetaMask detected
              {state.detection.version ? ` (v${state.detection.version})` : ""}, but
              Frost needs MetaMask Flask for ERC-7715 permission grants.
            </p>
          )}
          {state.detection.kind === "flask-too-old" && (
            <p className="txt-err">
              MetaMask Flask v{state.detection.version} detected, but Frost requires
              v{FLASK_REQUIRED_VERSION} or newer.
            </p>
          )}
          <a href="https://metamask.io/flask" target="_blank" rel="noreferrer" className="connect-link">
            Install / update MetaMask Flask
          </a>
        </div>
      )}

      {state.kind === "ready" && (
        <button onClick={connect} className="frost-btn">Connect MetaMask Flask</button>
      )}

      {state.kind === "connecting" && <p className="status-line">Awaiting MetaMask approval…</p>}
      {state.kind === "posting" && (
        <p className="status-line">Posting connection back to Frost (HTTP localhost:{port})…</p>
      )}

      {state.kind === "done" && (
        <div className="connect-sub">
          <p className="txt-ok">
            Connected as <span className="mono">{state.address}</span> on chain{" "}
            <span className="mono">{state.chainId}</span>.
          </p>
          {isBridgeMode ? (
            <p className="txt-muted">Callback HTTP {state.callbackStatus}. You can close this tab.</p>
          ) : (
            <p className="txt-muted">Flask v{state.flaskVersion}. (No Tauri bridge — standalone visit.)</p>
          )}
        </div>
      )}

      {state.kind === "error" && <pre className="code-block err">{state.message}</pre>}
    </ConnectShell>
  );
}

export default function ConnectLoginPage() {
  return (
    <Suspense fallback={<p className="connect-main">Loading…</p>}>
      <LoginInner />
    </Suspense>
  );
}
