import { keccak256, stringToHex, concat, type Hex } from "viem";

/**
 * Session audit receipt + Merkle commitment (contract-architecture §10.7 / §10.8,
 * Threat Model T-17 / T-35).
 *
 * At session end Frost compiles the audit trail — every sub-mandate issued, every
 * dispatch + result, every HITL approval, the revocation, the inference routing — into
 * an ordered list of entries, hashes each into a Merkle leaf, and computes a single
 * 32-byte root. That root is the tamper-evident commitment: anyone holding the
 * off-chain receipt can prove any entry's inclusion against the root, and a receipt
 * altered after the fact produces a root that no longer matches.
 *
 * This module is the OFF-CHAIN half (pure, browser-safe). The on-chain anchor — settling
 * the root through the audit-trail commitment service per §10.8 — is a separate seam: no
 * audit contract is deployed yet, so the root is computed and surfaced here, ready to
 * commit.
 */

export type ReceiptEntryKind =
  | "session"
  | "sub-agent"
  | "hitl"
  | "revocation"
  | "inference"
  | "authority";

export interface SessionEntry {
  kind: "session";
  description: string;
  rootMandateId?: string;
  createdAt: number;
}

export interface SubAgentEntry {
  kind: "sub-agent";
  index: number;
  role: string;
  behavior?: string;
  status: string;
  spendCapTotal?: bigint;
  mandateId?: string;
  txHash?: string;
  detail?: string;
}

export interface HitlEntry {
  kind: "hitl";
  notionalUsdc: bigint;
  reason: string;
  approved: boolean;
}

export interface RevocationEntry {
  kind: "revocation";
  txHash?: string;
}

export interface InferenceEntry {
  kind: "inference";
  venice: number;
  openrouter: number;
}

export interface AuthorityEntry {
  kind: "authority";
  subMandateCount: number;
  aggregateSubMandateBudget: bigint;
  bucketAvailable: number;
}

export type ReceiptEntry =
  | SessionEntry
  | SubAgentEntry
  | HitlEntry
  | RevocationEntry
  | InferenceEntry
  | AuthorityEntry;

export interface SessionReceipt {
  /** Stable session identifier (bytes32): the root mandate id, else derived from the header. */
  sessionId: Hex;
  description: string;
  createdAt: number;
  entries: ReceiptEntry[];
  /** Per-entry leaf hash, index-aligned with `entries`. */
  leaves: Hex[];
  /** The 32-byte Merkle commitment over the leaves. */
  merkleRoot: Hex;
}

export interface ReceiptInput {
  description: string;
  rootMandateId?: string;
  createdAt?: number;
  children: ReadonlyArray<{
    index: number;
    role: string;
    behavior?: string;
    status: string;
    spendCapTotal?: bigint;
    mandateId?: string;
    txHash?: string;
    detail?: string;
  }>;
  routes: { venice: number; openrouter: number };
  authority?: { subMandateCount: number; aggregateSubMandateBudget: bigint; bucketAvailable: number };
  hitlApprovals?: ReadonlyArray<{ notionalUsdc: bigint; reason: string; approved: boolean }>;
  revoked?: boolean;
  revokeTxHash?: string;
}

const ZERO_ROOT: Hex = `0x${"00".repeat(32)}`;

/**
 * Deterministic JSON for one entry. Keys are emitted in a fixed order per kind and
 * bigints are stringified, so the bytes (and therefore the leaf hash) are stable for a
 * given entry regardless of object construction order — the §10.7 byte-tie requirement.
 * Absent optional fields are emitted as null (not omitted) so two entries differing only
 * by presence still hash apart.
 */
export function canonicalEntryJson(e: ReceiptEntry): string {
  switch (e.kind) {
    case "session":
      return JSON.stringify({ kind: e.kind, description: e.description, rootMandateId: e.rootMandateId ?? null, createdAt: e.createdAt });
    case "sub-agent":
      return JSON.stringify({
        kind: e.kind,
        index: e.index,
        role: e.role,
        behavior: e.behavior ?? null,
        status: e.status,
        spendCapTotal: e.spendCapTotal !== undefined ? e.spendCapTotal.toString() : null,
        mandateId: e.mandateId ?? null,
        txHash: e.txHash ?? null,
        detail: e.detail ?? null,
      });
    case "hitl":
      return JSON.stringify({ kind: e.kind, notionalUsdc: e.notionalUsdc.toString(), reason: e.reason, approved: e.approved });
    case "revocation":
      return JSON.stringify({ kind: e.kind, txHash: e.txHash ?? null });
    case "inference":
      return JSON.stringify({ kind: e.kind, venice: e.venice, openrouter: e.openrouter });
    case "authority":
      return JSON.stringify({
        kind: e.kind,
        subMandateCount: e.subMandateCount,
        aggregateSubMandateBudget: e.aggregateSubMandateBudget.toString(),
        bucketAvailable: e.bucketAvailable,
      });
  }
}

