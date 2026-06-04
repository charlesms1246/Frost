import type { CommsPoster, PostReceipt } from "./comms.js";

/**
 * Discord webhook {@link CommsPoster}. The webhook URL is a session secret (threat
 * T-27, stored in the OS vault by the desktop app) and is injected here, never
 * logged. `fetch` is injectable so the post mapping is unit-testable offline.
 *
 * The post ALWAYS sets `allowed_mentions: { parse: [] }` — Discord then renders no
 * `@everyone` / `@here` / role / user pings regardless of message content. This is
 * the authoritative no-ping guarantee that backs the comms agent's untrusted-text
 * escaping (T-25): even if escaping somehow let a mention token through textually,
 * it cannot actually ping anyone.
 */

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text(): Promise<string> }>;

export class DiscordWebhookPoster implements CommsPoster {
  private readonly webhookUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(webhookUrl: string, fetchImpl?: FetchLike) {
    if (!webhookUrl) throw new Error("DiscordWebhookPoster: webhookUrl is required");
    this.webhookUrl = webhookUrl;
    if (fetchImpl) {
      this.fetchImpl = fetchImpl;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as FetchLike;
    } else {
      throw new Error("DiscordWebhookPoster: no fetch available; pass one in");
    }
  }

  async post(message: string): Promise<PostReceipt> {
    const res = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
    });
    if (res.status >= 400) {
      const body = await res.text().catch(() => "");
      throw new Error(`discord webhook ${res.status}: ${body.slice(0, 200)}`);
    }
    return { channel: "discord", ok: true };
  }
}
