/**
 * Contrast and type-size measurement for the health warning.
 *
 * Why this file exists, in one sentence: the model said a warning washed out to
 * roughly 12% contrast was legible, so legibility stopped being something we ask
 * the model and became something we compute.
 *
 * The division of labour is the same one the whole product rests on. The model
 * reports what it can see and is good at — the colour of the text, the colour
 * behind it, how tall the letters are relative to the label. Deterministic code
 * turns those into a verdict. A contrast ratio is arithmetic; whether a person
 * can read something is a judgement, and the arithmetic is the auditable half.
 *
 * The regulation prescribes physical millimetres and characters per inch
 * (27 CFR 16.22), which no photograph can establish without a known scale. The
 * relative measurements here are an honest approximation of that, and are
 * documented as such rather than presented as compliance measurement.
 */

/** Parse "#rrggbb" or "rrggbb" into 0-255 channels. Returns null if unparseable. */
export function parseHexColor(
  hex: string | undefined | null,
): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const cleaned = hex.trim().replace(/^#/, "");

  const expanded =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

/**
 * WCAG 2.x relative luminance.
 *
 * Not a simple average of the channels: human vision is far more sensitive to
 * green than to blue, and the channel weights below encode that. Using a naive
 * average would rate pale yellow on white as far more readable than it is.
 */
export function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast ratio between two colours, 1:1 (identical) to 21:1 (black on white).
 * Returns null when either colour could not be parsed.
 */
export function contrastRatio(
  foregroundHex: string | undefined | null,
  backgroundHex: string | undefined | null,
): number | null {
  const foreground = parseHexColor(foregroundHex);
  const background = parseHexColor(backgroundHex);
  if (!foreground || !background) return null;

  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Contrast below which the warning is treated as not readily legible.
 *
 * 4.5:1 is the WCAG AA threshold for body text. It is not what 27 CFR 16.22
 * says — the regulation speaks of "readily legible" and "contrasting
 * background" without a number — but it is a published, defensible line drawn
 * from research on ordinary human vision, which is the same question the
 * regulation is asking. Using a recognised standard beats inventing a number,
 * and stating which standard is being used is what makes the verdict arguable.
 */
export const MIN_WARNING_CONTRAST = 4.5;

/**
 * Contrast below which the warning is treated as outright hidden rather than
 * merely marginal. Around this level text is effectively invisible at a glance.
 */
export const HIDDEN_WARNING_CONTRAST = 2.0;

/**
 * Minimum cap height, as a percentage of the label's height.
 *
 * ADVISORY ONLY. This never decides a verdict on its own — see the note below.
 *
 * 27 CFR 16.22 sets type size in millimetres against container volume, which no
 * photograph can establish without a physical scale, so this was always a proxy:
 * on a 750ml label around 100mm tall, 1mm of cap height is roughly 1%.
 *
 * Measuring it turned out not to work. Asked for a percentage, the reader
 * returned 0.01 and 0.02 for perfectly ordinary warnings — reporting a fraction
 * regardless of how the field was described. Every compliant sample tripped the
 * threshold. A check that flags five out of eight good labels does not protect
 * anyone; it teaches agents to dismiss the flag, and then it fails silently on
 * the one that mattered.
 *
 * Contrast has no such problem, because it derives from two colours the model
 * can simply look at, and the arithmetic is fixed. So contrast decides, and cap
 * height only ever corroborates a contrast failure. Better a narrow check that
 * works than a broad one nobody trusts.
 */
export const MIN_CAP_HEIGHT_PERCENT = 0.7;

export interface LegibilityMeasurement {
  /** Computed contrast ratio, or null when colours were not reported. */
  contrast: number | null;
  capHeightPercent: number | null;
  /** True when contrast is measurably below the readable threshold. */
  contrastTooLow: boolean;
  /** True when contrast is so low the text is effectively hidden. */
  effectivelyHidden: boolean;
  /** True when the type is measurably smaller than the proxy threshold. */
  typeTooSmall: boolean;
  /** Human-readable findings, phrased for a compliance agent. */
  findings: string[];
}

/** Measure a warning's printed appearance. Reports; decides nothing. */
export function measureLegibility(appearance: {
  textColorHex?: string;
  backgroundColorHex?: string;
  capHeightPercentOfLabel?: number;
}): LegibilityMeasurement {
  const contrast = contrastRatio(appearance.textColorHex, appearance.backgroundColorHex);
  const capHeightPercent =
    typeof appearance.capHeightPercentOfLabel === "number" &&
    Number.isFinite(appearance.capHeightPercentOfLabel)
      ? appearance.capHeightPercentOfLabel
      : null;

  const contrastTooLow = contrast !== null && contrast < MIN_WARNING_CONTRAST;
  const effectivelyHidden = contrast !== null && contrast < HIDDEN_WARNING_CONTRAST;
  const typeTooSmall =
    capHeightPercent !== null && capHeightPercent < MIN_CAP_HEIGHT_PERCENT;

  const findings: string[] = [];
  if (contrast !== null && contrastTooLow) {
    findings.push(
      `the warning is printed at ${contrast.toFixed(1)}:1 contrast against its background, below the ${MIN_WARNING_CONTRAST}:1 generally accepted as readable`,
    );
  }
  // Reported only alongside a contrast failure, never on its own. See the note
  // on MIN_CAP_HEIGHT_PERCENT: as a standalone trigger this produced a false
  // positive on every compliant label in the sample set.
  if (typeTooSmall && contrastTooLow && capHeightPercent !== null) {
    findings.push(
      "the type also appears small relative to the rest of the label",
    );
  }

  return {
    contrast,
    capHeightPercent,
    contrastTooLow,
    effectivelyHidden,
    typeTooSmall,
    findings,
  };
}
