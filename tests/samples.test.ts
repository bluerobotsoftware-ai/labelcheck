import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verify } from "@/lib/ttb/rules";
import { COMPLIANT_SPIRITS } from "@/lib/reader/mock";
import type { Application, LabelExtraction } from "@/lib/ttb/types";

/**
 * Contract tests between the sample labels and the rules engine.
 *
 * The sample manifest declares, for each generated label, the verdict a correct
 * implementation must reach. That ground truth is only useful if it refers to
 * checks the engine actually emits — otherwise it drifts into fiction, quietly,
 * while every other test stays green. These tests bind the two together.
 *
 * They do NOT call a vision model. Verifying that the model reads the artwork
 * correctly needs an API key and is done by hand; what is verified here is that
 * the manifest and the engine still speak the same language.
 */

interface Manifest {
  samples: Array<{
    id: string;
    file: string;
    application: Application;
    expected: {
      recommendation: string;
      checks: Record<string, string>;
    };
  }>;
}

const manifest = JSON.parse(
  readFileSync(new URL("../public/samples/manifest.json", import.meta.url), "utf8"),
) as Manifest;

/** Every check id the engine can emit, gathered by exercising it. */
function knownCheckIds(): Set<string> {
  const ids = new Set<string>();

  const collect = (application: Application, extraction: LabelExtraction) => {
    for (const check of verify(application, extraction, {
      extractionMs: 0,
      reader: "test",
    }).checks) {
      ids.add(check.id);
    }
  };

  const base: Application = {
    beverageType: "distilled_spirits",
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholContent: "45% Alc./Vol. (90 Proof)",
    netContents: "750 mL",
    bottlerName: "Old Tom Distillery",
  };

  // Walk the branches that emit conditional checks, so ids like
  // proof_consistency and alcohol_present are included.
  collect(base, COMPLIANT_SPIRITS);
  collect({ ...base, isImport: true, countryOfOrigin: "Scotland" }, COMPLIANT_SPIRITS);
  collect(
    { ...base, alcoholContent: undefined },
    { ...COMPLIANT_SPIRITS, alcoholContent: null },
  );
  collect(base, {
    ...COMPLIANT_SPIRITS,
    alcoholContent: { text: "45% Alc./Vol. (80 Proof)", confidence: 0.9 },
  });

  return ids;
}

describe("sample manifest", () => {
  const ids = knownCheckIds();

  it("ships samples", () => {
    expect(manifest.samples.length).toBeGreaterThanOrEqual(8);
  });

  it("refers only to checks the rules engine actually emits", () => {
    const unknown = new Set<string>();
    for (const sample of manifest.samples) {
      for (const id of Object.keys(sample.expected?.checks ?? {})) {
        if (!ids.has(id)) unknown.add(id);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("only expects recommendations the engine can produce", () => {
    const valid = new Set(["approve", "needs_review", "reject"]);
    for (const sample of manifest.samples) {
      expect(valid.has(sample.expected.recommendation)).toBe(true);
    }
  });

  it("gives every sample a usable application", () => {
    for (const sample of manifest.samples) {
      expect(sample.application.brandName.trim()).not.toBe("");
      expect(sample.application.classType.trim()).not.toBe("");
      expect(["distilled_spirits", "wine", "malt_beverage"]).toContain(
        sample.application.beverageType,
      );
    }
  });

  /**
   * The trap sample: display capitals with a typographic apostrophe on the
   * artwork, title case with an ASCII apostrophe on the application. It must
   * pass. Failing it is the single most likely defect in a naive matcher, so
   * the sample set would be worth little if it did not assert this.
   */
  it("expects the case-and-apostrophe variant to pass", () => {
    const trap = manifest.samples.find((s) => s.id.includes("case-and-apostrophe"));
    expect(trap).toBeDefined();
    expect(trap?.expected.recommendation).toBe("approve");
  });
});
