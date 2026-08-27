import { describe, expect, it } from "vitest";
import { verify } from "@/lib/ttb/rules";
import { COMPLIANT_SPIRITS } from "@/lib/reader/mock";
import { parseAlcohol } from "@/lib/ttb/abv";
import { canonicalTokens, ladderMatch } from "@/lib/ttb/normalize";
import { assessWarning, STATUTORY_WARNING } from "@/lib/ttb/warning";
import type { Application, CheckResult, LabelExtraction } from "@/lib/ttb/types";

/**
 * Regressions from the adversarial audit (docs/AUDIT-CORRECTNESS.md).
 *
 * Each test below corresponds to a defect that was reproduced against the
 * committed tree. They are kept together, and tagged with the finding number,
 * so the audit stays connected to the code that answered it.
 */

const META = { extractionMs: 0, reader: "test" };

function label(overrides: Partial<LabelExtraction> = {}): LabelExtraction {
  return { ...structuredClone(COMPLIANT_SPIRITS), ...overrides };
}

function find(checks: CheckResult[], id: string): CheckResult {
  const match = checks.find((c) => c.id === id);
  if (!match) throw new Error(`No check with id "${id}"`);
  return match;
}

const APP: Application = {
  beverageType: "distilled_spirits",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  bottlerName: "Old Tom Distillery",
  isImport: false,
};

/**
 * Finding 1, CRITICAL. The confidence gate lived inside `preflight()`, which
 * only the text-comparison path calls. Alcohol content, net contents and the
 * health warning ran their own control flow and never read confidence at all —
 * so the three fields carrying the most absolute obligations in the system were
 * the three that would assert a pass on text the reader called a guess.
 */
describe("finding 1 — the confidence gate reaches every field", () => {
  const barelyRead = 0.05;

  it("refuses to judge alcohol content it could not read", () => {
    const report = verify(
      APP,
      label({ alcoholContent: { text: "45% Alc./Vol.", confidence: barelyRead } }),
      META,
    );
    expect(find(report.checks, "alcohol_content").verdict).toBe("unreadable");
    expect(report.recommendation).not.toBe("approve");
  });

  it("refuses to judge net contents it could not read", () => {
    const report = verify(
      APP,
      label({ netContents: { text: "750 mL", confidence: barelyRead } }),
      META,
    );
    expect(find(report.checks, "net_contents").verdict).toBe("unreadable");
    expect(report.recommendation).not.toBe("approve");
  });

  it("refuses to judge a warning it could not read", () => {
    // A shaky transcription produces a diff full of phantom edits, and with it
    // a confident, entirely fictional rejection.
    const report = verify(
      APP,
      label({
        governmentWarning: {
          text: STATUTORY_WARNING,
          confidence: barelyRead,
          headerIsAllCaps: true,
          headerIsBold: true,
          legibleSize: true,
        },
      }),
      META,
    );
    expect(find(report.checks, "government_warning").verdict).toBe("unreadable");
    expect(report.recommendation).not.toBe("approve");
  });

  it("does not approve a label read at 5% confidence throughout", () => {
    const barely = <T extends { confidence: number }>(reading: T): T => ({
      ...reading,
      confidence: barelyRead,
    });
    const base = label();
    const report = verify(
      APP,
      {
        ...base,
        brandName: barely(base.brandName!),
        classType: barely(base.classType!),
        alcoholContent: barely(base.alcoholContent!),
        netContents: barely(base.netContents!),
        bottlerName: barely(base.bottlerName!),
        governmentWarning: barely(base.governmentWarning!),
      },
      META,
    );
    expect(report.recommendation).toBe("needs_review");
  });
});

/**
 * Finding 2, HIGH. Containment was treated as a pass everywhere it was enabled,
 * including class/type — where an extra word changes what the product legally
 * is, and a class/type change always requires a new COLA.
 */
describe("finding 2 — extra words on a class/type reach a human", () => {
  it.each([
    ["GIN", "SLOE GIN"],
    ["BRANDY", "FLAVORED BRANDY"],
    ["VODKA", "VODKA LIQUEUR"],
  ])("sends %s vs %s to review rather than passing it", (filed, printed) => {
    const report = verify(
      { ...APP, classType: filed },
      label({ classType: { text: printed, confidence: 0.97 } }),
      META,
    );
    const check = find(report.checks, "class_type");
    expect(check.verdict).toBe("review");
    expect(report.recommendation).toBe("needs_review");
  });

  it("still passes a bottler line that merely adds an address", () => {
    // The behaviour containment exists for, and which must not regress.
    const report = verify(APP, label(), META);
    const check = find(report.checks, "bottler");
    expect(check.verdict).toBe("pass");
    expect(check.rule).toBe("label-contains-application-value");
  });
});

