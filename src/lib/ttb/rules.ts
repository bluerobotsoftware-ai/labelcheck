/**
 * The rules engine.
 *
 * This module is the entire decision-making surface of the product. It is pure:
 * given an `Application` and a `LabelExtraction` it returns a
 * `VerificationReport`, with no I/O, no network and no model in the loop. That
 * is the point. A federal compliance decision has to be explainable and
 * reproducible, and "the model said so" is not an explanation that survives an
 * applicant's appeal. Every verdict below carries the id of the rule that
 * produced it, so the question "why did it say that?" always has an answer.
 *
 * It also means the whole decision layer is unit-testable without a network,
 * an API key, or a penny of spend — see tests/rules.test.ts.
 */

import { parseAlcohol, proofIsConsistent, toleranceFor } from "./abv";
import { checkStandardOfFill, formatVolume, parseVolume } from "./netContents";
import { canonicalTokens, ladderMatch } from "./normalize";
import { combinedSimilarity, containsAllTokens } from "./similarity";
import type {
  Application,
  CheckCategory,
  CheckResult,
  FieldReading,
  LabelExtraction,
  Recommendation,
  VerificationReport,
  Verdict,
} from "./types";
import { assessWarning } from "./warning";

/**
 * Above this similarity, a non-matching pair is treated as probably the same
 * thing with a defect worth human eyes — a typo, a truncation, an ampersand.
 * Below it, the two strings are considered to name different products.
 *
 * Set by hand and deliberately generous: the cost of an unnecessary review is
 * a few seconds of an agent's time, while the cost of auto-rejecting a valid
 * application is a letter, an appeal and a resubmission. The asymmetry should
 * always favour review.
 */
const REVIEW_SIMILARITY_THRESHOLD = 0.82;

/**
 * Below this transcription confidence we decline to draw any conclusion, even
 * when the strings happen to agree. A confident-looking match on text the
 * reader admits it could barely see is worse than no answer at all.
 */
const MIN_USABLE_CONFIDENCE = 0.4;

/**
 * The confidence gate, as a standalone check.
 *
 * This lived inside `preflight()` originally, which meant only the four fields
 * routed through `compareTextField()` were gated — alcohol content, net
 * contents and the health warning each have their own control flow and silently
 * skipped it. Those are the three fields carrying the most absolute obligations
 * in the system, so a label whose ABV and warning were transcribed at 1%
 * confidence returned "approve". The gate now lives here and every caller
 * applies it.
 */
function unreadable(
  id: string,
  name: string,
  category: CheckCategory,
  reading: FieldReading,
  citation?: string,
): CheckResult {
  return {
    id,
    name,
    category,
    verdict: "unreadable",
    found: reading.text,
    rule: "low-transcription-confidence",
    explanation: `The ${name.toLowerCase()} could not be read reliably from this image. A clearer photograph is needed before this item can be verified.`,
    confidence: reading.confidence,
    citation,
  };
}

/** True when the reader admitted it was guessing at this field. */
function tooUncertain(reading: FieldReading): boolean {
  return reading.confidence < MIN_USABLE_CONFIDENCE;
}

/**
 * Shared handling for the three degenerate cases every field-match check has:
 * the application omitted the value, the label omitted it, or the reader could
 * not make it out. Returns null when the pair is comparable and the caller
 * should proceed with its own logic.
 */
