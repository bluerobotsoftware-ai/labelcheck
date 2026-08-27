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

/**
 * The hallucinated-warning defence.
 *
 * Found by running the real pipeline against a deliberately unreadable
 * photograph — heavy defocus, severe underexposure, oblique angle — in which
 * the health warning is not visible at all.
 *
 * The reader returned `tooPoorToReview: false`, a quality score of 0.4, and the
 * complete statutory warning text "verbatim" at 50% confidence. It had not read
 * it; it supplied it from expectation, because it knows what a bourbon label
 * says. The engine then reported `warning-verbatim: pass`.
 *
 * A hallucinated compliance PASS is the worst output this system can produce,
 * and the rules were not at fault — they reasoned correctly about fabricated
 * input. The defence has to sit at the boundary.
 */
describe("an unreadable photograph yields no findings at all", () => {
  const UNREADABLE = {
    score: 0.4,
    issues: ["dark image", "blurry", "low contrast"],
    tooPoorToReview: false,
  };

  it("does not approve, whatever the reader claims it saw", () => {
    const report = verify(APP, label({ imageQuality: UNREADABLE }), META);
    expect(report.recommendation).toBe("needs_review");
    expect(report.headline).toMatch(/not clear enough/i);
  });

  it("does not pass the warning as verbatim from an unreadable image", () => {
    // The exact hallucination observed: full statutory text, 50% confidence.
    const report = verify(
      APP,
      label({
        imageQuality: UNREADABLE,
        governmentWarning: {
          text: STATUTORY_WARNING,
          confidence: 0.5,
          headerIsAllCaps: true,
          headerIsBold: true,
          legibleSize: true,
        },
      }),
      META,
    );
    const warning = find(report.checks, "government_warning");
    expect(warning.verdict).toBe("unreadable");
    expect(warning.rule).toBe("image-not-reviewable");
  });

  it("does not manufacture a rejection either", () => {
    // A missing bottler on an unusable photograph is not "absent" — it is
    // unseen. Reporting it as a failure sends a rejection letter to a
    // compliant applicant.
    const report = verify(
      APP,
      label({ imageQuality: UNREADABLE, bottlerName: null }),
      META,
    );
    expect(report.recommendation).toBe("needs_review");
    expect(report.checks.some((c) => c.verdict === "fail")).toBe(false);
  });

  it("leaves not-applicable checks alone", () => {
    // Country of origin on a domestic product is not unreadable; it is simply
    // not required, and that stays true whatever the photograph looks like.
    const report = verify(APP, label({ imageQuality: UNREADABLE }), META);
    expect(find(report.checks, "country_of_origin").verdict).toBe("not_applicable");
  });

  it("still reviews a merely imperfect photograph normally", () => {
    // The gate must not swallow legitimate findings from usable images.
    const report = verify(
      APP,
      label({
        imageQuality: { score: 0.85, issues: ["slightly blurry"], tooPoorToReview: false },
      }),
      META,
    );
    expect(report.recommendation).toBe("approve");
  });
});

/**
 * Legibility to the naked eye — 27 CFR 5.55, 16.22.
 *
 * A compliance check on the PRODUCT, kept deliberately separate from image
 * quality, which is a check on the SUBMISSION. The two have opposite remedies:
 * a bad photograph means "send us a better picture", an illegible label means
 * "redesign the label". Conflating them tells an applicant to re-photograph a
 * label that will fail again for exactly the same reason.
 */
describe("legibility to a person of ordinary eyesight", () => {
  const illegible = {
    score: 0.2,
    belowOrdinaryEyesight: true,
    issues: ["warning set in roughly 1mm type", "pale grey text on a white panel"],
  };

  it("fails a sharp photograph of an illegibly printed label", () => {
    const report = verify(APP, label({ labelLegibility: illegible }), META);
    const check = find(report.checks, "label_legibility");
    expect(check.verdict).toBe("fail");
    expect(check.rule).toBe("below-ordinary-eyesight");
    expect(report.recommendation).toBe("reject");
  });

  it("says plainly that a better photograph will not help", () => {
    // The message an agent forwards to the applicant has to distinguish the
    // two failures, or the applicant fixes the wrong thing.
    const report = verify(APP, label({ labelLegibility: illegible }), META);
    expect(find(report.checks, "label_legibility").explanation).toMatch(
      /not in the photograph|clearer image will not/i,
    );
  });

  it("passes a normally printed label", () => {
    expect(find(verify(APP, label(), META).checks, "label_legibility").verdict).toBe(
      "pass",
    );
  });

  it("sends a marginal label to a human rather than failing it", () => {
    const report = verify(
      APP,
      label({
        labelLegibility: { score: 0.45, belowOrdinaryEyesight: false, issues: ["small type"] },
      }),
      META,
    );
    expect(find(report.checks, "label_legibility").verdict).toBe("review");
  });

  it("declines to judge printing through an unusable photograph", () => {
    // Blaming the label's design for a fault in the camera is the error this
    // guards against.
    const report = verify(
      APP,
      label({
        imageQuality: { score: 0.3, issues: ["out of focus"], tooPoorToReview: false },
        labelLegibility: illegible,
      }),
      META,
    );
    const check = find(report.checks, "label_legibility");
    expect(check.verdict).toBe("unreadable");
    expect(check.rule).toBe("image-not-reviewable");
  });
});
