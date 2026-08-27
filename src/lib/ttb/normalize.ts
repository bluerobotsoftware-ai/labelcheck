/**
 * Text normalisation primitives.
 *
 * Real labels are typographically expressive and real applications are typed by
 * humans in a hurry. The same product routinely appears as:
 *
 *     application:  Stone's Throw          (straight apostrophe, title case)
 *     label:        STONE'S THROW          (curly apostrophe, all capitals)
 *
 * A senior compliance agent told us that failing that pair would be absurd, and
 * he is right. Normalisation is where that judgement is encoded — explicitly,
 * in one place, so it can be read, argued with and tested, rather than being
 * buried in a model's opinion.
 *
 * Each function does exactly one transformation so the rules engine can report
 * WHICH normalisation was required to make two strings agree. "Matched after
 * ignoring case" is a meaningfully different message to an agent than "matched
 * exactly", and both are different from "matched after expanding abbreviations".
 */

/** Curly quotes, primes and assorted lookalikes → ASCII apostrophe. */
const APOSTROPHES = /[\u2018\u2019\u02BC\u02B9\u2032\u0060\u00B4]/g;
/** En/em dashes, minus signs and friends → ASCII hyphen. */
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
/** Double quotes of every persuasion → ASCII double quote. */
const QUOTES = /[\u201C\u201D\u201E\u00AB\u00BB\u2033]/g;

/**
 * Fold the typographic variants a designer might use into their ASCII
 * equivalents. Applied to every comparison; never changes meaning.
 */
export function foldTypography(input: string): string {
  return input
    .normalize("NFKC")
    .replace(APOSTROPHES, "'")
    .replace(DASHES, "-")
    .replace(QUOTES, '"');
}

/** Collapse runs of whitespace (including newlines from multi-line artwork) to single spaces. */
export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Strip accents. Applied only as a late-stage fallback: "Rosé" and "Rose" are
 * plausibly the same wine, but we want to report that we had to ignore the
 * accent to get there.
 */
export function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Remove punctuation entirely. The most aggressive fold; last resort only. */
export function stripPunctuation(input: string): string {
  return input.replace(/[^\p{L}\p{N}\s]/gu, " ");
}

/**
 * Common abbreviations and spelling variants seen on real labels.
 *
 * Deliberately conservative. Each entry maps a variant to a canonical form and
 * is only applied at the token level, so "ALC" inside a brand name like
 * "ALCATRAZ" is never touched.
 *
 * Note "whisky"/"whiskey": both spellings are legally correct and appear on
 * class/type designations interchangeably (Scotch whisky, Kentucky whiskey), so
 * treating them as equivalent is a matter of fact, not leniency.
 */
const TOKEN_SYNONYMS: Record<string, string> = {
  // Alcohol content phrasing
  alc: "alcohol",
  alch: "alcohol",
  alco: "alcohol",
  vol: "volume",
  abv: "alcoholbyvolume",
  // Spelling variants that are both correct
  whisky: "whiskey",
  // Company suffixes
  inc: "incorporated",
  co: "company",
  corp: "corporation",
  ltd: "limited",
  llc: "limitedliabilitycompany",
  bros: "brothers",
  dist: "distillery",
  distillers: "distillery",
  distilling: "distillery",
  // Units
  ml: "millilitre",
  mls: "millilitre",
  milliliter: "millilitre",
  milliliters: "millilitre",
  millilitres: "millilitre",
  l: "litre",
  liter: "litre",
  liters: "litre",
  litres: "litre",
  cl: "centilitre",
  centiliter: "centilitre",
  centiliters: "centilitre",
};

/** Tokens carrying no distinguishing information in a company or brand name. */
const NOISE_TOKENS = new Set(["the", "a", "an", "of"]);

/**
 * Split into comparable tokens: typography folded, lower-cased, punctuation
 * removed. Does NOT apply synonyms — that is a separate, reportable step.
 *
 * Ampersands and plus signs are spelled out BEFORE punctuation is stripped.
 * They are punctuation, so stripping first destroyed them and the "&" entry in
 * TOKEN_SYNONYMS could never fire — "Smith & Sons" against "Smith and Sons"
 * was a hard mismatch, despite being an allowable revision TTB permits without
 * refiling. Any punctuation-bearing synonym added later needs the same
 * treatment; `canonicalTokens("A & B")` is pinned by a test.
 */
export function tokenize(input: string): string[] {
  return stripPunctuation(foldTypography(input).replace(/[&+]/g, " and "))
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Tokenize, then expand known abbreviations and drop noise words. */
export function canonicalTokens(input: string): string[] {
  return tokenize(input)
    .map((t) => TOKEN_SYNONYMS[t] ?? t)
    .filter((t) => !NOISE_TOKENS.has(t));
}

/**
 * A ladder of increasingly permissive normalisations.
 *
 * The rules engine walks this in order and stops at the first level where two
 * strings agree, which tells the agent exactly how much latitude was needed.
 * Order matters: earlier levels are less of a stretch than later ones.
 */
export const NORMALISATION_LADDER = [
  {
    id: "exact",
    describe: () => "matched exactly",
    apply: (s: string) => s,
  },
  {
    id: "whitespace",
    describe: () => "matched after normalising spacing",
    apply: (s: string) => collapseWhitespace(s),
  },
  {
    id: "typography",
    describe: () => "matched after normalising curly quotes and dashes",
    apply: (s: string) => collapseWhitespace(foldTypography(s)),
  },
  {
    id: "case",
    describe: () => "matched apart from capitalisation",
    apply: (s: string) => collapseWhitespace(foldTypography(s)).toLowerCase(),
  },
  {
    id: "accents",
    describe: () => "matched apart from capitalisation and accents",
    apply: (s: string) =>
      stripDiacritics(collapseWhitespace(foldTypography(s)).toLowerCase()),
  },
  {
    id: "punctuation",
    describe: () => "matched apart from capitalisation and punctuation",
    apply: (s: string) =>
      collapseWhitespace(
        stripPunctuation(stripDiacritics(foldTypography(s)).toLowerCase()),
      ),
  },
  {
    id: "synonyms",
    describe: () =>
      "matched after expanding abbreviations (e.g. 'Inc.' and 'Incorporated')",
    apply: (s: string) => canonicalTokens(s).join(" "),
  },
] as const;

export type NormalisationLevel = (typeof NORMALISATION_LADDER)[number]["id"];

export interface LadderMatch {
  matched: boolean;
  /** The rung at which the two strings first agreed, if they did. */
  level?: NormalisationLevel;
  /** Human-readable account of how much latitude was needed. */
  description?: string;
}

/**
 * Walk the ladder, returning the least permissive level at which `a` and `b`
 * agree. Returns `{matched: false}` if they never do.
 */
export function ladderMatch(a: string, b: string): LadderMatch {
  for (const rung of NORMALISATION_LADDER) {
    const left = rung.apply(a);
    const right = rung.apply(b);
    /*
     * Two values that both reduce to nothing are not a match, they are two
     * absences. Without this guard a brand name of "&" and a brand name of
     * "..." agreed at the punctuation rung and reported a confident pass on a
     * comparison of empty string against empty string.
     */
    if (left === right && left.trim() !== "") {
      return { matched: true, level: rung.id, description: rung.describe() };
    }
  }
  return { matched: false };
}