function preflight(
  id: string,
  name: string,
  expected: string | undefined,
  reading: FieldReading | null,
  options: { requiredOnLabel: boolean; citation?: string },
): CheckResult | null {
  const { requiredOnLabel, citation } = options;

  /*
   * Absence from the LABEL is tested before absence from the application, and
   * the order matters. A mandatory item missing from the artwork is a defect
   * whatever the application happens to say — testing `expected` first let an
   * empty application field cancel the label's own obligation and return
   * "not applicable" for something the regulation requires unconditionally.
   */
  if (!reading && requiredOnLabel) {
    return {
      id,
      name,
      category: "compliance",
      verdict: "fail",
      expected,
      rule: "mandatory-field-absent",
      explanation: `No ${name.toLowerCase()} could be found anywhere on the label. This is a mandatory item on every container.`,
      citation,
    };
  }

  if (!expected || !expected.trim()) {
    return {
      id,
      name,
      category: "match",
      verdict: "not_applicable",
      found: reading?.text,
      rule: "application-field-empty",
      explanation: `The application did not state a ${name.toLowerCase()}, so there is nothing to compare against.`,
      citation,
    };
  }

  if (!reading) {
    return {
      id,
      name,
      category: "match",
      verdict: "review",
      expected,
      rule: "label-field-absent",
      explanation: `No ${name.toLowerCase()} was found on the label. The application states "${expected}".`,
      citation,
    };
  }

  if (tooUncertain(reading)) {
    return { ...unreadable(id, name, "match", reading, citation), expected };
  }

  return null;
}

/**
 * Generic text-field comparison: the normalisation ladder first, then a
 * similarity fallback into the review tier.
 *
 * `subsetIsAcceptable` exists for fields where the label legitimately carries
 * more text than the application — a bottler line reads "BOTTLED BY OLD TOM
 * DISTILLERY, BARDSTOWN, KY" against an application field of "Old Tom
 * Distillery". Containment is a satisfied requirement there, but would be far
 * too permissive for a brand name.
 */
function compareTextField(
  id: string,
  name: string,
  expected: string | undefined,
  reading: FieldReading | null,
  options: {
    requiredOnLabel: boolean;
    citation?: string;
    subsetIsAcceptable?: boolean;
    /**
     * What containment should yield. A bottler line legitimately carries an
     * address the application omits, so extra words there are a `pass`. On a
     * class/type designation extra words can change the product outright —
     * "GIN" against a label reading "SLOE GIN", or "BRANDY" against "FLAVORED
     * BRANDY" — and a class/type change always requires a new COLA. Those must
     * reach a human, so containment there yields `review`.
     */
    containmentVerdict?: "pass" | "review";
  },
): CheckResult {
  const early = preflight(id, name, expected, reading, options);
  if (early) return early;

  // preflight() guarantees both are present past this point.
  const expectedValue = expected as string;
  const found = reading as FieldReading;
  const {
    citation,
    subsetIsAcceptable = false,
    containmentVerdict = "pass",
  } = options;

  const ladder = ladderMatch(expectedValue, found.text);
  if (ladder.matched) {
    const exact = ladder.level === "exact";
    return {
      id,
      name,
      category: "match",
      verdict: "pass",
      expected: expectedValue,
      found: found.text,
      rule: `normalised-match:${ladder.level}`,
      explanation: exact
        ? "The label matches the application exactly."
        : `The label agrees with the application — ${ladder.description}.`,
      confidence: found.confidence,
      citation,
    };
  }

  const expectedTokens = canonicalTokens(expectedValue);
  const foundTokens = canonicalTokens(found.text);

  if (subsetIsAcceptable && containsAllTokens(foundTokens, expectedTokens)) {
    const extra = foundTokens.filter((token) => !expectedTokens.includes(token));
    return {
      id,
      name,
      category: "match",
      verdict: containmentVerdict,
      expected: expectedValue,
      found: found.text,
      rule:
        containmentVerdict === "pass"
          ? "label-contains-application-value"
          : "label-adds-words-needs-review",
      explanation:
        containmentVerdict === "pass"
          ? "The label carries additional text, but everything the application stated appears within it."
          : `The label states everything the application did, but adds ${extra.map((word) => `"${word}"`).join(", ")}. On a class or type designation an extra word can change what the product legally is, so please confirm this is the same designation.`,
      confidence: found.confidence,
      citation,
    };
  }

  const similarity = combinedSimilarity(
    expectedValue.toLowerCase(),
    found.text.toLowerCase(),
    expectedTokens,
    foundTokens,
  );

  if (similarity >= REVIEW_SIMILARITY_THRESHOLD) {
    return {
      id,
      name,
      category: "match",
      verdict: "review",
      expected: expectedValue,
      found: found.text,
      rule: "near-match-needs-review",
      explanation: `The label and the application are close but not identical (${Math.round(similarity * 100)}% similar). This is likely the same product with a discrepancy worth confirming by eye.`,
      confidence: found.confidence,
      citation,
    };
  }

  return {
    id,
    name,
    category: "match",
    verdict: "fail",
    expected: expectedValue,
    found: found.text,
    rule: "mismatch",
    explanation: `The label states "${found.text}" but the application states "${expectedValue}". These do not correspond.`,
    confidence: found.confidence,
    citation,
  };
}

