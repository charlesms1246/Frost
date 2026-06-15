import { describe, expect, it } from "vitest";
import {
  OpenRouterClient,
  OpenRouterError,
  type FetchLike,
} from "../src/inference/openrouter.js";

/** Build a fake fetch that records the request and returns a canned response. */
function fakeFetch(
  response: { ok: boolean; status: number; body: string },
  capture?: { url?: string; init?: Parameters<FetchLike>[1] },
): FetchLike {
  return async (url, init) => {
    if (capture) {
      capture.url = url;
      capture.init = init;
    }
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body,
    };
  };
}

describe("OpenRouterClient", () => {
  it("maps choices[0].message.content, id and model", async () => {
    const body = JSON.stringify({
      id: "gen-abc123",
      model: "anthropic/claude-3.5-sonnet",
      choices: [{ message: { content: "hello world" } }],
    });
    const client = new OpenRouterClient({
      apiKey: "sk-test",
      model: "anthropic/claude-3.5-sonnet",
      fetchImpl: fakeFetch({ ok: true, status: 200, body }),
    });

    const res = await client.complete({
      model: "",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.text).toBe("hello world");
    expect(res.id).toBe("gen-abc123");
    expect(res.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("sends the bearer token and json response_format when requested", async () => {
    const capture: { url?: string; init?: Parameters<FetchLike>[1] } = {};
    const body = JSON.stringify({
      id: "x",
      model: "m",
      choices: [{ message: { content: "{}" } }],
    });
    const client = new OpenRouterClient({
      apiKey: "sk-secret",
      model: "default-model",
      fetchImpl: fakeFetch({ ok: true, status: 200, body }, capture),
    });

    await client.complete({
      model: "",
      messages: [{ role: "user", content: "hi" }],
      json: true,
    });

    expect(capture.url).toContain("/chat/completions");
    expect(capture.init?.headers["Authorization"]).toBe("Bearer sk-secret");
    const sent = JSON.parse(capture.init?.body ?? "{}");
    expect(sent.model).toBe("default-model");
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.temperature).toBe(0);
  });

  it("throws OpenRouterError on non-2xx with status and body", async () => {
    const client = new OpenRouterClient({
      apiKey: "sk-test",
      model: "m",
      fetchImpl: fakeFetch({ ok: false, status: 429, body: "rate limited" }),
    });

    await expect(
      client.complete({ model: "", messages: [] }),
    ).rejects.toMatchObject({
      name: "OpenRouterError",
      status: 429,
      body: "rate limited",
    });
  });

  it("throws when the response is missing message content", async () => {
    const body = JSON.stringify({ id: "x", model: "m", choices: [{}] });
    const client = new OpenRouterClient({
      apiKey: "sk-test",
      model: "m",
      fetchImpl: fakeFetch({ ok: true, status: 200, body }),
    });

    await expect(
      client.complete({ model: "", messages: [] }),
    ).rejects.toBeInstanceOf(OpenRouterError);
  });

  it("retries without response_format when a provider rejects json mode (Groq json_validate_failed)", async () => {
    const bodies: string[] = [];
    const responses = [
      { ok: false, status: 400, body: JSON.stringify({ error: { code: "json_validate_failed", message: "Failed to validate JSON." } }) },
      { ok: true, status: 200, body: JSON.stringify({ id: "x", model: "m", choices: [{ message: { content: "{\"ok\":true}" } }] }) },
    ];
    let call = 0;
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(init.body);
      const r = responses[call++]!;
      return { ok: r.ok, status: r.status, text: async () => r.body };
    };
    const client = new OpenRouterClient({ apiKey: "sk-test", model: "openai/gpt-oss-120b", fetchImpl });

    const res = await client.complete({ model: "", messages: [{ role: "user", content: "hi" }], json: true });

    expect(res.text).toBe('{"ok":true}');
    expect(call).toBe(2); // first attempt 400'd, retried once
    expect(JSON.parse(bodies[0]!).response_format).toEqual({ type: "json_object" }); // first asked for json mode
    expect(JSON.parse(bodies[1]!).response_format).toBeUndefined(); // retry dropped the constraint
  });

  it("does not retry a 400 that is not json_validate_failed", async () => {
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call++;
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { code: "context_length_exceeded" } }) };
    };
    const client = new OpenRouterClient({ apiKey: "sk-test", model: "m", fetchImpl });

    await expect(client.complete({ model: "", messages: [], json: true })).rejects.toBeInstanceOf(OpenRouterError);
    expect(call).toBe(1); // no retry
  });

  it("requires an apiKey", () => {
    expect(
      () =>
        new OpenRouterClient({
          apiKey: "",
          model: "m",
          fetchImpl: fakeFetch({ ok: true, status: 200, body: "{}" }),
        }),
    ).toThrow(/apiKey/);
  });
});
