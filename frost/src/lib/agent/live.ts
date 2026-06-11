import { createWalletClient, createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  encodeRootCaveats,
  makeSdkIssuer,
  type CompiledSpec,
  type SubMandateIssuer,
} from "@frost/agent/browser";
import { CAPABILITY, CAVEAT_TYPE, capabilityWhitelist, mandate, FROST_BASE_SEPOLIA, type Caveat } from "@frost/sdk";

/**
 * The LIVE sub-mandate issuer — the real chain-write path that replaces
 * `simulatedIssuer` once issuance is approved. It wraps the SDK's
 * `issueSubMandate` (already integration-tested against an anvil fork in
 * `agent/test/spawn-flow.integration.test.ts`) with a viem wallet built from the
 * master agent's session key + a Base Sepolia RPC.
 *
 * PREREQUISITES before this can succeed on-chain (not satisfied by this code):
 *  - The ROOT mandate must already exist on-chain — i.e. the user's ERC-7715 grant
 *    via the wallet bridge has been redeemed into a root `Mandate` the session key
 *    holds. `issueSubMandate` reverts if the parent mandate is not registered.
 *  - The session key must be funded for gas on Base Sepolia.
 *  - The sub-mandate caveats must intersect within the signed CAP_REDELEGATE bounds
 *    (the contract re-enforces this; a violation surfaces as a failed spawn).
 *
 * Construction makes NO network call — clients connect lazily on first issuance.
 */
export interface LiveIssuerOptions {
  /** Master-agent session private key (holds the root mandate). */
  sessionPrivateKey: Hex;
  /** Base Sepolia JSON-RPC URL. */
  rpcUrl: string;
}

export function liveSdkIssuer(opts: LiveIssuerOptions): SubMandateIssuer {
  const account = privateKeyToAccount(opts.sessionPrivateKey);
  const transport = http(opts.rpcUrl);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  // frost / @frost/agent / @frost/sdk each resolve their own copy of viem (file:
  // links), so the WalletClient/PublicClient types are nominally distinct here though
  // structurally identical — the Vite build and agent/test/issuance.live.test.ts both
  // confirm the runtime. Cast across the duplicate-viem-types boundary.
  return makeSdkIssuer(wallet as never, publicClient as never, FROST_BASE_SEPOLIA);
}

/** The master agent's capability set on the root mandate — must include CAP_REDELEGATE
 * (or it cannot issue sub-mandates) plus every capability its sub-agents may need. */
const MASTER_AGENT_CAPABILITIES = [
  CAPABILITY.REDELEGATE,
  CAPABILITY.INFERENCE_CALL,
  CAPABILITY.RPC_READ,
  CAPABILITY.ONCHAIN_EXECUTION,
  CAPABILITY.COMMS_POST,
];

/**
 * Create the ROOT mandate on-chain (§10.1) — the prerequisite for `liveSdkIssuer`.
 * The session key here plays the "user" (issuer) and the master agent (holder); in
 * production those are distinct (the user's MetaMask grants via the wallet bridge).
 *
 * The root caveats are the compiled spec's (`encodeRootCaveats`) PLUS the
 * master-agent capability whitelist — `encodeRootCaveats` omits capabilities, and
 * the contract requires the parent to hold CAP_REDELEGATE before it will issue any
 * sub-mandate (verified live in `agent/test/issuance.live.test.ts`).
 */
export interface RootMandateOptions {
  sessionPrivateKey: Hex;
  rpcUrl: string;
  spec: CompiledSpec;
  /** Per-issuer nonce; defaults to the clock to avoid cross-run collisions. */
  nonce?: bigint;
}

export async function createLiveRootMandate(
  opts: RootMandateOptions,
): Promise<{ rootMandateId: Hex; txHash: Hex; holder: Address; commsTemplateCaveat?: Caveat }> {
  const account = privateKeyToAccount(opts.sessionPrivateKey);
  const transport = http(opts.rpcUrl);
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });

  // Build the signed caveat array ONCE so the COMMS_TEMPLATE entry we hand to the
  // comms sub-agent (for its send-time hash binding, IG-06/I-16) is provably the same
  // bytes issued on-chain — not a re-encoding that could drift from the commitment.
  const caveats = [capabilityWhitelist(MASTER_AGENT_CAPABILITIES), ...encodeRootCaveats(opts.spec)];

  // Cast the clients across the duplicate-viem-types boundary (see liveSdkIssuer).
  const { mandateId, txHash } = await mandate.issueMandate(
    wallet as never,
    publicClient as never,
    FROST_BASE_SEPOLIA,
    {
      holder: account.address,
      caveats,
      nonce: opts.nonce ?? BigInt(Date.now()),
    },
  );
  const commsTemplateCaveat = caveats.find((c) => c.caveatType === CAVEAT_TYPE.COMMS_TEMPLATE);
  return {
    rootMandateId: mandateId,
    txHash,
    holder: account.address,
    ...(commsTemplateCaveat ? { commsTemplateCaveat } : {}),
  };
}
