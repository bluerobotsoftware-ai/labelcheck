import { describe, expect, it } from "vitest";
import {
  canonicalTokens,
  foldTypography,
  ladderMatch,
  tokenize,
} from "@/lib/ttb/normalize";

describe("foldTypography", () => {
  it("folds curly apostrophes to ASCII", () => {
    expect(foldTypography("Stone’s Throw")).toBe("Stone's Throw");
  });

  it("folds em and en dashes to hyphens", () => {
    expect(foldTypography("Reserve—Cask")).toBe("Reserve-Cask");
    expect(foldTypography("2019–2021")).toBe("2019-2021");
  });

  it("leaves already-ASCII text untouched", () => {
    expect(foldTypography("OLD TOM DISTILLERY")).toBe("OLD TOM DISTILLERY");
  });
});

describe("tokenize", () => {
  it("lower-cases and strips punctuation", () => {
    expect(tokenize("Old Tom Distillery, Inc.")).toEqual([
      "old",
      "tom",
      "distillery",
      "inc",
    ]);
  });
});

describe("canonicalTokens", () => {
  it("expands company suffixes", () => {
    expect(canonicalTokens("Old Tom Inc")).toEqual([
      "old",
      "tom",
      "incorporated",
    ]);
  });

  it("treats whisky and whiskey as the same word", () => {
    expect(canonicalTokens("Scotch Whisky")).toEqual(
      canonicalTokens("Scotch Whiskey"),
    );
  });

  it("drops noise words that carry no distinguishing information", () => {
    expect(canonicalTokens("The Macallan")).toEqual(["macallan"]);
  });
});

describe("ladderMatch", () => {
  /**
   * The case a 28-year veteran agent raised by name. Failing this pair would
   * make the tool actively worse than the manual process it replaces.
   */
  it("matches STONE'S THROW to Stone's Throw across case and curly apostrophes", () => {
    const result = ladderMatch("Stone's Throw", "STONE’S THROW");
    expect(result.matched).toBe(true);
    expect(result.level).toBe("case");
  });

  it("reports an exact match as exact", () => {
    const result = ladderMatch("OLD TOM DISTILLERY", "OLD TOM DISTILLERY");
    expect(result.matched).toBe(true);
    expect(result.level).toBe("exact");
  });

  it("reports the least permissive level that succeeds", () => {
    // Differs only in spacing, so it must not be reported as a case match.
    const result = ladderMatch("OLD  TOM", "OLD TOM");
    expect(result.level).toBe("whitespace");
  });

  it("matches across accents when nothing else differs", () => {
    const result = ladderMatch("Rose Wine", "Rosé Wine");
    expect(result.matched).toBe(true);
    expect(result.level).toBe("accents");
  });

  it("matches abbreviated company suffixes", () => {
    const result = ladderMatch("Old Tom Distillery Inc.", "OLD TOM DISTILLERY INCORPORATED");
    expect(result.matched).toBe(true);
    expect(result.level).toBe("synonyms");
  });

  it("does not match genuinely different names", () => {
    expect(ladderMatch("Old Tom Distillery", "Young Bill Brewing").matched).toBe(
      false,
    );
  });
});
