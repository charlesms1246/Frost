import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Vitest global setup for the on-chain integration suite. Spins up an anvil
 * fork of Base Sepolia on `localhost:8545`, exposes the URL via env, and tears
 * it down after the suite. Copied from `sdk/test/global-setup.ts` — same
 * mechanism, same Windows anvil-path handling (no `shell: true`, full exe path).
 *
 * Reads `BASE_SEPOLIA_HTTP` from `../../spikes/.env`; falls back to the public
 * RPC if absent.
 */

let anvilProc: ChildProcess | undefined;

function resolveAnvilBin(): string {
  if (process.platform === "win32") {
    const home = process.env["USERPROFILE"] ?? process.env["HOME"] ?? "";
    return `${home}\\.foundry\\bin\\anvil.exe`;
  }
  return "anvil";
}

function loadEnv(): Record<string, string> {
  const envPath = resolve(__dirname, "../../spikes/.env");
  if (!existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].trim();
  }
  return out;
}

export async function setup() {
  const env = loadEnv();
  const forkUrl = env["BASE_SEPOLIA_HTTP"] ?? "https://sepolia.base.org";
  const port = 8545;

  console.log(`[anvil] forking ${forkUrl} on port ${port}`);

  anvilProc = spawn(
    resolveAnvilBin(),
    ["--fork-url", forkUrl, "--port", String(port), "--accounts", "10"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  anvilProc.stderr?.on("data", (b) => {
    const s = b.toString();
    if (s.trim()) console.error(`[anvil] ${s.trimEnd()}`);
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) {
        const j = (await res.json()) as { result?: string };
        if (j.result) {
          console.log(`[anvil] ready, chainId=${parseInt(j.result, 16)}`);
          break;
        }
      }
    } catch {
      // not ready yet
    }
    await sleep(300);
  }
  if (Date.now() >= deadline) {
    throw new Error("anvil failed to start within 30s");
  }

  process.env["FROST_TEST_RPC"] = `http://127.0.0.1:${port}`;
}

export async function teardown() {
  if (!anvilProc || anvilProc.killed) return;
  console.log("[anvil] shutting down");
  anvilProc.kill("SIGTERM");
  await sleep(500);
  if (!anvilProc.killed) anvilProc.kill("SIGKILL");
}
