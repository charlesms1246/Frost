import { createPublicClient, createWalletClient, http } from "viem";
import type { LocalAccount } from "viem";
import { baseSepolia } from "viem/chains";
import { getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";

/**
 * Ensure the agent's session account is an EIP-7702 DELEGATED account (its code points at
 * the MetaMask gator `EIP7702StatelessDeleGatorImpl`). This is REQUIRED to pay x402 via an
 * ERC-7710 delegation: the MetaMask facilitator rejects a non-delegated payer with
 * `invalid_exact_evm_erc7710_account_not_delegated` (spike 11).
 *
 * Unlike the USER's MetaMask account (which MetaMask refuses to sign delegations for — the
 * "internal accounts" block), the SESSION key is a LOCAL key the agent controls, so it can
 * self-sign the 7702 authorization. One-time per session key; idempotent (no-op if already
 * delegated to the gator). Needs a little Base Sepolia ETH on the account for the upgrade tx.
 */

const GATOR_DESIGNATOR_PREFIX = "0xef0100";

export type DelegationResult =
  | { status: "already-delegated"; impl: `0x${string}` }
  | { status: "upgraded"; impl: `0x${string}`; txHash: `0x${string}` }
  | { status: "wrong-impl"; impl: `0x${string}`; expected: `0x${string}` };

function delegatedImpl(code: string | undefined): `0x${string}` | undefined {
  if (!code || !code.toLowerCase().startsWith(GATOR_DESIGNATOR_PREFIX) || code.length < 48) return undefined;
  return `0x${code.slice(8, 48)}` as `0x${string}`;
}

export async function ensureSessionDelegated(opts: {
  account: LocalAccount;
  rpcUrl?: string;
}): Promise<DelegationResult> {
  const gator = getSmartAccountsEnvironment(baseSepolia.id).implementations
    .EIP7702StatelessDeleGatorImpl as `0x${string}`;

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(opts.rpcUrl) });
  const walletClient = createWalletClient({
    account: opts.account,
    chain: baseSepolia,
    transport: http(opts.rpcUrl),
  });

  const code = await publicClient.getCode({ address: opts.account.address }).catch(() => undefined);
  const current = delegatedImpl(code);
  if (current) {
    // Already has a 7702 designator — accept only if it points at the gator.
    if (current.toLowerCase() === gator.toLowerCase()) return { status: "already-delegated", impl: gator };
    return { status: "wrong-impl", impl: current, expected: gator };
  }

  // Plain EOA → self-sign the 7702 authorization to the gator impl and land it on-chain.
  const authorization = await walletClient.signAuthorization({
    account: opts.account,
    contractAddress: gator,
    executor: "self",
  });
  const txHash = await walletClient.sendTransaction({
    to: opts.account.address,
    authorizationList: [authorization],
    // value 0; this tx just installs the 7702 designator.
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { status: "upgraded", impl: gator, txHash };
}
