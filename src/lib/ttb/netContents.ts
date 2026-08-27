/**
 * Net contents parsing and standards of fill.
 *
 * Two separate questions hide in this field:
 *
 *   1. Does the label's stated volume match the application's? Comparison must
 *      be numeric and unit-aware — "750 mL", "75 cL" and "0.75 L" are the same
 *      quantity written three ways, and a string compare fails all three pairs.
 *
 *   2. Is that volume a container size the law actually permits? TTB prescribes
 *      "standards of fill" — a closed list of authorised bottle sizes. A 700 mL
 *      bourbon bottle is a perfectly coherent statement that happens to be
 *      illegal to sell in the United States. Only a check against the list
 *      catches it, and no amount of matching against the application ever will,
 *      because the application says 700 mL too.
 */

import type { BeverageType } from "./types";

export interface VolumeReading {
  /** Normalised to millilitres so all comparisons are like-for-like. */
  millilitres: number | null;
  /** The unit as printed, e.g. "mL", "L", "fl oz". */
  statedUnit?: string;
  /** The numeric value as printed, before unit conversion. */
  statedValue?: number;
  matchedText?: string;
}

/** Conversion factors into millilitres. */
const UNIT_TO_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  millilitre: 1,
  milliliters: 1,
  millilitres: 1,
  cl: 10,
  centiliter: 10,
  centilitre: 10,
  centiliters: 10,
  centilitres: 10,
  dl: 100,
  l: 1000,
  liter: 1000,
  litre: 1000,
  liters: 1000,
  litres: 1000,
  // US fluid ounce, used on malt beverage labels.
  "fl oz": 29.5735,
  floz: 29.5735,
  "fluid ounce": 29.5735,
  "fluid ounces": 29.5735,
  oz: 29.5735,
  pint: 473.176,
  pints: 473.176,
  quart: 946.353,
  quarts: 946.353,
  gallon: 3785.41,
  gallons: 3785.41,
};

const VOLUME_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(ml|milliliters?|millilitres?|cl|centiliters?|centilitres?|dl|l|liters?|litres?|fl\.?\s*oz\.?|fluid\s+ounces?|oz\.?|pints?|quarts?|gallons?)\b/i;

/** Normalise a matched unit string to a `UNIT_TO_ML` key. */
function canonicalUnit(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (/^fl\s*oz$/.test(cleaned)) return "fl oz";
  return cleaned;
}

/**
 * Parse a free-form net contents statement into millilitres.
 * Returns `millilitres: null` when nothing interpretable is present.
 */
export function parseVolume(input: string | null | undefined): VolumeReading {
  if (!input) return { millilitres: null };

  const text = input.normalize("NFKC").trim();
  const match = VOLUME_PATTERN.exec(text);
  if (!match) return { millilitres: null };

  // Accept "1,5 L" (comma decimal separator appears on imported labels).
  const value = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return { millilitres: null };

  const unit = canonicalUnit(match[2]);
  const factor = UNIT_TO_ML[unit];
  if (factor === undefined) return { millilitres: null };

  return {
    millilitres: value * factor,
    statedUnit: match[2].trim(),
    statedValue: value,
    matchedText: match[0].trim(),
  };
}

/**
 * Authorised standards of fill, in millilitres.
 *
 * Transcribed from the eCFR — see docs/REGULATORY-NOTES.md, which records the
 * full list and its citation for each entry.
 *
 * THESE LISTS CHANGED RECENTLY. T.D. TTB-200 (90 FR 1868, 10 January 2025)
 * added ten sizes to the spirits list — 945, 900, 720, 710, 570, 475, 355,
 * 350, 331 and 250 mL — and amended the wine list. Any reference material or
 * cached list predating 2025 is wrong, and seeding this constant from one
 * would cause the app to reject lawful containers: a false rejection that
 * looks entirely authoritative, carries a citation, and would send a compliant
 * applicant an official rejection letter. Check the date on any source before
 * touching these arrays.
 *
 * Malt beverages have no prescribed standards of fill anywhere in part 7,
 * which is why they are absent here and why the rules engine skips the check
 * for them rather than failing it.
 */