/** Alcohol content: parsed and compared numerically, within regulatory tolerance. */
function checkAlcoholContent(
  application: Application,
  extraction: LabelExtraction,
): CheckResult[] {
  const results: CheckResult[] = [];
  const id = "alcohol_content";
  const name = "Alcohol Content";
  const citation =
    application.beverageType === "wine" ? "27 CFR 4.36" : "27 CFR 5.65";

  const reading = extraction.alcoholContent;
  const declared = parseAlcohol(application.alcoholContent);
  const printed = parseAlcohol(reading?.text);

  /**
   * Alcohol content was removed from TTB Form 5100.31 around 2015 — it was Item
   * 13 until then. A COLA filed today carries no declared ABV at all, verified
   * against the public registry (a 2016 filing renders an alcohol content, a
   * 2025 one does not; see docs/COLA-FORM-NOTES.md).
   *
   * So "the application does not state an ABV" is the normal modern case, not
   * an omission. There is nothing to match against — but the label's own
   * obligations still stand, and those are checked below regardless.
   */
  if (!application.alcoholContent?.trim()) {
    results.push({
      id,
      name,
      category: "match",
      verdict: "not_applicable",
      found: reading?.text,
      rule: "application-field-empty",
      explanation:
        "Alcohol content is not captured on the current COLA application, so there is nothing to compare the label against. The label's own requirements are still checked.",
      citation,
    });
    results.push(...alcoholComplianceOnly(application, reading, printed, citation));
    return results;
  }

  if (!reading) {
    results.push({
      id,
      name,
      category: "match",
      verdict: application.beverageType === "malt_beverage" ? "review" : "fail",
      expected: application.alcoholContent,
      rule: "label-field-absent",
      explanation:
        application.beverageType === "malt_beverage"
          ? "No alcohol content statement was found. Malt beverages are not always required to carry one, so this may be acceptable."
          : "No alcohol content statement was found on the label. This is a mandatory item.",
      citation,
    });
    return results;
  }

  if (tooUncertain(reading)) {
    results.push(unreadable(id, name, "match", reading, citation));
    return results;
  }

  if (declared.abv === null || printed.abv === null) {
    results.push({
      id,
      name,
      category: "match",
      verdict: "review",
      expected: application.alcoholContent,
      found: reading.text,
      rule: "alcohol-unparseable",
      explanation: `The alcohol statement could not be interpreted as a number (application: "${application.alcoholContent ?? "—"}", label: "${reading.text}"). Please compare by eye.`,
      confidence: reading.confidence,
      citation,
    });
    return results;
  }

  const tolerance = toleranceFor(application.beverageType, declared.abv);
  const difference = Math.abs(declared.abv - printed.abv);

  if (difference === 0) {
    results.push({
      id,
      name,
      category: "match",
      verdict: "pass",
      expected: application.alcoholContent,
      found: reading.text,
      rule: "abv-exact",
      explanation: `Both state ${printed.abv}% alcohol by volume.`,
      confidence: reading.confidence,
      citation,
    });
  } else if (difference <= tolerance) {
    results.push({
      id,
      name,
      category: "match",
      verdict: "review",
      expected: application.alcoholContent,
      found: reading.text,
      rule: "abv-within-tolerance",
      explanation: `The label states ${printed.abv}% against ${declared.abv}% on the application. The difference of ${difference.toFixed(1)} points is within the ${tolerance}-point tolerance allowed by ${citation}, but the two documents should still agree.`,
      confidence: reading.confidence,
      citation,
    });
  } else {
    results.push({
      id,
      name,
      category: "match",
      verdict: "fail",
      expected: application.alcoholContent,
      found: reading.text,
      rule: "abv-outside-tolerance",
      explanation: `The label states ${printed.abv}% but the application states ${declared.abv}%. That is a difference of ${difference.toFixed(1)} points, beyond the ${tolerance}-point tolerance permitted by ${citation}.`,
      confidence: reading.confidence,
      citation,
    });
  }

  // An internally contradictory label is worth flagging even when the ABV
  // itself matches the application.
  const consistent = proofIsConsistent(printed);
  if (consistent === false && printed.abv !== null && printed.proof !== null) {
    results.push({
      id: "proof_consistency",
      name: "Proof Statement",
      category: "compliance",
      verdict: "fail",
      found: reading.text,
      rule: "proof-inconsistent-with-abv",
      explanation: `The label states ${printed.abv}% alcohol by volume and ${printed.proof} proof. Proof is twice the alcohol by volume, so ${printed.abv}% should be shown as ${(printed.abv * 2).toFixed(0)} proof.`,
      confidence: reading.confidence,
      citation: "27 CFR 5.65",
    });
  }

  return results;
}

