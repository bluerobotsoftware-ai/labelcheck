import { describe, expect, it } from "vitest";
import { verify } from "@/lib/ttb/rules";
import { STATUTORY_WARNING } from "@/lib/ttb/warning";
import { COMPLIANT_SPIRITS } from "@/lib/reader/mock";
import type { Application, CheckResult, LabelExtraction } from "@/lib/ttb/types";

/** The application matching the compliant spirits sample. */
const BOURBON_APPLICATION: Application = {
  applicationId: "TTB-2026-000001",
  beverageType: "distilled_spirits",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  bottlerName: "Old Tom Distillery",
  isImport: false,
};

const META = { extractionMs: 1200, reader: "test" };

/** Deep-ish clone with overrides, so each test starts from a known-good label. */
function label(overrides: Partial<LabelExtraction> = {}): LabelExtraction {
  return { ...structuredClone(COMPLIANT_SPIRITS), ...overrides };
}

function find(checks: CheckResult[], id: string): CheckResult {
  const match = checks.find((c) => c.id === id);
  if (!match) throw new Error(`No check with id "${id}" in report`);
  return match;
}

describe("a fully compliant application", () => {
  const report = verify(BOURBON_APPLICATION, label(), META);

  it("is recommended for approval", () => {
    expect(report.recommendation).toBe("approve");
  });

  it("raises no failures and nothing for review", () => {
    expect(report.checks.filter((c) => c.verdict === "fail")).toHaveLength(0);
    expect(report.checks.filter((c) => c.verdict === "review")).toHaveLength(0);
  });

  it("attributes every check to a named rule", () => {
    // The audit trail: an agent must always be able to ask "why did it say that?"
    for (const check of report.checks) {
      expect(check.rule).toBeTruthy();
      expect(check.explanation).toBeTruthy();
    }
  });

  it("reports timing separately for the model and the rules", () => {
    expect(report.timing.extractionMs).toBe(1200);
    expect(report.timing.totalMs).toBeGreaterThanOrEqual(1200);
  });
});

describe("brand name", () => {
  it("accepts a case and apostrophe difference without complaint", () => {
    const report = verify(
      { ...BOURBON_APPLICATION, brandName: "Stone's Throw" },
      label({ brandName: { text: "STONE’S THROW", confidence: 0.97 } }),
      META,
    );
    const check = find(report.checks, "brand_name");
    expect(check.verdict).toBe("pass");
    expect(check.rule).toBe("normalised-match:case");
    expect(report.recommendation).toBe("approve");
  });

  it("sends a near-miss to review rather than rejecting it", () => {
    const report = verify(
      { ...BOURBON_APPLICATION, brandName: "Old Tom Distillery" },
      label({ brandName: { text: "Old Tom Distilery", confidence: 0.9 } }),
      META,
    );
    const check = find(report.checks, "brand_name");
    expect(check.verdict).toBe("review");
    expect(report.recommendation).toBe("needs_review");
  });

  it("fails a genuinely different brand", () => {
    const report = verify(
      BOURBON_APPLICATION,
      label({ brandName: { text: "SILVER CREEK SPIRITS", confidence: 0.97 } }),
      META,
    );
    expect(find(report.checks, "brand_name").verdict).toBe("fail");
    expect(report.recommendation).toBe("reject");
  });

  it("fails when the brand is absent from the label entirely", () => {
    const report = verify(BOURBON_APPLICATION, label({ brandName: null }), META);
    const check = find(report.checks, "brand_name");
    expect(check.verdict).toBe("fail");
    // A mandatory item missing from the artwork is a regulatory defect, not a
    // failure to match — so it is reported as a compliance check.
    expect(check.rule).toBe("mandatory-field-absent");
    expect(check.category).toBe("compliance");
  });

  it("still fails a missing mandatory field when the application is silent too", () => {
    // Regression: testing the application field first let an empty application
    // cancel the label's own unconditional obligation.
    const report = verify(
      { ...BOURBON_APPLICATION, brandName: "" },
      label({ brandName: null }),
      META,
    );
    expect(find(report.checks, "brand_name").verdict).toBe("fail");
  });

  it("declines to conclude anything from text it could barely read", () => {
    const report = verify(
      BOURBON_APPLICATION,
      label({ brandName: { text: "OLD TOM DISTILLERY", confidence: 0.2 } }),
      META,
    );
    const check = find(report.checks, "brand_name");
    // Text agrees, but the reader admits it was guessing. A match asserted on
    // that basis would be worse than no answer.
    expect(check.verdict).toBe("unreadable");
    expect(report.recommendation).toBe("needs_review");
  });
});

