import { describe, expect, it } from "vitest";
import {
  parseAlcohol,
  proofIsConsistent,
  toleranceFor,
  wineTolerance,
} from "@/lib/ttb/abv";

describe("parseAlcohol", () => {
  it("parses the canonical spirits form", () => {
    const reading = parseAlcohol("45% Alc./Vol. (90 Proof)");
    expect(reading.abv).toBe(45);
    expect(reading.proof).toBe(90);
    expect(reading.abvDerivedFromProof).toBe(false);
  });

  it.each([
    ["40% ALC/VOL", 40],
    ["ALC. 12.5% BY VOL.", 12.5],
    ["5.0% ABV", 5],
    ["ALCOHOL 45% BY VOLUME", 45],
    ["13,5% vol", 13.5],
    ["45", 45],
  ])("parses %s as %s%%", (input, expected) => {
    expect(parseAlcohol(input).abv).toBe(expected);
  });

  it("handles a leading decimal point, as on low-alcohol products", () => {
    expect(parseAlcohol(".5% ALC BY VOL").abv).toBe(0.5);
  });

  it("derives ABV from proof when only proof is stated", () => {
    const reading = parseAlcohol("90 PROOF");
    expect(reading.abv).toBe(45);
    expect(reading.abvDerivedFromProof).toBe(true);
  });

  it("does not mistake the proof figure for a percentage", () => {
    // The bug this guards against: reading "(90 Proof)" as 90% ABV.
    expect(parseAlcohol("45% Alc./Vol. (90 Proof)").abv).toBe(45);
  });

  it("returns nulls rather than guessing when nothing is parseable", () => {
    const reading = parseAlcohol("bottled with care");
    expect(reading.abv).toBeNull();
    expect(reading.proof).toBeNull();
  });

  it("treats empty input as unparseable", () => {
    expect(parseAlcohol(undefined).abv).toBeNull();
    expect(parseAlcohol("").abv).toBeNull();
  });
});

describe("proofIsConsistent", () => {
  it("accepts proof that is exactly twice the ABV", () => {
    expect(proofIsConsistent(parseAlcohol("45% Alc./Vol. (90 Proof)"))).toBe(true);
  });

  it("rejects proof that contradicts the stated ABV", () => {
    expect(proofIsConsistent(parseAlcohol("45% Alc./Vol. (80 Proof)"))).toBe(false);
  });

  it("allows a point of rounding slack", () => {
    expect(proofIsConsistent(parseAlcohol("40.5% Alc./Vol. (81 Proof)"))).toBe(true);
  });

  it("has no opinion when only one figure is present", () => {
    expect(proofIsConsistent(parseAlcohol("45% Alc./Vol."))).toBeNull();
  });
});

describe("tolerances", () => {
  it("applies the wider tolerance to wines at or below 14%", () => {
    expect(wineTolerance(12.5)).toBe(1.5);
    expect(wineTolerance(14)).toBe(1.5);
  });

  it("applies the tighter tolerance above 14%", () => {
    expect(wineTolerance(14.5)).toBe(1.0);
  });

  it("uses the spirits tolerance for spirits regardless of strength", () => {
    expect(toleranceFor("distilled_spirits", 45)).toBe(0.3);
    expect(toleranceFor("distilled_spirits", 12)).toBe(0.3);
  });
});
