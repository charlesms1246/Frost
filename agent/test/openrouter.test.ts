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
