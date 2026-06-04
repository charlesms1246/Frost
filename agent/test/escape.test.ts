import { describe, expect, it } from "vitest";
import { escapeForSource, escapeUntrustedText, MAX_UNTRUSTED_LEN } from "../src/comms/escape.js";

describe("escapeForSource — trusted typed sources (H-14 enforcement)", () => {
  it("accepts well-shaped values verbatim", () => {
    expect(escapeForSource("a", "numeric", "2700.50")).toEqual({ ok: true, value: "2700.50" });
    expect(escapeForSource("a", "numeric", "-12")).toEqual({ ok: true, value: "-12" });
    expect(escapeForSource("a", "timestamp", "1900000000")).toEqual({ ok: true, value: "1900000000" });
    const addr = "0x" + "ab".repeat(20);
    expect(escapeForSource("a", "known-address", addr)).toEqual({ ok: true, value: addr });
    const tx = "0x" + "cd".repeat(32);
    expect(escapeForSource("a", "txhash", tx)).toEqual({ ok: true, value: tx });
  });

  it("rejects values that violate the declared type", () => {
    expect(escapeForSource("a", "numeric", "12; @everyone").ok).toBe(false);
    expect(escapeForSource("a", "known-address", "0x123").ok).toBe(false);
    expect(escapeForSource("a", "txhash", "0xabc").ok).toBe(false);
    expect(escapeForSource("a", "timestamp", "not-a-time").ok).toBe(false);
    const r = escapeForSource("amount", "numeric", "**bold**");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/declared type mismatch, H-14/);
  });
});

describe("escapeForSource — untrusted-text / internal escaping (T-25)", () => {
  it("escapes markdown and mention-delimiter characters", () => {
    const r = escapeForSource("note", "untrusted-text", "**bold** _i_ `code` [x](y) <@123> #ch ~s~ |sp|");
    expect(r.ok).toBe(true);
    if (r.ok) {
      // No formatting / mention delimiter survives UNescaped (a `\<` before `@`
      // neutralizes the mention in Discord even though "<@" still appears literally).
      expect(r.value).not.toMatch(/(?<!\\)\*/);
      expect(r.value).not.toMatch(/(?<!\\)</);
      expect(r.value).toContain("\\*");
      expect(r.value).toContain("\\<@123");
      expect(r.value).toContain("\\`");
    }
  });

  it("strips control, newline, and zero-width characters", () => {
    const r = escapeForSource("note", "untrusted-text", "line1\nline2\tx​zero");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toMatch(/[\n\t​]/);
      expect(r.value).toContain("line1 line2"); // newline → space
    }
  });

  it("escapes a lone backslash without double-escaping the escapes it adds", () => {
    const r = escapeForSource("note", "untrusted-text", "a\\b*c");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("a\\\\b\\*c");
  });

  it("caps length with an ellipsis", () => {
    const long = "a".repeat(MAX_UNTRUSTED_LEN + 50);
    const out = escapeUntrustedText(long);
    expect(out.length).toBe(MAX_UNTRUSTED_LEN);
    expect(out.endsWith("…")).toBe(true);
  });

  it("treats `internal` as trusted-but-escaped (always ok)", () => {
    const r = escapeForSource("role", "internal", "executor*1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("executor\\*1");
  });
});
