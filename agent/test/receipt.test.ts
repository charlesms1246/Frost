import { describe, it, expect } from "vitest";
import { keccak256, stringToHex } from "viem";
import {
  buildReceipt,
  canonicalEntryJson,
  hashLeaf,
  merkleRoot,
  merkleProof,
  verifyMerkleProof,
  type ReceiptInput,
  type ReceiptEntry,
} from "../src/audit/receipt.js";

const baseInput: ReceiptInput = {
  description: "Buy ETH when price < $2800, cross-DEX",
  rootMandateId: `0x${"ab".repeat(32)}`,
  createdAt: 1_700_000_000_000,
  children: [
    { index: 0, role: "pricer-uniswap", behavior: "pricer", status: "done", spendCapTotal: 0n, mandateId: `0x${"11".repeat(32)}` },
    { index: 1, role: "executor", behavior: "executor", status: "done", spendCapTotal: 50_000_000n, mandateId: `0x${"22".repeat(32)}`, txHash: `0x${"33".repeat(32)}` },
  ],
  routes: { venice: 2, openrouter: 1 },
  authority: { subMandateCount: 2, aggregateSubMandateBudget: 50_000_000n, bucketAvailable: 8 },
};

describe("canonical entry hashing", () => {
  it("is stable regardless of object key order", () => {
    const a: ReceiptEntry = { kind: "sub-agent", index: 1, role: "executor", status: "done", spendCapTotal: 5n };
    const b = { kind: "sub-agent", spendCapTotal: 5n, status: "done", role: "executor", index: 1 } as ReceiptEntry;
    expect(canonicalEntryJson(a)).toBe(canonicalEntryJson(b));
    expect(hashLeaf(a)).toBe(hashLeaf(b));
  });

  it("serializes bigints as decimal strings (no precision loss)", () => {
    const e: ReceiptEntry = { kind: "hitl", notionalUsdc: 50_000_000n, reason: "over threshold", approved: true };
    expect(canonicalEntryJson(e)).toContain('"notionalUsdc":"50000000"');
  });

  it("distinguishes an absent optional from a present one", () => {
    const withTx: ReceiptEntry = { kind: "revocation", txHash: `0x${"ff".repeat(32)}` };
    const without: ReceiptEntry = { kind: "revocation" };
    expect(hashLeaf(withTx)).not.toBe(hashLeaf(without));
  });
});

describe("merkle root", () => {
  it("empty ⇒ zero root", () => {
    expect(merkleRoot([])).toBe(`0x${"00".repeat(32)}`);
  });

  it("single leaf ⇒ that leaf", () => {
    const leaf = keccak256(stringToHex("only"));
    expect(merkleRoot([leaf])).toBe(leaf);
  });

  it("is deterministic, and a different leaf set yields a different root", () => {
    const l = [keccak256(stringToHex("a")), keccak256(stringToHex("b")), keccak256(stringToHex("c"))];
    const r1 = merkleRoot(l);
    expect(merkleRoot(l)).toBe(r1); // deterministic
    // Re-pairing across the structure (swap into a different pair) changes the tree.
    // NB: commutative hashing makes a within-pair swap a no-op, by design.
    expect(merkleRoot([l[2]!, l[1]!, l[0]!])).not.toBe(r1);
    expect(merkleRoot([keccak256(stringToHex("a")), keccak256(stringToHex("b")), keccak256(stringToHex("d"))])).not.toBe(r1);
  });

  it("two-leaf root is the commutative pair hash (independent of input order)", () => {
    const a = keccak256(stringToHex("x"));
    const b = keccak256(stringToHex("y"));
    expect(merkleRoot([a, b])).toBe(merkleRoot([b, a]));
  });
});

describe("inclusion proofs", () => {
  const leaves = Array.from({ length: 7 }, (_, i) => keccak256(stringToHex(`leaf-${i}`)));
  const root = merkleRoot(leaves);

  it("every leaf (incl. the odd trailing one) verifies against the root", () => {
    for (let i = 0; i < leaves.length; i++) {
      const proof = merkleProof(leaves, i);
      expect(verifyMerkleProof(leaves[i]!, proof, root)).toBe(true);
    }
  });

  it("a wrong leaf does not verify", () => {
    const proof = merkleProof(leaves, 3);
    expect(verifyMerkleProof(keccak256(stringToHex("forged")), proof, root)).toBe(false);
  });

  it("a proof for a different leaf does not verify", () => {
    expect(verifyMerkleProof(leaves[0]!, merkleProof(leaves, 4), root)).toBe(false);
  });

  it("rejects an out-of-range index", () => {
    expect(() => merkleProof(leaves, 7)).toThrow(/out of range/);
  });

  it("single-leaf proof is empty and verifies", () => {
    const one = [keccak256(stringToHex("solo"))];
    expect(merkleProof(one, 0)).toEqual([]);
    expect(verifyMerkleProof(one[0]!, [], merkleRoot(one))).toBe(true);
  });
});

describe("buildReceipt", () => {
  it("emits header → sub-agents → inference → authority in order, with a 32-byte root", () => {
    const r = buildReceipt(baseInput);
    expect(r.entries.map((e) => e.kind)).toEqual(["session", "sub-agent", "sub-agent", "inference", "authority"]);
    expect(r.leaves).toHaveLength(r.entries.length);
    expect(r.merkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.sessionId).toBe(baseInput.rootMandateId); // root mandate id is the session id
  });

  it("is reproducible — same input ⇒ same root", () => {
    expect(buildReceipt(baseInput).merkleRoot).toBe(buildReceipt(baseInput).merkleRoot);
  });

  it("every entry's leaf has a verifiable inclusion proof against the receipt root", () => {
    const r = buildReceipt(baseInput);
    for (let i = 0; i < r.leaves.length; i++) {
      expect(verifyMerkleProof(r.leaves[i]!, merkleProof(r.leaves, i), r.merkleRoot)).toBe(true);
    }
  });

  it("a tampered entry breaks its inclusion proof (tamper-evidence)", () => {
    const r = buildReceipt(baseInput);
    const tampered = hashLeaf({ ...(r.entries[1] as ReceiptEntry), detail: "altered after the fact" } as ReceiptEntry);
    expect(verifyMerkleProof(tampered, merkleProof(r.leaves, 1), r.merkleRoot)).toBe(false);
  });

  it("includes HITL approvals and a revocation entry when present", () => {
    const r = buildReceipt({
      ...baseInput,
      hitlApprovals: [{ notionalUsdc: 50_000_000n, reason: "exceeds $5 threshold", approved: true }],
      revoked: true,
      revokeTxHash: `0x${"ee".repeat(32)}`,
    });
    const kinds = r.entries.map((e) => e.kind);
    expect(kinds).toContain("hitl");
    expect(kinds).toContain("revocation");
    // ordering: hitl before revocation before inference
    expect(kinds.indexOf("hitl")).toBeLessThan(kinds.indexOf("revocation"));
    expect(kinds.indexOf("revocation")).toBeLessThan(kinds.indexOf("inference"));
  });

  it("derives a session id from the header when no root mandate id is set", () => {
    const { rootMandateId, ...noRoot } = baseInput;
    void rootMandateId;
    const r = buildReceipt(noRoot);
    expect(r.sessionId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.sessionId).not.toBe(baseInput.rootMandateId);
  });

  it("changing the order children are passed in does not change the root (sorted by index)", () => {
    const reversed = { ...baseInput, children: [...baseInput.children].reverse() };
    expect(buildReceipt(reversed).merkleRoot).toBe(buildReceipt(baseInput).merkleRoot);
  });
});
