/**
 * Contrast measured from the image's own pixels.
 *
 * The fourth attempt at this check. Each failure narrowed what the model is
 * asked to do, and the sequence is worth recording:
 *
 *   1. "Is this legible?" — it said yes about a warning washed out to
 *      near-invisibility.
 *   2. "What colour is the text, and the background?" Correct on that label,
 *      but running the SAME image four times gave approve, reject, reject,
 *      approve: it samples a slightly different pixel each call.
 *   3. "Where is the warning?", then cluster the pixels in that box into ink
 *      and paper with Otsu's method. Deterministic at last — but the reader's
 *      boxes are loose, and a loose box drags in background that dilutes the
 *      ink cluster. Four compliant labels were flagged in production, one of
 *      them rejected outright.
 *   4. This version. Same box, but the ratio is taken between percentiles
 *      rather than cluster means.
 *
 * Percentiles are what make it robust. The darkest 2% of pixels are ink
 * wherever the box happens to fall; the 90th percentile is paper. Extra
 * background only pads the light end, so a sloppy box costs accuracy at the
 * margin instead of inverting the answer. On the sample set with deliberately
 * loose boxes: 9.3 and 11.5 for compliant labels, 3.5 for the washed-out one.
 *
 * Step 3's failure is the one to remember. It was deterministic and wrong,
 * which is worse than flaky and wrong: it rejected a compliant product
 * confidently, with a citation attached, every single time.
 */

import sharp from "sharp";
import { relativeLuminance } from "./contrast";

/** Where the warning sits. Fractions of the image, or pixels — both accepted. */
export interface WarningBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelContrastResult {
  /** Measured contrast ratio between the warning text and its background. */
  contrast: number;
  /** The ink colour sampled, for showing an agent. */
  darkerHex: string;
  /** The background colour sampled. */
  lighterHex: string;
}

/**
 * Percentiles sampled for ink and for paper.
 *
 * INK at 2%: low enough to land on the darkest strokes rather than on the
 * anti-aliased edges that surround them, which is what diluted the earlier
 * cluster average. Not 0%, so a single stray dark pixel cannot set the result.
 *
 * PAPER at 90%: high enough to be substrate, below the specular highlights a
 * glared photograph puts at the very top of the range.
 */
const INK_PERCENTILE = 0.02;
const PAPER_PERCENTILE = 0.9;

/** Clamp a fraction into [0,1], tolerating an approximate box. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toHex([r, g, b]: [number, number, number]): string {
  const part = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Measure the contrast of the warning region.
 *
 * Returns null when the region cannot be measured — off the image, or too
 * small to sample. Null means "no measurement", never "compliant": the caller
 * must not read silence as a pass.
 */
export async function measureWarningContrast(
  image: Buffer,
  boundsInput: WarningBounds,
): Promise<PixelContrastResult | null> {
  let bounds = boundsInput;
  try {
    const { width: fullWidth, height: fullHeight } = await sharp(image).metadata();
    if (!fullWidth || !fullHeight) return null;

    /*
     * Accept the box in either unit.
     *
     * The schema asks for fractions. The reader frequently answers in pixels
     * anyway — {x: 84, y: 883, width: 818, height: 69} on an 800x1000 label —
     * and no wording of the field description changed that. Read as fractions
     * those clamp to a degenerate crop, the measurement returns null, and null
     * reads downstream as "nothing wrong". Any value above 1 cannot be a
     * fraction, which makes the two cases trivially separable.
     */
    if (bounds.width > 1 || bounds.height > 1 || bounds.x > 1 || bounds.y > 1) {
      bounds = {
        x: bounds.x / fullWidth,
        y: bounds.y / fullHeight,
        width: bounds.width / fullWidth,
        height: bounds.height / fullHeight,
      };
    }

    // Fit to the image first, then inset inside what remains. Insetting before
    // clamping pushed the crop off the panel entirely on an overrunning box.
    const x0 = Math.round(clamp01(bounds.x) * fullWidth);
    const y0 = Math.round(clamp01(bounds.y) * fullHeight);
    const boxWidth = Math.min(Math.round(bounds.width * fullWidth), fullWidth - x0);
    const boxHeight = Math.min(Math.round(bounds.height * fullHeight), fullHeight - y0);

    const inset = 0.05;
    const left = x0 + Math.round(boxWidth * inset);
    const top = y0 + Math.round(boxHeight * inset);
    const width = Math.round(boxWidth * (1 - inset * 2));
    const height = Math.round(boxHeight * (1 - inset * 2));

    if (width < 8 || height < 4) return null;
    if (left + width > fullWidth || top + height > fullHeight) return null;

    const { data, info } = await sharp(image)
      .extract({ left, top, width, height })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixelCount = info.width * info.height;
    if (pixelCount === 0) return null;

    // Index the pixels by luminance, then read off the two percentiles.
    const order = Array.from({ length: pixelCount }, (_, i) => i);
    const luminance = new Float64Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const o = i * info.channels;
      luminance[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    }
    order.sort((a, b) => luminance[a] - luminance[b]);

    const pixelAt = (percentile: number): [number, number, number] => {
      const index = order[Math.min(pixelCount - 1, Math.floor(percentile * pixelCount))];
      const o = index * info.channels;
      return [data[o], data[o + 1], data[o + 2]];
    };

    const ink = pixelAt(INK_PERCENTILE);
    const paper = pixelAt(PAPER_PERCENTILE);

    const inkLuminance = relativeLuminance({ r: ink[0], g: ink[1], b: ink[2] });
    const paperLuminance = relativeLuminance({ r: paper[0], g: paper[1], b: paper[2] });

    const lighter = Math.max(inkLuminance, paperLuminance);
    const darker = Math.min(inkLuminance, paperLuminance);

    return {
      contrast: (lighter + 0.05) / (darker + 0.05),
      darkerHex: toHex(ink),
      lighterHex: toHex(paper),
    };
  } catch {
    // Measurement is a bonus signal, never a gate. An unreadable or exotic
    // image format must not fail the whole verification.
    return null;
  }
}
