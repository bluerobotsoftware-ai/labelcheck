/**
 * Client-side image downscaling.
 *
 * Runs in the browser, before upload. This is the single largest lever on the
 * response time an agent actually experiences, and it moves three costs at once:
 *
 *   - Upload. A 6 MB phone photograph over an office connection can spend
 *     several seconds on the wire before the server has even started work.
 *   - Model latency. Vision models tile large images; more tiles, more time.
 *   - Money. Image tokens scale with area, so a needlessly large image is
 *     billed for detail no one reads.
 *
 * TTB abandoned a previous vendor over 30-40 second response times and told us
 * plainly that anything above about five seconds will not be used. Downscaling
 * is most of how the budget is met.
 */

/**
 * Longest edge, in pixels, after downscaling.
 *
 * 1568 is the point above which Anthropic's vision endpoint resizes internally
 * anyway, so sending more pixels buys nothing but upload time. It also stays
 * comfortably legible for the small print — the government warning is the
 * smallest text on any label and the one thing that must be read exactly, so
 * this is the floor set by the hardest field, not by the easiest.
 */
const MAX_EDGE = 1568;

/** JPEG quality for the re-encode. High enough to leave small print crisp. */
const JPEG_QUALITY = 0.92;

/** Below this, re-encoding costs more than it saves. */
const SKIP_BELOW_BYTES = 400 * 1024;

export interface DownscaleResult {
  file: File;
  /** True when the original was returned unchanged. */
  skipped: boolean;
  originalBytes: number;
  finalBytes: number;
  width: number;
  height: number;
}

/**
 * Downscale an image file, preserving aspect ratio.
 *
 * Falls back to returning the original on any failure. A slightly slow check is
 * a far better outcome than a check that refuses to run because a canvas
 * operation failed on an unusual file.
 */
export async function downscaleImage(file: File): Promise<DownscaleResult> {
  const originalBytes = file.size;

  const unchanged = (width = 0, height = 0): DownscaleResult => ({
    file,
    skipped: true,
    originalBytes,
    finalBytes: originalBytes,
    width,
    height,
  });

  // GIFs may be animated; re-encoding would silently drop frames.
  if (file.type === "image/gif") return unchanged();
  if (originalBytes <= SKIP_BELOW_BYTES) return unchanged();

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const longestEdge = Math.max(width, height);

    if (longestEdge <= MAX_EDGE) {
      bitmap.close();
      return unchanged(width, height);
    }

    const scale = MAX_EDGE / longestEdge;
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return unchanged(width, height);
    }

    // Text is the entire payload of a label, so favour resampling quality.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) return unchanged(width, height);

    // Re-encoding can enlarge an already well-compressed file; keep the smaller.
    if (blob.size >= originalBytes) return unchanged(width, height);

    return {
      file: new File([blob], renameToJpeg(file.name), { type: "image/jpeg" }),
      skipped: false,
      originalBytes,
      finalBytes: blob.size,
      width: targetWidth,
      height: targetHeight,
    };
  } catch {
    return unchanged();
  }
}

function renameToJpeg(name: string): string {
  return name.replace(/\.[^.]+$/, "") + ".jpg";
}
