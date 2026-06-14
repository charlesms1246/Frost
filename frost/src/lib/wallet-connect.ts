import { requestMetaMaskGrant, type MetaMaskGrantOptions } from "$lib/agent/metamask-issuer";
import { config } from "$lib/stores/config.svelte";
import { RelayerClient } from "@frost/agent/browser";

/**
 * Token + scope defaults for the demo grant: Base Sepolia USDC, an `erc20-token-periodic`
 * budget of 10 USDC/day for a week, revocable. Periodic (not stream) is the type MetaMask's
 * Advanced Permissions grant UI actually supports — verified live (see ERRORS.MD breakthrough).
 */
export const GRANT_TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;
/** Per-period spend cap (10 USDC). */
export const GRANT_PERIOD_USDC = 10_000_000n;
/** Budget period length (1 day) — the cap resets each period. */
export const GRANT_PERIOD_SECS = 86_400;
/** Total grant lifetime (1 week). */
export const GRANT_EXPIRY_SECS = 604_800;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/**
 * Base Sepolia public-relayer redemption address (from `relayer_getCapabilities`,
 * verified 2026-06-06). The ERC-7715 grant is signed `to` THIS so the 1Shot public
 * relayer can redeem the delegation on-chain — no custodial wallet in the loop. Used
 * as the fallback when a live capabilities lookup can't be made.
 */
export const RELAYER_TARGET_BASE_SEPOLIA = "0xf1ef956eff4181Ce913b664713515996858B9Ca9" as `0x${string}`;

/**
 * Capture a REAL ERC-7715 spending grant from the user's own MetaMask Smart Account
 * — the product's headline: the user delegates scoped, revocable authority instead
 * of handing over keys. This drives the existing (tested) wallet bridge and returns
 * a structured authority the app stores + displays as the session's root.
 *
 * Scope note: this captures + records the grant. Connecting it on-chain so the
 * executor spends the USER's tokens via the ERC-7710 redelegation chain
 * (`delegation.ts`) is the tracked follow-up; the runtime still issues/executes via
 * the proven path for now.
 *
 * `request` is injectable so the hex-encoding + scope math is unit-testable without
 * a live Tauri shell / MetaMask.
 */
export type MetaMaskAuthority = {
  /** The agent session account the permission was granted TO (the delegate). */
  sessionAccount: `0x${string}`;
  /** ERC-20 the session may spend. */
  tokenAddress: `0x${string}`;
  /** Per-period spend cap, token base units (decimal string). */
  periodAmount: string;
  /** Budget period length in seconds (cap resets each period). */
  periodSecs: number;
  /** Absolute expiry (unix seconds). */
  expiryUnix: number;
  /** The redeemable ERC-7715 permission context (`granted[0].context`). */
  context?: string;
  /** The DelegationManager the context redeems against (`granted[0].delegationManager`). */
  delegationManager?: string;
  /** The raw ERC-7715 granted delegation from MetaMask. */
  granted: unknown;
};

export type ConnectAuthorityOptions = {
  sessionAccount: `0x${string}`;
  tokenAddress: `0x${string}`;
  /** Per-period spend cap, token base units. */
  periodAmount: bigint;
  /** Budget period length in seconds (the cap resets each period). */
  periodSecs: number;
  /** Lifetime in seconds (→ the ERC-7715 expiry rule). */
  expirySecs: number;
  /** Current unix time (injected so the result is deterministic in tests). */
  nowUnix: number;
  justification?: string;
};

const toHex = (n: bigint): string => "0x" + n.toString(16);

/** Pull the redeemable `context` + `delegationManager` out of the raw ERC-7715 granted blob. */
function extractGrantRedemption(granted: unknown): { context?: string; delegationManager?: string } {
  const g = (Array.isArray(granted) ? granted[0] : granted) as
    | { context?: unknown; delegationManager?: unknown }
    | undefined;
  return {
    context: typeof g?.context === "string" ? g.context : undefined,
    delegationManager: typeof g?.delegationManager === "string" ? g.delegationManager : undefined,
  };
}

