/**
 * MongoDB Atlas accessor for the Frost hosted backend.
 *
 * Stores ONE document per user, keyed by the lowercased wallet address. The
 * document is a schema-light blob the desktop app round-trips: profile (display
 * name / email / avatar), chat history, and automations (custom agents + saved
 * workflows). It deliberately holds NO secrets — never a session key, never the
 * live ERC-7715 grant. Those are per-device and re-established by re-delegating.
 */

import { MongoClient, type Collection } from "mongodb";

const DB_NAME = process.env.MONGODB_DB ?? "frost";
const COLLECTION = "users";

export type UserData = {
  profile?: { displayName?: string; email?: string; avatarDataUrl?: string };
  /** Serialized chat history (the desktop `chats` store). */
  chats?: unknown[];
  /** Serialized automations (custom agents + saved workflows). */
  automations?: unknown[];
};

export type UserDoc = UserData & {
  /** Lowercased wallet address — the `_id`. */
  _id: string;
  updatedAt: Date;
};

/** Cache the client across hot-reloads (dev) and serverless invocations. */
function clientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const g = globalThis as unknown as { _frostMongo?: Promise<MongoClient> };
  g._frostMongo ??= new MongoClient(uri).connect();
  return g._frostMongo;
}

async function users(): Promise<Collection<UserDoc>> {
  const client = await clientPromise();
  return client.db(DB_NAME).collection<UserDoc>(COLLECTION);
}

/** Fetch a user's synced data (or null if they've never synced). */
export async function getUserData(address: string): Promise<UserData | null> {
  const col = await users();
  const doc = await col.findOne({ _id: address.toLowerCase() });
  if (!doc) return null;
  return { profile: doc.profile, chats: doc.chats, automations: doc.automations };
}

/** Upsert a user's synced data. Only the data fields are written (never secrets). */
export async function putUserData(address: string, data: UserData): Promise<void> {
  const col = await users();
  const set: Partial<UserDoc> = { updatedAt: new Date() };
  if (data.profile !== undefined) set.profile = data.profile;
  if (data.chats !== undefined) set.chats = data.chats;
  if (data.automations !== undefined) set.automations = data.automations;
  await col.updateOne(
    { _id: address.toLowerCase() },
    { $set: set, $setOnInsert: { _id: address.toLowerCase() } },
    { upsert: true },
  );
}
