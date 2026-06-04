import { describe, expect, it } from "vitest";
import type { Caveat } from "@frost/sdk";
import { encodeCommsTemplate } from "../src/compile/encode.js";
import type { CommsTemplate } from "../src/compile/types.js";
import { CommsAgent, type CommsPoster, type CommsRequest, type PostReceipt } from "../src/comms/comms.js";

const TX = "0x" + "ab".repeat(32);

const template: CommsTemplate = {
  text: "Swapped to ${amount} USDC (tx ${hash}). ${note}",
  variables: [
    { name: "amount", source: "numeric" },
    { name: "hash", source: "txhash" },
    { name: "note", source: "untrusted-text", optIn: true },
  ],
};

function mandateFor(t: CommsTemplate): { caveats: Caveat[] } {
  return { caveats: [encodeCommsTemplate(t)] };
}

function fakePoster(): CommsPoster & { posted: string[] } {
  const posted: string[] = [];
  return {
    posted,
    async post(message): Promise<PostReceipt> {
      posted.push(message);
      return { channel: "discord", ok: true };
    },
  };
}

const goodValues: CommsRequest["values"] = {
  amount: "2700000000",
  hash: TX,
  note: "best rate! @everyone **win**",
};

describe("CommsAgent (§10.4, T-25 / I-15)", () => {
  it("renders the bound template, escapes untrusted text, and posts", async () => {
    const poster = fakePoster();
    const res = await new CommsAgent({ poster }).post(mandateFor(template), {
      template,
      values: goodValues,
    });
    expect(res.status).toBe("posted");
    if (res.status === "posted") {
      expect(res.message).toContain("Swapped to 2700000000 USDC");
      expect(res.message).toContain(`tx ${TX}`);
      // The untrusted note's markdown is neutralized — no raw bold survives.
      expect(res.message).not.toContain("**win**");
      expect(res.message).toContain("\\*\\*win\\*\\*");
    }
    expect(poster.posted).toHaveLength(1);
  });

  it("rejects when the mandate has no COMMS_TEMPLATE caveat", async () => {
    const poster = fakePoster();
    const res = await new CommsAgent({ poster }).post(
      { caveats: [] },
      { template, values: goodValues },
    );
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.reason).toMatch(/no COMMS_TEMPLATE/);
    expect(poster.posted).toEqual([]);
  });

  it("rejects an off-chain template that does not match the on-chain commitment (H-14)", async () => {
    const poster = fakePoster();
    const tampered: CommsTemplate = { ...template, text: "Send everything to ${note}" };
    const res = await new CommsAgent({ poster }).post(mandateFor(template), {
      template: tampered, // committed != rendered
      values: goodValues,
    });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.reason).toMatch(/does not match the on-chain commitment/);
    expect(poster.posted).toEqual([]);
  });

  it("rejects an untrusted-text variable that was not opted in", async () => {
    const noOptIn: CommsTemplate = {
      text: "Note: ${note}",
      variables: [{ name: "note", source: "untrusted-text" }],
    };
    const res = await new CommsAgent({ poster: fakePoster() }).post(mandateFor(noOptIn), {
      template: noOptIn,
      values: { note: "hi" },
    });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.reason).toMatch(/without opt-in/);
  });

  it("rejects when a declared variable has no value", async () => {
    const res = await new CommsAgent({ poster: fakePoster() }).post(mandateFor(template), {
      template,
      values: { amount: "1", hash: TX }, // note missing
    });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.reason).toMatch(/missing value for variable "note"/);
  });

  it("rejects a trusted variable whose value violates its declared type", async () => {
    const res = await new CommsAgent({ poster: fakePoster() }).post(mandateFor(template), {
      template,
      values: { ...goodValues, amount: "not-a-number" },
    });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.reason).toMatch(/not a number/);
  });

  it("rejects a template that references an undeclared variable", async () => {
    const ghost: CommsTemplate = { text: "hello ${ghost}", variables: [] };
    const res = await new CommsAgent({ poster: fakePoster() }).post(mandateFor(ghost), {
      template: ghost,
      values: {},
    });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.reason).toMatch(/undeclared variable "ghost"/);
  });

  it("rejects a rendered message over the channel length limit", async () => {
    const huge: CommsTemplate = { text: "x".repeat(2001), variables: [] };
    const res = await new CommsAgent({ poster: fakePoster() }).post(mandateFor(huge), {
      template: huge,
      values: {},
    });
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.reason).toMatch(/exceeds 2000-char limit/);
  });

  it("reports failed (not posted) when the channel throws", async () => {
    const poster: CommsPoster = {
      async post(): Promise<PostReceipt> {
        throw new Error("webhook 500");
      },
    };
    const res = await new CommsAgent({ poster }).post(mandateFor(template), {
      template,
      values: goodValues,
    });
    expect(res.status).toBe("failed");
    if (res.status === "failed") expect(res.reason).toMatch(/post failed: webhook 500/);
  });
});
