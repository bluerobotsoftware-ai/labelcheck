/**
 * Deterministic reader used by the test suite and by the no-key demo mode.
 *
 * Its value in tests is that it makes the whole decision layer verifiable with
 * no network, no API key and no spend: a test hands it an extraction and
 * asserts on the report the rules engine produces. Every rule in the system is
 * covered this way.
 *
 * Its value in the deployed app is narrower and needs stating plainly: with no
 * provider key configured, the app still runs so the interface can be explored,
 * but this reader DOES NOT LOOK AT THE IMAGE. It returns fixed sample data. The
 * UI labels it as such in the clearest terms available, because a compliance
 * tool that appears to have read a label it never opened is worse than one that
 * refuses to start.
 */

import type { LabelExtraction } from "../ttb/types";
import type { LabelReader, ReadResult } from "./types";

/** A clean, fully compliant distilled spirits label. */
export const COMPLIANT_SPIRITS: LabelExtraction = {
  brandName: { text: "OLD TOM DISTILLERY", confidence: 0.98 },
  classType: { text: "Kentucky Straight Bourbon Whiskey", confidence: 0.97 },
  alcoholContent: { text: "45% Alc./Vol. (90 Proof)", confidence: 0.96 },
  netContents: { text: "750 mL", confidence: 0.98 },
  bottlerName: {
    text: "DISTILLED AND BOTTLED BY OLD TOM DISTILLERY, BARDSTOWN, KENTUCKY",
    confidence: 0.94,
  },
  countryOfOrigin: null,
  governmentWarning: {
    text:
      "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not " +
      "drink alcoholic beverages during pregnancy because of the risk of birth " +
      "defects. (2) Consumption of alcoholic beverages impairs your ability to " +
      "drive a car or operate machinery, and may cause health problems.",
    confidence: 0.95,
    headerIsAllCaps: true,
    headerIsBold: true,
    legibleSize: true,
    bounds: { x: 0.08, y: 0.86, width: 0.84, height: 0.09 },
    appearance: {
      measuredContrast: 11.2,
      textColorHex: "#2b2b26",
      backgroundColorHex: "#efeadc",
    },
  },
  imageQuality: { score: 0.96, issues: [], tooPoorToReview: false },
  labelLegibility: { score: 0.95, belowOrdinaryEyesight: false, issues: [] },
  notes: [],
};

export class MockReader implements LabelReader {
  readonly id = "mock";
  readonly displayName = "Demo mode — no AI reader configured";
  readonly isOffline = true;

  constructor(
    private readonly extraction: LabelExtraction = COMPLIANT_SPIRITS,
    /** Simulated latency, so batch progress behaves realistically in demos. */
    private readonly latencyMs = 0,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async read(): Promise<ReadResult> {
    const started = Date.now();
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    return {
      extraction: this.extraction,
      elapsedMs: Date.now() - started,
      reader: "mock:fixed-sample-data",
    };
  }
}
