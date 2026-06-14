import { buildSiweMessage, issueNonce } from "@/app/_lib/auth";
import { json, preflight } from "@/app/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** POST { address } → { nonce, message } — the exact message the wallet must sign. */
export async function POST(req: Request) {
  let address: unknown;
  try {
    ({ address } = (await req.json()) as { address?: unknown });
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return json({ error: "valid wallet address required" }, 400);
  }
  const nonce = issueNonce(address);
  return json({ nonce, message: buildSiweMessage(address, nonce) });
}
