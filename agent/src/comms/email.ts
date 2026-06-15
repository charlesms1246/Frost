import type { CommsPoster, PostReceipt } from "./comms.js";
import type { FetchLike } from "./discord.js";

/**
 * Email {@link CommsPoster}. Posts the rendered comms message to an email-relay
 * endpoint (the hosted backend, which holds the SMTP/provider credentials — the
 * desktop renderer never does), mirroring how {@link DiscordWebhookPoster} posts to
 * a webhook URL. `fetch` is injectable so the mapping is unit-testable offline.
 *
 * The comms agent renders exactly the signed COMMS_TEMPLATE (T-25 escaping already
 * applied) and hands that string here as the email BODY; the recipient + subject are
 * session config, not message content. Like the webhook, the relay endpoint and
 * recipient are session config — never logged.
 */

export interface EmailPosterOptions {
  /** Email-relay endpoint that performs the actual send (hosted backend). */
  endpoint: string;
  /** Recipient address (the `commsEmail` from settings). */
  to: string;
  /** Subject line (defaults to a generic agent-update subject). */
  subject?: string;
  /** Optional sender override; the relay supplies a default From otherwise. */
  from?: string;
  fetchImpl?: FetchLike;
}

export class EmailPoster implements CommsPoster {
  private readonly endpoint: string;
  private readonly to: string;
  private readonly subject: string;
  private readonly from?: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: EmailPosterOptions) {
    if (!opts.endpoint) throw new Error("EmailPoster: endpoint is required");
    if (!opts.to) throw new Error("EmailPoster: recipient (to) is required");
    this.endpoint = opts.endpoint;
    this.to = opts.to;
    this.subject = opts.subject ?? "Frost agent update";
    if (opts.from) this.from = opts.from;
    if (opts.fetchImpl) {
      this.fetchImpl = opts.fetchImpl;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as FetchLike;
    } else {
      throw new Error("EmailPoster: no fetch available; pass one in");
    }
  }

  async post(message: string): Promise<PostReceipt> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: this.to,
        subject: this.subject,
        text: message,
        ...(this.from ? { from: this.from } : {}),
      }),
    });
    if (res.status >= 400) {
      const body = await res.text().catch(() => "");
      throw new Error(`email relay ${res.status}: ${body.slice(0, 200)}`);
    }
    return { channel: "email", ok: true };
  }
}