describe("alcohol content", () => {
  it("passes an exact match", () => {
    expect(find(verify(BOURBON_APPLICATION, label(), META).checks, "alcohol_content").verdict).toBe(
      "pass",
    );
  });

  it("fails a difference beyond the spirits tolerance", () => {
    const report = verify(
      BOURBON_APPLICATION,
      label({ alcoholContent: { text: "40% Alc./Vol. (80 Proof)", confidence: 0.95 } }),
      META,
    );
    const check = find(report.checks, "alcohol_content");
    expect(check.verdict).toBe("fail");
    expect(check.rule).toBe("abv-outside-tolerance");
    expect(check.citation).toBe("27 CFR 5.65");
  });

  it("sends a difference inside tolerance to review, not to approval", () => {
    const report = verify(
      BOURBON_APPLICATION,
      label({ alcoholContent: { text: "45.2% Alc./Vol.", confidence: 0.95 } }),
      META,
    );
    expect(find(report.checks, "alcohol_content").verdict).toBe("review");
  });

  it("matches across different phrasings of the same strength", () => {
    const report = verify(
      { ...BOURBON_APPLICATION, alcoholContent: "45" },
      label({ alcoholContent: { text: "ALC. 45% BY VOL.", confidence: 0.95 } }),
      META,
    );
    expect(find(report.checks, "alcohol_content").verdict).toBe("pass");
  });

  it("flags a label whose proof contradicts its own ABV", () => {
    const report = verify(
      { ...BOURBON_APPLICATION, alcoholContent: "45%" },
      label({ alcoholContent: { text: "45% Alc./Vol. (80 Proof)", confidence: 0.95 } }),
      META,
    );
    const check = find(report.checks, "proof_consistency");
    expect(check.verdict).toBe("fail");
    expect(check.explanation).toContain("90 proof");
  });
});

describe("net contents", () => {
  it("accepts the same volume written in different units", () => {
    const report = verify(
      { ...BOURBON_APPLICATION, netContents: "750 mL" },
      label({ netContents: { text: "75 cL", confidence: 0.95 } }),
      META,
    );
    const check = find(report.checks, "net_contents");
    expect(check.verdict).toBe("pass");
    expect(check.explanation).toMatch(/different units/i);
  });

  it("fails a genuine volume mismatch", () => {
    const report = verify(
      BOURBON_APPLICATION,
      label({ netContents: { text: "1 L", confidence: 0.95 } }),
      META,
    );
    expect(find(report.checks, "net_contents").verdict).toBe("fail");
  });

  it("fails a container size that is not an authorised standard of fill", () => {
    // Both documents agree on 800 mL, so only the regulation catches this.
    const report = verify(
      { ...BOURBON_APPLICATION, netContents: "800 mL" },
      label({ netContents: { text: "800 mL", confidence: 0.95 } }),
      META,
    );
    expect(find(report.checks, "net_contents").verdict).toBe("pass");
    expect(find(report.checks, "standard_of_fill").verdict).toBe("fail");
    expect(report.recommendation).toBe("reject");
  });

  it("fails when net contents are missing from the label", () => {
    const report = verify(BOURBON_APPLICATION, label({ netContents: null }), META);
    expect(find(report.checks, "net_contents").verdict).toBe("fail");
  });
});

