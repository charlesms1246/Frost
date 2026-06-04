import { describe, expect, it } from "vitest";
import { DiscordWebhookPoster, type FetchLike } from "../src/comms/discord.js";

interface RecordedPost {
  url: string;
  body: unknown;
}

function fakeFetch(status: number, recorded: RecordedPost[]): FetchLike {
  return async (url, init) => {
    recorded.push({ url, body: JSON.parse(init.body) });
    return { status, async text() { return status >= 400 ? "bad" : ""; } };
  };
}

const WEBHOOK = "https://discord.com/api/webhooks/123/abc";

describe("DiscordWebhookPoster", () => {
  it("posts content with mentions disabled (allowed_mentions parse:[])", async () => {
    const recorded: RecordedPost[] = [];
    const receipt = await new DiscordWebhookPoster(WEBHOOK, fakeFetch(204, recorded)).post("hi @everyone");

    expect(receipt).toEqual({ channel: "discord", ok: true });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.url).toBe(WEBHOOK);
    expect(recorded[0]!.body).toEqual({ content: "hi @everyone", allowed_mentions: { parse: [] } });
  });

  it("throws with the status when the webhook errors", async () => {
    await expect(
      new DiscordWebhookPoster(WEBHOOK, fakeFetch(429, [])).post("x"),
    ).rejects.toThrow(/discord webhook 429/);
  });

  it("requires a webhook url", () => {
    expect(() => new DiscordWebhookPoster("", fakeFetch(204, []))).toThrow(/webhookUrl is required/);
  });
});
