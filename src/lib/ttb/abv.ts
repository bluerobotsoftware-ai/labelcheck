/**
 * Alcohol content parsing and comparison.
 *
 * "Check the ABV matches" sounds like string equality until you look at what
 * actually appears on labels and in applications:
 *
 *     45% Alc./Vol. (90 Proof)      40% ALC/VOL          ALC. 12.5% BY VOL.
 *     45% alc/vol                   90 PROOF             12.5%
 *     ALCOHOL 45% BY VOLUME         .5% ALC BY VOL       5.0% ABV
 *
 * All of these are the same kind of statement in different clothes. We parse to
 * a number and compare numerically, applying the tolerance the regulations
 * actually allow rather than demanding exact textual agreement.
 */

import type { BeverageType } from "./types";

export interface AlcoholReading {
  /** Alcohol by volume as a percentage, e.g. 45 for "45% Alc./Vol." */
  abv: number | null;
  /** Degrees proof where stated, e.g. 90 for "(90 Proof)". */
  proof: number | null;
  /** True when the source stated proof but no ABV, so ABV was derived as proof/2. */
  abvDerivedFromProof: boolean;
  /** The substring the number came from, for showing an agent what we read. */
  matchedText?: string;
}

/**
 * Tolerances permitted between the labelled alcohol content and the true
 * content, by beverage class.
 *
 * These come from the regulations, not from taste. They exist because
 * production varies batch to batch; a label is not expected to be exact. We
 * apply them when comparing the application's declared value to the label's
 * printed value, since a difference inside tolerance is not a defect.
 *
 * NOTE: figures are confirmed against the eCFR in docs/REGULATORY-NOTES.md.
 * If that document and this table ever disagree, the document wins and this
 * table is the bug.
 */
export const ABV_TOLERANCE: Record<BeverageType, number> = {
  /** 27 CFR 5.65(a) — distilled spirits. */
  distilled_spirits: 0.3,
  /**
   * 27 CFR 4.36(b) — wine. The regulation distinguishes wines at or below
   * 14% (1.5 points) from those above (1.0 point). We take the stricter of the
   * two as the default and refine per-reading below.
   */
  wine: 1.0,
  /** 27 CFR 7 — malt beverages. */
  malt_beverage: 0.3,
};

/** Wine tolerance depends on where the wine sits relative to the 14% line. */
export function wineTolerance(abv: number): number {
  return abv <= 14 ? 1.5 : 1.0;
}

/** The tolerance applicable to a given beverage type and stated strength. */
export function toleranceFor(type: BeverageType, abv: number): number {
  return type === "wine" ? wineTolerance(abv) : ABV_TOLERANCE[type];
}

/**
 * A percentage figure: optional leading dot (".5%"), optional decimals.
 *
 * The decimal separator may be a comma. Imported labels routinely print
 * "13,5% vol", and a pattern anchored on "." alone reads that as 5% — a
 * catastrophic misreading that looks like a legitimate number.
 */
const ABV_PATTERNS: RegExp[] = [
  /*
   * Ordered from most to least specific, and the first two REQUIRE alcohol
   * vocabulary next to the number.
   *
   * A bare "(\d+)%" pattern matched any percentage anywhere on the label, and
   * spirits labels are full of them — "DISTILLED FROM 100% CORN" was read as
   * 100% alcohol by volume, a confident and completely fictional figure.
   */
  // "45% Alc./Vol.", "12.5% ALC BY VOL", "5% ABV", "13,5% vol"
  /(\d*[.,]?\d+)\s*%\s*(?:alc|alcohol|abv|vol)/i,
  // "ALC. 45% BY VOL", "ALCOHOL 45 BY VOLUME"
  /(?:alc|alcohol|abv)\.?\s*(\d*[.,]?\d+)\s*(?:%|percent)?\s*(?:by\s*)?vol/i,
  // Bare trailing percentage, e.g. an application field containing just "45"
  /^\s*(\d*[.,]?\d+)\s*%?\s*$/,
  /*
   * Last resort: a lone percentage in a field with nothing else in it. Kept
   * because an application's alcohol field is sometimes just "45%", but placed
   * after the vocabulary-anchored patterns so it never wins on a busy label.
   */
  /^\s*(\d*[.,]?\d+)\s*%\s*$/,
];

