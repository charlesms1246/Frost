import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keccak256, stringToHex, zeroAddress, type Address, type Hex } from "viem";
import { anvilAccount, walletFor, publicClient } from "./fixtures.js";
import { auditRegistryAbi } from "../src/abis.js";
import { FROST_BASE_SEPOLIA, type FrostDeployment } from "../src/addresses.js";
import * as audit from "../src/audit.js";

/**
 * AuditRegistry (§10.8) round-trip against the real bytecode on the anvil fork. Proves
 * the SDK ABI + EIP-712 typed-data match the deployed contract for BOTH the direct
 * commit and the co-signed (`commitWithSig`) path — the latter is the strongest check
 * that `signAuditCommit`'s domain/types produce a signature the contract recovers.
 */
const artifact = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../contracts/out/AuditRegistry.sol/AuditRegistry.json", import.meta.url)), "utf8")
) as { bytecode: { object: Hex } };

describe("audit registry round-trip", () => {
  let deployment: FrostDeployment;
  const submitter = anvilAccount(0);
  const owner = anvilAccount(1);

  beforeAll(async () => {
    const wallet = walletFor(submitter);
    const pub = publicClient();
    const hash = await wallet.deployContract({
      abi: auditRegistryAbi,
      bytecode: artifact.bytecode.object,
      account: submitter,
      chain: null,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    deployment = { ...FROST_BASE_SEPOLIA, auditRegistry: receipt.contractAddress as Address };
  });

  it("throws a clear error when the registry address is unconfigured (zero)", async () => {
    const unconfigured = { ...FROST_BASE_SEPOLIA, auditRegistry: zeroAddress };
    await expect(
      audit.commit(walletFor(submitter) as never, publicClient() as never, unconfigured, {
        sessionId: keccak256(stringToHex("x")),
        merkleRoot: keccak256(stringToHex("y")),
        sessionEnd: 1n,
      })
    ).rejects.toThrow(/not deployed/i);
  });

  it("direct commit stores the root and records the sender as committer", async () => {
    const sessionId = keccak256(stringToHex("session-direct"));
    const root = keccak256(stringToHex("root-direct"));
    await audit.commit(walletFor(submitter) as never, publicClient() as never, deployment, {
      sessionId,
      merkleRoot: root,
      sessionEnd: 1_700_000_000n,
    });
    const c = await audit.getCommitment(publicClient() as never, deployment, sessionId);
    expect(c.merkleRoot).toBe(root);
    expect(c.committer.toLowerCase()).toBe(submitter.address.toLowerCase());
    expect(c.committedAt).toBeGreaterThan(0n);
  });

  it("co-signed commit attributes the commitment to the signer, not the relayer", async () => {
    const sessionId = keccak256(stringToHex("session-cosigned"));
    const root = keccak256(stringToHex("root-cosigned"));
    const params = { sessionId, merkleRoot: root, sessionEnd: 1_700_000_001n };
    // Owner signs; a different account (submitter) relays the tx.
    const signature = await audit.signAuditCommit(walletFor(owner) as never, deployment, params);
    await audit.commitWithSig(walletFor(submitter) as never, publicClient() as never, deployment, { ...params, signature });

    const c = await audit.getCommitment(publicClient() as never, deployment, sessionId);
    expect(c.merkleRoot).toBe(root);
    expect(c.committer.toLowerCase()).toBe(owner.address.toLowerCase());
  });

  it("refuses a second commit for the same session (immutable anchor)", async () => {
    const sessionId = keccak256(stringToHex("session-once"));
    const root = keccak256(stringToHex("root-once"));
    await audit.commit(walletFor(submitter) as never, publicClient() as never, deployment, {
      sessionId,
      merkleRoot: root,
      sessionEnd: 5n,
    });
    await expect(
      audit.commit(walletFor(submitter) as never, publicClient() as never, deployment, {
        sessionId,
        merkleRoot: keccak256(stringToHex("root-two")),
        sessionEnd: 6n,
      })
    ).rejects.toThrow();
  });
});