/**
 * Checks that apply to the label's alcohol statement on its own, with no
 * application value to compare against.
 *
 * Mandatory-ness differs by class: always required for distilled spirits
 * (27 CFR 5.63(a)(3)); required for wine above 14% and for wine at or below 14%
 * without a "table"/"light" designation (4.36(a)); optional by default for malt
 * beverages (7.63(a)(3)).
 */
function alcoholComplianceOnly(
  application: Application,
  reading: FieldReading | null,
  printed: ReturnType<typeof parseAlcohol>,
  citation: string,
): CheckResult[] {
  const results: CheckResult[] = [];

  if (!reading) {
    if (application.beverageType === "distilled_spirits") {
      results.push({
        id: "alcohol_present",
        name: "Alcohol Content Statement",
        category: "compliance",
        verdict: "fail",
        rule: "alcohol-statement-absent",
        explanation:
          "Distilled spirits labels must state alcohol content. No statement was found.",
        citation: "27 CFR 5.63",
      });
    } else if (application.beverageType === "wine") {
      results.push({
        id: "alcohol_present",
        name: "Alcohol Content Statement",
        category: "compliance",
        verdict: "review",
        rule: "alcohol-statement-absent-conditional",
        explanation:
          'No alcohol statement was found. Wine may omit it only at or below 14% alcohol when the label carries a "table wine" or "light wine" designation — confirm that applies here.',
        citation: "27 CFR 4.36",
      });
    }
    return results;
  }

  const consistent = proofIsConsistent(printed);
  if (consistent === false && printed.abv !== null && printed.proof !== null) {
    results.push({
      id: "proof_consistency",
      name: "Proof Statement",
      category: "compliance",
      verdict: "fail",
      found: reading.text,
      rule: "proof-inconsistent-with-abv",
      explanation: `The label states ${printed.abv}% alcohol by volume and ${printed.proof} proof. Proof is twice the alcohol by volume, so ${printed.abv}% should be shown as ${(printed.abv * 2).toFixed(0)} proof.`,
      confidence: reading.confidence,
      citation,
    });
  }

  return results;
}

