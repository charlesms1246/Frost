"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ConnectShell from "../_components/ConnectShell";

function EchoInner() {
  const params = useSearchParams();
  const challenge = params.get("challenge") ?? "";
  const port = params.get("port") ?? "";
  const userParams = params.get("params") ?? "{}";

  const missingParams = !challenge || !port;
  const [status, setStatus] = useState<"idle" | "posting" | "ok" | "err">(() =>
    missingParams ? "err" : "idle",
  );
  const [detail, setDetail] = useState<string>(() =>
    missingParams ? "missing challenge or port query param" : "",
  );

  async function send() {
    if (!challenge || !port) {
      setStatus("err");
      setDetail("missing challenge or port query param");
      return;
    }
    setStatus("posting");
    try {
      const res = await fetch(`http://localhost:${port}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge,
          hello: "world",
          echoed_params: safeParse(userParams),
          ts: Date.now(),
        }),
      });
      setDetail(`HTTP ${res.status}: ${await res.text()}`);
      setStatus(res.ok ? "ok" : "err");
    } catch (e) {
      setStatus("err");
      setDetail(String(e));
    }
  }

  useEffect(() => {
    if (missingParams) return;
    // auto-post on mount so the round-trip is a single user click in Tauri.
    // queueMicrotask defers the setState inside send() out of the effect body
    // to satisfy react-hooks/set-state-in-effect.
    queueMicrotask(() => {
      send();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ConnectShell
      eyebrow="Bridge · Echo"
      title="Round-trip"
      subtitle="Smoke test for the Tauri ↔ browser bridge."
    >
      <div className="connect-card">
        <div className="card-title">Callback</div>
        <div className="kv"><span className="k">challenge</span><span className="v mono">{challenge || "—"}</span></div>
        <div className="kv"><span className="k">port</span><span className="v mono">{port || "—"}</span></div>
        <div className="kv"><span className="k">params</span><span className="v mono">{userParams}</span></div>
        <div className="kv"><span className="k">status</span><span className="v mono">{status}</span></div>
        <div className="kv"><span className="k">detail</span><span className="v mono">{detail || "—"}</span></div>
      </div>
      <button onClick={send} className="frost-btn">Re-send callback</button>
    </ConnectShell>
  );
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

export default function EchoPage() {
  return (
    <Suspense fallback={<p className="connect-main">Loading…</p>}>
      <EchoInner />
    </Suspense>
  );
}
