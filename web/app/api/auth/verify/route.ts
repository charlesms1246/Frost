import { signSession, verifySignIn } from "@/app/_lib/auth";
import { json, preflight } from "@/app/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Headroom for the rare on-chain EIP-1271 signature check (smart-contract wallets).
export const maxDuration = 30;

export function OPTIONS() {
  return preflight();
}

/** POST { message, signature } → { token, address }. Verifies the SIWE signature + nonce. */
export async function POST(req: Request) {
  let body: { message?: unknown; signature?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const { message, signature } = body;
  if (
    typeof message !== "string" ||
    typeof signature !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(signature)
  ) {
    return json({ error: "message and 0x signature required" }, 400);
  }
  const address = await verifySignIn(message, signature as `0x${string}`);
  if (!address) return json({ error: "invalid signature or expired nonce" }, 401);
  return json({ token: signSession(address), address });
}
