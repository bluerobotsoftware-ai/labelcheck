/**
 * Core domain types for TTB label verification.
 *
 * Design note: the vision model produces a `LabelExtraction` and nothing else.
 * Every pass/fail decision is made by deterministic code in `rules.ts` against
 * that extraction. No verdict in this system originates from a language model.
 */

/** Beverage class governs which fields are mandatory and which tolerances apply. */
export type BeverageType = "distilled_spirits" | "wine" | "malt_beverage";

/**
 * TTB F 5100.31 Item 14. Determines which label rules apply: a certificate of
 * exemption additionally requires "For sale in XX only" printed on the container.
 */
export type ApplicationType =
  /** 14a. The normal case. */
  | "cola"
  /** 14b. Intrastate sale only. Not issued for imports or malt beverages. */
  | "exemption"
  /** 14c. Distilled spirits in a distinctive container. */
  | "distinctive_bottle"
  /** 14d. Refiling after a rejection; carries the rejected TTB ID. */
  | "resubmission";

/** Lifecycle state shown in the Public COLA Registry. Only "approved" authorises bottling. */
export type ColaStatus = "approved" | "surrendered" | "expired" | "revoked";

/**
 * The typed-in half of a COLA application (TTB Form 5100.31).
 *
 * Field numbering below is the current 04/2023 revision of the paper form, which
 * is also what the Public COLA Registry renders. Two caveats an agent will notice:
 *
 * 1. `alcoholContent` and `netContents` are NOT on the current form. They were
 *    Items 13 and 12 respectively up to the ~2015 revision and were removed.
 *    A COLA filed today therefore carries no declared ABV or net contents to
 *    match a label against. Treat them as optional supplementary data: when
 *    absent, ABV and net-contents checks are `not_applicable` for matching and
 *    fall back to pure compliance checks against the class/type standard.
 * 2. `bottlerName` is ambiguous on the real form. Item 8 is the *legal* applicant
 *    name; the name printed on the label is often an approved DBA/trade name
 *    recorded separately. Both are modelled - see `labelCompanyName`.
 */
export interface Application {
  /** Free-form applicant reference, e.g. "TTB-2026-004417". Not verified, just carried through. */
  applicationId?: string;
  /**
   * TTB's own 14-digit identifier, e.g. "24009001000244". Structure is
   * YY + DDD (Julian day received) + RRR (receipt method; 001 = e-filed) +
   * NNNNNN (daily sequence). This, not `applicationId`, is what an agent searches on.
   */
  ttbId?: string;
  beverageType: BeverageType;
  brandName: string;
  /**
   * TTB's class/type designation, e.g. "STRAIGHT BOURBON WHISKY".
   * Note TTB spells it "WHISKY" in every code, including for products whose
   * labels lawfully read "WHISKEY". Never treat that difference as a mismatch.
   */
  classType: string;
  /** As typed by the applicant, e.g. "45% Alc./Vol. (90 Proof)" or plain "45". */
  alcoholContent?: string;
  /** e.g. "750 mL" */
  netContents?: string;
  /** Name and address of the bottler, producer or importer. */
  bottlerName?: string;
  /** Required when the product is imported. */
  countryOfOrigin?: string;
  /** True when the product is imported, which makes country of origin mandatory. */
  isImport?: boolean;

  // ---------------------------------------------------------------------------
  // Fields present on the real form that the first cut of this type omitted.
  // All optional so existing fixtures and callers keep compiling.
  // ---------------------------------------------------------------------------

