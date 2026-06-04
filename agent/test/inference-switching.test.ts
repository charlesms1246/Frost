import { describe, expect, it } from "vitest";
import {
  SwitchingInferenceTransport,
  type RouteInfo,
} from "../src/inference/switching.js";
import { VeniceInferenceClient } from "../src/inference/venice-inference.js";
import type {
  InferenceTransport,
  CompletionRequest,
  CompletionResponse,
  FetchLike,
} from "../src/inference/openrouter.js";

/** A transport that records its calls and returns a labeled response. */
function stubTransport(label: string): InferenceTransport & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      calls.push(req);
      return { text: label, model: label, id: `${label}-${calls.length}` };
    },
  };
}

/** A transport that always throws (to exercise the error-fallback path). */
function throwingTransport(message: string): InferenceTransport & { calls: number } {
  const t = {
    calls: 0,
    async complete(): Promise<CompletionResponse> {
      t.calls += 1;
      throw new Error(message);
    },
  };
  return t;
}

const REQ: CompletionRequest = { model: "", messages: [{ role: "user", content: "hi" }] };

describe("SwitchingInferenceTransport", () => {
  it("routes the first N calls to primary, then auto-switches to fallback", async () => {
    const primary = stubTransport("venice");
    const fallback = stubTransport("openrouter");
    const routes: RouteInfo[] = [];
    const sw = new SwitchingInferenceTransport({
      primary,
      fallback,
      primaryCallBudget: 2,
      onRoute: (i) => routes.push(i),
    });

    const out = [
      await sw.complete(REQ),
      await sw.complete(REQ),
      await sw.complete(REQ),
      await sw.complete(REQ),
    ];

    expect(out.map((o) => o.text)).toEqual(["venice", "venice", "openrouter", "openrouter"]);
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(2);
    expect(routes.map((r) => r.reason)).toEqual([
      "primary",
      "primary",
      "budget-exhausted",
      "budget-exhausted",
    ]);
    expect(routes[1]).toMatchObject({ primaryCallsUsed: 2, primaryCallBudget: 2 });
    expect(sw.state).toEqual({ primaryCallsUsed: 2, primaryCallBudget: 2, primaryEnabled: true });
  });

  it("budget 0 ⇒ never touches primary", async () => {
    const primary = stubTransport("venice");
    const fallback = stubTransport("openrouter");
    const sw = new SwitchingInferenceTransport({ primary, fallback, primaryCallBudget: 0 });

    await sw.complete(REQ);
    expect(primary.calls).toHaveLength(0);
    expect(fallback.calls).toHaveLength(1);
  });

  it("the master switch forces fallback immediately, ignoring remaining budget", async () => {
    const primary = stubTransport("venice");
    const fallback = stubTransport("openrouter");
    const routes: RouteInfo[] = [];
    const sw = new SwitchingInferenceTransport({
      primary,
      fallback,
      primaryCallBudget: 5,
      onRoute: (i) => routes.push(i),
    });

    await sw.complete(REQ); // primary
    sw.setPrimaryEnabled(false);
    await sw.complete(REQ); // forced fallback even though budget remains

    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
    expect(routes.map((r) => r.reason)).toEqual(["primary", "disabled"]);
    // The disabled call did NOT consume another budget slot.
    expect(sw.state.primaryCallsUsed).toBe(1);
  });

  it("a primary error falls through to fallback but still spends the budget slot", async () => {
    const primary = throwingTransport("venice 402 payment required");
    const fallback = stubTransport("openrouter");
    const routes: RouteInfo[] = [];
    const sw = new SwitchingInferenceTransport({
      primary,
      fallback,
      primaryCallBudget: 1,
      onRoute: (i) => routes.push(i),
    });

    const out = await sw.complete(REQ);
    expect(out.text).toBe("openrouter");
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      provider: "fallback",
      reason: "primary-error-fallback",
      primaryError: "venice 402 payment required",
      primaryCallsUsed: 1,
    });
    // Budget slot was consumed by the attempt — next call goes straight to fallback.
    await sw.complete(REQ);
    expect(primary.calls).toBe(1);
  });

  it("re-throws a primary error when fallbackOnError is false", async () => {
    const primary = throwingTransport("boom");
    const fallback = stubTransport("openrouter");
    const sw = new SwitchingInferenceTransport({
      primary,
      fallback,
      primaryCallBudget: 1,
      fallbackOnError: false,
    });

    await expect(sw.complete(REQ)).rejects.toThrow("boom");
    expect(fallback.calls).toHaveLength(0);
  });

  it("rejects a non-integer / negative budget at construction", () => {
    const primary = stubTransport("venice");
    const fallback = stubTransport("openrouter");
    expect(() => new SwitchingInferenceTransport({ primary, fallback, primaryCallBudget: -1 })).toThrow();
    expect(() => new SwitchingInferenceTransport({ primary, fallback, primaryCallBudget: 1.5 })).toThrow();
  });
});

/** Build a fake fetch returning a canned body (mirrors openrouter.test.ts). */
function fakeFetch(response: { ok: boolean; status: number; body: string }): FetchLike {
  return async () => ({
    ok: response.ok,
    status: response.status,
    text: async () => response.body,
  });
}

describe("VeniceInferenceClient", () => {
  it("maps the OpenAI-compatible response shape", async () => {
    const body = JSON.stringify({
      id: "venice-xyz",
      model: "llama-3.3-70b",
      choices: [{ message: { content: "{\"ok\":true}" } }],
    });
    const client = new VeniceInferenceClient({
      apiKey: "vk-test",
      model: "llama-3.3-70b",
      fetchImpl: fakeFetch({ ok: true, status: 200, body }),
    });

    const res = await client.complete({ model: "", messages: [{ role: "user", content: "hi" }], json: true });
    expect(res).toEqual({ text: "{\"ok\":true}", model: "llama-3.3-70b", id: "venice-xyz" });
  });

  it("throws VeniceInferenceError on a non-200 (e.g. 402 payment required)", async () => {
    const client = new VeniceInferenceClient({
      apiKey: "vk-test",
      model: "llama-3.3-70b",
      fetchImpl: fakeFetch({ ok: false, status: 402, body: "payment required" }),
    });
    await expect(client.complete(REQ)).rejects.toThrow(/402/);
  });

  it("requires an apiKey", () => {
    expect(() => new VeniceInferenceClient({ apiKey: "", model: "m" })).toThrow();
  });
});
