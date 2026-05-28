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
