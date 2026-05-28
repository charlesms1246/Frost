"use client";

// /connect/revoke/ — Day 2 stub.
//
// Real implementation (Day 6) will:
//   1. Read `permissionContext` from query params (the `context` blob returned
//      by spike 8 — a delegation chain on Base Sepolia).
//   2. Discover the connected MetaMask Flask account (via the shared
//      `detectMetaMask()` helper).
//   3. Call the Delegation Manager (`0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`)
//      `disableDelegation(...)` or the equivalent path documented by the
//      MetaMask Delegation Toolkit.
//   4. Wait for the tx receipt; POST `{ challenge, txHash, status }` back to
//      the Tauri callback server.
//
// For now the page accepts the bridge frame (challenge + port query params)
// and reports back with `status: "not-implemented"` so the Tauri side can
// be exercised without a 404.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function RevokeInner() {
  const params = useSearchParams();
  const challenge = params.get("challenge") ?? "";
  const port = params.get("port") ?? "";
  const [status, setStatus] = useState<"idle" | "posting" | "ok" | "err">("idle");
  const [detail, setDetail] = useState<string>("");

  useEffect(() => {
    if (!challenge || !port) {
      setStatus("err");
      setDetail("missing challenge or port query param");
      return;
    }
    setStatus("posting");
    fetch(`http://localhost:${port}/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge,
        status: "not-implemented",
        note: "revoke route is a stub; real implementation Day 6",
        ts: Date.now(),
      }),
    })
      .then(async (r) => {
        setDetail(`HTTP ${r.status}: ${await r.text()}`);
        setStatus(r.ok ? "ok" : "err");
      })
      .catch((e) => {
        setStatus("err");
        setDetail(String(e));
      });
  }, [challenge, port]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 font-sans">
      <h1 className="text-2xl font-semibold">Frost · revoke (stub)</h1>
      <p className="text-sm text-zinc-600">Day 6 will replace this with the real revoke flow.</p>
      <dl className="text-xs grid grid-cols-[max-content_1fr] gap-x-3 max-w-xl break-all">
        <dt className="text-zinc-500">challenge</dt><dd>{challenge || "(missing)"}</dd>
        <dt className="text-zinc-500">port</dt><dd>{port || "(missing)"}</dd>
        <dt className="text-zinc-500">status</dt><dd>{status}</dd>
        <dt className="text-zinc-500">detail</dt><dd>{detail}</dd>
      </dl>
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