const PROOF_PATTERN = /(\d*[.,]?\d+)\s*(?:degrees?\s*)?proof/i;

/**
 * Plausible bounds for a beverage.
 *
 * Anything outside this is a misparse, not a product — the strongest spirits
 * sold are around 95%. Returning null lets the engine report "could not
 * interpret" and route to review, which is honest; returning 100 because the
 * label mentioned 100% rye is a fabricated finding wearing a number's clothes.
 */
const MIN_PLAUSIBLE_ABV = 0;
const MAX_PLAUSIBLE_ABV = 95;

/** Vulgar fractions, which NFKC does not decompose into usable decimals. */
const VULGAR_FRACTIONS: Record<string, string> = {
  "½": ".5",
  "¼": ".25",
  "¾": ".75",
  "⅓": ".333",
  "⅔": ".667",
  "⅕": ".2",
  "⅖": ".4",
  "⅗": ".6",
  "⅘": ".8",
  "⅙": ".167",
  "⅛": ".125",
  "⅜": ".375",
  "⅝": ".625",
  "⅞": ".875",
};

/**
 * Fold vulgar fractions into decimals BEFORE normalising.
 *
 * NFKC turns "12½%" into "121⁄2%", which then parses as 2% — a plausible-looking
 * number that is wrong by a factor of six. Wine and cider labels use these.
 */
function expandFractions(input: string): string {
  let output = input;
  for (const [glyph, decimal] of Object.entries(VULGAR_FRACTIONS)) {
    output = output.split(glyph).join(decimal);
  }
  return output;
}

/** Parse a number that may use either a dot or a comma as its decimal mark. */
function parseDecimal(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

/** Reject impossible figures rather than reporting them confidently. */
function plausibleAbv(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= MIN_PLAUSIBLE_ABV &&
    value <= MAX_PLAUSIBLE_ABV
  );
}

/**
 * Parse a free-form alcohol statement.
 *
 * Returns nulls rather than throwing: an unparseable string is a legitimate
 * outcome that the rules engine reports as "could not interpret", which is a
 * different and more honest verdict than a fabricated number.
 */
export function parseAlcohol(input: string | null | undefined): AlcoholReading {
  const empty: AlcoholReading = {
    abv: null,
    proof: null,
    abvDerivedFromProof: false,
  };
  if (!input) return empty;

  const text = expandFractions(input).normalize("NFKC").trim();

  let proof: number | null = null;
  const proofMatch = PROOF_PATTERN.exec(text);
  if (proofMatch) {
    const value = parseDecimal(proofMatch[1]);
    // Proof is twice ABV, so the same plausibility bound applies doubled.
    if (Number.isFinite(value) && value >= 0 && value <= MAX_PLAUSIBLE_ABV * 2) {
      proof = value;
    }
  }

  // Look for an explicit percentage. Exclude the proof substring first so
  // "(90 Proof)" cannot be mistaken for a percentage in a later pattern.
  const withoutProof = proofMatch
    ? text.replace(proofMatch[0], " ")
    : text;

  let abv: number | null = null;
  let matchedText: string | undefined;
  for (const pattern of ABV_PATTERNS) {
    const match = pattern.exec(withoutProof);
    if (match) {
      const value = parseDecimal(match[1]);
      if (plausibleAbv(value)) {
        abv = value;
        matchedText = match[0].trim();
        break;
      }
    }
  }

  // Proof is defined as twice ABV in the United States, so a label that gives
  // only proof still tells us the ABV.
  let abvDerivedFromProof = false;
  if (abv === null && proof !== null) {
    abv = proof / 2;
    abvDerivedFromProof = true;
    matchedText = proofMatch?.[0].trim();
  }

  return { abv, proof, abvDerivedFromProof, matchedText };
}

/**
 * Is a stated proof consistent with a stated ABV?
 *
 * Only meaningful when the label gives both. A label reading "45% Alc./Vol.
 * (80 Proof)" is internally contradictory and an agent should see that even
 * though the ABV itself matches the application.
 */
export function proofIsConsistent(reading: AlcoholReading): boolean | null {
  if (reading.abv === null || reading.proof === null) return null;
  if (reading.abvDerivedFromProof) return true;
  // Allow a rounding point of slack: 40.5% is legitimately printed as 81 proof.
  return Math.abs(reading.proof - reading.abv * 2) <= 1;
}
