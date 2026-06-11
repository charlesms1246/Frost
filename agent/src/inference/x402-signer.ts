/**
 * Real EVM implementation of the {@link X402PaymentSigner} seam.
 *
 * Wraps the official x402 client SDK (`@x402/core/client` + `@x402/evm/exact/client`)
 * so signing an EIP-3009 USDC `transferWithAuthorization` is done by audited code,
 * not hand-rolled (the Venice x402 skill warns hand-rolling is nonce-risky). Given a
 * `402`'s headers + body it parses the x402 `PaymentRequired`, signs the exact-scheme
 * payment with the agent's wallet, and returns the encoded `X-PAYMENT` header.
 *
 * Kept in its own module (the heavy x402 SDK imports) so the transport
 * orchestration (`x402-inference.ts`) stays dep-light and unit-testable.
 *
 * Imports are restricted to the `/client` subpaths (browser-safe; viem-based) so the
 * webview bundle never pulls the server/facilitator code.
 */

import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { EvmClientConfig } from "@x402/evm/exact/client";
import type { LocalAccount } from "viem";
import type { X402PaymentSigner } from "./x402-inference.js";

export interface EvmX402SignerConfig {
  /**
   * The wallet that pays for inference — a viem account with `signTypedData`
   * (e.g. `privateKeyToAccount(key)`). Must hold USDC on `network` for live use.
   */
  account: LocalAccount;
  /**
   * CAIP-2 network the gateway settles on, e.g. `eip155:84532` (Base Sepolia).
   * Typed as `string` so consumers need not import `@x402/core`; validated by the
   * x402 SDK at registration.
   */
  network: string;
  /**
   * Optional RPC URL. Only needed for EIP-2612 / ERC-20-approval enrichment; the
   * exact EIP-3009 `transferWithAuthorization` path does not require on-chain reads.
   */
  rpcUrl?: string;
}

/**
 * Build a live EVM x402 payment signer. The returned signer is injected into
 * {@link X402InferenceClient}; everything network/key-bound is isolated here.
 */
export function makeEvmX402Signer(config: EvmX402SignerConfig): X402PaymentSigner {
  const client = new x402Client();
  // A viem LocalAccount satisfies ClientEvmSigner structurally (address +
  // signTypedData); cast through the exported config type to bridge viem's
  // overloaded signTypedData generic to the SDK's single call signature.
  const evmConfig: EvmClientConfig = {
    signer: config.account as unknown as EvmClientConfig["signer"],
    networks: [config.network] as NonNullable<EvmClientConfig["networks"]>,
    ...(config.rpcUrl ? { schemeOptions: { rpcUrl: config.rpcUrl } } : {}),
  };
  registerExactEvmScheme(client, evmConfig);
  const http = new x402HTTPClient(client);

  return {
    async paymentHeadersFor({ getHeader, body }) {
      const required = http.getPaymentRequiredResponse(getHeader, body);
      const payload = await http.createPaymentPayload(required);
      return http.encodePaymentSignatureHeader(payload);
    },
  };
}
