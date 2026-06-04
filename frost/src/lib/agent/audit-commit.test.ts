import { describe, expect, it } from "vitest";
import { auditRegistryConfigured, liveCommitAudit } from "./audit-commit";
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
