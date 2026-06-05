/**
 * Fetch the available model list from each inference provider, so the user picks
 * from a live list in Setup instead of hand-typing model ids (a top source of the
 * "provider rejected the model" 400s). All three expose an OpenAI-style
 * `{ data: [{ id, ... }] }`. The Venice/Groq lists need the user's Bearer key;
 * OpenRouter's is public (a key is sent if present, harmlessly).
 */
export type CatalogProvider = "venice" | "groq" | "openrouter";

export type ModelInfo = { id: string; name?: string };

export type CatalogFetch = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok?: boolean; status: number; text(): Promise<string> }>;

const ENDPOINTS: Record<CatalogProvider, string> = {
  // `?type=text` keeps Venice's list to chat/inference models (not image/audio).
  venice: "https://api.venice.ai/api/v1/models?type=text",
  groq: "https://api.groq.com/openai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
};

/** Fetch + normalize a provider's model list (sorted by id). Throws on HTTP error. */
export async function fetchModelCatalog(
  provider: CatalogProvider,
  apiKey: string,
  fetchImpl?: CatalogFetch,
): Promise<ModelInfo[]> {
  const f: CatalogFetch = fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

  const res = await f(ENDPOINTS[provider], { method: "GET", headers });
  const raw = await res.text();
  const ok = res.ok ?? (res.status >= 200 && res.status < 300);
  if (!ok) throw new Error(`${provider} models request failed (${res.status}): ${raw.slice(0, 160)}`);

  const data = JSON.parse(raw) as { data?: { id?: string; name?: string }[] };
  const list = (data.data ?? [])
    .filter((m): m is { id: string; name?: string } => typeof m.id === "string" && m.id !== "")
    .map((m) => (m.name ? { id: m.id, name: m.name } : { id: m.id }));
  list.sort((a, b) => a.id.localeCompare(b.id));
  return list;
}