  /**
   * Item 4, MANDATORY on the form. Applicant-assigned, begins with the last two
   * digits of the calendar year, max 6 characters. Alphanumeric in practice
   * ("240013", "16P032", "12VW01", "20JD02"), so never parse this as a number.
   */
  serialNumber?: string;
  /**
   * Item 2, MANDATORY. Plant registry / basic permit / brewer's notice number,
   * e.g. "DSP-KY-113", "BW-CA-4213", "BR-CA-SIE-1", "NY-I-15204".
   * The prefix encodes the permit class and is the strongest signal of beverage type.
   */
  plantRegistryNumber?: string;
  /**
   * Item 7. A second name that further identifies the product, printed on the
   * label alongside the brand name. Mandatory for specialty products that have
   * no recognised class designation, optional otherwise. Applicants who have
   * none often type the literal string "N/A".
   */
  fancifulName?: string;
  /**
   * Numeric class/type code, e.g. "101", "902", "951". This is the registry's
   * canonical key; the description alone is ambiguous because domestic and
   * imported products use different codes for the same words (902 and 952 are
   * both "ALE").
   */
  classTypeCode?: string;
  /**
   * TTB origin code. One namespace covering both US states and foreign
   * countries: "22" = Kentucky, "01" = California, "5K" = Scotland, "81" = Mexico.
   */
  originCode?: string;
  /**
   * The approved DBA / trade name that actually appears on the label, when it
   * differs from the legal applicant in `bottlerName`. Registry renders it as
   * "(Used on label)". Matching a label's bottler statement against `bottlerName`
   * without consulting this produces false failures - the applicant may be
   * "PERNOD RICARD USA, LLC" while the label reads "THE GLENLIVET DISTILLING COMPANY".
   */
  labelCompanyName?: string;
  /**
   * Item 9. TTB Formula ID, pre-import approval number or lab number for products
   * that required a pre-COLA evaluation. Presence implies the product is a
   * specialty/formula product, which is also when `fancifulName` becomes mandatory.
   */
  formulaId?: string;
  /** Item 11, wine only. Filled in only when an appellation is stated on the label. */
  wineAppellation?: string;
  /** Wine only. Filled in only when a vintage date is stated on the label. */
  wineVintage?: string;
  /** Item 10, wine only. Each grape varietal appearing on the label. */
  grapeVarietals?: string[];
  /** Item 14. Defaults to a plain COLA. */
  applicationType?: ApplicationType;
  /** Two-letter state abbreviation, mandatory on the label when `applicationType` is "exemption". */
  forSaleInState?: string;
  /** Registry status. Anything other than "approved" means the label is not authorised. */
  status?: ColaStatus;
  /**
   * Item 15. Wording blown, branded or embossed on the container that does not
   * appear on the affixed labels, plus translations of foreign-language text.
   * Load-bearing: net contents are frequently embossed rather than printed, so a
   * label with no printed net contents is not automatically a failure.
   */
  containerInfoNotOnLabels?: string;
  /** Conditions TTB attached to the approval, verbatim from the certificate. */
  qualifications?: string[];
}

/**
 * What the vision model reports after reading the artwork.
 *
 * Every field is nullable: "I could not read this" is a first-class answer and
 * must never be conflated with "this is absent from the label". The distinction
 * decides whether an agent gets `FAIL` or `UNREADABLE`.
 */
export interface LabelExtraction {
  brandName: FieldReading | null;
  classType: FieldReading | null;
  alcoholContent: FieldReading | null;
  netContents: FieldReading | null;
  bottlerName: FieldReading | null;
  countryOfOrigin: FieldReading | null;
  governmentWarning: WarningReading | null;
  /** Model's assessment of whether the image is good enough to review at all. */
  imageQuality: ImageQuality;
  /** Whether the label itself is legible to a person, regardless of the photo. */
  labelLegibility: LabelLegibility;
  /** Anything the model saw that an agent should know about but that no rule covers. */
  notes: string[];
}

export interface FieldReading {
  /** Transcribed EXACTLY as printed, preserving case, punctuation and spacing. */
  text: string;
  /** 0-1. The model's confidence it transcribed this correctly. */
  confidence: number;
}

export interface WarningReading extends FieldReading {
  /** Is the literal string "GOVERNMENT WARNING:" rendered in all capitals? */
  headerIsAllCaps: boolean;
  /** Does the header appear bold relative to the body of the warning? */
  headerIsBold: boolean;
  /** Is the warning legible at typical bottle size, or shrunk to hide it? */
  legibleSize: boolean;
  /**
   * Objective measurements of how the warning is printed.
   *
   * Asked for instead of a legibility opinion, because the opinion proved
   * unreliable: shown a label whose warning had been washed out to roughly 12%
   * contrast — plainly unreadable to the eye — the reader answered
   * `legibleSize: true`. Models are far better at naming a colour they can see
   * than at judging whether a person could read it, so the model supplies the
   * quantities and `rules.ts` computes the verdict from them.
   */
  /** Where the warning sits, as fractions of the image. Supplied by the reader. */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Measured server-side from the pixels inside . Never model-reported. */
  appearance?: WarningAppearance;
}

/**
 * Whether the LABEL is legible, as distinct from whether the PHOTOGRAPH is.
 *
 * These are two different failures with opposite remedies and they must never
 * be conflated:
 *
 *   - A bad photograph is the applicant's *submission* being inadequate. The
 *     label may be perfect. Remedy: ask for a better picture. No finding can be
 *     made about the label at all.
 *
 *   - An illegible label is the *product* being non-compliant. The photograph
 *     may be pin-sharp. Mandatory information must be "readily legible under
 *     ordinary conditions" (27 CFR 5.55), and the health warning must be
 *     readable by a person of ordinary eyesight (27 CFR 16.22). Type set too
 *     small, or in too little contrast against its background, fails on the
 *     merits. Remedy: reject and require a redesign.
 *
 * Shrinking the warning into near-invisible type is a known evasion — "smaller
 * font... burying it in tiny text" — so this cannot be folded into image
 * quality, or the tactic it exists to catch would read as a photography problem.
 */
