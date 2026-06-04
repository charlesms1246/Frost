import type { Address, Hex } from "viem";

/**
 * Frost / Port-42 deployment record per `DEPLOYED_CONTRACTS.md`.
 *
 * Base Sepolia (chain id 84532), deployed 2026-05-28. All lock-once admin
 * setters already executed; bindings are immutable for the lifetime of this
 * deployment.
 */
export const FROST_BASE_SEPOLIA = {
  chainId: 84532,
  delegationRegistry: "0x4981C4Ad54D1ceF31Ef9F8Dc4627CdeEEc841D6C",
  revocation:         "0xadc993c5dC34d1017dCAD10651Aff89233b39FE9",
  mandate:            "0x4F03b0df6cBB79be9E19872EF7B6809e36fA57FE",
  providerRegistry:   "0x6E33f6ec96Be0660E4E5573338113214538D5cBd",
  settlement:         "0xFBCd30DF3633b92bc79dAC6E94b7461E568CA860",
  refillableMandate:  "0x4DeC870341cfcbc208b5A7c985946e49Eb70b76E",
  usdc:               "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  delegationManager:  "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
  // §10.8 audit-root anchor. Deployed 2026-06-04 (tx 0x96e25336…327513).
  auditRegistry:      "0xeA157DE7D1ec58a0610D82171bbb4873bc19319B",
} as const satisfies FrostDeployment;

export type FrostDeployment = {
  chainId: number;
  delegationRegistry: Address;
  revocation: Address;
  mandate: Address;
  providerRegistry: Address;
  settlement: Address;
  refillableMandate: Address;
  usdc: Address;
  /** MetaMask Delegation Framework manager on this chain (Day-1 spike 8). */
  delegationManager: Address;
  /** AuditRegistry (§10.8). Zero address ⇒ not yet deployed. */
  auditRegistry: Address;
};

/**
 * AuditRegistry EIP-712 domain. Intentionally has NO `verifyingContract` so it matches
 * the wallet-bridge co-sign page (`web/app/connect/commit`) byte-for-byte; `name` and
 * `version` are baked into AuditRegistry.sol. (Adding `verifyingContract` to both the
 * contract and the page is a post-MVP hardening.)
 */
export function auditCommitEip712Domain(deployment: FrostDeployment) {
  return {
    name: "Frost",
    version: "0.1.0",
    chainId: deployment.chainId,
  } as const;
}

/**
 * Settlement EIP-712 domain. Constant across deployments on the same chain
 * because `name` and `version` are baked into Settlement.sol.
 */
export function settlementEip712Domain(deployment: FrostDeployment) {
  return {
    name: "Frost Settlement",
    version: "1",
    chainId: deployment.chainId,
    verifyingContract: deployment.settlement,
  } as const;
}

/** Marker for "unset" placeholder addresses seeded into ProviderRegistry. */
export const FROST_BASE_SEPOLIA_SEEDED_PROVIDERS = {
  veniceX402:  "0x34BED22FA0950b1ff69B61E549D7509e34F85D5b",
  veniceRpc:   "0x759FEf5547F90C8Aaa34835595A269F3a7D7B892",
  frostAudit:  "0xd93A30882E42E7b77f15f8e3f899c695C1f46353",
} as const satisfies Record<string, Address>;

/** `keccak256(REVOCATION_LATENCY_BLOCKS)` constant from Settlement.sol. */
export const REVOCATION_LATENCY_BLOCKS = 30n;

/** Mandate bounds from Caveats.sol. */
export const MAX_DELEGATION_DEPTH = 5;
export const MAX_FAN_OUT_PER_NODE = 10;
export const MAX_CAVEATS_PER_MANDATE = 24;

export type { Address, Hex };