/** Net contents: numeric comparison, then the standards-of-fill check. */
function checkNetContents(
  application: Application,
  extraction: LabelExtraction,
): CheckResult[] {
  const results: CheckResult[] = [];
  const id = "net_contents";
  const name = "Net Contents";
  const citation =
    application.beverageType === "wine" ? "27 CFR 4.72" : "27 CFR 5.203";

  const reading = extraction.netContents;
  if (!reading) {
    results.push({
      id,
      name,
      category: "match",
      verdict: "fail",
      expected: application.netContents,
      rule: "label-field-absent",
      explanation:
        "No net contents statement was found on the label. This is a mandatory item on every container.",
      citation,
    });
    return results;
  }

  // A volume the reader could barely see must not drive a standards-of-fill
  // conclusion — that check produces a hard failure citing a specific CFR part.
  if (tooUncertain(reading)) {
    results.push(unreadable(id, name, "match", reading, citation));
    return results;
  }

  const declared = parseVolume(application.netContents);
  const printed = parseVolume(reading.text);

  // Net contents was Item 12 on TTB Form 5100.31 until the ~2015 revision and
  // is no longer captured. As with alcohol content, its absence from the
  // application is now normal — but the standard-of-fill check below does not
  // depend on the application at all, and still runs.
  if (!application.netContents?.trim()) {
    results.push({
      id,
      name,
      category: "match",
      verdict: "not_applicable",
      found: reading.text,
      rule: "application-field-empty",
      explanation:
        "Net contents is not captured on the current COLA application, so there is nothing to compare the label against. The container size is still checked against the authorised standards of fill.",
      citation,
    });
  } else if (declared.millilitres === null || printed.millilitres === null) {
    results.push({
      id,
      name,
      category: "match",
      verdict: "review",
      expected: application.netContents,
      found: reading.text,
      rule: "volume-unparseable",
      explanation: `The net contents could not be interpreted as a volume (application: "${application.netContents ?? "—"}", label: "${reading.text}"). Please compare by eye.`,
      confidence: reading.confidence,
      citation,
    });
  } else if (Math.abs(declared.millilitres - printed.millilitres) < 0.5) {
    results.push({
      id,
      name,
      category: "match",
      verdict: "pass",
      expected: application.netContents,
      found: reading.text,
      rule: "volume-equal",
      explanation:
        declared.statedUnit?.toLowerCase() === printed.statedUnit?.toLowerCase()
          ? `Both state ${reading.text}.`
          : `Both describe the same volume (${formatVolume(printed.millilitres)}), written in different units.`,
      confidence: reading.confidence,
      citation,
    });
  } else {
    results.push({
      id,
      name,
      category: "match",
      verdict: "fail",
      expected: application.netContents,
      found: reading.text,
      rule: "volume-mismatch",
      explanation: `The label states ${formatVolume(printed.millilitres)} but the application states ${formatVolume(declared.millilitres)}.`,
      confidence: reading.confidence,
      citation,
    });
  }

  // Standards of fill are a property of the label alone, so this runs even when
  // the label and application agree with each other.
  const fill = checkStandardOfFill(application.beverageType, printed.millilitres);
  if (!fill.notApplicable && printed.millilitres !== null) {
    if (fill.authorised) {
      results.push({
        id: "standard_of_fill",
        name: "Standard of Fill",
        category: "compliance",
        verdict: "pass",
        found: reading.text,
        rule: "authorised-container-size",
        explanation: `${formatVolume(fill.matchedSize as number)} is an authorised container size.`,
        citation,
      });
    } else {
      const nearest = (fill.nearest ?? []).map(formatVolume).join(" or ");
      results.push({
        id: "standard_of_fill",
        name: "Standard of Fill",
        category: "compliance",
        verdict: "fail",
        found: reading.text,
        rule: "unauthorised-container-size",
        explanation: `${formatVolume(printed.millilitres)} is not an authorised container size for this class of product. The nearest permitted sizes are ${nearest}.`,
        citation,
      });
    }
  }

  return results;
}

