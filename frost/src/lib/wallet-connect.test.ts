import { describe, it, expect } from "vitest";
import { connectMetaMaskAuthority, granterAddressOf } from "./wallet-connect";
import type { MetaMaskGrantOptions } from "$lib/agent/metamask-issuer";

describe("connectMetaMaskAuthority", () => {
  it("hex-encodes the periodic scope, computes absolute expiry, and returns the grant + context", async () => {
    let seen: MetaMaskGrantOptions | undefined;
    const auth = await connectMetaMaskAuthority(
      {
        sessionAccount: "0x1111111111111111111111111111111111111111",
        tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        periodAmount: 10_000_000n, // 10 USDC / period
        periodSecs: 86_400, // 1 day
        expirySecs: 604_800,
        nowUnix: 1_000_000,
        justification: "test",
      },
      async (o) => {
        seen = o;
        return { granted: [{ context: "0xctx", delegationManager: "0xdm", delegation: "0xabc" }] };
      },
    );

    // periodic scope passed to the bridge
    expect(seen?.periodAmountHex).toBe("0x" + (10_000_000).toString(16));
    expect(seen?.periodDurationSecs).toBe(86_400);
    expect(seen?.expirySecs).toBe(604_800);
    expect(seen?.justification).toBe("test");

    // structured authority returned for storage/display
    expect(auth.sessionAccount).toBe("0x1111111111111111111111111111111111111111");
    expect(auth.periodAmount).toBe("10000000");
    expect(auth.periodSecs).toBe(86_400);
    expect(auth.expiryUnix).toBe(1_000_000 + 604_800);
    // redeemable context + manager pulled out of the granted blob
    expect(auth.context).toBe("0xctx");
    expect(auth.delegationManager).toBe("0xdm");
  });

  it("defaults the justification when omitted", async () => {
    let seen: MetaMaskGrantOptions | undefined;
    await connectMetaMaskAuthority(
      {
        sessionAccount: "0x2222222222222222222222222222222222222222",
        tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        periodAmount: 1n,
        periodSecs: 86_400,
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