describe("government warning", () => {
  it("passes the statutory text rendered correctly", () => {
    const report = verify(BOURBON_APPLICATION, label(), META);
    expect(find(report.checks, "government_warning").verdict).toBe("pass");
    expect(find(report.checks, "warning_capitalisation").verdict).toBe("pass");
    expect(find(report.checks, "warning_prominence").verdict).toBe("pass");
  });

  it("rejects a title-case heading even when the wording is perfect", () => {
    const report = verify(
      BOURBON_APPLICATION,
      label({
        governmentWarning: {
          text: STATUTORY_WARNING.replace("GOVERNMENT WARNING:", "Government Warning:"),
          confidence: 0.95,
          headerIsAllCaps: false,
          headerIsBold: true,
          legibleSize: true,
        },
      }),
      META,
    );
    expect(find(report.checks, "government_warning").verdict).toBe("pass");
    expect(find(report.checks, "warning_capitalisation").verdict).toBe("fail");
    expect(report.recommendation).toBe("reject");
  });

  it("rejects reworded text and supplies a diff", () => {
    const report = verify(
      BOURBON_APPLICATION,
      label({
        governmentWarning: {
          text: STATUTORY_WARNING.replace("may cause health problems", "can cause health issues"),
          confidence: 0.95,
          headerIsAllCaps: true,
          headerIsBold: true,
          legibleSize: true,
        },
      }),
      META,
    );
    expect(find(report.checks, "government_warning").verdict).toBe("fail");
    expect(report.warningDiff?.some((s) => s.op === "insert")).toBe(true);
  });

  it("rejects a label with no warning at all", () => {
    const report = verify(BOURBON_APPLICATION, label({ governmentWarning: null }), META);
    const check = find(report.checks, "government_warning");
    expect(check.verdict).toBe("fail");
    expect(check.rule).toBe("warning-absent");
  });

  it("is checked against the statute, not the application", () => {
    // Nothing in the application mentions the warning, yet it is still assessed.
    const report = verify(BOURBON_APPLICATION, label(), META);
    const warningChecks = report.checks.filter((c) => c.id.startsWith("warning") || c.id === "government_warning");
    expect(warningChecks.every((c) => c.category === "compliance")).toBe(true);
    expect(warningChecks.every((c) => c.expected === undefined)).toBe(true);
  });
});

describe("country of origin", () => {
  it("is not required for a domestic product", () => {
    const report = verify(BOURBON_APPLICATION, label(), META);
    expect(find(report.checks, "country_of_origin").verdict).toBe("not_applicable");
  });

  it("is required for an import and fails when absent", () => {
    const report = verify(
      { ...BOURBON_APPLICATION, isImport: true, countryOfOrigin: "Scotland" },
      label({ countryOfOrigin: null }),
      META,
    );
    const check = find(report.checks, "country_of_origin");
    expect(check.verdict).toBe("fail");
    expect(check.rule).toBe("origin-absent-on-import");
  });

  it("accepts a label that states the origin within a longer phrase", () => {
    const report = verify(
      { ...BOURBON_APPLICATION, isImport: true, countryOfOrigin: "Scotland" },
      label({ countryOfOrigin: { text: "PRODUCT OF SCOTLAND", confidence: 0.95 } }),
      META,
    );
    expect(find(report.checks, "country_of_origin").verdict).toBe("pass");
  });
});

describe("bottler", () => {
  it("accepts a label line that contains the applicant's name plus an address", () => {
    const report = verify(BOURBON_APPLICATION, label(), META);
    const check = find(report.checks, "bottler");
    expect(check.verdict).toBe("pass");
    expect(check.rule).toBe("label-contains-application-value");
  });
});

describe("image quality", () => {
  it("overrides an otherwise clean result when the photograph is unusable", () => {
    // The most dangerous failure this system could have is approving an
    // application from an image it could not actually read.
    const report = verify(
      BOURBON_APPLICATION,
      label({
        imageQuality: {
          score: 0.15,
          issues: ["severe glare", "photographed at an oblique angle"],
          tooPoorToReview: true,
        },
      }),
      META,
    );
    expect(report.recommendation).toBe("needs_review");
    expect(report.headline).toMatch(/not clear enough/i);
  });
});

describe("determinism", () => {
  it("produces an identical report for identical inputs", () => {
    const a = verify(BOURBON_APPLICATION, label(), META);
    const b = verify(BOURBON_APPLICATION, label(), META);
    // Timing is wall-clock, so compare everything else.
    expect({ ...a, timing: null }).toEqual({ ...b, timing: null });
  });
});