/** The government warning: checked against the statute, not the application. */
function checkGovernmentWarning(extraction: LabelExtraction): CheckResult[] {
  const citation = "27 CFR 16.21";
  const reading = extraction.governmentWarning;

  if (!reading) {
    return [
      {
        id: "government_warning",
        name: "Government Warning",
        category: "compliance",
        verdict: "fail",
        rule: "warning-absent",
        explanation:
          "No government health warning was found on the label. It is mandatory on every alcoholic beverage container.",
        citation,
      },
    ];
  }

  /*
   * The warning is compared word-for-word against the statute, so a shaky
   * transcription produces a diff full of phantom edits and a confident,
   * entirely fictional rejection. Refusing to judge is the honest answer.
   */
  if (tooUncertain(reading)) {
    return [
      unreadable("government_warning", "Government Warning", "compliance", reading, citation),
    ];
  }

  const assessment = assessWarning(reading);
  const results: CheckResult[] = [];

  results.push({
    id: "government_warning",
    name: "Government Warning — Wording",
    category: "compliance",
    verdict: assessment.wordingExact ? "pass" : "fail",
    found: reading.text,
    rule: assessment.wordingExact ? "warning-verbatim" : "warning-wording-altered",
    explanation: assessment.wordingExact
      ? "The warning reproduces the statutory text word for word."
      : `The warning does not reproduce the statutory text: ${assessment.deletions} word${assessment.deletions === 1 ? "" : "s"} missing, ${assessment.insertions} added or altered. See the highlighted comparison below.`,
    confidence: reading.confidence,
    citation,
  });

  results.push({
    id: "warning_capitalisation",
    name: "Government Warning — Capitalisation",
    category: "compliance",
    verdict: assessment.headerAllCaps ? "pass" : "fail",
    found: reading.text.slice(0, 40),
    rule: assessment.headerAllCaps ? "warning-header-caps" : "warning-header-not-caps",
    explanation: assessment.headerAllCaps
      ? 'The heading "GOVERNMENT WARNING:" appears in capital letters as required.'
      : 'The heading "GOVERNMENT WARNING:" must appear in capital letters. It does not.',
    citation,
  });

  const prominenceProblems = [
    !assessment.headerBold ? "the heading is not bold" : null,
    !assessment.legibleSize
      ? "the text is too small or low-contrast to read readily"
      : null,
  ].filter(Boolean) as string[];

  results.push({
    id: "warning_prominence",
    name: "Government Warning — Prominence",
    category: "compliance",
    verdict: prominenceProblems.length === 0 ? "pass" : "fail",
    rule:
      prominenceProblems.length === 0
        ? "warning-prominent"
        : "warning-insufficiently-prominent",
    explanation:
      prominenceProblems.length === 0
        ? "The warning is boldly headed and legibly sized."
        : `The warning is not sufficiently prominent: ${prominenceProblems.join(", and ")}.`,
    citation: "27 CFR 16.22",
  });

  return results;
}

/**
 * Bottler / producer, matched against either name the applicant may lawfully use.
 *
 * The form records two different things. Item 8 is the LEGAL applicant; the
 * trade name actually printed on the label is recorded separately, and the two
 * differ in most real filings — an applicant may be "PERNOD RICARD USA, LLC"
 * while the bottle reads "THE GLENLIVET DISTILLING COMPANY". Both are correct.
 *
 * Checking the label against the legal name alone would false-fail the majority
 * of valid applications, so a match against EITHER name passes. Where the trade
 * name is what matched, the report says so — an agent seeing "matched the trade
 * name, not the applicant" learns something a bare tick would hide.
 */
function checkBottler(
  application: Application,
  extraction: LabelExtraction,
): CheckResult {
  const options = {
    requiredOnLabel: true,
    citation: "27 CFR 5.66",
    subsetIsAcceptable: true,
  };

  const legal = compareTextField(
    "bottler",
    "Bottler / Producer",
    application.bottlerName,
    extraction.bottlerName,
    options,
  );

  const tradeName = application.labelCompanyName?.trim();
  if (!tradeName || legal.verdict === "pass") return legal;

  const viaTradeName = compareTextField(
    "bottler",
    "Bottler / Producer",
    tradeName,
    extraction.bottlerName,
    options,
  );

  if (viaTradeName.verdict !== "pass") return legal;

  return {
    ...viaTradeName,
    expected: `${tradeName} (trade name; applicant is ${application.bottlerName ?? "not stated"})`,
    rule: `${viaTradeName.rule}:trade-name`,
    explanation: `The label names the approved trade name rather than the legal applicant. ${viaTradeName.explanation}`,
  };
}

