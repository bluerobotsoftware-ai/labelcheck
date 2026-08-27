import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STANDARDS_OF_FILL } from "@/lib/ttb/netContents";
import { ABV_TOLERANCE } from "@/lib/ttb/abv";

/**
 * Keeps the code's regulatory constants tied to the research they came from.
 *
 * docs/REGULATORY-NOTES.md was built from the eCFR versioner API with a
 * citation per claim. These tests parse that document and compare it against
 * the constants actually compiled into the app, so the two cannot drift apart
 * silently — which is exactly how the pre-2025 standards-of-fill bug survived
 * a green test suite: every test agreed with a constant that was wrong.
 *
 * If a regulation changes, update the notes and these tests will point at every
 * constant that needs to follow.
 */

const doc = readFileSync(
  new URL("../docs/REGULATORY-NOTES.md", import.meta.url),
  "utf8",
);

const FENCE = "```";

/** Pull the first fenced list following a heading, normalised to millilitres. */
function fillListAfter(heading: string): number[] {
  const index = doc.indexOf(heading);
  if (index === -1) throw new Error(`Heading not found in notes: ${heading}`);
  const start = doc.indexOf(FENCE, index);
  const end = doc.indexOf(FENCE, start + 3);

  return doc
    .slice(start + 3, end)
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const match = /^([\d.]+)\s*(L|mL)$/i.exec(token);
      if (!match) throw new Error(`Unparsed size in notes: "${token}"`);
      return /^l$/i.test(match[2])
        ? Math.round(Number.parseFloat(match[1]) * 1000)
        : Number.parseFloat(match[1]);
    })
    .sort((a, b) => a - b);
}

const ascending = (sizes: number[]) => [...sizes].sort((a, b) => a - b);

describe("standards of fill match the researched regulation", () => {
  it("distilled spirits — 27 CFR 5.203, as amended by T.D. TTB-200", () => {
    const fromNotes = fillListAfter(
      "Authorized metric standards of fill, domestic and imported alike",
    );
    expect(ascending(STANDARDS_OF_FILL.distilled_spirits!)).toEqual(fromNotes);
    expect(fromNotes).toHaveLength(25);
  });

  it("wine — 27 CFR 4.72, as amended by T.D. TTB-200", () => {
    const fromNotes = fillListAfter(
      "Authorized metric standards of fill — 27 CFR 4.72",
    );
    expect(ascending(STANDARDS_OF_FILL.wine!)).toEqual(fromNotes);
    expect(fromNotes).toHaveLength(25);
  });

  it("malt beverages have no standards of fill anywhere in part 7", () => {
    expect(STANDARDS_OF_FILL.malt_beverage).toBeUndefined();
    expect(doc).toContain("Malt beverages — no standards of fill");
  });
});

describe("alcohol tolerances match the researched regulation", () => {
  it("spirits and malt beverages are 0.3 percentage points", () => {
    // 27 CFR 5.65(c) and 7.65(c).
    expect(ABV_TOLERANCE.distilled_spirits).toBe(0.3);
    expect(ABV_TOLERANCE.malt_beverage).toBe(0.3);
  });

  it("the notes still record 0.3 for spirits", () => {
    // Guards against the constant and the notes being edited apart. An earlier
    // draft of the research had 0.15 here; the figure is 0.3.
    expect(doc).toMatch(/Distilled spirits[^\n|]*\|\s*±\s*0\.3/);
  });
});
