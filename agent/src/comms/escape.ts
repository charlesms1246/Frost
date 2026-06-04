import type { VariableSource } from "../compile/types.js";

/**
 * Per-source resolution + escaping for COMMS_TEMPLATE variables — the **T-25 / I-15**
 * security boundary, applied at SEND time. Pure and exhaustively testable.
 *
 * The on-chain metadata DECLARES each variable's source/type; this is where the
 * runtime ENFORCES that declaration (audit hotspot H-14):
 *
 *  - **Trusted typed sources** (numeric / known-address / txhash / timestamp) must
 *    MATCH their declared shape. A value that doesn't (e.g. a "numeric" carrying
 *    `@everyone http://evil`) is an anomaly — reject, never render it (T-32 posture).
 *    A value that matches is constrained to digits/hex and is safe verbatim.
 *  - **`internal`** (runtime-generated: role, session id) is trusted but still passed
 *    through the inert-text escaper defensively.
 *  - **`untrusted-text`** is attacker-influenceable by definition; it is escaped to
 *    inert text so it cannot break Discord markdown structure or inject mention
 *    syntax. (The authoritative no-ping guarantee is the webhook's
 *    `allowed_mentions: { parse: [] }` — see `discord.ts`; this escaping is
 *    defense-in-depth for visual/structural integrity.)
 */

export type Resolved = { ok: true; value: string } | { ok: false; reason: string };

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TXHASH_RE = /^0x[0-9a-fA-F]{64}$/;
const TIMESTAMP_RE = /^\d+$/; // unix seconds

/** Hard cap on a single rendered untrusted value, to prevent message bloat / hidden tails. */
export const MAX_UNTRUSTED_LEN = 500;

export function escapeForSource(name: string, source: VariableSource, value: string): Resolved {
  switch (source) {
    case "numeric":
      return shape(name, value, NUMERIC_RE, "a number");
    case "known-address":
      return shape(name, value, ADDRESS_RE, "a 20-byte address");
    case "txhash":
      return shape(name, value, TXHASH_RE, "a 32-byte tx hash");
    case "timestamp":
      return shape(name, value, TIMESTAMP_RE, "a unix timestamp");
    case "internal":
    case "untrusted-text":
      return { ok: true, value: escapeUntrustedText(value) };
    default:
      // Exhaustive over VariableSource; an unknown source reaching here is a bug/attack.
      return { ok: false, reason: `unknown variable source "${String(source)}" for "${name}"` };
  }
}

function shape(name: string, value: string, re: RegExp, expected: string): Resolved {
  return re.test(value)
    ? { ok: true, value }
    : { ok: false, reason: `variable "${name}" is not ${expected} (declared type mismatch, H-14)` };
}

const MD_SPECIALS = ["`", "*", "_", "~", "|", ">", "<", "[", "]", "(", ")", "#"];

// Zero-width / invisible code points to drop entirely (by numeric code point, so no
// literal invisible characters appear in this source file).
const ZERO_WIDTH = new Set<number>([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

/**
 * Render an attacker-influenceable string as inert Discord text: drop control /
 * zero-width / newline characters (a variable must not introduce structure), then
 * backslash-escape the markdown + mention-delimiter set so it cannot break out of
 * the surrounding message. Capped in length.
 */
export function escapeUntrustedText(input: string): string {
  // 1 — scrub by code point: C0 controls + DEL (incl. newline/CR/TAB) → space; drop
  // zero-width characters that could hide content or smuggle mention syntax.
  let s = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f) s += " ";
    else if (ZERO_WIDTH.has(code)) continue;
    else s += ch;
  }

  // 2 — escape backslash first, then the markdown / mention-delimiter set.
  s = s.replace(/\\/g, "\\\\");
  for (const ch of MD_SPECIALS) s = s.split(ch).join("\\" + ch);

  // 3 — length cap.
  if (s.length > MAX_UNTRUSTED_LEN) s = s.slice(0, MAX_UNTRUSTED_LEN - 1) + "…";
  return s;
}
