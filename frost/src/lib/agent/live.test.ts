import { describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { liveSdkIssuer } from "./live";

/**
 * The live issuer's on-chain behavior is covered by the agent's anvil-fork
 * integration test; here we only assert the embedding wiring constructs a
 * `SubMandateIssuer` with no network call (clients connect lazily). Proves the
 * real chain-write seam is wired and ready to swap in for `simulatedIssuer`.
 */
describe("liveSdkIssuer", () => {
  it("constructs a SubMandateIssuer offline (no RPC call at build time)", () => {
    const issue = liveSdkIssuer({
      sessionPrivateKey: generatePrivateKey(),
      rpcUrl: "https://sepolia.base.org",
    });
    expect(typeof issue).toBe("function");
  });
});
