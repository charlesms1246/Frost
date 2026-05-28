"use client";

// /connect/commit/ — Day 2 stub.
//
// Real implementation (Day 6) will:
//   1. Read `auditRoot` (bytes32) + `sessionId` from query params.
//   2. Ask the connected MetaMask Flask account to sign a typed-data payload
//      that commits the session audit Merkle root.
//   3. POST `{ challenge, signature, signer }` back to the Tauri callback server.
//   4. Tauri side then submits the commitment on-chain via the audit-trail
//      provider (per contract-architecture.md §10.8).
//
// For now this is a stub that POSTs `status: "not-implemented"` so the Tauri
// bridge frame can be exercised without a 404.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function CommitInner() {
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
        note: "commit route is a stub; real implementation Day 6",
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
      <h1 className="text-2xl font-semibold">Frost · audit commit (stub)</h1>
      <p className="text-sm text-zinc-600">Day 6 will replace this with the real audit-root co-sign flow.</p>
      <dl className="text-xs grid grid-cols-[max-content_1fr] gap-x-3 max-w-xl break-all">
        <dt className="text-zinc-500">challenge</dt><dd>{challenge || "(missing)"}</dd>
        <dt className="text-zinc-500">port</dt><dd>{port || "(missing)"}</dd>
        <dt className="text-zinc-500">status</dt><dd>{status}</dd>
        <dt className="text-zinc-500">detail</dt><dd>{detail}</dd>
      </dl>
    </main>
  );
}

export default function CommitPage() {
  return (
    <Suspense fallback={<p className="p-8">Loading…</p>}>
      <CommitInner />
    </Suspense>
  );
}
