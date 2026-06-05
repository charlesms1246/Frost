import { describe, it, expect } from "vitest";
import { connectMetaMaskAuthority, granterAddressOf } from "./wallet-connect";
import type { MetaMaskGrantOptions } from "$lib/agent/metamask-issuer";

describe("connectMetaMaskAuthority", () => {
  it("hex-encodes the scope, computes absolute expiry, and returns the grant", async () => {
    let seen: MetaMaskGrantOptions | undefined;
    const auth = await connectMetaMaskAuthority(
      {
        sessionAccount: "0x1111111111111111111111111111111111111111",
        tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        maxAmount: 50_000_000n, // $50 USDC
        amountPerSecond: 1n,
        expirySecs: 86_400,
        nowUnix: 1_000_000,
        justification: "test",
      },
      async (o) => {
        seen = o;
        return { granted: { delegation: "0xabc" } };
      },
    );

    // hex-encoded amounts passed to the bridge
    expect(seen?.maxAmountHex).toBe("0x" + (50_000_000).toString(16));
    expect(seen?.amountPerSecondHex).toBe("0x1");
    // full cap front-loaded so the relayer can redeem immediately (no streaming wait)
    expect(seen?.initialAmountHex).toBe("0x" + (50_000_000).toString(16));
    expect(seen?.expirySecs).toBe(86_400);
    expect(seen?.justification).toBe("test");

    // structured authority returned for storage/display
    expect(auth.sessionAccount).toBe("0x1111111111111111111111111111111111111111");
    expect(auth.maxAmount).toBe("50000000");
    expect(auth.expiryUnix).toBe(1_000_000 + 86_400);
    expect(auth.granted).toEqual({ delegation: "0xabc" });
  });

  it("defaults the justification when omitted", async () => {
    let seen: MetaMaskGrantOptions | undefined;
    await connectMetaMaskAuthority(
      {
        sessionAccount: "0x2222222222222222222222222222222222222222",
        tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        maxAmount: 1n,
        amountPerSecond: 1n,
        expirySecs: 10,
        nowUnix: 0,
      },
      async (o) => {
        seen = o;
        return { granted: null };
      },
    );
    expect(seen?.justification).toMatch(/revocable/i);
  });
});

describe("granterAddressOf", () => {
  const session = "0x1111111111111111111111111111111111111111";
  const user = "0x9999999999999999999999999999999999999999";

  it("prefers a well-known key and skips the session/delegate address", () => {
    const granted = { chainId: "0x14a34", address: user, signerMeta: { delegationManager: session } };
    expect(granterAddressOf(granted, session)).toBe(user);
  });

  it("falls back to any non-session address when no preferred key exists", () => {
    const granted = { context: "0xdeadbeef", nested: { foo: session, bar: user } };
    expect(granterAddressOf(granted, session)).toBe(user);
  });

  it("returns undefined when nothing matches", () => {
    expect(granterAddressOf({ a: 1, b: "hello" })).toBeUndefined();
  });
});
