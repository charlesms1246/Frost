import { describe, it, expect, beforeEach } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import {
  anvilAccount,
  publicClient,
  walletFor,
  walletForImpersonated,
  impersonate,
  snapshot,
  revertTo,
} from "./fixtures.js";
import { FROST_BASE_SEPOLIA, settlementEip712Domain } from "../src/addresses.js";
import * as mandate from "../src/mandate.js";
import * as settlement from "../src/settlement.js";
import * as providers from "../src/providers.js";
import {
  spendCapTotal,
  spendCapPerCall,
  capabilityWhitelist,
  providerWhitelist,
  capRedelegate,
  CAPABILITY,
} from "../src/caveats/index.js";

/**
 * Settlement EIP-712 signature flow. The Settlement contract is wired to
 * the real USDC on Base Sepolia (immutable); we don't actually transfer
 * USDC here — we exercise the signing + domain-separator path.
 *
 * Deployed admin (the spike wallet) is `0xce4389AC…D8D8`. We impersonate
 * it via anvil to call `approveProvider` for the test holder.
 */
const DEPLOYED_ADMIN = "0xce4389ACb79463062c362fACB8CB04513fA3D8D8" as const;

describe("settlement signing + reads", () => {
  let snap: Hex;
  beforeEach(async () => {
    snap = await snapshot();
  });

  it("domainSeparator from chain matches the SDK's local computation", async () => {
    const pc = publicClient();
    const onChain = await settlement.domainSeparator(pc, FROST_BASE_SEPOLIA);
    // Compute it locally using the same scheme Settlement uses:
    // keccak256(abi.encode(typeHash, nameHash, versionHash, chainId, verifyingContract))
    const { keccak256: kc, encodeAbiParameters, parseAbiParameters } = await import("viem");
    const domain = settlementEip712Domain(FROST_BASE_SEPOLIA);
    const local = kc(
      encodeAbiParameters(
        parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
        [
          kc(toBytes(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
          )),
          kc(toBytes(domain.name)),
          kc(toBytes(domain.version)),
          BigInt(domain.chainId),
          domain.verifyingContract,
        ]
      )
    );
    expect(onChain).toBe(local);
  });

  it("signPaymentAuthorization: produces a 65-byte signature", async () => {
    const holder = anvilAccount(2);
    const wallet = walletFor(holder);
    const sig = await settlement.signPaymentAuthorization(wallet, FROST_BASE_SEPOLIA, {
      mandateId: ("0x" + "11".repeat(32)) as Hex,
      provider: "0x34BED22FA0950b1ff69B61E549D7509e34F85D5b",
      amount: 1_000_000n,
      paymentNonce: keccak256(toBytes("nonce-test-1")),
    });
    expect(sig).toMatch(/^0x[a-fA-F0-9]{130}$/);
  });

  it("simulate-only settle: nonce status reads pre/post", async () => {
    const pc = publicClient();
    const someNonce = keccak256(toBytes("never-used"));
    expect(await settlement.isNonceSpent(pc, FROST_BASE_SEPOLIA, someNonce)).toBe(false);
  });

  it("getRevocationStatus: false for an unknown / never-revoked mandate", async () => {
    const pc = publicClient();
    const unknown = ("0x" + "ff".repeat(32)) as Hex;
    const status = await settlement.getRevocationStatus(pc, FROST_BASE_SEPOLIA, unknown);
    expect(status.revoked).toBe(false);
    expect(status.revokedAtBlock).toBe(0n);
  });

  it("admin can re-approve a provider via impersonation (sanity for ProviderRegistry path)", async () => {
    const pc = publicClient();
    const newProvider = anvilAccount(3).address;

    await impersonate(DEPLOYED_ADMIN);
    const adminWallet = walletForImpersonated(DEPLOYED_ADMIN);

    expect(await providers.isApproved(pc, FROST_BASE_SEPOLIA, newProvider)).toBe(false);
    await providers.approveProvider(adminWallet, pc, FROST_BASE_SEPOLIA, {
      provider: newProvider,
      manifestHash: ("0x" + "00".repeat(32)) as Hex,
      manifestUri: keccak256(toBytes("https://provider.example/manifest")),
      tier: 1,
    });
    expect(await providers.isApproved(pc, FROST_BASE_SEPOLIA, newProvider)).toBe(true);

    await revertTo(snap);
  });
});
