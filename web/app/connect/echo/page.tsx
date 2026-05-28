"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

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
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 font-sans">
      <h1 className="text-2xl font-semibold">Frost · /connect/echo</h1>
      <p className="text-sm text-zinc-600">
        Round-trip smoke test for the Tauri ↔ browser bridge.
      </p>
      <dl className="text-xs grid grid-cols-[max-content_1fr] gap-x-3 max-w-xl break-all">
        <dt className="text-zinc-500">challenge</dt><dd>{challenge}</dd>
        <dt className="text-zinc-500">port</dt><dd>{port}</dd>
        <dt className="text-zinc-500">params</dt><dd>{userParams}</dd>
        <dt className="text-zinc-500">status</dt><dd>{status}</dd>
        <dt className="text-zinc-500">detail</dt><dd>{detail}</dd>
      </dl>
      <button
        onClick={send}
        className="px-4 py-2 rounded bg-zinc-900 text-white text-sm"
      >
        Re-send callback
      </button>
    </main>
  );
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

export default function EchoPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading…</p>}>
      <EchoInner />
    </Suspense>
  );
}
