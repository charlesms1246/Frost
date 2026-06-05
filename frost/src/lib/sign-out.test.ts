import { describe, it, expect, vi, beforeEach } from "vitest";
import { signOut } from "./sign-out";
import type { InvokeFn } from "$lib/agent/metamask-issuer";
import { config } from "$lib/stores/config.svelte";
import { chats } from "$lib/stores/chats.svelte";
import { customAgents } from "$lib/stores/custom-agents.svelte";
import { profile } from "$lib/stores/profile.svelte";

const SESSION = "0x1111111111111111111111111111111111111111";
const grant = JSON.stringify([{ context: "0xabc123" }]);

beforeEach(() => {
  config.clear();
  chats.clearAll();
  customAgents.clearAll();
  profile.clear();
});

describe("signOut", () => {
  it("revokes the grant on-chain, purges the session key, then wipes every store", async () => {
    config.update({ metaMaskGrant: grant, sessionAccount: SESSION });
    profile.update({ displayName: "Alice" });
    chats.append({ role: "user", content: "hello" });

    const invoke = vi.fn(async () => ({ body: {} }));
    const keyStore = { delete: vi.fn(async () => {}) };
    const res = await signOut({ invoke: invoke as unknown as InvokeFn, keyStore });

    // revoked via the bridge with the grant's permission context
    expect(invoke).toHaveBeenCalledWith(
      "wallet_bridge_perform",
      expect.objectContaining({
        args: expect.objectContaining({ operation: "revoke", params: { permissionContext: "0xabc123" } }),
      }),
    );
    expect(keyStore.delete).toHaveBeenCalledWith(SESSION);
    expect(res).toEqual({ revoked: true });

    // everything wiped
    expect(config.value.metaMaskGrant).toBeUndefined();
    expect(config.value.sessionAccount).toBeUndefined();
    expect(profile.value.displayName).toBe("");
    expect(chats.list.length).toBe(0);
    expect(customAgents.list.length).toBe(0);
  });

  it("still wipes local data when the on-chain revoke fails, surfacing the error", async () => {
    config.update({ metaMaskGrant: grant });
    const invoke = vi.fn(async () => ({ body: { error: "user rejected" } }));
    const res = await signOut({ invoke: invoke as unknown as InvokeFn, keyStore: { delete: vi.fn(async () => {}) } });

    expect(res.revoked).toBe(false);
    expect(res.revokeError).toMatch(/user rejected/);
    expect(config.value.metaMaskGrant).toBeUndefined();
  });

  it("skips revocation when there is no grant", async () => {
    const invoke = vi.fn();
    const res = await signOut({ invoke, keyStore: { delete: vi.fn(async () => {}) } });
    expect(invoke).not.toHaveBeenCalled();
    expect(res).toEqual({ revoked: false });
  });
});
