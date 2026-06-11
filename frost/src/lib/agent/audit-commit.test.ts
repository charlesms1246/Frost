import { describe, expect, it } from "vitest";
import { auditRegistryConfigured, liveCommitAudit, requestAuditCommitSignature, type InvokeFn } from "./audit-commit";
import { FROST_BASE_SEPOLIA } from "@frost/sdk";

/**
 * The audit-commit helper is the §10.8 on-chain anchor seam. Until `DeployAudit.s.sol`
 * runs and `FROST_BASE_SEPOLIA.auditRegistry` is set, it reports unconfigured and the
 * SDK refuses to submit (so the dashboard falls back to a simulated anchor).
 */
describe("audit-commit", () => {
  it("reports not-configured while the AuditRegistry address is the zero address", () => {
    // The committed default ships with a zero address (deploy is a separate, manual step).
    expect(auditRegistryConfigured()).toBe(FROST_BASE_SEPOLIA.auditRegistry !== "0x0000000000000000000000000000000000000000");
  });

  it("refuses to commit while the AuditRegistry is undeployed (no silent no-op)", async () => {
    if (auditRegistryConfigured()) return; // once deployed, this guard no longer applies
    await expect(
      liveCommitAudit({
        sessionPrivateKey: (`0x${"11".repeat(32)}`) as `0x${string}`,
        rpcUrl: "https://base-sepolia.publicnode.com",
        sessionId: (`0x${"ab".repeat(32)}`) as `0x${string}`,
        merkleRoot: (`0x${"cd".repeat(32)}`) as `0x${string}`,
        sessionEnd: 1_700_000_000n,
      })
    ).rejects.toThrow(/not deployed/i);
  });
});

describe("requestAuditCommitSignature (T-17 co-sign bridge round-trip)", () => {
  const params = {
    sessionId: (`0x${"ab".repeat(32)}`) as `0x${string}`,
    auditRoot: (`0x${"cd".repeat(32)}`) as `0x${string}`,
    sessionEnd: 1_700_000_000,
  };

  it("drives the commit bridge op and returns the signature + signer", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    const invoke: InvokeFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return { challenge: "c", body: { challenge: "c", signature: "0xsig", signer: "0xUser" } } as never;
    };
    const res = await requestAuditCommitSignature(params, invoke);
    expect(res).toEqual({ signature: "0xsig", signer: "0xUser" });
    expect(calls[0]!.cmd).toBe("wallet_bridge_perform");
    expect(calls[0]!.args).toMatchObject({
      args: { operation: "commit", params: { sessionId: params.sessionId, auditRoot: params.auditRoot, sessionEnd: params.sessionEnd } },
    });
  });

  it("throws when the bridge reports an error (user cancelled)", async () => {
    const invoke: InvokeFn = async () => ({ challenge: "c", body: { challenge: "c", error: "user rejected" } }) as never;
    await expect(requestAuditCommitSignature(params, invoke)).rejects.toThrow(/Audit co-sign failed: user rejected/);
  });

  it("throws when no signature came back", async () => {
    const invoke: InvokeFn = async () => ({ challenge: "c", body: { challenge: "c" } }) as never;
    await expect(requestAuditCommitSignature(params, invoke)).rejects.toThrow(/no signature/);
  });
});
