import { describe, expect, it } from "vitest";
import { FanoutPoster } from "../src/comms/fanout.js";
import type { CommsPoster, PostReceipt } from "../src/comms/comms.js";

function okPoster(channel: string, log: string[]): CommsPoster {
  return { async post(message) { log.push(`${channel}:${message}`); return { channel, ok: true } as PostReceipt; } };
}
function failPoster(channel: string): CommsPoster {
  return { async post() { throw new Error(`${channel} down`); } };
}

describe("FanoutPoster", () => {
  it("delivers to every channel and joins the delivered channel names", async () => {
    const log: string[] = [];
    const receipt = await new FanoutPoster([okPoster("discord", log), okPoster("email", log)]).post("ping");
    expect(receipt).toEqual({ channel: "discord+email", ok: true });
    expect(log).toEqual(["discord:ping", "email:ping"]);
  });

  it("succeeds when at least one channel delivers (partial failure)", async () => {
    const log: string[] = [];
    const receipt = await new FanoutPoster([failPoster("email"), okPoster("discord", log)]).post("ping");
    expect(receipt).toEqual({ channel: "discord", ok: true });
  });

  it("throws when every channel fails, surfacing the reasons", async () => {
    await expect(
      new FanoutPoster([failPoster("email"), failPoster("discord")]).post("ping"),
    ).rejects.toThrow(/all comms channels failed: email down; discord down/);
  });

  it("requires at least one poster", () => {
    expect(() => new FanoutPoster([])).toThrow(/at least one poster/);
  });
});
