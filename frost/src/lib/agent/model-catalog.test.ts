import { describe, it, expect } from "vitest";
import { fetchModelCatalog, type CatalogFetch } from "./model-catalog";

function stub(status: number, body: unknown): CatalogFetch & { calls: { url: string; init: { method: string; headers: Record<string, string> } }[] } {
  const calls: { url: string; init: { method: string; headers: Record<string, string> } }[] = [];
  const fn = (async (url: string, init: { method: string; headers: Record<string, string> }) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  }) as CatalogFetch & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

describe("fetchModelCatalog", () => {
  it("parses Groq's OpenAI-style list and sorts by id", async () => {
    const f = stub(200, { data: [{ id: "mixtral-8x7b" }, { id: "llama-3.3-70b-versatile" }] });
    const list = await fetchModelCatalog("groq", "gsk", f);
    expect(list.map((m) => m.id)).toEqual(["llama-3.3-70b-versatile", "mixtral-8x7b"]);
    expect(f.calls[0].url).toContain("api.groq.com");
    expect(f.calls[0].init.headers.Authorization).toBe("Bearer gsk");
  });

  it("hits Venice's text models endpoint with the key", async () => {
    const f = stub(200, { data: [{ id: "venice-uncensored" }] });
    const list = await fetchModelCatalog("venice", "vk", f);
    expect(list).toEqual([{ id: "venice-uncensored" }]);
    expect(f.calls[0].url).toContain("api.venice.ai");
    expect(f.calls[0].url).toContain("type=text");
  });

  it("keeps OpenRouter names and needs no key", async () => {
    const f = stub(200, { data: [{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }] });
    const list = await fetchModelCatalog("openrouter", "", f);
    expect(list[0]).toEqual({ id: "openai/gpt-4o-mini", name: "GPT-4o mini" });
    expect(f.calls[0].init.headers.Authorization).toBeUndefined();
  });

  it("throws a useful error on an HTTP failure", async () => {
    const f = stub(401, { error: "bad key" });
    await expect(fetchModelCatalog("venice", "bad", f)).rejects.toThrow(/venice models request failed \(401\)/);
  });
});
