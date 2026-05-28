// MetaMask Delegation Framework — minimum ABI needed for revocation.
//
// Source: MetaMask/delegation-framework. Pinned to the on-chain Delegation
// Manager at `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` on Base Sepolia
// (HANDOFF.md locked decisions). If the deployed contract diverges from this
// ABI the call will revert — the revoke page surfaces the revert reason.
//
// permissionContext (returned by `wallet_requestExecutionPermissions`) is
// `abi.encode(Delegation[] delegations)`. The outermost delegation is the one
// the user is granting away; that's what we pass to `disableDelegation`.

export const BASE_SEPOLIA_DELEGATION_MANAGER =
  "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3" as const;

export const CAVEAT_TUPLE = {
  type: "tuple",
  components: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
    { name: "args", type: "bytes" },
  ],
} as const;

export const DELEGATION_TUPLE = {
  type: "tuple",
  components: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "tuple[]", components: CAVEAT_TUPLE.components },
    { name: "salt", type: "uint256" },
    { name: "signature", type: "bytes" },
  ],
} as const;

export const DELEGATION_ARRAY_TYPE = [
  { ...DELEGATION_TUPLE, name: "delegations", type: "tuple[]" },
] as const;

export const DISABLE_DELEGATION_ABI = [
  {
    type: "function",
    name: "disableDelegation",
    stateMutability: "nonpayable",
    inputs: [{ name: "_delegation", ...DELEGATION_TUPLE }],
    outputs: [],
  },
] as const;

export type Caveat = {
  enforcer: `0x${string}`;
  terms: `0x${string}`;
  args: `0x${string}`;
};

export type Delegation = {
  delegate: `0x${string}`;
  delegator: `0x${string}`;
  authority: `0x${string}`;
  caveats: readonly Caveat[];
  salt: bigint;
  signature: `0x${string}`;
};
