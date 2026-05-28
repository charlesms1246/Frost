import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { settlementAbi } from "./abis.js";
import { settlementEip712Domain, type FrostDeployment } from "./addresses.js";

/**
 * EIP-712 typed-data spec for `Settlement.settle` authorization.
 *
 * The on-chain typeHash is:
 * `keccak256("PaymentAuthorization(bytes32 mandateId,address provider,uint256 amount,bytes32 paymentNonce)")`.
 *
 * `provider` is baked into the signed digest to defeat cross-provider
 * replay even if the off-chain nonce generator drifts (§6.4 / I-12).
 */
export const PAYMENT_AUTHORIZATION_TYPES = {
  PaymentAuthorization: [
    { name: "mandateId", type: "bytes32" },
    { name: "provider", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "paymentNonce", type: "bytes32" },
  ],
} as const;

export type PaymentAuthorization = {
  mandateId: Hex;
  provider: Address;
  amount: bigint;
  paymentNonce: Hex;
};

/**
 * Sign a PaymentAuthorization with the mandate holder's key. The returned
 * signature is the 65-byte `(r, s, v)` packing Settlement's `_recover` expects.
 */
export async function signPaymentAuthorization(
  wallet: WalletClient,
  deployment: FrostDeployment,
  auth: PaymentAuthorization
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  return wallet.signTypedData({
    account,
    domain: settlementEip712Domain(deployment),
    types: PAYMENT_AUTHORIZATION_TYPES,
    primaryType: "PaymentAuthorization",
    message: auth,
  });
}

/**
 * Submit `Settlement.settle`. Anyone can call this — the signature commits
 * the holder, and the holder must have approved USDC to Settlement for the
 * pull to succeed. Returns the tx hash; reverts surface as viem errors with
 * the contract's custom-error selector.
 */
export async function settle(
  wallet: WalletClient,
  publicClient: PublicClient,
  deployment: FrostDeployment,
  params: PaymentAuthorization & { signature: Hex }
): Promise<Hex> {
  const account = wallet.account;
  if (!account) throw new Error("wallet client has no account configured");
  const { request } = await publicClient.simulateContract({
    address: deployment.settlement,
    abi: settlementAbi,
    functionName: "settle",
    args: [params.mandateId, params.provider, params.amount, params.paymentNonce, params.signature],
    account,
  });
  const txHash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

/**
 * `Settlement.getRevocationStatus(mandateId)` — pre-flight check. Returns
 * `revoked: true` only once the ancestor-chain revocation has aged past
 * `REVOCATION_LATENCY_BLOCKS`. Useful for the off-chain executor's
 * "should I bother signing?" gate.
 */
export async function getRevocationStatus(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  mandateId: Hex
): Promise<{ revoked: boolean; revokedAtBlock: bigint }> {
  const [revoked, atBlock] = (await publicClient.readContract({
    address: deployment.settlement,
    abi: settlementAbi,
    functionName: "getRevocationStatus",
    args: [mandateId],
  })) as readonly [boolean, bigint];
  return { revoked, revokedAtBlock: atBlock };
}

export async function isNonceSpent(
  publicClient: PublicClient,
  deployment: FrostDeployment,
  paymentNonce: Hex
): Promise<boolean> {
  return (await publicClient.readContract({
    address: deployment.settlement,
    abi: settlementAbi,
    functionName: "spentNonces",
    args: [paymentNonce],
  })) as boolean;
}

export async function domainSeparator(
  publicClient: PublicClient,
  deployment: FrostDeployment
): Promise<Hex> {
  return (await publicClient.readContract({
    address: deployment.settlement,
    abi: settlementAbi,
    functionName: "domainSeparator",
  })) as Hex;
}

export type { Account };
