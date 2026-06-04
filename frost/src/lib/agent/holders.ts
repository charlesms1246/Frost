import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { HolderProvisioner, KeyStore, SubMandateIssuer } from "@frost/agent/browser";

/**
 * Mint a fresh in-process EOA holder per sub-agent and store its key in the
 * Rust-backed {@link KeyStore} (DPAPI / Keychain / Secret Service). This is the
 * browser-safe holder path for non-executor roles; the executor's 1Shot server
 * wallet is the deferred live path. Used as the {@link HolderProvisioner} seam the
 * session's translate step calls before issuance.
 */
export function eoaProvisioner(keyStore: KeyStore): HolderProvisioner {
  return async () => {
    const privateKey = generatePrivateKey();
    const address = privateKeyToAccount(privateKey).address;
    await keyStore.set(address, privateKey);
    return address;
  };
}

/**
 * A simulated sub-mandate issuer for the demo (and as the seam tests mock). It does
 * NOT touch the chain — it returns a deterministic mandate id derived from the
 * nonce. Swap for `makeSdkIssuer(wallet, publicClient, deployment)` once the wallet
 * bridge supplies a signer and issuance is approved.
 */
export function simulatedIssuer(): SubMandateIssuer {
  return async ({ nonce }) => ({
    mandateId: `0x${nonce.toString(16).padStart(64, "0")}` as Hex,
    txHash: `0x${"00".repeat(32)}` as Hex,
  });
}
