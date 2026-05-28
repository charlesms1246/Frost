// MetaMask / Flask detection via EIP-6963 (multi-injection provider discovery).
//
// Background:
//   EIP-6963 is the multi-injection wallet discovery standard. Each wallet
//   announces itself by dispatching an `eip6963:announceProvider` event with
//   an `info` object containing { uuid, name, icon, rdns }. We ask for those
//   announcements by dispatching `eip6963:requestProvider`.
//
// Why not just `window.ethereum`?
//   With multiple wallets installed, `window.ethereum` is whichever wallet won
//   the injection race — not necessarily the user's MetaMask Flask. EIP-6963
//   lets us pick the right one deterministically by `rdns`.
//
// rdns values we care about (MetaMask convention):
//   "io.metamask"        — stable MetaMask
//   "io.metamask.flask"  — MetaMask Flask (the dev / preview channel)
//   "io.metamask.mmi"    — MetaMask Institutional (out of scope here)
//
// Frost requires Flask for ERC-7715 `wallet_requestExecutionPermissions`,
// which only ships in Flask >= 13.5.0 (per `wallet-bridge-spec.md` and the
// MetaMask Snaps / Permissions roadmap).

const FLASK_MIN_VERSION = "13.5.0";

export type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo;
  // The actual EIP-1193 provider. Typed loosely to avoid pulling viem here.
  provider: {
    request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  };
};

export type MMDetection =
  | { kind: "no-metamask" }
  | { kind: "stable-only"; detail: Eip6963ProviderDetail; version?: string }
  | { kind: "flask-too-old"; detail: Eip6963ProviderDetail; version: string }
  | { kind: "flask-ok"; detail: Eip6963ProviderDetail; version: string };

/**
 * Discover all EIP-6963 providers currently announced. Resolves after
 * `timeoutMs` to give injected wallets a moment to dispatch their event
 * after we ask.
 */
export function discoverProviders(timeoutMs = 300): Promise<Eip6963ProviderDetail[]> {
  if (typeof window === "undefined") return Promise.resolve([]);
  return new Promise((resolve) => {
    const found: Eip6963ProviderDetail[] = [];
    const onAnnounce = (event: Event) => {
      // CustomEvent<{ info, provider }>
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (detail && detail.info && detail.provider) found.push(detail);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
      resolve(found);
    }, timeoutMs);
  });
}

/**
 * Query MetaMask for its version. MetaMask responds to `web3_clientVersion`
 * with a string like "MetaMask/v13.5.0/flask/...". If the API ever changes,
 * this returns undefined and the caller can fall back to assuming "unknown
 * but installed".
 */
export async function readMetaMaskVersion(
  detail: Eip6963ProviderDetail,
): Promise<string | undefined> {
  try {
    const raw = (await detail.provider.request({ method: "web3_clientVersion" })) as unknown;
    if (typeof raw !== "string") return undefined;
    // Expect "MetaMask/v13.5.0/flask/<commit>" or similar. Pull the first vX.Y.Z.
    const m = raw.match(/v?(\d+\.\d+\.\d+)/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * Top-level: tell us whether the user has Flask >= 13.5.0 installed.
 */
export async function detectMetaMask(): Promise<MMDetection> {
  const providers = await discoverProviders();
  const flask = providers.find((p) => p.info.rdns === "io.metamask.flask");
  const stable = providers.find((p) => p.info.rdns === "io.metamask");

  if (flask) {
    const version = (await readMetaMaskVersion(flask)) ?? "0.0.0";
    if (compareSemver(version, FLASK_MIN_VERSION) >= 0) {
      return { kind: "flask-ok", detail: flask, version };
    }
    return { kind: "flask-too-old", detail: flask, version };
  }
  if (stable) {
    const version = await readMetaMaskVersion(stable);
    return { kind: "stable-only", detail: stable, version };
  }
  return { kind: "no-metamask" };
}

export const FLASK_REQUIRED_VERSION = FLASK_MIN_VERSION;
