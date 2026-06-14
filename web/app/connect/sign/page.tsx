"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ConnectShell from "../_components/ConnectShell";

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getProvider(): EthProvider | null {
  const w = window as unknown as { ethereum?: EthProvider };
  return w.ethereum ?? null;
}

/**
 * Cloud sign-in (SIWE). Runs entirely in the browser page — which can reach BOTH
 * MetaMask and the same-origin backend — so the desktop app gets back a finished
 * session token in one bridge round-trip. Uses `personal_sign` (a basic signature),
 * NOT the ERC-7715 permissions snap, so it is decoupled from the flaky grant flow.
 */
function SignInner() {
  const params = useSearchParams();
  const challenge = params.get("challenge") ?? "";
  const port = params.get("port") ?? "";

  const missing = !challenge || !port;
  const [status, setStatus] = useState<"idle" | "working" | "ok" | "err">(() =>
    missing ? "err" : "idle",
  );
  const [detail, setDetail] = useState<string>(() =>
    missing ? "missing challenge or port query param" : "",
  );

  const run = useCallback(async () => {
    if (!challenge || !port) return;
    setStatus("working");
    setDetail("Opening MetaMask…");
    try {
      const provider = getProvider();
      if (!provider) throw new Error("No Ethereum wallet detected in this browser.");

      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error("No account selected.");

      setDetail("Requesting a sign-in challenge…");
      const nonceRes = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!nonceRes.ok) throw new Error(`nonce request failed (${nonceRes.status})`);
      const { message } = (await nonceRes.json()) as { message: string };

      setDetail("Waiting for your signature…");
      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      setDetail("Verifying…");
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!verifyRes.ok) throw new Error(`verification failed (${verifyRes.status})`);
      const { token } = (await verifyRes.json()) as { token: string };

      const cb = await fetch(`http://localhost:${port}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge, token, address }),
      });
      setDetail(`Signed in — you can return to Frost. (callback ${cb.status})`);
      setStatus(cb.ok ? "ok" : "err");
    } catch (e) {
      // Best-effort: tell the desktop app it failed so it stops waiting.
      try {
        await fetch(`http://localhost:${port}/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challenge, error: e instanceof Error ? e.message : String(e) }),
        });
      } catch {
        /* the desktop side will time out */
      }
      setStatus("err");
      setDetail(e instanceof Error ? e.message : String(e));
    }
  }, [challenge, port]);

  useEffect(() => {
    if (missing) return;
    // Don't auto-trigger MetaMask; let the user click (signing is a deliberate act).
  }, [missing]);

  return (
    <ConnectShell
      eyebrow="Bridge · Sign in"
      title="Sign in to Frost"
      subtitle="Prove wallet ownership to sync your profile, chats, and automations. No gas, no transaction."
    >
      <div className="connect-card">
        <div className="card-title">Wallet sign-in</div>
        <div className="kv"><span className="k">status</span><span className="v mono">{status}</span></div>
        <div className="kv"><span className="k">detail</span><span className="v mono">{detail || "—"}</span></div>
      </div>
      <button onClick={run} className="frost-btn" disabled={status === "working" || missing}>
        {status === "working" ? "Signing…" : "Sign in with MetaMask"}
      </button>
    </ConnectShell>
  );
}

export default function SignPage() {
  return (
    <Suspense fallback={null}>
      <SignInner />
    </Suspense>
  );
}
