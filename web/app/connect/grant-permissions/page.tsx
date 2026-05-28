"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { detectMetaMask, type MMDetection } from "../_lib/detect-mm";

// Permission spec — shape required by MetaMask Flask 13.5+.
// Parsed from the validator's error messages: top-level `to` (delegate address),
// no top-level `expiry`/`signer` (Flask resolves signer from the connected
// account and reads expiry from `permission.data`), and `isAdjustmentAllowed`
// lives inside `permission`.
const BASE_SEPOLIA_CHAIN_HEX = "0x14a34"; // 84532
function defaultPermissionRequest(sessionAccount: string) {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      chainId: BASE_SEPOLIA_CHAIN_HEX,
      to: sessionAccount,
      permission: {
        type: "native-token-stream",
        data: {
          amountPerSecond: "0x1",
          maxAmount: "0x1",
          initialAmount: "0x0",
          startTime: now,
          justification: "Frost spike 8 — ERC-7715 round-trip test",
        },
        isAdjustmentAllowed: true,
      },
      // ERC-7715 §"Rules": constraints live here, not at the top level.
      // `expiry` is the canonical example in the EIP.
      rules: [
        { type: "expiry", data: { timestamp: now + 60 * 30 } },
      ],
    },
  ];
}

type State =
  | { kind: "waiting-mm" }
  | { kind: "no-flask"; detection: MMDetection }
  | { kind: "ready"; detection: Extract<MMDetection, { kind: "flask-ok" }> }
  | { kind: "requesting" }
  | { kind: "posting"; granted: unknown }
  | { kind: "done"; granted: unknown; callbackStatus: number }
  | { kind: "error"; message: string };

function GrantInner() {
  const params = useSearchParams();
  const challenge = params.get("challenge") ?? "";
  const port = params.get("port") ?? "";
  const sessionAccountFromParams = (params.get("session_account") ?? "0x0000000000000000000000000000000000000001");

  const [state, setState] = useState<State>({ kind: "waiting-mm" });

  useEffect(() => {
    detectMetaMask().then((det) => {
      if (det.kind === "flask-ok") setState({ kind: "ready", detection: det });
      else setState({ kind: "no-flask", detection: det });
    });
  }, []);

  async function run() {
    if (state.kind !== "ready") return;
    const provider = state.detection.detail.provider;
    setState({ kind: "requesting" });
    try {
      // 1. Ensure an account is connected.
      await provider.request({ method: "eth_requestAccounts" });
      // 2. Ensure MetaMask is on Base Sepolia; add it if it doesn't have it yet.
      //    Flask reads token balance/metadata for the permission preview and
      //    will fail with -32001 if the chain isn't configured.
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
        } else {
          throw switchErr;
        }
      }
      const req = defaultPermissionRequest(sessionAccountFromParams);
      const granted = await provider.request({
        method: "wallet_requestExecutionPermissions",
        params: req,
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
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 font-sans">
      <h1 className="text-2xl font-semibold">Frost · grant execution permissions</h1>

      <dl className="text-xs grid grid-cols-[max-content_1fr] gap-x-3 max-w-xl break-all">
        <dt className="text-zinc-500">challenge</dt><dd>{challenge || "(missing)"}</dd>
        <dt className="text-zinc-500">port</dt><dd>{port || "(missing)"}</dd>
        <dt className="text-zinc-500">session account</dt><dd>{sessionAccountFromParams}</dd>
        <dt className="text-zinc-500">state</dt><dd>{state.kind}</dd>
      </dl>

      {state.kind === "waiting-mm" && <p>Detecting MetaMask Flask…</p>}

      {state.kind === "no-flask" && (
        <div className="text-center max-w-md">
          <p className="mb-2">MetaMask Flask &gt;= 13.5.0 is required.</p>
          <p className="text-xs text-zinc-500">Detection result: {state.detection.kind}</p>
        </div>
      )}

      {state.kind === "ready" && (
        <button onClick={run} className="px-4 py-2 rounded bg-zinc-900 text-white">
          Request permission in MetaMask
        </button>
      )}

      {state.kind === "requesting" && <p>Awaiting MetaMask approval…</p>}
      {state.kind === "posting" && <p>Posting signed permission back to Frost…</p>}

      {state.kind === "done" && (
        <div className="text-center max-w-2xl">
          <p className="text-green-700 mb-2">Done. Callback HTTP {state.callbackStatus}.</p>
          <pre className="text-xs text-left bg-zinc-100 dark:bg-zinc-900 p-3 rounded overflow-auto">
            {JSON.stringify(state.granted, null, 2)}
          </pre>
        </div>
      )}

      {state.kind === "error" && (
        <pre className="text-xs text-red-700 max-w-2xl whitespace-pre-wrap">{state.message}</pre>
      )}
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
