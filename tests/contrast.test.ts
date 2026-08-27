import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  measureLegibility,
  parseHexColor,
  relativeLuminance,
  MIN_WARNING_CONTRAST,
} from "@/lib/ttb/contrast";

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

describe("measureLegibility", () => {
  const wellPrinted = {
    textColorHex: "#2b2b26",
    backgroundColorHex: "#efeadc",
    capHeightPercentOfLabel: 1.1,
  };

  it("passes a normally printed warning", () => {
    const measured = measureLegibility(wellPrinted);
    expect(measured.contrastTooLow).toBe(false);
    expect(measured.typeTooSmall).toBe(false);
    expect(measured.findings).toHaveLength(0);
    expect(measured.contrast).toBeGreaterThan(MIN_WARNING_CONTRAST);
  });

  /**
   * The real measurement from the washed-out sample: the model reported this
   * warning as legible, and the arithmetic disagreed.
   */
  it("catches a warning washed out to near-invisibility", () => {
    const measured = measureLegibility({
      textColorHex: "#c9c6bb",
      backgroundColorHex: "#f4f1e6",
      capHeightPercentOfLabel: 0.9,
    });
    expect(measured.contrastTooLow).toBe(true);
    expect(measured.contrast).toBeLessThan(2);
    expect(measured.effectivelyHidden).toBe(true);
    expect(measured.findings.join(" ")).toMatch(/contrast/i);
  });

  /**
   * Cap height is measured but never decides, and this test pins that.
   *
   * Asked for a percentage, the reader returns a fraction — 0.01 for an
   * ordinary warning — and no wording of the schema changed it. As a standalone
   * trigger it flagged five of eight compliant sample labels. A check that
   * cries wolf on good labels teaches agents to dismiss it, and then it fails
   * silently on the one that mattered. Contrast decides; this corroborates.
   */
  it("notes small type but does not flag it on its own", () => {
    const measured = measureLegibility({ ...wellPrinted, capHeightPercentOfLabel: 0.3 });
    expect(measured.typeTooSmall).toBe(true);
    // Well-contrasted, so nothing is reported to the agent.
    expect(measured.contrastTooLow).toBe(false);
    expect(measured.findings).toHaveLength(0);
  });

  it("mentions small type only when contrast has already failed", () => {
    const measured = measureLegibility({
      textColorHex: "#c9c6bb",
      backgroundColorHex: "#f4f1e6",
      capHeightPercentOfLabel: 0.3,
    });
    expect(measured.findings.join(" ")).toMatch(/contrast/i);
    expect(measured.findings.join(" ")).toMatch(/small/i);
  });

  it("draws no conclusion when the reader reported no measurements", () => {
    // Silence must never be read as a failure — that would manufacture
    // rejections out of a reader that simply did not answer.
    const measured = measureLegibility({});
    expect(measured.contrast).toBeNull();
    expect(measured.contrastTooLow).toBe(false);
    expect(measured.typeTooSmall).toBe(false);
    expect(measured.findings).toHaveLength(0);
  });

  it("quotes the measured figure so an agent can cite it", () => {
    // "Not legible" is unusable in a rejection letter; "1.6:1" is not.
    const measured = measureLegibility({
      textColorHex: "#c9c6bb",
      backgroundColorHex: "#f4f1e6",
      capHeightPercentOfLabel: 1.1,
    });
    expect(measured.findings.join(" ")).toMatch(/\d+\.\d+:1/);
  });
});