export async function connectMetaMaskAuthority(
  opts: ConnectAuthorityOptions,
  request: (o: MetaMaskGrantOptions) => Promise<{ granted: unknown }> = requestMetaMaskGrant,
): Promise<MetaMaskAuthority> {
  const grant = await request({
    sessionAccount: opts.sessionAccount,
    tokenAddress: opts.tokenAddress,
    periodAmountHex: toHex(opts.periodAmount),
    periodDurationSecs: opts.periodSecs,
    expirySecs: opts.expirySecs,
    justification: opts.justification ?? "Frost agent spending authority — scoped and revocable.",
  });
  const { context, delegationManager } = extractGrantRedemption(grant.granted);
  return {
    sessionAccount: opts.sessionAccount,
    tokenAddress: opts.tokenAddress,
    periodAmount: opts.periodAmount.toString(),
    periodSecs: opts.periodSecs,
    expiryUnix: opts.nowUnix + opts.expirySecs,
    context,
    delegationManager,
    granted: grant.granted,
  };
}

/**
 * Best-effort: pull the granter (user) address out of the raw ERC-7715 grant — its
 * exact shape is MetaMask-Smart-Accounts-Kit-defined, so prefer well-known keys, then
 * fall back to any 0x address that isn't the session/delegate we already know.
 */
export function granterAddressOf(granted: unknown, exclude?: string): string | undefined {
  const ex = exclude?.toLowerCase();
  const isAddr = (s: unknown): s is string => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
  const preferred = new Set(["address", "account", "delegator", "from", "signer", "granter", "owner"]);
  const seen = new Set<object>();
  let fallback: string | undefined;
  const walk = (v: unknown): string | undefined => {
    if (!v || typeof v !== "object" || seen.has(v as object)) return undefined;
    seen.add(v as object);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (isAddr(val) && val.toLowerCase() !== ex) {
        if (preferred.has(k.toLowerCase())) return val;
        fallback ??= val;
      } else if (val && typeof val === "object") {
        const hit = walk(val);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(granted) ?? fallback;
}

/** The live public-relayer redemption address for Base Sepolia, or the pinned fallback. */
export async function resolveRelayerTarget(
  client: RelayerClient = new RelayerClient({ chainId: BASE_SEPOLIA_CHAIN_ID }),
): Promise<`0x${string}`> {
  try {
    const caps = await client.getCapabilities([String(BASE_SEPOLIA_CHAIN_ID)]);
    const live = caps[String(BASE_SEPOLIA_CHAIN_ID)]?.targetAddress;
    if (live && /^0x[0-9a-fA-F]{40}$/.test(live)) return live;
  } catch {
    /* offline / CORS — fall back to the pinned target */
  }
  return RELAYER_TARGET_BASE_SEPOLIA;
}

/**
 * App-level orchestration (used by signup / login / setup): capture the user's
 * ERC-7715 grant delegated to the PUBLIC RELAYER, store it in `config`, and return the
 * granter address. Requires the Tauri shell (the wallet bridge).
 *
 * The grant's delegate (`to`) is the 1Shot public relayer's `targetAddress` — the
 * relayer redeems the delegation on-chain and is paid per-tx in USDC, so there is NO
 * custodial wallet to provision. This realizes the "no keys to manage" thesis.
 */
export async function captureMetaMaskAuthority(): Promise<{ granter?: string; sessionAccount: `0x${string}` }> {
  const target = await resolveRelayerTarget();
  const auth = await connectMetaMaskAuthority({
    sessionAccount: target,
    tokenAddress: GRANT_TOKEN,
    periodAmount: GRANT_PERIOD_USDC,
    periodSecs: GRANT_PERIOD_SECS,
    expirySecs: GRANT_EXPIRY_SECS,
    nowUnix: Math.floor(Date.now() / 1000),
  });
  config.update({
    sessionAccount: auth.sessionAccount,
    metaMaskGrant: JSON.stringify(auth.granted),
    grantTokenAddress: auth.tokenAddress,
    grantMaxAmount: auth.periodAmount,
    grantExpiryUnix: auth.expiryUnix,
  });
  return { granter: granterAddressOf(auth.granted, auth.sessionAccount), sessionAccount: auth.sessionAccount };
}
