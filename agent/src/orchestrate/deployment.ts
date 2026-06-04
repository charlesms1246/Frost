import { toFunctionSelector, type Address } from "viem";
import type { CallableSurfaceEntry } from "@frost/sdk";
import type { DeploymentConfig } from "./session-context.js";

/**
 * The REAL Base deployment config the enricher draws structural caveats from: the
 * on-chain DEX-router call surface (CALLABLE_SURFACE) and the approved x402
 * settlement providers (PROVIDER_WHITELIST).
 *
 * These are properties of the DEPLOYMENT, not the workflow — the planner's LLM must
 * never supply them (it would be inventing on-chain addresses/selectors). They are
 * supplied here, verbatim from verified on-chain records, and the enricher stamps
 * them onto sub-mandates by capability (`enrich.ts`).
 *
 * **Selectors are DERIVED from human-readable signatures** via viem's
 * `toFunctionSelector`, never hand-transcribed 4-byte literals: a typo in a
 * signature string is auditable against the router ABI, a typo in `0x04e45aaf` is
 * not (cf. H-15, CALLABLE_SURFACE selector confusion).
 *
 * Issuance target for the MVP is **Base Sepolia** (chain 84532) — that is where
 * sub-mandates are issued and the executor submits. The Base mainnet router is the
 * pricer's READ target (testnet lacks liquidity) and is exposed only as a constant.
 */

// --- Router addresses -------------------------------------------------------

/** Uniswap v3 SwapRouter02 on Base **mainnet** (8453). Canonical, verified. */
export const BASE_MAINNET_SWAP_ROUTER_02 =
  "0x2626664c2603336E57B271c5C0b26F421741e481" as Address;

/**
 * Uniswap v3 SwapRouter02 on Base **Sepolia** (84532) — the executor's write
 * target for the MVP. Per Uniswap's published deployments; CONFIRM on BaseScan
 * before live settlement (tracked in ERRORS.MD alongside the QuoterV2 check).
 */
export const BASE_SEPOLIA_SWAP_ROUTER_02 =
  "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4" as Address;

/**
 * SwapRouter02 functions the executor is permitted to call: single-hop and
 * multi-hop exact-input swaps. SwapRouter02 dropped `deadline` from these structs
 * vs. the original SwapRouter — the signatures below are SwapRouter02's.
 */
const SWAP_ROUTER_02_FNS = [
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
  "exactInput((bytes,address,uint256,uint256))",
] as const;

// --- Per-call ceiling -------------------------------------------------------

/**
 * Deployment-wide per-call USDC-equivalent ceiling (6 decimals) for a CALLABLE_SURFACE
 * entry — a structural backstop, NOT the user's spend limit. The tight, user-signed
 * caps (SPEND_CAP_TOTAL, HITL_THRESHOLD) on the same mandate do the real limiting and
 * intersect min-wise down the redelegation chain (§2.7, I-17). $1,000.
 */
export const DEFAULT_PER_CALL_CAP_USDC = 1_000_000_000n;

// --- Settlement providers (Base Sepolia, on-chain registry state) -----------

/**
 * The x402 settlement providers currently APPROVED in the on-chain ProviderRegistry
 * (Base Sepolia deploy 2026-05-28). Addresses are deterministic PLACEHOLDERS
 * (DEPLOYED_CONTRACTS.md §"Seeded providers") — real Venice payment addresses are not
 * yet published. A sub-mandate's PROVIDER_WHITELIST must match what the registry holds
 * for `Settlement.settle` to pass, so the config mirrors the registry verbatim. When
 * the real addresses land, `registry.revokeProvider` + `approveProvider` to swap, then
 * update these.
 */
export const BASE_SEPOLIA_PROVIDERS = {
  veniceX402Inference: "0x34BED22FA0950b1ff69B61E549D7509e34F85D5b",
  veniceCryptoRpc: "0x759FEf5547F90C8Aaa34835595A269F3a7D7B892",
  frostAuditTrail: "0xd93A30882E42E7b77f15f8e3f899c695C1f46353",
} as const satisfies Record<string, Address>;

// --- Builders ---------------------------------------------------------------

/** One router function the executor may call, named by its human-readable signature. */
export interface RouterCall {
  /** Router contract address (e.g. Uniswap SwapRouter02). */
  target: Address;
  /** Canonical function signature, e.g. `exactInput((bytes,address,uint256,uint256))`. */
  signature: string;
  /** Per-call USDC-equivalent ceiling (6 decimals). */
  maxValue: bigint;
}

/**
 * Lower a list of {@link RouterCall}s to {@link CallableSurfaceEntry}s, deriving each
 * 4-byte selector from its signature. The single source of truth for "what function"
 * is the readable signature, not a magic hex literal.
 */
export function surfaceFrom(calls: readonly RouterCall[]): CallableSurfaceEntry[] {
  return calls.map((c) => ({
    target: c.target,
    selector: toFunctionSelector(c.signature),
    maxValue: c.maxValue,
  }));
}

function uniswapSurface(
  router: Address,
  perCallCap: bigint = DEFAULT_PER_CALL_CAP_USDC,
): CallableSurfaceEntry[] {
  return surfaceFrom(
    SWAP_ROUTER_02_FNS.map((signature) => ({ target: router, signature, maxValue: perCallCap })),
  );
}

// --- Assembled deployments --------------------------------------------------

/** The canonical Base Sepolia (84532) deployment — the MVP issuance target. */
export const BASE_SEPOLIA_DEPLOYMENT: DeploymentConfig = {
  approvedProviders: [
    BASE_SEPOLIA_PROVIDERS.veniceX402Inference,
    BASE_SEPOLIA_PROVIDERS.veniceCryptoRpc,
    BASE_SEPOLIA_PROVIDERS.frostAuditTrail,
  ],
  callableSurface: uniswapSurface(BASE_SEPOLIA_SWAP_ROUTER_02),
};

/**
 * Resolve the deployment config for a chain. Only Base Sepolia is a real issuance
 * target today; anything else throws rather than silently returning an empty/foreign
 * surface that would mis-authorize the executor.
 */
export function deploymentConfigFor(chainId: number): DeploymentConfig {
  if (chainId === 84532) return BASE_SEPOLIA_DEPLOYMENT;
  throw new Error(
    `no deployment config for chain ${chainId}; only Base Sepolia (84532) is supported`,
  );
}
