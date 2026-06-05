import { describe, it, expect } from "vitest";
import { runMasterTool, readToolNames, toolCatalog, type ToolContext, type ToolFetch } from "./master-tools";

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    veniceApiKey: "vk",
    veniceNetwork: "base-mainnet",
    basescanApiKey: "",
    discordWebhookUrl: "",
    veniceDisabled: false,
    fallbackRpcUrl: "https://mainnet.base.org",
    chainId: 8453,
    ...over,
  };
}

/** A fetch stub that returns a fixed JSON body and records the request. */
function stubFetch(status: number, body: unknown): ToolFetch & { calls: { url: string; init: unknown }[] } {
  const calls: { url: string; init: unknown }[] = [];
  const fn = (async (url: string, init: unknown) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  }) as ToolFetch & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}

describe("master-tools", () => {
  it("exposes a catalog and the read-tool names", () => {
    const names = readToolNames();
    expect(names).toEqual(expect.arrayContaining(["current_time", "onchain_read", "price_quote", "web_search", "fetch_url", "contract_abi", "discord_test"]));
    expect(toolCatalog()).toContain("price_quote:");
  });

  it("current_time needs no network and returns the unix time", async () => {
    const r = await runMasterTool("current_time", {}, ctx());
    expect(r.ok).toBe(true);
    expect(r.observation).toMatch(/unix \d+/);
  });

  it("web_search posts the query to Venice augment and formats results", async () => {
    const fetchImpl = stubFetch(200, { results: [{ title: "T1", url: "https://a", content: "body one" }] });
    const r = await runMasterTool("web_search", { query: "base exploit" }, ctx({ fetchImpl }));
    expect(r.ok).toBe(true);
    expect(fetchImpl.calls[0].url).toContain("/augment/search");
    expect(r.observation).toContain("T1");
    expect(r.observation).toContain("https://a");
  });

  it("web_search rejects a missing query without calling the network", async () => {
    const fetchImpl = stubFetch(200, {});
    const r = await runMasterTool("web_search", {}, ctx({ fetchImpl }));
    expect(r.ok).toBe(false);
    expect(fetchImpl.calls.length).toBe(0);
  });

  it("onchain_read rejects non-read methods", async () => {
    const r = await runMasterTool("onchain_read", { method: "eth_sendTransaction" }, ctx());
    expect(r.ok).toBe(false);
    expect(r.observation).toContain("not an allowed read method");
  });

  it("onchain_read returns the JSON-RPC result via Venice", async () => {
    const fetchImpl = stubFetch(200, [{ jsonrpc: "2.0", id: 0, result: "0x10" }]);
    const r = await runMasterTool("onchain_read", { method: "eth_blockNumber", params: [] }, ctx({ fetchImpl }));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain("0x10");
  });

  it("onchain_read falls back to the public RPC when Venice is disabled", async () => {
    const fetchImpl = stubFetch(200, [{ jsonrpc: "2.0", id: 0, result: "0x20" }]);
    const r = await runMasterTool("onchain_read", { method: "eth_blockNumber", params: [] }, ctx({ veniceDisabled: true, fetchImpl }));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain("0x20");
    expect(fetchImpl.calls[0].url).toBe("https://mainnet.base.org"); // not the Venice endpoint
  });

  it("web_search is disabled when Venice is off", async () => {
    const fetchImpl = stubFetch(200, { results: [] });
    const r = await runMasterTool("web_search", { query: "x" }, ctx({ veniceDisabled: true, fetchImpl }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain("disabled");
    expect(fetchImpl.calls.length).toBe(0);
  });

  it("contract_abi is disabled without a BaseScan key (graceful)", async () => {
    const r = await runMasterTool("contract_abi", { address: "0x" + "a".repeat(40) }, ctx({ basescanApiKey: "" }));
    expect(r.ok).toBe(false);
    expect(r.observation).toContain("No BaseScan API key");
  });

  it("contract_abi lists functions when verified", async () => {
    const abi = JSON.stringify([{ type: "function", name: "swap" }, { type: "event", name: "Sync" }, { type: "function", name: "quote" }]);
    const fetchImpl = stubFetch(200, { status: "1", result: abi });
    const r = await runMasterTool("contract_abi", { address: "0x" + "b".repeat(40) }, ctx({ basescanApiKey: "K", fetchImpl }));
    expect(r.ok).toBe(true);
    expect(r.observation).toContain("swap");
    expect(r.observation).toContain("quote");
    expect(r.observation).not.toContain("Sync"); // events filtered out
  });

  it("discord_test is disabled without a configured webhook", async () => {
    const r = await runMasterTool("discord_test", {}, ctx());
    expect(r.ok).toBe(false);
    expect(r.observation).toContain("No Discord webhook");
  });

  it("discord_test posts a fixed, mention-free message to the webhook", async () => {
    const fetchImpl = stubFetch(204, "");
    const r = await runMasterTool("discord_test", {}, ctx({ discordWebhookUrl: "https://discord.com/api/webhooks/x", fetchImpl }));
    expect(r.ok).toBe(true);
    const body = JSON.parse((fetchImpl.calls[0].init as { body: string }).body);
    expect(body.content).toContain("Frost webhook test");
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("unknown tool name fails cleanly", async () => {
    const r = await runMasterTool("nope", {}, ctx());
    expect(r.ok).toBe(false);
    expect(r.observation).toContain("unknown tool");
  });
});