/**
 * Finding 4, HIGH. The header test read raw text, so a heading wrapping across
 * two lines — routine on a real bottle — rejected a compliant label. Worse, the
 * report contradicted itself: the wording check passed the identical string.
 */
describe("finding 4 — a wrapped warning heading is still a heading", () => {
  it("accepts GOVERNMENT WARNING: split across a line break", () => {
    const assessment = assessWarning({
      text: STATUTORY_WARNING.replace("GOVERNMENT WARNING:", "GOVERNMENT\nWARNING:"),
      confidence: 0.95,
      headerIsAllCaps: true,
      headerIsBold: true,
      legibleSize: true,
    });
    expect(assessment.headerAllCaps).toBe(true);
    expect(assessment.wordingExact).toBe(true);
    expect(assessment.problems).toHaveLength(0);
  });

  it("accepts a non-breaking space inside the heading", () => {
    const assessment = assessWarning({
      text: STATUTORY_WARNING.replace("GOVERNMENT WARNING:", "GOVERNMENT WARNING:"),
      confidence: 0.95,
      headerIsAllCaps: true,
      headerIsBold: true,
      legibleSize: true,
    });
    expect(assessment.headerAllCaps).toBe(true);
  });

  it("still catches a genuinely title-cased heading", () => {
    const assessment = assessWarning({
      text: STATUTORY_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"),
      confidence: 0.95,
      headerIsAllCaps: false,
      headerIsBold: true,
      legibleSize: true,
    });
    expect(assessment.headerAllCaps).toBe(false);
  });
});

/**
 * Finding 6, HIGH. "&" was mapped to "and" in the synonym table, but punctuation
 * was stripped before the table ran, so the entry could never fire. Changing an
 * ampersand to "and" is an allowable revision TTB permits without refiling; the
 * app hard-failed it as a mismatch.
 */
describe("finding 6 — ampersands fold to 'and'", () => {
  it("produces the token 'and' from an ampersand", () => {
    expect(canonicalTokens("A & B")).toContain("and");
  });

  it("matches Smith & Sons to Smith and Sons", () => {
    const result = ladderMatch("Smith & Sons", "SMITH AND SONS");
    expect(result.matched).toBe(true);
  });

  it("passes an ampersand difference on a brand name", () => {
    const report = verify(
      { ...APP, brandName: "Smith & Sons" },
      label({ brandName: { text: "SMITH AND SONS", confidence: 0.97 } }),
      META,
    );
    expect(find(report.checks, "brand_name").verdict).toBe("pass");
  });
});

/**
 * Finding 7, MEDIUM. The bare percentage pattern matched any percentage on the
 * label. Spirits labels are full of them, and "DISTILLED FROM 100% CORN" was
 * read as 100% alcohol by volume.
 */
describe("finding 7 — percentages need alcohol vocabulary beside them", () => {
  it("does not read a grain-bill percentage as alcohol content", () => {
    expect(parseAlcohol("DISTILLED FROM 100% CORN").abv).toBeNull();
    expect(parseAlcohol("MADE WITH 100% AGAVE").abv).toBeNull();
  });

  it("rejects an implausible strength rather than reporting it", () => {
    expect(parseAlcohol("200% ALC/VOL").abv).toBeNull();
  });

  it("still parses every legitimate form", () => {
    expect(parseAlcohol("45% Alc./Vol. (90 Proof)").abv).toBe(45);
    expect(parseAlcohol("ALC. 12.5% BY VOL.").abv).toBe(12.5);
    expect(parseAlcohol("13,5% vol").abv).toBe(13.5);
    expect(parseAlcohol("45").abv).toBe(45);
  });
});

/** Finding 8, MEDIUM. NFKC turned "12½%" into "121⁄2%", which parsed as 2%. */
describe("finding 8 — vulgar fractions", () => {
  it("reads 12½% as 12.5, not 2", () => {
    expect(parseAlcohol("12½% alc/vol").abv).toBe(12.5);
  });

  it("reads 5¼% as 5.25", () => {
    expect(parseAlcohol("5¼% ALC BY VOL").abv).toBe(5.25);
  });
});

/**
 * Finding 11, MEDIUM. Two values that both normalise away to nothing were
 * reported as a confident match of empty string against empty string.
 */
describe("finding 11 — two absences are not a match", () => {
  it("does not match punctuation-only values to each other", () => {
    expect(ladderMatch("&", "...").matched).toBe(false);
    expect(ladderMatch("   ", "").matched).toBe(false);
  });

  it("still matches real values normally", () => {
    expect(ladderMatch("Stone's Throw", "STONE’S THROW").matched).toBe(true);
  });
});