/**
 * A COLA filed today carries no alcohol content and no net contents — both were
 * removed from Form 5100.31 around 2015. Verified against the public registry:
 * a 2016 filing renders both, a 2025 filing renders neither.
 * See docs/COLA-FORM-NOTES.md.
 */
describe("a modern COLA, which omits ABV and net contents", () => {
  const MODERN: Application = {
    applicationId: "TTB-2026-000002",
    beverageType: "distilled_spirits",
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    bottlerName: "Old Tom Distillery",
    isImport: false,
  };

  it("does not fail the label for fields the application never captured", () => {
    const report = verify(MODERN, label(), META);
    expect(find(report.checks, "alcohol_content").verdict).toBe("not_applicable");
    expect(find(report.checks, "net_contents").verdict).toBe("not_applicable");
    expect(report.recommendation).toBe("approve");
  });

  it("still checks the container against the standards of fill", () => {
    // No application value is involved in this check at all.
    const report = verify(
      MODERN,
      label({ netContents: { text: "800 mL", confidence: 0.95 } }),
      META,
    );
    expect(find(report.checks, "net_contents").verdict).toBe("not_applicable");
    expect(find(report.checks, "standard_of_fill").verdict).toBe("fail");
    expect(report.recommendation).toBe("reject");
  });

  it("still requires spirits to carry an alcohol statement at all", () => {
    const report = verify(MODERN, label({ alcoholContent: null }), META);
    const check = find(report.checks, "alcohol_present");
    expect(check.verdict).toBe("fail");
    expect(check.category).toBe("compliance");
  });

  it("still catches a label whose proof contradicts its own ABV", () => {
    const report = verify(
      MODERN,
      label({ alcoholContent: { text: "45% Alc./Vol. (80 Proof)", confidence: 0.95 } }),
      META,
    );
    expect(find(report.checks, "proof_consistency").verdict).toBe("fail");
  });

  it("asks for confirmation rather than failing when wine omits its ABV", () => {
    const report = verify(
      { ...MODERN, beverageType: "wine", classType: "Napa Valley Cabernet Sauvignon" },
      label({ alcoholContent: null }),
      META,
    );
    expect(find(report.checks, "alcohol_present").verdict).toBe("review");
  });
});

/**
 * The label prints an approved trade name while the application names the legal
 * entity. This differs in most real filings, so matching only against the legal
 * name would false-fail the majority of valid applications.
 */
describe("bottler trade names", () => {
  it("accepts a label bearing the approved trade name", () => {
    const report = verify(
      {
        ...BOURBON_APPLICATION,
        bottlerName: "Pernod Ricard USA, LLC",
        labelCompanyName: "The Glenlivet Distilling Company",
      },
      label({
        bottlerName: {
          text: "BOTTLED BY THE GLENLIVET DISTILLING COMPANY, NEW YORK, NY",
          confidence: 0.94,
        },
      }),
      META,
    );
    const check = find(report.checks, "bottler");
    expect(check.verdict).toBe("pass");
    expect(check.rule).toContain("trade-name");
    expect(check.explanation).toMatch(/trade name/i);
  });

  it("still fails a bottler matching neither name", () => {
    const report = verify(
      {
        ...BOURBON_APPLICATION,
        bottlerName: "Pernod Ricard USA, LLC",
        labelCompanyName: "The Glenlivet Distilling Company",
      },
      label({
        bottlerName: { text: "BOTTLED BY SOMEBODY ELSE ENTIRELY, OH", confidence: 0.94 },
      }),
      META,
    );
    expect(find(report.checks, "bottler").verdict).toBe("fail");
  });

  it("reports against the legal name when that is what matched", () => {
    const report = verify(
      { ...BOURBON_APPLICATION, labelCompanyName: "Some Other Trade Name" },
      label(),
      META,
    );
    const check = find(report.checks, "bottler");
    expect(check.verdict).toBe("pass");
    expect(check.rule).not.toContain("trade-name");
  });
});
