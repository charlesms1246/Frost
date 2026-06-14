import { describe, expect, it } from "vitest";
import {
  X402InferenceClient,
  X402InferenceError,
  type X402FetchLike,
  type X402FetchResponse,
  type X402PaymentSigner,
  type SettleInfo,
} from "../src/inference/x402-inference.js";
import type { CompletionRequest } from "../src/inference/openrouter.js";

const REQ: CompletionRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "hi" }],
};

/** Build a fake X402FetchResponse. */
function res(
  status: number,
  bodyObj: unknown,
  headers: Record<string, string> = {},
): X402FetchResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => lower[n.toLowerCase()] ?? null },
    text: async () => (typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj)),
  };
}

const OK_BODY = {
  id: "chatcmpl-1",
  model: "served-model",
  choices: [{ message: { content: "the answer" } }],
};

/** A fetch stub that returns scripted responses per call, recording the init. */
function scriptedFetch(responses: X402FetchResponse[]): X402FetchLike & {
  calls: { url: string; headers: Record<string, string>; body: string }[];
} {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fn = (async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const next = responses[calls.length - 1];
    if (!next) throw new Error(`no scripted response for call ${calls.length}`);
    return next;
  }) as X402FetchLike & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

/** A signer that records its input and returns a fixed X-PAYMENT header. */
function fakeSigner(): X402PaymentSigner & {
  inputs: { body: unknown; paymentRequiredHeader: string | null | undefined }[];
} {
  const inputs: { body: unknown; paymentRequiredHeader: string | null | undefined }[] = [];
  return {
    inputs,
    async paymentHeadersFor({ getHeader, body }) {
      inputs.push({ body, paymentRequiredHeader: getHeader("payment-required") });
      return { "X-PAYMENT": "signed-payment-token" };
    },
  };
}

describe("X402InferenceClient", () => {
  it("returns the completion directly on an initial 200 (no payment)", async () => {
    const fetchImpl = scriptedFetch([res(200, OK_BODY)]);
    const signer = fakeSigner();
    const client = new X402InferenceClient({
      baseUrl: "http://gw/v1",
      model: "m",
      signer,
      fetchImpl,
    });

    const out = await client.complete(REQ);

    expect(out.text).toBe("the answer");
    expect(out.model).toBe("served-model");
    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0]!.url).toBe("http://gw/v1/chat/completions");
    expect(signer.inputs).toHaveLength(0); // never paid
    expect("X-PAYMENT" in fetchImpl.calls[0]!.headers).toBe(false);
  });

  it("on 402, signs a payment and retries with the X-PAYMENT header", async () => {
    const fetchImpl = scriptedFetch([
      res(402, { error: "payment required" }, { "PAYMENT-REQUIRED": "b64-reqs" }),
      res(200, OK_BODY, { "X-PAYMENT-RESPONSE": "settle-proof" }),
    ]);
    const signer = fakeSigner();
    const settled: SettleInfo[] = [];
    const client = new X402InferenceClient({
      baseUrl: "http://gw/v1",
      model: "m",
      signer,
      fetchImpl,
      onSettle: (i) => settled.push(i),
    });

    const out = await client.complete(REQ);

    expect(out.text).toBe("the answer");
    expect(fetchImpl.calls).toHaveLength(2);
    // The signer saw the 402's PAYMENT-REQUIRED header + parsed body.
    expect(signer.inputs).toHaveLength(1);
    expect(signer.inputs[0]!.paymentRequiredHeader).toBe("b64-reqs");
    expect(signer.inputs[0]!.body).toEqual({ error: "payment required" });
    // The retry carried the signed header.
    expect(fetchImpl.calls[1]!.headers["X-PAYMENT"]).toBe("signed-payment-token");
    // Settlement telemetry surfaced.
    expect(settled).toEqual([{ paymentResponse: "settle-proof" }]);
  });

  it("throws on a non-402 error without attempting payment", async () => {
    const fetchImpl = scriptedFetch([res(500, "upstream boom")]);
    const signer = fakeSigner();
    const client = new X402InferenceClient({ baseUrl: "http://gw", model: "m", signer, fetchImpl });

    await expect(client.complete(REQ)).rejects.toBeInstanceOf(X402InferenceError);
    expect(signer.inputs).toHaveLength(0);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("throws if the paid retry still fails", async () => {
    const fetchImpl = scriptedFetch([
      res(402, { error: "pay" }),
      res(402, { error: "INVALID_PAYMENT" }),
    ]);
    const client = new X402InferenceClient({
      baseUrl: "http://gw",
      model: "m",
      signer: fakeSigner(),
      fetchImpl,
    });

    await expect(client.complete(REQ)).rejects.toMatchObject({ status: 402 });
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it("requests JSON output when req.json is set", async () => {
    const fetchImpl = scriptedFetch([res(200, OK_BODY)]);
    const client = new X402InferenceClient({
      baseUrl: "http://gw",
      model: "m",
      signer: fakeSigner(),
      fetchImpl,
    });

    await client.complete({ ...REQ, json: true });

    const sent = JSON.parse(fetchImpl.calls[0]!.body) as Record<string, unknown>;
    expect(sent["response_format"]).toEqual({ type: "json_object" });
  });
});