/** Hash one entry into its Merkle leaf. */
export function hashLeaf(e: ReceiptEntry): Hex {
  return keccak256(stringToHex(canonicalEntryJson(e)));
}

/**
 * Commutative pair hash (OpenZeppelin MerkleProof convention): the two children are
 * sorted before hashing, so a proof only needs the sibling hashes, not their positions.
 */
function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) <= BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/**
 * Merkle root over leaf hashes. Empty ⇒ the zero root; single leaf ⇒ that leaf. At each
 * level an odd trailing node is carried up unpaired (it pairs at a higher level). Uses
 * commutative {@link hashPair} so inclusion proofs are position-independent.
 */
export function merkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) return ZERO_ROOT;
  let level = leaves.slice();
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      next.push(i + 1 < level.length ? hashPair(left, level[i + 1]!) : left);
    }
    level = next;
  }
  return level[0]!;
}

/**
 * The sibling hashes proving `leaves[index]`'s inclusion in {@link merkleRoot}. Verify
 * with {@link verifyMerkleProof}. Throws if `index` is out of range.
 */
export function merkleProof(leaves: Hex[], index: number): Hex[] {
  if (index < 0 || index >= leaves.length) throw new Error(`merkleProof: index ${index} out of range (${leaves.length} leaves)`);
  const proof: Hex[] = [];
  let level = leaves.slice();
  let idx = index;
  while (level.length > 1) {
    const sibling = idx ^ 1;
    if (sibling < level.length) proof.push(level[sibling]!);
    // else: idx is the odd trailing node, carried up with no sibling this level.
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      next.push(i + 1 < level.length ? hashPair(left, level[i + 1]!) : left);
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Recompute the root from a leaf + its proof and compare to `root`. */
export function verifyMerkleProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let computed = leaf;
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed.toLowerCase() === root.toLowerCase();
}

/** A bytes32 session id: the root mandate id when present, else keccak of the header. */
function deriveSessionId(input: ReceiptInput, createdAt: number): Hex {
  if (input.rootMandateId && /^0x[0-9a-fA-F]{64}$/.test(input.rootMandateId)) return input.rootMandateId as Hex;
  return keccak256(stringToHex(`frost-session:${input.description}:${createdAt}`));
}

/**
 * Compile the live session state into an ordered audit trail and commit it. Entry order
 * is fixed (header → sub-agents by index → HITL approvals → revocation → inference →
 * authority) so the same session always yields the same root.
 */
export function buildReceipt(input: ReceiptInput): SessionReceipt {
  const createdAt = input.createdAt ?? Date.now();
  const entries: ReceiptEntry[] = [];

  entries.push({
    kind: "session",
    description: input.description,
    ...(input.rootMandateId ? { rootMandateId: input.rootMandateId } : {}),
    createdAt,
  });

  for (const c of [...input.children].sort((a, b) => a.index - b.index)) {
    entries.push({
      kind: "sub-agent",
      index: c.index,
      role: c.role,
      ...(c.behavior ? { behavior: c.behavior } : {}),
      status: c.status,
      ...(c.spendCapTotal !== undefined ? { spendCapTotal: c.spendCapTotal } : {}),
      ...(c.mandateId ? { mandateId: c.mandateId } : {}),
      ...(c.txHash ? { txHash: c.txHash } : {}),
      ...(c.detail ? { detail: c.detail } : {}),
    });
  }

  for (const h of input.hitlApprovals ?? []) {
    entries.push({ kind: "hitl", notionalUsdc: h.notionalUsdc, reason: h.reason, approved: h.approved });
  }

  if (input.revoked) {
    entries.push({ kind: "revocation", ...(input.revokeTxHash ? { txHash: input.revokeTxHash } : {}) });
  }

  entries.push({ kind: "inference", venice: input.routes.venice, openrouter: input.routes.openrouter });

  if (input.authority) {
    entries.push({
      kind: "authority",
      subMandateCount: input.authority.subMandateCount,
      aggregateSubMandateBudget: input.authority.aggregateSubMandateBudget,
      bucketAvailable: input.authority.bucketAvailable,
    });
  }

  const leaves = entries.map(hashLeaf);
  return {
    sessionId: deriveSessionId(input, createdAt),
    description: input.description,
    createdAt,
    entries,
    leaves,
    merkleRoot: merkleRoot(leaves),
  };
}
