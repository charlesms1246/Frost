import { describe, it, expect, beforeEach } from "vitest";
import { chats } from "./chats.svelte";

describe("chats store", () => {
  beforeEach(() => chats.clearAll());

  it("first user message creates a conversation titled from it", () => {
    chats.newChat();
    expect(chats.current).toBeUndefined();
    chats.append({ role: "user", content: "Compare WETH to USDC across DEXes" });
    expect(chats.current).toBeDefined();
    expect(chats.current?.messages.length).toBe(1);
    expect(chats.current?.title).toContain("Compare WETH");
    expect(chats.list.length).toBe(1);
  });

  it("subsequent messages append to the same conversation", () => {
    chats.newChat();
    chats.append({ role: "user", content: "hi" });
    chats.append({ role: "assistant", content: "hello" });
    expect(chats.current?.messages.length).toBe(2);
    expect(chats.list.length).toBe(1);
  });

  it("newChat then a message starts a separate conversation", () => {
    chats.append({ role: "user", content: "one" });
    const first = chats.currentId;
    chats.newChat();
    chats.append({ role: "user", content: "two" });
    expect(chats.currentId).not.toBe(first);
    expect(chats.list.length).toBe(2);
  });

  it("remove deletes and reselects", () => {
    chats.append({ role: "user", content: "a" });
    const id = chats.currentId!;
    chats.remove(id);
    expect(chats.list.find((c) => c.id === id)).toBeUndefined();
  });
});
