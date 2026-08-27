import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords, toCsv } from "@/lib/csv";
import { clientKey, rateLimit } from "@/lib/ratelimit";

/**
 * Regressions from the robustness audit (docs/AUDIT-ROBUSTNESS.md).
 */

describe("CSV export neutralises spreadsheet formulas", () => {
  /**
   * Finding 5, HIGH. A brand name is free text on a COLA application, and the
   * export is a file a compliance agent opens in Excel. Without this, a value
   * beginning "=" executes on open.
   */
  it.each([
    ["=HYPERLINK(\"http://example.test\",\"Click\")", "'=HYPERLINK"],
    ["+1234", "'+1234"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
  ])("prefixes %s so the spreadsheet treats it as text", (input, expectedStart) => {
    const output = toCsv([[input]]);
    // The cell may also be quoted for containing a comma; check the payload.
    expect(output.replace(/^"|"$/g, "")).toContain(expectedStart);
  });

  it("leaves ordinary values completely untouched", () => {
    expect(toCsv([["OLD TOM DISTILLERY", "750 mL", 42]])).toBe(
      "OLD TOM DISTILLERY,750 mL,42",
    );
  });

  it("still round-trips a value containing commas and quotes", () => {
    const value = 'Old Tom Distillery Co., Bardstown, KY (the "good" one)';
    const parsed = parseCsv(toCsv([[value]]));
    expect(parsed[0][0]).toBe(value);
  });
});

describe("CSV parsing", () => {
  it("keeps a bottler line's commas inside one cell", () => {
    // Splitting naively on commas corrupts every importer row.
    const records = parseCsvRecords(
      'filename,brandname,bottlername\na.png,OLD TOM,"Old Tom Co., Bardstown, KY"\n',
    );
    expect(records[0].bottlername).toBe("Old Tom Co., Bardstown, KY");
  });

  it("handles doubled quotes and embedded newlines", () => {
    const rows = parseCsv('a,"say ""hi""","line1\nline2"\n');
    expect(rows[0][1]).toBe('say "hi"');
    expect(rows[0][2]).toBe("line1\nline2");
  });

  it("accepts CRLF files from Excel", () => {
    expect(parseCsvRecords("brandname\r\nOLD TOM\r\n")[0].brandname).toBe("OLD TOM");
  });
});

describe("client identity for rate limiting", () => {
  /**
   * Finding 2, CRITICAL. The first version read the leftmost x-forwarded-for
   * entry, which is whatever the client typed — rotating it defeated the
   * limiter entirely, 300 requests with zero rejections.
   */
  it("prefers the platform header over anything the client can set", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
      "x-real-ip": "9.9.9.9",
    });
    expect(clientKey(headers)).toBe("203.0.113.7");
  });

  it("takes the rightmost forwarded hop, not the client-supplied leftmost", () => {
    // A client can prepend entries; it cannot append past the nearest proxy.
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" });
    expect(clientKey(headers)).toBe("203.0.113.7");
  });

  it("does not let a spoofed leftmost value mint a fresh bucket", () => {
    const spoofed = (fake: string) =>
      clientKey(new Headers({ "x-forwarded-for": `${fake}, 203.0.113.7` }));
    expect(spoofed("1.1.1.1")).toBe(spoofed("2.2.2.2"));
  });

  it("falls back sensibly when no header is present", () => {
    expect(clientKey(new Headers())).toBe("unknown");
  });
});

describe("rate limiter", () => {
  it("allows up to the limit and rejects past it", () => {
    const key = `test-${Math.random()}`;
    const options = { limit: 3, windowMs: 60_000 };
    expect(rateLimit(key, options).allowed).toBe(true);
    expect(rateLimit(key, options).allowed).toBe(true);
    expect(rateLimit(key, options).allowed).toBe(true);
    expect(rateLimit(key, options).allowed).toBe(false);
  });

  it("reports how long to wait when it rejects", () => {
    const key = `test-${Math.random()}`;
    const options = { limit: 1, windowMs: 60_000 };
    rateLimit(key, options);
    const rejected = rateLimit(key, options);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    const options = { limit: 1, windowMs: 60_000 };
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    expect(rateLimit(a, options).allowed).toBe(true);
    expect(rateLimit(b, options).allowed).toBe(true);
    expect(rateLimit(a, options).allowed).toBe(false);
  });

  it("survives a flood of unique keys without unbounded growth", () => {
    // The eviction path: previously the map only shed EXPIRED entries, so a
    // rotating key grew it without bound inside a single window.
    const options = { limit: 5, windowMs: 60_000 };
    for (let i = 0; i < 20_000; i++) rateLimit(`flood-${i}`, options);
    // Still functioning, and still enforcing, after the flood.
    const key = `after-flood-${Math.random()}`;
    expect(rateLimit(key, { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
    expect(rateLimit(key, { limit: 1, windowMs: 60_000 }).allowed).toBe(false);
  });
});
