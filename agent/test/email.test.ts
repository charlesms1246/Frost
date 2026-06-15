import { describe, expect, it } from "vitest";
import { EmailPoster } from "../src/comms/email.js";
import type { FetchLike } from "../src/comms/discord.js";

interface RecordedPost {
  url: string;
  body: Record<string, unknown>;
}

function fakeFetch(status: number, recorded: RecordedPost[]): FetchLike {
  return async (url, init) => {
    recorded.push({ url, body: JSON.parse(init.body) });
    return { status, async text() { return status >= 400 ? "bad" : ""; } };
  };
}

const ENDPOINT = "https://xfrost.vercel.app/api/comms/email";

describe("EmailPoster", () => {
  it("posts to/subject/text to the relay endpoint", async () => {
    const recorded: RecordedPost[] = [];
    const receipt = await new EmailPoster({
      endpoint: ENDPOINT,
      to: "user@example.com",
      subject: "Swap done",
      fetchImpl: fakeFetch(200, recorded),
    }).post("WETH→USDC settled");

    expect(receipt).toEqual({ channel: "email", ok: true });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.url).toBe(ENDPOINT);
    expect(recorded[0]!.body).toEqual({ to: "user@example.com", subject: "Swap done", text: "WETH→USDC settled" });
  });

  it("defaults the subject and omits `from` when unset", async () => {
    const recorded: RecordedPost[] = [];
    await new EmailPoster({ endpoint: ENDPOINT, to: "a@b.com", fetchImpl: fakeFetch(200, recorded) }).post("hello");
    expect(recorded[0]!.body.subject).toBe("Frost agent update");
    expect(recorded[0]!.body).not.toHaveProperty("from");
  });

  it("includes `from` when provided", async () => {
    const recorded: RecordedPost[] = [];
    await new EmailPoster({ endpoint: ENDPOINT, to: "a@b.com", from: "frost@x.io", fetchImpl: fakeFetch(200, recorded) }).post("hi");
    expect(recorded[0]!.body.from).toBe("frost@x.io");
  });

  it("throws with the status when the relay errors", async () => {
    await expect(
      new EmailPoster({ endpoint: ENDPOINT, to: "a@b.com", fetchImpl: fakeFetch(500, []) }).post("x"),
    ).rejects.toThrow(/email relay 500/);
  });

  it("requires an endpoint and a recipient", () => {
    expect(() => new EmailPoster({ endpoint: "", to: "a@b.com", fetchImpl: fakeFetch(200, []) })).toThrow(/endpoint is required/);
    expect(() => new EmailPoster({ endpoint: ENDPOINT, to: "", fetchImpl: fakeFetch(200, []) })).toThrow(/recipient .* is required/);
  });
});
