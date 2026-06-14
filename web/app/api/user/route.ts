import { bearer, verifySession } from "@/app/_lib/auth";
import { getUserData, putUserData, type UserData } from "@/app/_lib/mongo";
import { json, preflight } from "@/app/_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Headroom for a cold MongoDB Atlas connection on the first invocation.
export const maxDuration = 30;

export function OPTIONS() {
  return preflight();
}

function authedAddress(req: Request): string | null {
  return verifySession(bearer(req.headers.get("authorization")) ?? "");
}

/** GET → the caller's synced data ({ profile, chats, automations }) or null. */
export async function GET(req: Request) {
  const address = authedAddress(req);
  if (!address) return json({ error: "unauthorized" }, 401);
  return json({ data: await getUserData(address) });
}

/** PUT { profile?, chats?, automations? } → upsert the caller's data. Secrets are never accepted. */
export async function PUT(req: Request) {
  const address = authedAddress(req);
  if (!address) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad json" }, 400);
  }
  // Allow-list the known fields only — never persist anything else a client sends.
  const data: UserData = {};
  if (body.profile && typeof body.profile === "object") data.profile = body.profile as UserData["profile"];
  if (Array.isArray(body.chats)) data.chats = body.chats;
  if (Array.isArray(body.automations)) data.automations = body.automations;
  await putUserData(address, data);
  return json({ ok: true });
}
