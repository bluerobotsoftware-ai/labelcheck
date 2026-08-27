/**
 * Contrast measured from the image's own pixels.
 *
 * The third attempt at this check, and the reason for each step is worth
 * recording because the failures were instructive.
 *
 *   1. Ask the model "is this legible?" — it said yes about a warning washed
 *      out to near-invisibility.
 *   2. Ask the model for the two colours and compute the ratio in code. Better,
 *      and it caught that label at 1.1:1 — but running the SAME image four
 *      times produced approve, reject, reject, approve. The model samples a
 *      slightly different pixel each time, and near a threshold that flips the
 *      verdict.
 *   3. This file. The model is asked only WHERE the warning is; the contrast is
 *      computed from the actual pixels inside that box.
 *
 * Step 2's failure mattered more than it first appears. The rules engine is
 * deterministic and advertised as such — same input, same report. That promise
 * is worthless if the input is a coin flip. A compliance tool that rejects a
 * label on Tuesday and approves it on Wednesday is not one an agent can defend
 * to an applicant, and the flakiness would surface as arbitrariness rather than
 * as a bug.
 *
 * Otsu's method separates the pixels into ink and substrate without being told
 * which is which, so nothing here depends on a model's opinion about a colour.
 * Given the same crop it returns the same number every time.
 */

import sharp from "sharp";
import { relativeLuminance } from "./contrast";

/** Where the warning sits, as fractions of the image. */
export interface WarningBounds {
  /** Left edge, 0-1. */
  x: number;
  /** Top edge, 0-1. */
  y: number;
  /** Width, 0-1. */
  width: number;
  /** Height, 0-1. */
  height: number;
}

export interface PixelContrastResult {
  /** Measured contrast ratio between the text and its background. */
  contrast: number;
  /** Hex of the darker cluster, for display back to an agent. */
  darkerHex: string;
  /** Hex of the lighter cluster. */
  lighterHex: string;
  /** Share of pixels in the smaller (ink) cluster — a sanity signal. */
  inkFraction: number;
}

/** Clamp a fraction into [0,1], tolerating a model's approximate box. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Otsu's threshold over a 256-bin luminance histogram.
 *
 * Chooses the split that maximises between-class variance — the point at which
 * "ink" and "paper" are most cleanly separated. Standard, cheap, and entirely
 * deterministic.
 */
function otsuThreshold(histogram: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let threshold = 0;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;

    const variance =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) *
      (meanBackground - meanForeground);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
}

/**
 * Measure the contrast of the warning region.
 *
 * Returns null when the region cannot be measured — too small, off the image,
 * or so uniform that there is no text/background separation to find. Null means
 * "no measurement", never "compliant": the caller must not read silence as a
 * pass.
 */
export async function measureWarningContrast(
  image: Buffer,
  bounds: WarningBounds,
): Promise<PixelContrastResult | null> {
  try {
    const source = sharp(image);
    const { width: fullWidth, height: fullHeight } = await source.metadata();
    if (!fullWidth || !fullHeight) return null;

    // The model's box is approximate, so inset slightly to avoid dragging in a
    // panel border or the label stock beyond it, which would flatter the ratio.
    const inset = 0.02;
    const left = Math.round(clamp01(bounds.x + bounds.width * inset) * fullWidth);
    const top = Math.round(clamp01(bounds.y + bounds.height * inset) * fullHeight);
    const width = Math.round(clamp01(bounds.width * (1 - inset * 2)) * fullWidth);
    const height = Math.round(clamp01(bounds.height * (1 - inset * 2)) * fullHeight);

    // Too small a crop cannot hold a meaningful sample of both classes.
    if (width < 8 || height < 4) return null;
    if (left + width > fullWidth || top + height > fullHeight) return null;

    const { data, info } = await sharp(image)
      .extract({ left, top, width, height })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const pixelCount = info.width * info.height;
    if (pixelCount === 0) return null;

    // Build a luminance histogram, keeping per-bin colour sums so the two
    // clusters can be reported back as real colours.
    const histogram = new Array<number>(256).fill(0);
    const luminance = new Uint8Array(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      const offset = i * channels;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      // Perceptual weighting, matching the luminance used for the final ratio.
      const value = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      luminance[i] = value;
      histogram[value]++;
    }

    const threshold = otsuThreshold(histogram, pixelCount);

    let darkCount = 0;
    let lightCount = 0;
    const darkSum = [0, 0, 0];
    const lightSum = [0, 0, 0];

    for (let i = 0; i < pixelCount; i++) {
      const offset = i * channels;
      const target = luminance[i] <= threshold ? darkSum : lightSum;
      target[0] += data[offset];
      target[1] += data[offset + 1];
      target[2] += data[offset + 2];
      if (luminance[i] <= threshold) darkCount++;
      else lightCount++;
    }

    if (darkCount === 0 || lightCount === 0) return null;

    const darker = darkSum.map((c) => c / darkCount) as [number, number, number];
    const lighter = lightSum.map((c) => c / lightCount) as [number, number, number];

    const darkLuminance = relativeLuminance({ r: darker[0], g: darker[1], b: darker[2] });
    const lightLuminance = relativeLuminance({ r: lighter[0], g: lighter[1], b: lighter[2] });

    const contrast = (lightLuminance + 0.05) / (darkLuminance + 0.05);

    return {
      contrast,
      darkerHex: toHex(darker[0], darker[1], darker[2]),
      lighterHex: toHex(lighter[0], lighter[1], lighter[2]),
      inkFraction: Math.min(darkCount, lightCount) / pixelCount,
    };
  } catch {
    // Measurement is a bonus signal, never a gate. An unreadable or exotic
    // image format must not fail the whole verification.
    return null;
  }
}
