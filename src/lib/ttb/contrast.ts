/**
 * Colour arithmetic for the health-warning legibility check.
 *
 * These are the primitives. The measurement that uses them lives in
 * pixelContrast.ts, which samples the image's own pixels — see the note at the
 * top of that file for why asking the model for colours was abandoned.
 *
 * The threshold constants below are the policy: what counts as legible, stated
 * once, with the standard it comes from named so it can be argued with.
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