/** Country of origin, mandatory only for imported product. */
function checkCountryOfOrigin(
  application: Application,
  extraction: LabelExtraction,
): CheckResult {
  const id = "country_of_origin";
  const name = "Country of Origin";
  const citation = "27 CFR 5.69";

  if (!application.isImport) {
    return {
      id,
      name,
      category: "compliance",
      verdict: "not_applicable",
      rule: "not-an-import",
      explanation:
        "The application is not for an imported product, so a country of origin statement is not required.",
      citation,
    };
  }

  if (!extraction.countryOfOrigin) {
    return {
      id,
      name,
      category: "compliance",
      verdict: "fail",
      expected: application.countryOfOrigin,
      rule: "origin-absent-on-import",
      explanation:
        "This is an imported product, so the label must state the country of origin. No such statement was found.",
      citation,
    };
  }

  return compareTextField(
    id,
    name,
    application.countryOfOrigin,
    extraction.countryOfOrigin,
    { requiredOnLabel: true, citation, subsetIsAcceptable: true },
  );
}

/** Roll individual verdicts up into a single recommendation. */
function summarise(checks: CheckResult[]): {
  recommendation: Recommendation;
  headline: string;
} {
  const counts = (verdict: Verdict) =>
    checks.filter((c) => c.verdict === verdict).length;

  const failures = counts("fail");
  const reviews = counts("review");
  const unreadable = counts("unreadable");

  if (failures > 0) {
    return {
      recommendation: "reject",
      headline: `${failures} problem${failures === 1 ? "" : "s"} found that would prevent approval.`,
    };
  }
  if (unreadable > 0) {
    return {
      recommendation: "needs_review",
      headline: `${unreadable} item${unreadable === 1 ? "" : "s"} could not be read from this image.`,
    };
  }
  if (reviews > 0) {
    return {
      recommendation: "needs_review",
      headline: `${reviews} item${reviews === 1 ? "" : "s"} need${reviews === 1 ? "s" : ""} a second look.`,
    };
  }
  return {
    recommendation: "approve",
    headline:
      "Everything checked matches the application and meets labelling requirements.",
  };
}

/**
 * Verify a label extraction against an application.
 *
 * Pure and synchronous. Given the same inputs it always produces the same
 * report, which is what makes the decision layer testable and auditable.
 */
export function verify(
  application: Application,
  extraction: LabelExtraction,
  meta: { extractionMs: number; reader: string },
): VerificationReport {
  const started = Date.now();

  const checks: CheckResult[] = [
    compareTextField(
      "brand_name",
      "Brand Name",
      application.brandName,
      extraction.brandName,
      { requiredOnLabel: true, citation: "27 CFR 5.63" },
    ),
    compareTextField(
      "class_type",
      "Class / Type",
      application.classType,
      extraction.classType,
      {
        requiredOnLabel: true,
        citation: "27 CFR 5.63",
        subsetIsAcceptable: true,
        containmentVerdict: "review",
      },
    ),
    ...checkAlcoholContent(application, extraction),
    ...checkNetContents(application, extraction),
    checkBottler(application, extraction),
    checkCountryOfOrigin(application, extraction),
    ...checkGovernmentWarning(extraction),
  ];

  let { recommendation, headline } = summarise(checks);

  // A photograph too poor to review overrides any conclusion drawn from it.
  // Reporting "approved" from an unreadable image would be the single most
  // dangerous failure mode this system has.
  if (extraction.imageQuality.tooPoorToReview) {
    recommendation = "needs_review";
    headline =
      "This image is not clear enough to review. Request a better photograph from the applicant.";
  }

  const warningReading = extraction.governmentWarning;
  const rulesMs = Date.now() - started;

  return {
    recommendation,
    headline,
    checks,
    imageQuality: extraction.imageQuality,
    notes: extraction.notes,
    warningDiff: warningReading ? assessWarning(warningReading).diff : undefined,
    timing: {
      extractionMs: meta.extractionMs,
      rulesMs,
      totalMs: meta.extractionMs + rulesMs,
    },
    reader: meta.reader,
  };
}
