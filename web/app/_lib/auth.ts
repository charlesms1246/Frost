/**
 * Wallet-first passwordless auth for the Frost hosted backend (SIWE-style).
 *
 * The user's wallet IS the identity — no password, no email/password store. The
 * client fetches a server-issued nonce, the user signs a human-readable sign-in
 * message with their wallet, and the server verifies the signature + nonce and
 * issues a short-lived JWT bound to the (lowercased) address. Every /api/user call
 * carries that JWT; the address in the JWT is the only key into the user's data.
 *
 * This module is framework-agnostic (no Next imports) and pure-ish so it is
 * unit-testable with a viem test account — no MetaMask, no live network.
 *
 * Security notes:
 * - The nonce is STATELESS + signed (HMAC over address+random+timestamp), so no
 *   nonce store is needed; it is single-window (5 min) and bound to the address.
 * - Signature verification tries offline ECDSA recovery first (covers EOAs and
 *   EIP-7702 smart accounts, where the account address == the signing key), then
 *   falls back to on-chain EIP-1271/6492 for true contract wallets.
 * - The JWT is HS256 (Node crypto, no external dep), short TTL, address in `sub`.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createPublicClient,
  http,
  recoverMessageAddress,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";

const NONCE_TTL_MS = 5 * 60_000; // 5 minutes
const JWT_TTL_SEC = 60 * 60 * 12; // 12 hours
const SIWE_DOMAIN = process.env.SIWE_DOMAIN ?? "xfrost.vercel.app";
const SIWE_URI = process.env.SIWE_URI ?? "https://xfrost.vercel.app";
const SIWE_CHAIN_ID = Number(process.env.SIWE_CHAIN_ID ?? 84532); // Base Sepolia
const SIWE_RPC_URL = process.env.SIWE_RPC_URL ?? "https://sepolia.base.org";

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "JWT_SECRET is missing or too short (set a 32+ char secret)",
    );
  }
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function isAddress(s: unknown): s is `0x${string}` {
  return typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
}

// ---------------------------------------------------------------------------
// Stateless signed nonce
// ---------------------------------------------------------------------------

/** Issue a nonce bound to `address` and the current time, signed with JWT_SECRET. */
export function issueNonce(address: string): string {
  const addr = address.toLowerCase();
  const rand = randomBytes(16).toString("hex");
  const ts = Date.now().toString();
  const mac = createHmac("sha256", secret())
    .update(`${addr}.${rand}.${ts}`)
    .digest("base64url");
  return `${rand}.${ts}.${mac}`;
}

/** True if `nonce` was issued by us for `address` and is still within the window. */
export function verifyNonce(address: string, nonce: string): boolean {
  const parts = nonce.split(".");
  if (parts.length !== 3) return false;
  const [rand, ts, mac] = parts;
  if (!rand || !ts || !mac) return false;
  const ageMs = Date.now() - Number(ts);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > NONCE_TTL_MS)
    return false;
  const expected = createHmac("sha256", secret())
    .update(`${address.toLowerCase()}.${rand}.${ts}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// SIWE-style sign-in message
// ---------------------------------------------------------------------------

/** Build the canonical, human-readable message the wallet signs. */
export function buildSiweMessage(
  address: string,
  nonce: string,
  issuedAt = new Date().toISOString(),
): string {
  return [
    `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to Frost to sync your profile, chats, and automations. This request will not trigger a blockchain transaction or cost any gas.",
    "",
    `URI: ${SIWE_URI}`,
    "Version: 1",
    `Chain ID: ${SIWE_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

/** Pull the address + nonce out of a message produced by {@link buildSiweMessage}. */
export function parseSiweMessage(
  message: string,
): { address: string; nonce: string } | null {
  const lines = message.split("\n");
  const address = lines[1]?.trim();
  const nonceLine = lines.find((l) => l.startsWith("Nonce: "));
  const nonce = nonceLine?.slice("Nonce: ".length).trim();
  if (!isAddress(address) || !nonce) return null;
  return { address, nonce };
}

function makePublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(SIWE_RPC_URL),
  });
}
// Type the cache from the specific factory (not the unparameterized
// `ReturnType<typeof createPublicClient>`, whose chain-type variance clashes).
let publicClient: ReturnType<typeof makePublicClient> | undefined;
function getPublicClient() {
  publicClient ??= makePublicClient();
  return publicClient;
}

/** Verify `signature` over `message` was produced by `address` (EOA/7702, then 1271/6492). */
export async function verifySignature(
  address: string,
  message: string,
  signature: Hex,
): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    if (recovered.toLowerCase() === address.toLowerCase()) return true;
  } catch {
    /* not a plain ECDSA sig — fall through to on-chain verification */
  }
  try {
    return await getPublicClient().verifyMessage({
      address: address as `0x${string}`,
      message,
      signature,
    });
  } catch {
    return false;
  }
}

/**
 * Full sign-in verification: the message is well-formed, its nonce is ours + fresh,
 * and the signature is valid for the claimed address. Returns the lowercased address
 * on success, or null.
 */
export async function verifySignIn(
  message: string,
  signature: Hex,
): Promise<string | null> {
  const parsed = parseSiweMessage(message);
  if (!parsed) return null;
  if (!verifyNonce(parsed.address, parsed.nonce)) return null;
  if (!(await verifySignature(parsed.address, message, signature))) return null;
  return parsed.address.toLowerCase();
}

// ---------------------------------------------------------------------------
// HS256 JWT (no external dependency)
// ---------------------------------------------------------------------------

/** Sign a session JWT for `address` (HS256, 12h TTL). */
export function signSession(address: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: address.toLowerCase(),
    iat: now,
    exp: now + JWT_TTL_SEC,
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac("sha256", secret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** Verify a session JWT; returns the address (`sub`) or null. */
export function verifySession(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = createHmac("sha256", secret())
    .update(`${h}.${p}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(p, "base64url").toString("utf8"),
    ) as {
      sub?: string;
      exp?: number;
    };
    if (!isAddress(payload.sub)) return null;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    )
      return null;
    return payload.sub.toLowerCase();
  } catch {
    return null;
  }
}

/** Extract a bearer token from an Authorization header, or null. */
export function bearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}