export const STANDARDS_OF_FILL: Partial<Record<BeverageType, number[]>> = {
  /** 27 CFR 5.203(a)(1)-(a)(25), as amended by T.D. TTB-200. 25 sizes. */
  distilled_spirits: [
    50, 100, 187, 200, 250, 331, 350, 355, 375, 475, 500, 570, 700, 710, 720,
    750, 900, 945, 1000, 1500, 1750, 1800, 2000, 3000, 3750,
  ],
  /** 27 CFR 4.72(a)(1)-(a)(25), as amended by T.D. TTB-200. 25 sizes. */
  wine: [
    50, 100, 180, 187, 200, 250, 300, 330, 355, 360, 375, 473, 500, 550, 568,
    600, 620, 700, 720, 750, 1000, 1500, 1800, 2250, 3000,
  ],
};

/**
 * Wine may also be packed in containers of four litres or more, provided they
 * are filled in EVEN litres — 27 CFR 4.72(b). So 4 L and 5 L are authorised
 * while 4.5 L is not, which no enumerated list can express.
 */
const WINE_EVEN_LITRE_FLOOR_ML = 4000;

/**
 * Wine in containers of 18 litres or more falls outside the standards of fill
 * entirely — 27 CFR 4.70(b)(2). Out of scope is not the same as non-compliant,
 * so the check reports itself as inapplicable rather than passing silently.
 */
const WINE_SCOPE_CEILING_ML = 18000;

/** Tolerance when matching a measured volume to a standard-of-fill entry. */
const FILL_MATCH_TOLERANCE_ML = 1;

export interface FillCheck {
  /** False only when we positively know the size is not authorised. */
  authorised: boolean;
  /** True when this beverage type has no prescribed standards of fill. */
  notApplicable: boolean;
  /** The authorised size the reading corresponds to, when it does. */
  matchedSize?: number;
  /** Nearest authorised sizes, to help an agent see how far off the label is. */
  nearest?: number[];
}

/** Is `millilitres` an authorised container size for this beverage type? */
export function checkStandardOfFill(
  type: BeverageType,
  millilitres: number | null,
): FillCheck {
  const sizes = STANDARDS_OF_FILL[type];
  if (!sizes) return { authorised: true, notApplicable: true };
  if (millilitres === null) return { authorised: true, notApplicable: false };

  if (type === "wine") {
    // Large-format wine sits outside the standards of fill altogether.
    if (millilitres >= WINE_SCOPE_CEILING_ML) {
      return { authorised: true, notApplicable: true };
    }
    // Four litres and above, in even litres, is authorised by 4.72(b).
    if (millilitres >= WINE_EVEN_LITRE_FLOOR_ML) {
      const litres = millilitres / 1000;
      const evenLitres = Math.abs(litres - Math.round(litres)) < 0.001;
      return evenLitres
        ? { authorised: true, notApplicable: false, matchedSize: millilitres }
        : { authorised: false, notApplicable: false, nearest: [Math.floor(litres) * 1000, Math.ceil(litres) * 1000] };
    }
  }

  const exact = sizes.find(
    (size) => Math.abs(size - millilitres) <= FILL_MATCH_TOLERANCE_ML,
  );
  if (exact !== undefined) {
    return { authorised: true, notApplicable: false, matchedSize: exact };
  }

  // Report the sizes either side rather than the two closest. An agent asked to
  // advise an applicant needs to know which way to move: "750 mL or 900 mL"
  // brackets the problem, whereas the two nearest values can both sit below it
  // and silently imply the container must shrink.
  const ascending = [...sizes].sort((a, b) => a - b);
  const below = ascending.filter((size) => size < millilitres).pop();
  const above = ascending.find((size) => size > millilitres);
  const nearest = [below, above].filter(
    (size): size is number => size !== undefined,
  );

  return { authorised: false, notApplicable: false, nearest };
}

/** Render millilitres the way a label would, for display back to an agent. */
export function formatVolume(millilitres: number): string {
  if (millilitres >= 1000) {
    const litres = millilitres / 1000;
    return `${Number.isInteger(litres) ? litres : litres.toFixed(2)} L`;
  }
  return `${Number.isInteger(millilitres) ? millilitres : millilitres.toFixed(1)} mL`;
}
