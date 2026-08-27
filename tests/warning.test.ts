import { describe, expect, it } from "vitest";
import { assessWarning, diffWords, STATUTORY_WARNING } from "@/lib/ttb/warning";
import type { WarningReading } from "@/lib/ttb/types";

/** A correctly rendered warning: right words, right case, bold, legible. */
function compliant(overrides: Partial<WarningReading> = {}): WarningReading {
  return {
    text: STATUTORY_WARNING,
    confidence: 0.95,
    headerIsAllCaps: true,
    headerIsBold: true,
    legibleSize: true,
    ...overrides,
  };
}

describe("diffWords", () => {
  it("reports no edits for identical text", () => {
    const diff = diffWords(STATUTORY_WARNING, STATUTORY_WARNING);
    expect(diff.every((segment) => segment.op === "equal")).toBe(true);
  });

  it("marks a substituted word as both a deletion and an insertion", () => {
    const altered = STATUTORY_WARNING.replace(
      "may cause health problems",
      "might cause health problems",
    );
    const diff = diffWords(STATUTORY_WARNING, altered);
    expect(diff.some((s) => s.op === "delete" && s.text.includes("may"))).toBe(true);
    expect(diff.some((s) => s.op === "insert" && s.text.includes("might"))).toBe(true);
  });

  it("marks a dropped clause as a deletion", () => {
    const truncated = STATUTORY_WARNING.replace(
      " (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
      "",
    );
    const diff = diffWords(STATUTORY_WARNING, truncated);
    expect(diff.some((s) => s.op === "delete")).toBe(true);
    expect(diff.some((s) => s.op === "insert")).toBe(false);
  });
});

describe("assessWarning", () => {
  it("passes a fully compliant warning", () => {
    const assessment = assessWarning(compliant());
    expect(assessment.wordingExact).toBe(true);
    expect(assessment.headerAllCaps).toBe(true);
    expect(assessment.problems).toHaveLength(0);
  });

  it("ignores capitalisation and spacing when comparing wording", () => {
    // Wording is assessed separately from casing, so a lower-cased copy of the
    // statutory text is still word-for-word correct — the casing defect is
    // reported by its own check rather than twice.
    const assessment = assessWarning(
      compliant({ text: STATUTORY_WARNING.toLowerCase(), headerIsAllCaps: false }),
    );
    expect(assessment.wordingExact).toBe(true);
    expect(assessment.headerAllCaps).toBe(false);
  });

  /**
   * The defect a junior agent caught by eye last month and rejected: the
   * heading set in title case rather than capitals. Everything else correct.
   */
  it("catches a title-case heading", () => {
    const titleCased = STATUTORY_WARNING.replace(
      "GOVERNMENT WARNING:",
      "Government Warning:",
    );
    const assessment = assessWarning(
      compliant({ text: titleCased, headerIsAllCaps: false }),
    );
    expect(assessment.wordingExact).toBe(true);
    expect(assessment.headerAllCaps).toBe(false);
    expect(assessment.problems.join(" ")).toMatch(/capital letters/i);
  });

  it("does not accept an all-caps claim when the text disagrees", () => {
    // Guards against a reader that sets the flag carelessly: the transcription
    // itself must contain the heading in capitals.
    const assessment = assessWarning(
      compliant({
        text: STATUTORY_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"),
        headerIsAllCaps: true,
      }),
    );
    expect(assessment.headerAllCaps).toBe(false);
  });

  it("catches altered wording", () => {
    const assessment = assessWarning(
      compliant({
        text: STATUTORY_WARNING.replace("birth defects", "birth complications"),
      }),
    );
    expect(assessment.wordingExact).toBe(false);
    expect(assessment.insertions).toBeGreaterThan(0);
    expect(assessment.deletions).toBeGreaterThan(0);
  });

  it("catches a warning shrunk below legibility", () => {
    const assessment = assessWarning(compliant({ legibleSize: false }));
    expect(assessment.problems.join(" ")).toMatch(/small|contrast/i);
  });

  it("catches a heading that is not bold", () => {
    const assessment = assessWarning(compliant({ headerIsBold: false }));
    expect(assessment.problems.join(" ")).toMatch(/bold/i);
  });

  it("reports every independent defect separately", () => {
    const assessment = assessWarning(
      compliant({
        text: "Government Warning: drinking is bad for you.",
        headerIsAllCaps: false,
        headerIsBold: false,
        legibleSize: false,
      }),
    );
    expect(assessment.problems).toHaveLength(4);
  });
});

/**
 * A guard, not a behaviour test.
 *
 * STATUTORY_WARNING is legislation transcribed into a string literal. A stray
 * edit — a "tidied" apostrophe, a lost comma, a reflowed line — would silently
 * change what this product enforces, and every other test would still pass
 * because they all compare against the same altered constant. This test pins
 * the exact text, independently verified against the eCFR, 27 U.S.C. 215 and
 * govinfo (see docs/REGULATORY-NOTES.md).
 */
describe("the statutory text itself", () => {
  it("is exactly the text prescribed by 27 CFR 16.21", () => {
    expect(STATUTORY_WARNING).toBe(
      "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.",
    );
  });

  it("is 283 characters long", () => {
    expect(STATUTORY_WARNING).toHaveLength(283);
  });

  it("keeps the serial comma before 'and may cause health problems'", () => {
    // Easily lost to a well-meaning copy-edit; its absence is a wording defect.
    expect(STATUTORY_WARNING).toContain("machinery, and may cause health problems.");
  });

  it("uses bare parenthesised digits for the two clauses", () => {
    expect(STATUTORY_WARNING).toContain("(1) According");
    expect(STATUTORY_WARNING).toContain("(2) Consumption");
  });
});
