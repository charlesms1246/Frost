import type { CommsPoster, PostReceipt } from "./comms.js";

/**
 * Fan-out {@link CommsPoster}: delivers one rendered comms message to several
 * channels at once (e.g. Discord + email). The comms agent does its binding +
 * escaping ONCE and posts the single safe string; this just multiplexes delivery.
 *
 * Delivery is best-effort across channels: each is attempted independently, and the
 * post succeeds if AT LEAST ONE channel delivered (so a flaky email relay never
 * suppresses a working Discord post). It throws only when EVERY channel failed, so
 * the comms agent reports `failed` rather than a false `posted`.
 */
export class FanoutPoster implements CommsPoster {
  private readonly posters: readonly CommsPoster[];

  constructor(posters: readonly CommsPoster[]) {
    if (posters.length === 0) throw new Error("FanoutPoster: at least one poster is required");
    this.posters = posters;
  }

  async post(message: string): Promise<PostReceipt> {
    const results = await Promise.allSettled(this.posters.map((p) => p.post(message)));
    const delivered = results
      .filter((r): r is PromiseFulfilledResult<PostReceipt> => r.status === "fulfilled" && r.value.ok)
      .map((r) => r.value.channel);

    if (delivered.length === 0) {
      const reasons = results
        .map((r) => (r.status === "rejected" ? errMsg(r.reason) : "channel returned not-ok"))
        .join("; ");
      throw new Error(`all comms channels failed: ${reasons}`);
    }
    return { channel: delivered.join("+"), ok: true };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