export interface LabelLegibility {
  /**
   * 0-1. How readable the label's mandatory information is to a person of
   * ordinary eyesight holding the container, judged as if the photograph were
   * perfect. Low values mean the LABEL is at fault, not the picture.
   */
  score: number;
  /**
   * True when mandatory information would not be readily legible to a person of
   * ordinary eyesight under ordinary conditions.
   */
  belowOrdinaryEyesight: boolean;
  /** e.g. ["warning set in roughly 1mm type", "grey text on a grey panel"] */
  issues: string[];
}

/**
 * Measured properties of the printed warning, from which legibility is computed
 * deterministically rather than judged.
 */
export interface WarningAppearance {
  /**
   * Contrast ratio between the warning text and its background, measured from
   * the image's own pixels — not reported by the model.
   *
   * The model is asked only where the warning is. Asking it for the two colours
   * worked until the same image was run four times and produced approve,
   * reject, reject, approve: it samples a slightly different pixel each time,
   * and near a threshold that flips the verdict. A deterministic engine fed a
   * non-deterministic input is not deterministic.
   */
  measuredContrast: number;
  /**
   * The warning contrast divided by the contrast of the label as a whole.
   *
   * This, not the absolute figure, is what decides. An underexposed photograph
   * of a well-printed label measures low in absolute terms — 1.53:1 on one
   * sample — and rejecting it would blame the product for the camera. Dividing
   * by the rest of the same label cancels the exposure: a warning printed like
   * the rest of the label sits near 1, while one deliberately washed out sits
   * near 0.28. Measured across the sample set the two populations are three
   * times apart.
   */
  relativeContrast?: number;
  /** The two colours the measurement separated, for showing an agent. */
  textColorHex: string;
  backgroundColorHex: string;
}

export interface ImageQuality {
  /** 0-1 overall readability of the artwork. */
  score: number;
  /** e.g. ["glare on lower third", "photographed at ~30 degree angle"] */
  issues: string[];
  /** True when the image is too poor to review and should be returned to the applicant. */
  tooPoorToReview: boolean;
}

/** Outcome of a single check. */
export type Verdict =
  /** Label agrees with the application, or satisfies the regulation. */
  | "pass"
  /** Defensible either way. A human must look. Never auto-approved. */
  | "review"
  /** Label contradicts the application, or violates the regulation. */
  | "fail"
  /** The model could not read the field; no compliance conclusion is possible. */
  | "unreadable"
  /** This field is not required for this beverage type / import status. */
  | "not_applicable";

export type CheckCategory =
  /** Label vs. the application. Requires both halves. */
  | "match"
  /** Label vs. federal law. Requires only the label. */
  | "compliance";

export interface CheckResult {
  id: string;
  /** Human label shown in the UI, e.g. "Brand Name". */
  name: string;
  category: CheckCategory;
  verdict: Verdict;
  /** What the application claimed, verbatim. */
  expected?: string;
  /** What the label showed, verbatim. */
  found?: string;
  /**
   * Identifier of the specific rule that produced this verdict, e.g.
   * "normalized-equal" or "abv-outside-tolerance". This is the audit trail:
   * an agent can always answer "why did it say that?".
   */
  rule: string;
  /** Plain-English sentence for a non-technical reviewer. */
  explanation: string;
  /** Governing regulation, e.g. "27 CFR 5.63(a)". */
  citation?: string;
  /** Transcription confidence carried through from the extraction, 0-1. */
  confidence?: number;
}

/** Overall recommendation. Deliberately advisory: an agent always decides. */
export type Recommendation = "approve" | "needs_review" | "reject";

export interface VerificationReport {
  recommendation: Recommendation;
  /** One-line summary for the top of the screen. */
  headline: string;
  checks: CheckResult[];
  imageQuality: ImageQuality;
  notes: string[];
  /** Word-level diff of the government warning, when one was found. */
  warningDiff?: DiffSegment[];
  timing: {
    /** Milliseconds spent in the vision model. */
    extractionMs: number;
    /** Milliseconds spent in the deterministic rules engine. */
    rulesMs: number;
    totalMs: number;
  };
  /** Which reader produced the extraction, e.g. "anthropic:claude-opus-5". */
  reader: string;
}

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffSegment {
  op: DiffOp;
  text: string;
}
