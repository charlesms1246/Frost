/**
 * Contract ABIs, re-exported as `const` for viem's type-inference.
 *
 * Source of truth: `contracts/abi/*.json`, regenerated via
 * `forge inspect <Contract> abi --json`. The files under `sdk/abi/` are
 * copies kept in sync with the contracts package via the deploy workflow.
 */
import type { Abi } from "viem";
import DelegationRegistryAbi from "../abi/DelegationRegistry.json" with { type: "json" };
import RevocationAbi         from "../abi/Revocation.json"         with { type: "json" };
import MandateAbi            from "../abi/Mandate.json"            with { type: "json" };
import ProviderRegistryAbi   from "../abi/ProviderRegistry.json"   with { type: "json" };
import SettlementAbi         from "../abi/Settlement.json"         with { type: "json" };
import RefillableMandateAbi  from "../abi/RefillableMandate.json"  with { type: "json" };

// Typed as `Abi` (viem's runtime type) rather than the JSON literal — the
// JSON import yields a structural shape; viem's helpers accept Abi at the
// public-facing boundary. Call sites supply explicit return types for reads.
export const delegationRegistryAbi: Abi = DelegationRegistryAbi as Abi;
export const revocationAbi:         Abi = RevocationAbi         as Abi;
export const mandateAbi:            Abi = MandateAbi            as Abi;
export const providerRegistryAbi:   Abi = ProviderRegistryAbi   as Abi;
export const settlementAbi:         Abi = SettlementAbi         as Abi;
export const refillableMandateAbi:  Abi = RefillableMandateAbi  as Abi;

/** Minimal ERC-20 surface used by USDC interactions. */
export const erc20Abi: Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
];

/**
 * AuditRegistry (§10.8 on-chain audit-root anchor). Hand-written like {@link erc20Abi}
 * — the contract is small and has no generated JSON copy under `sdk/abi/`.
 */
export const auditRegistryAbi: Abi = [
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "sessionEnd", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "commitWithSig",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "sessionEnd", type: "uint64" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "commitments",
    stateMutability: "view",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [
      { name: "merkleRoot", type: "bytes32" },
      { name: "committer", type: "address" },
      { name: "sessionEnd", type: "uint64" },
      { name: "committedAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "isCommitted",
    stateMutability: "view",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "domainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "event",
    name: "AuditCommitted",
    inputs: [
      { name: "sessionId", type: "bytes32", indexed: true },
      { name: "merkleRoot", type: "bytes32", indexed: true },
      { name: "committer", type: "address", indexed: true },
      { name: "sessionEnd", type: "uint64", indexed: false },
      { name: "committedAt", type: "uint64", indexed: false },
    ],
  },
  { type: "error", name: "AlreadyCommitted", inputs: [{ name: "sessionId", type: "bytes32" }] },
  { type: "error", name: "ZeroRoot", inputs: [] },
  { type: "error", name: "ZeroSession", inputs: [] },
  { type: "error", name: "InvalidSignature", inputs: [] },
];
