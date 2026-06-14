import { describe, it, expect, vi } from "vitest";
import { cloudSignIn } from "./auth";
import { pullCloud, pushCloud, type CloudUserData } from "./sync";
import { profile } from "$lib/stores/profile.svelte";
import { chats } from "$lib/stores/chats.svelte";
import { customAgents } from "$lib/stores/custom-agents.svelte";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("cloud auth — SIWE handshake", () => {
  it("fetches a nonce, signs the message, exchanges it for a token", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/api/auth/nonce")) return jsonResponse({ nonce: "n", message: "SIGN THIS" });
      if (String(url).endsWith("/api/auth/verify")) return jsonResponse({ token: "jwt-123", address: "0xabc" });
      throw new Error("unexpected " + url);
    }) as unknown as typeof fetch;
    const sign = vi.fn(async (msg: string) => `0xsig${msg.length}` as `0x${string}`);

    const token = await cloudSignIn("0xAbc", sign, fetchImpl);

    expect(token).toBe("jwt-123");
    expect(sign).toHaveBeenCalledWith("SIGN THIS");
    const verify = calls.find((c) => c.url.endsWith("/api/auth/verify"))!;
    expect(JSON.parse(String(verify.init!.body))).toMatchObject({ message: "SIGN THIS", signature: "0xsig9" });
  });

  it("throws if verification fails", async () => {
    const fetchImpl = (async (url: string) =>
      String(url).endsWith("/api/auth/nonce")
        ? jsonResponse({ message: "m" })
        : jsonResponse({ error: "bad" }, false, 401)) as unknown as typeof fetch;
    await expect(cloudSignIn("0xAbc", async () => "0xsig", fetchImpl)).rejects.toThrow(/sign-in failed/);
  });
});

describe("cloud sync — push then restore", () => {
  it("pushes local data and restores it on pull", async () => {
    profile.update({ displayName: "Sat", email: "s@x.io" });
    customAgents.hydrate([]);
    chats.hydrate([{ id: "c1", title: "t", createdAt: 1, messages: [{ role: "user", content: "hi" }] }]);

    let stored: CloudUserData | undefined;
    const putFetch = (async (_url: string, init?: RequestInit) => {
      stored = JSON.parse(String(init!.body)) as CloudUserData;
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;

    expect(await pushCloud("tok", putFetch)).toBe(true);
    expect(stored!.profile?.displayName).toBe("Sat");
    expect(stored!.chats?.[0]?.id).toBe("c1");

    // Wipe locally (simulate a fresh device), then pull restores from the blob.
    chats.hydrate([]);
    profile.update({ displayName: "" });
    expect(chats.list).toHaveLength(0);

    const getFetch = (async () => jsonResponse({ data: stored })) as unknown as typeof fetch;
    expect(await pullCloud("tok", getFetch)).toBe(true);
    expect(profile.value.displayName).toBe("Sat");
    expect(chats.list[0]?.id).toBe("c1");
  });

  it("pull returns false when the user has no cloud data yet", async () => {
    const getFetch = (async () => jsonResponse({ data: null })) as unknown as typeof fetch;
    expect(await pullCloud("tok", getFetch)).toBe(false);
  });
});
