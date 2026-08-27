import { describe, expect, it } from "vitest";
import {
  checkStandardOfFill,
  formatVolume,
  parseVolume,
} from "@/lib/ttb/netContents";

describe("parseVolume", () => {
  it.each([
    ["750 mL", 750],
    ["750ml", 750],
    ["75 cL", 750],
    ["0.75 L", 750],
    ["1.75 L", 1750],
    ["1,5 L", 1500],
    ["12 FL OZ", 354.882],
    ["12 fl. oz.", 354.882],
  ])("parses %s to %s mL", (input, expected) => {
    expect(parseVolume(input).millilitres).toBeCloseTo(expected, 2);
  });

  it("returns null rather than guessing at unparseable text", () => {
    expect(parseVolume("one bottle").millilitres).toBeNull();
    expect(parseVolume(undefined).millilitres).toBeNull();
  });

  it("keeps the unit as printed so it can be shown back to an agent", () => {
    expect(parseVolume("75 cL").statedUnit).toBe("cL");
  });

  /**
   * The reason volumes are normalised at all: three spellings of one quantity
   * that a string comparison would report as three different container sizes.
   */
  it("treats 750 mL, 75 cL and 0.75 L as the same quantity", () => {
    const a = parseVolume("750 mL").millilitres;
    const b = parseVolume("75 cL").millilitres;
    const c = parseVolume("0.75 L").millilitres;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("checkStandardOfFill", () => {
  it("accepts an authorised spirits size", () => {
    const result = checkStandardOfFill("distilled_spirits", 750);
    expect(result.authorised).toBe(true);
    expect(result.matchedSize).toBe(750);
  });

  /**
   * The check that cannot be done by comparing the label to the application:
   * the application says 800 mL too, so the two documents agree perfectly.
   * Only the regulation catches it.
   */
  it("rejects a size that is not on the authorised list", () => {
    const result = checkStandardOfFill("distilled_spirits", 800);
    expect(result.authorised).toBe(false);
    expect(result.nearest).toContain(750);
    expect(result.nearest).toContain(900);
  });

  /**
   * Regression guard for a real defect found during development.
   *
   * T.D. TTB-200 (10 January 2025) added ten container sizes to 27 CFR 5.203,
   * 710 mL among them. The first version of this app was seeded from a
   * pre-2025 list and rejected all ten as unlawful — a false rejection that
   * arrived with a citation attached and looked completely authoritative.
   */
  it("accepts the sizes added to the spirits list in January 2025", () => {
    for (const size of [945, 900, 720, 710, 570, 475, 355, 350, 331, 250]) {
      expect(checkStandardOfFill("distilled_spirits", size).authorised).toBe(true);
    }
  });

  it("does not apply to malt beverages, which have no standards of fill", () => {
    const result = checkStandardOfFill("malt_beverage", 355);
    expect(result.notApplicable).toBe(true);
    expect(result.authorised).toBe(true);
  });

  it("draws no conclusion when the volume could not be read", () => {
    expect(checkStandardOfFill("distilled_spirits", null).authorised).toBe(true);
  });

  it("keeps the two lists distinct", () => {
    // 187 mL is authorised for both, but the lists are not interchangeable —
    // see the per-class assertions in the wine large-format block below.
    expect(checkStandardOfFill("wine", 187).authorised).toBe(true);
    expect(checkStandardOfFill("distilled_spirits", 187).authorised).toBe(true);
  });
});

describe("formatVolume", () => {
  it("shows sub-litre volumes in millilitres", () => {
    expect(formatVolume(750)).toBe("750 mL");
  });

  it("shows litre-and-above volumes in litres", () => {
    expect(formatVolume(1750)).toBe("1.75 L");
    expect(formatVolume(1000)).toBe("1 L");
  });
});

describe("wine large formats — 27 CFR 4.72(b)", () => {
  it("accepts four litres and above when filled in even litres", () => {
    expect(checkStandardOfFill("wine", 4000).authorised).toBe(true);
    expect(checkStandardOfFill("wine", 5000).authorised).toBe(true);
    expect(checkStandardOfFill("wine", 6000).authorised).toBe(true);
  });

  it("rejects a large format that is not an even number of litres", () => {
    // 4.5 L reads as a plausible bottle size and is on no authorised list.
    const result = checkStandardOfFill("wine", 4500);
    expect(result.authorised).toBe(false);
    expect(result.nearest).toEqual([4000, 5000]);
  });

  it("treats eighteen litres and above as outside the standards of fill", () => {
    // 27 CFR 4.70(b)(2) — out of scope, which is not the same as compliant.
    const result = checkStandardOfFill("wine", 18000);
    expect(result.notApplicable).toBe(true);
  });

  it("accepts wine sizes that are not valid for spirits, and the reverse", () => {
    expect(checkStandardOfFill("wine", 473).authorised).toBe(true);
    expect(checkStandardOfFill("distilled_spirits", 473).authorised).toBe(false);
    expect(checkStandardOfFill("distilled_spirits", 945).authorised).toBe(true);
    expect(checkStandardOfFill("wine", 945).authorised).toBe(false);
  });
});

describe("guidance when a size is unauthorised", () => {
  it("brackets the offending size so an agent can advise which way to move", () => {
    const result = checkStandardOfFill("distilled_spirits", 800);
    expect(result.nearest).toEqual([750, 900]);
  });

  it("offers only a larger size when the container is below the smallest", () => {
    expect(checkStandardOfFill("distilled_spirits", 25).nearest).toEqual([50]);
  });

  it("offers only a smaller size when the container is above the largest", () => {
    expect(checkStandardOfFill("distilled_spirits", 5000).nearest).toEqual([3750]);
  });
});
