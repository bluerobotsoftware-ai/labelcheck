import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  contrastRatio,
  parseHexColor,
  relativeLuminance,
  HIDDEN_WARNING_CONTRAST,
  MIN_WARNING_CONTRAST,
} from "@/lib/ttb/contrast";
import { measureWarningContrast } from "@/lib/ttb/pixelContrast";

/**
 * Legibility is computed, not judged.
 *
 * The reason is a measured failure: shown a label whose warning had been washed
 * out to 1.6:1 contrast — plainly unreadable — the vision model reported
 * `legibleSize: true` and the label was approved. Asking a model whether a
 * person could read something turns out to be a poor question. Asking it what
 * colour the ink is, and computing the answer here, works.
 */

describe("parseHexColor", () => {
  it("parses six-digit hex with and without a hash", () => {
    expect(parseHexColor("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("expands three-digit shorthand", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("returns null rather than guessing at nonsense", () => {
    expect(parseHexColor("not a colour")).toBeNull();
    expect(parseHexColor("#12345")).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("puts black at 0 and white at 1", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it("weights green far above blue, as human vision does", () => {
    // A naive channel average would rate these equal, and would badly
    // over-rate pale yellow text on white.
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect(green).toBeGreaterThan(blue * 8);
  });
});

describe("contrastRatio", () => {
  it("gives 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("gives 1:1 for a colour against itself", () => {
    expect(contrastRatio("#8a8a80", "#8a8a80")).toBeCloseTo(1, 5);
  });

  it("is order-independent", () => {
    expect(contrastRatio("#333333", "#eeeeee")).toBeCloseTo(
      contrastRatio("#eeeeee", "#333333") as number,
      5,
    );
  });

  it("returns null when a colour cannot be parsed", () => {
    expect(contrastRatio("#000000", "beige")).toBeNull();
  });
});

/**
 * The property that matters most about the pixel measurement: it is stable.
 *
 * The mechanism this replaced was not. Asked for the warning's two colours, the
 * reader sampled a slightly different pixel on each call, and the same
 * washed-out label produced approve, reject, reject, approve across four
 * consecutive runs against production. The rules engine advertises "same input,
 * same report" — a promise worth nothing if the input is a coin flip, and worse
 * than nothing in a compliance tool, where the flakiness reaches an applicant
 * as arbitrariness rather than as a bug.
 *
 * These run against the real sample images, with no network and no model.
 */
describe("pixel-measured contrast", () => {
  const WARNING_BOUNDS = { x: 0.08, y: 0.86, width: 0.84, height: 0.09 };

  const read = (name: string) =>
    readFileSync(new URL(`../public/samples/${name}`, import.meta.url));

  it("returns the identical figure every time for one image", async () => {
    const image = read("spirits-bourbon-compliant.png");
    const runs = await Promise.all(
      Array.from({ length: 5 }, () => measureWarningContrast(image, WARNING_BOUNDS)),
    );
    const values = runs.map((r) => r?.contrast);
    expect(values.every((v) => v === values[0])).toBe(true);
    expect(values[0]).toBeDefined();
  });

  it("rates a normally printed warning as comfortably readable", async () => {
    const measured = await measureWarningContrast(
      read("spirits-bourbon-compliant.png"),
      WARNING_BOUNDS,
    );
    expect(measured).not.toBeNull();
    expect(measured!.contrast).toBeGreaterThan(MIN_WARNING_CONTRAST);
  });

  it("catches the washed-out warning the model called legible", async () => {
    const measured = await measureWarningContrast(
      read("spirits-warning-illegible.png"),
      WARNING_BOUNDS,
    );
    expect(measured).not.toBeNull();
    expect(measured!.contrast).toBeLessThan(HIDDEN_WARNING_CONTRAST);
  });

  it("separates the two labels by a wide margin, not a hair", async () => {
    // A threshold only means something if the populations are actually apart.
    const good = await measureWarningContrast(read("spirits-bourbon-compliant.png"), WARNING_BOUNDS);
    const bad = await measureWarningContrast(read("spirits-warning-illegible.png"), WARNING_BOUNDS);
    expect(good!.contrast / bad!.contrast).toBeGreaterThan(3);
  });

  it("returns null rather than a number it cannot justify", async () => {
    // Off-image and degenerate boxes must not yield a confident ratio.
    const image = read("spirits-bourbon-compliant.png");
    expect(await measureWarningContrast(image, { x: 0, y: 0, width: 0, height: 0 })).toBeNull();
    expect(await measureWarningContrast(image, { x: 2, y: 2, width: 1, height: 1 })).toBeNull();
  });

  it("survives bytes that are not an image at all", async () => {
    const junk = Buffer.from("this is not a picture");
    expect(await measureWarningContrast(junk, WARNING_BOUNDS)).toBeNull();
  });
});
