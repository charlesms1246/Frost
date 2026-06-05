import { describe, it, expect } from "vitest";
import { config, fallbackKeyOf, type FrostConfig } from "./config.svelte";

describe("config store", () => {
  it("starts with defaults and not onboarded", () => {
    config.clear();
    expect(config.onboarded).toBe(false);
    expect(config.value.veniceModels[0]).toBe("llama-3.3-70b");
    expect(config.value.fallbackProvider).toBe("openrouter");
    expect(config.value.fallbackModels[0]).toBe("openai/gpt-4o-mini");
    expect(config.value.veniceCallBudget).toBe(3);
  });

  it("ready is true via Venice (primary) OR the fallback provider", () => {
    config.clear();
    config.update({ veniceApiKey: "", openRouterApiKey: "", veniceModels: ["", "", ""], fallbackModels: ["", "", ""] });
    expect(config.ready).toBe(false);
    // Venice path alone satisfies ready
    config.update({ veniceApiKey: "vk", veniceModels: ["llama", "", ""] });
    expect(config.ready).toBe(true);
    // Or the fallback path alone
    config.update({ veniceApiKey: "", veniceModels: ["", "", ""], openRouterApiKey: "sk-or", fallbackModels: ["gpt", "", ""] });
    expect(config.ready).toBe(true);
  });

  it("fallbackKeyOf picks the key for the chosen provider", () => {
    config.clear();
    config.update({ fallbackProvider: "openrouter", openRouterApiKey: "sk-or", groqApiKey: "gsk" });
    expect(fallbackKeyOf(config.value)).toBe("sk-or");
    config.update({ fallbackProvider: "groq" });
    expect(fallbackKeyOf(config.value)).toBe("gsk");
  });

  it("primaryModel uses Venice only when Venice is usable (key + model), else fallback", () => {
    config.clear();
    // Venice model set but NO key ⇒ Venice isn't usable, so the model id must not
    // leak to the fallback provider (a Venice id is invalid on Groq/OpenRouter).
    config.update({ veniceApiKey: "", veniceModels: ["v0", "", ""], fallbackModels: ["f0", "", ""] });
    expect(config.primaryModel).toBe("f0");
    // With a Venice key, the primary model is the Venice one.
    config.update({ veniceApiKey: "vk" });
    expect(config.primaryModel).toBe("v0");
    // Clearing the Venice model falls back again.
    config.update({ veniceModels: ["", "", ""] });
    expect(config.primaryModel).toBe("f0");
  });

  it("update normalizes the model triples and is patch-scoped", () => {
    config.clear();
    config.update({ veniceModels: ["a", "b"] as unknown as [string, string, string] });
    expect(config.value.veniceModels).toEqual(["a", "b", ""]);
    config.update({ discordWebhookUrl: "https://discord/x" });
    expect(config.value.veniceModels).toEqual(["a", "b", ""]); // untouched
  });

  it("syncToHosted sends the current config and flips synced", async () => {
    config.clear();
    config.update({ discordWebhookUrl: "https://discord/x" });
    let sent: FrostConfig | undefined;
    const ok = await config.syncToHosted(async (c) => {
      sent = c;
    });
    expect(ok).toBe(true);
    expect(config.synced).toBe(true);
    expect(sent?.discordWebhookUrl).toBe("https://discord/x");
  });

  it("a failing sync resolves false; update resets synced", async () => {
    config.clear();
    const bad = await config.syncToHosted(async () => {
      throw new Error("down");
    });
    expect(bad).toBe(false);
    expect(config.synced).toBe(false);

    await config.syncToHosted(async () => {});
    expect(config.synced).toBe(true);
    config.update({ veniceApiKey: "vk" });
    expect(config.synced).toBe(false);
  });
});
