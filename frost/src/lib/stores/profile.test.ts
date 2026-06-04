import { describe, it, expect } from "vitest";
import { profile, type Profile } from "./profile.svelte";

describe("profile store", () => {
  it("starts empty / signed-out", () => {
    profile.clear();
    expect(profile.signedIn).toBe(false);
    expect(profile.value.displayName).toBe("");
  });

  it("update merges fields and marks signed-in", () => {
    profile.clear();
    profile.update({ displayName: "Satoshi", email: "s@example.com" });
    expect(profile.signedIn).toBe(true);
    expect(profile.value.displayName).toBe("Satoshi");
    expect(profile.value.email).toBe("s@example.com");
  });

  it("a wallet address alone counts as signed-in", () => {
    profile.clear();
    profile.update({ walletAddress: "0xabc" });
    expect(profile.signedIn).toBe(true);
  });

  it("syncToHosted sends the current profile and flips synced", async () => {
    profile.clear();
    profile.update({ displayName: "Ada", email: "ada@x.io" });
    let sent: Profile | undefined;
    const ok = await profile.syncToHosted(async (p) => {
      sent = p;
    });
    expect(ok).toBe(true);
    expect(profile.synced).toBe(true);
    expect(sent?.displayName).toBe("Ada");
  });

  it("a failing sync resolves false and leaves synced=false", async () => {
    profile.clear();
    profile.update({ displayName: "Grace" });
    const ok = await profile.syncToHosted(async () => {
      throw new Error("network down");
    });
    expect(ok).toBe(false);
    expect(profile.synced).toBe(false);
  });

  it("update after a sync resets synced (so the UI can re-sync)", async () => {
    profile.clear();
    profile.update({ displayName: "Linus" });
    await profile.syncToHosted(async () => {});
    expect(profile.synced).toBe(true);
    profile.update({ email: "l@x.io" });
    expect(profile.synced).toBe(false);
  });
});
