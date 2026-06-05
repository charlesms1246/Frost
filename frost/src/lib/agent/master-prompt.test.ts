import { describe, it, expect } from "vitest";
import { masterRuntimeContext } from "./master-prompt";
import type { FrostConfig } from "$lib/stores/config.svelte";

function cfg(over: Partial<FrostConfig>): FrostConfig {
  return {
    discordWebhookUrl: "",
    veniceApiKey: "",
    veniceModels: ["", "", ""],
    veniceCallBudget: 3,
    fallbackProvider: "openrouter",
    openRouterApiKey: "",
    groqApiKey: "",
    fallbackModels: ["", "", ""],
    rpcUrl: "",
    basescanApiKey: "",
    onboarded: true,
    ...over,
  };
}

describe("masterRuntimeContext", () => {
  it("names Groq (not OpenRouter/OpenAI) when Groq is the fallback and Venice is unused", () => {
    const ctx = masterRuntimeContext(
      cfg({ fallbackProvider: "groq", groqApiKey: "gsk", fallbackModels: ["llama-3.3-70b-versatile", "", ""] }),
    );
    expect(ctx).toContain("Provider: Groq");
    expect(ctx).toContain("llama-3.3-70b-versatile");
    expect(ctx).not.toContain("Primary provider: Venice");
  });

  it("surfaces Venice as primary with the fallback named when Venice is usable", () => {
    const ctx = masterRuntimeContext(
      cfg({ veniceApiKey: "vk", veniceModels: ["venice-uncensored", "", ""], fallbackProvider: "groq", groqApiKey: "gsk" }),
    );
    expect(ctx).toContain("Primary provider: Venice");
    expect(ctx).toContain("venice-uncensored");
    expect(ctx).toContain("Fallback provider: Groq");
  });

  it("ignores Venice and uses the fallback when Venice is disabled", () => {
    const ctx = masterRuntimeContext(
      cfg({ veniceApiKey: "vk", veniceModels: ["venice-x", "", ""], fallbackProvider: "groq", groqApiKey: "gsk", fallbackModels: ["llama-g", "", ""] }),
      true,
    );
    expect(ctx).not.toContain("Primary provider: Venice");
    expect(ctx).toContain("Provider: Groq");
    expect(ctx).toContain("llama-g");
    expect(ctx).toContain("Venice is currently OFF");
  });

  it("tells the agent NOT to ask for the webhook when Discord is configured", () => {
    const ctx = masterRuntimeContext(cfg({ discordWebhookUrl: "https://discord.com/api/webhooks/x" }));
    expect(ctx).toContain("ALREADY configured");
    expect(ctx).not.toContain("https://discord.com/api/webhooks/x"); // never leak the URL
  });

  it("flags Discord as not configured otherwise", () => {
    const ctx = masterRuntimeContext(cfg({}));
    expect(ctx).toContain("NOT configured");
  });
});
