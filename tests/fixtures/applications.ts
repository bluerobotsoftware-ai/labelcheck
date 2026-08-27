/**
 * Test fixtures for the label-verification rules engine.
 *
 * PROVENANCE - read this before trusting any value here.
 *
 * Fixtures split into two groups, distinguished by one machine-checkable signal:
 *
 *   - `ttbId` IS SET  -> every field is transcribed verbatim from a real, public
 *     record in TTB's Public COLA Registry (https://ttbonline.gov/colasonline/).
 *     Retrieve the original with:
 *       https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=<ttbId>
 *     Capitalisation, punctuation, spacing and spelling are TTB's, not ours -
 *     including "WHISKY" everywhere, "DESSERT /PORT/SHERRY/(COOKING) WINE" with
 *     its stray space, and the literal "N/A" some applicants type into Item 7.
 *     Do not "tidy" these strings. The mess is the point.
 *
 *   - `ttbId` IS ABSENT -> a DERIVED fixture. It takes a real filing as its base
 *     (named in the comment) and perturbs exactly one field to exercise one rule.
 *     No COLA ID is attached because these filings do not exist. `applicationId`
 *     carries a "DERIVED-..." marker so they can never be mistaken for real data.
 *
 * Two structural facts about the real form that shape these fixtures:
 *
 *   1. TTB F 5100.31 has carried NO alcohol-content and NO net-contents field
 *      since roughly the 2015 revision (they were Items 13 and 12). Fixtures
 *      sourced from 2016+ filings therefore genuinely have neither, and the
 *      rules engine must return `not_applicable` for those match checks rather
 *      than failing or guessing. Older filings still carry both, verbatim.
 *   2. The label almost never repeats the application's wording. The application
 *      says `45` and `750 MILLILITERS`; the artwork says `45% ALC/VOL (90 PROOF)`
 *      and `750ML`. Normalisation is the default path, not an edge case.
 *
 * See docs/COLA-FORM-NOTES.md for sources and the full field-by-field notes.
 */

import type { Application } from "@/lib/ttb/types";

/** A fixture plus the outcome the rules engine is expected to reach. */
export interface ApplicationFixture {
  /** Stable key for use in test names. */
  id: string;
  /** What this fixture exercises. */
  describe: string;
  /**
   * The label text this fixture is meant to be paired against.
   *
   * These are CONSTRUCTED counterparts describing what the artwork should say -
   * they are not transcriptions of real labels, with one exception:
   * `real-bourbon-buffalo-trace`, whose value was read off the actual artwork
   * retrieved from that COLA. That fixture says so in its `describe`.
   */
  labelSays?: string;
  /** Expected verdict for the check under test. */
  expect: string;
  application: Application;
}

export const applicationFixtures: ApplicationFixture[] = [
  // ===========================================================================
  // GROUP 1 - REAL FILINGS, TRANSCRIBED VERBATIM
  // ===========================================================================

  {
    id: "real-bourbon-makers-mark",
    describe:
      "Baseline distilled spirits, older form revision so ABV and net contents " +
      "are genuinely present. Exercises three normalisations at once: a bare " +
      "numeric ABV ('45'), a spelled-out net contents ('750 MILLILITERS'), and " +
      "TTB's 'WHISKY' spelling against a label that reads 'WHISKEY'.",
    labelSays:
      "MAKER'S MARK / KENTUCKY STRAIGHT BOURBON WHISKY / 45% Alc./Vol. (90 Proof) / 750 mL",
    expect: "pass on every check",
    application: {
      ttbId: "11354001000132",
      applicationId: "COLA 11354001000132",
      beverageType: "distilled_spirits",
      brandName: "MAKER'S MARK",
      fancifulName: "N/A", // applicant literally typed "N/A" into Item 7
      classType: "STRAIGHT BOURBON WHISKY",
      classTypeCode: "101",
      alcoholContent: "45",
      netContents: "750 MILLILITERS",
      bottlerName: "MAKER'S MARK DISTILLERY, INC., 3350 BURKS SPRING RD, LORETTO, KY 40037",
      serialNumber: "110017",
      plantRegistryNumber: "DSP-KY-44",
      countryOfOrigin: "KENTUCKY",
      originCode: "22",
      isImport: false,
      applicationType: "cola",
      status: "approved",
    },
  },

  {
    id: "real-wine-barefoot",
    describe:
      "Baseline wine. The legal applicant (E. & J. GALLO WINERY) is not the name " +
      "on the label (BAREFOOT CELLARS). A bottler check that compares artwork " +
      "against `bottlerName` alone fails this valid filing - it must also " +
      "consider `labelCompanyName`. Also carries a bare integer ABV, '9'.",
    labelSays: "BAREFOOT / CALIFORNIA RED MOSCATO / ALC. 9% BY VOL. / 1.5 L / BAREFOOT CELLARS, MODESTO, CA",
    expect: "pass; bottler check must resolve against labelCompanyName, not bottlerName",
    application: {
      ttbId: "12061001000632",
      applicationId: "COLA 12061001000632",
      beverageType: "wine",
      brandName: "BAREFOOT",
      fancifulName: "N/A",
      classType: "TABLE RED WINE",
      classTypeCode: "80",
      alcoholContent: "9",
      netContents: "1.5 LITERS",
      bottlerName: "E. & J. GALLO WINERY, 600 YOSEMITE BLVD, MODESTO, CA 95354",
      labelCompanyName: "BAREFOOT CELLARS",
      serialNumber: "120049",
      plantRegistryNumber: "BW-CA-4213",
      wineAppellation: "CALIFORNIA",
      countryOfOrigin: "CALIFORNIA",
      originCode: "01",
      isImport: false,
      applicationType: "cola",
      status: "approved",
    },
  },

  {
    id: "real-malt-sierra-nevada-keg",
    describe:
      "Baseline malt beverage, filed for TWO container sizes at once (the form " +
      "explicitly permits a range). `netContents` is not a single value, so a " +
      "rule that compares it as one string will fail a valid keg label that " +
      "prints only one of the two sizes.",
    labelSays: "SIERRA NEVADA / ROUGE 66 / ALE / 15.5 GAL (1/2 BBL)",
    expect: "pass - label matching ANY listed size satisfies net contents",
    application: {
      ttbId: "11364001000198",
      applicationId: "COLA 11364001000198",
      beverageType: "malt_beverage",
      brandName: "SIERRA NEVADA",
      fancifulName: "ROUGE 66",
      classType: "ALE",
      classTypeCode: "902",
      alcoholContent: "7.5",
      netContents: "5 GAL.; 15.5 GAL. (1/2 BBL)",
      bottlerName: "SIERRA NEVADA BREWING CO., 1075 E 20TH ST, CHICO, CA 95928",
      serialNumber: "110059",
      plantRegistryNumber: "BR-CA-SIE-1",
      countryOfOrigin: "CALIFORNIA",
      originCode: "01",
      isImport: false,
      applicationType: "cola",
      status: "approved",
    },
  },

  {
    id: "real-import-scotch-glenlivet",
    describe:
      "Imported distilled spirits. Three things at once: the class/type is " +
      "spelled 'WHISKY' and the label agrees (Scotch never takes the E, so this " +
      "is the case where whisky/whiskey tolerance must NOT be applied blindly); " +
      "the applicant is an importer whose name is nowhere on the label; and net " +
      "contents are embossed rather than printed, recorded in Item 15.",
    labelSays: "THE GLENLIVET / SINGLE MALT SCOTCH WHISKY / 40% ALC/VOL / 750ML",
    expect: "pass; country of origin must resolve to Scotland",
    application: {
      ttbId: "16062001000172",
      applicationId: "COLA 16062001000172",
      beverageType: "distilled_spirits",
      brandName: "THE GLENLIVET",
      classType: "SINGLE MALT SCOTCH WHISKY",
      classTypeCode: "153",
      alcoholContent: "40",
      netContents: "750 MILLILITERS",
      bottlerName: "PERNOD RICARD USA, LLC, 100 MANHATTANVILLE RD, LEGAL DEPT, PURCHASE, NY 10577",
      labelCompanyName: "THE GLENLIVET DISTILLING COMPANY",
      serialNumber: "16P032",
      plantRegistryNumber: "NY-I-15204",
      countryOfOrigin: "SCOTLAND",
      originCode: "5K",
      isImport: true,
      applicationType: "cola",
      // Verbatim Item 15 on the filing.
      containerInfoNotOnLabels: "GEORGE & J.G. SMITH LTD. IS EMBOSSED INTO THE BOTTLE.",
      // Real status. A surrendered COLA no longer authorises bottling, so the
      // engine should surface this regardless of how well the label matches.
      status: "surrendered",
    },
  },

  {
    id: "real-import-beer-modelo-especial",
    describe:
      "Imported malt beverage with the two nastiest real-world value formats we " +
      "found. ABV is '3.2/wt' - alcohol by WEIGHT, not volume, which is ~4.0% ABV; " +
      "parsing it as a volume percentage produces a confident wrong answer. Net " +
      "contents is a dual statement, '1 PT. 8 FL. OZ. (24 FL. OZ.)'.",
    labelSays: "MODELO ESPECIAL / CERVEZA / 24 FL. OZ. (1 PT. 8 FL. OZ.)",
    expect:
      "ABV check must return review, never a numeric pass/fail, when the unit is /wt",
    application: {
      ttbId: "12019001000628",
      applicationId: "COLA 12019001000628",
      beverageType: "malt_beverage",
      brandName: "MODELO ESPECIAL",
      fancifulName: "N/A",
      classType: "BEER",
      classTypeCode: "951",
      alcoholContent: "3.2/wt",
      netContents: "1 PT. 8 FL. OZ. (24 FL. OZ.)",
      bottlerName: "CROWN IMPORTS LLC, 1 S DEARBORN ST, SUITE 1700, CHICAGO, IL 60603",
      serialNumber: "120006",
      plantRegistryNumber: "IL-I-15100",
      countryOfOrigin: "MEXICO",
      originCode: "81",
      isImport: true,
      applicationType: "cola",
      status: "approved",
    },
  },

  {
    id: "real-specialty-jack-daniels-whiskey-cola",
    describe:
      "The whisky/whiskey collision inside a single real filing: TTB's class/type " +
      "is 'WHISKY SPECIALTIES' while the applicant's own fanciful name is " +
      "'WHISKEY & COLA'. Both are correct. Any rule that treats the two spellings " +
      "as different tokens will fail TTB's own data. Also a formula product, so " +
      "Item 7 is mandatory here rather than optional.",
    labelSays: "JACK DANIEL'S / WHISKEY & COLA / 5% ALC/VOL / 355 mL",
    expect: "pass; whisky/whiskey must normalise to the same token",
    application: {
      ttbId: "10236001000047",
      applicationId: "COLA 10236001000047",
      beverageType: "distilled_spirits",
      brandName: "JACK DANIEL'S",
      fancifulName: "WHISKEY & COLA",
      classType: "WHISKY SPECIALTIES",
      classTypeCode: "641",
      alcoholContent: "5%",
      netContents: "355 MILLILITERS (METAL ONLY)",
      bottlerName: "PRI-PAK, INC., 2000 SCHENLEY PL, LAWRENCEBURG, IN 47025",
      labelCompanyName: "JACK DANIEL DISTILLERY",
      serialNumber: "10JD01",
      plantRegistryNumber: "DSP-IN-26",
      formulaId: "393",
      countryOfOrigin: "INDIANA",
      originCode: "19",
      isImport: false,
      applicationType: "resubmission",
      status: "surrendered",
    },
  },

  {
    id: "real-modern-cola-no-abv-filed",
    describe:
      "A 2025 filing on the current form revision. There is NO alcohol content " +
      "and NO net contents on the application because TTB removed both fields. " +
      "This is the fixture that proves the engine distinguishes 'the applicant " +
      "did not state this' from 'the label contradicts the applicant'. Also an " +
      "imported wine carrying both a fanciful name and an appellation.",
    labelSays: "LA VIEILLE FERME / THE CHICKEN WINE / VIN DE FRANCE / 12.5% ALC/VOL / 750ML",
    expect:
      "ABV and net-contents MATCH checks return not_applicable, not fail; " +
      "brand, class/type and origin still pass",
    application: {
      ttbId: "25014001000156",
      applicationId: "COLA 25014001000156",
      beverageType: "wine",
      brandName: "LA VIEILLE FERME",
      fancifulName: "THE CHICKEN WINE",
      classType: "TABLE WHITE WINE",
      classTypeCode: "81",
      // alcoholContent and netContents deliberately absent - not on the 04/2023 form.
      serialNumber: "250023",
      plantRegistryNumber: "AL-I-381",
      wineAppellation: "VIN DE FRANCE",
      countryOfOrigin: "FRANCE",
      originCode: "51",
      isImport: true,
      applicationType: "cola",
      status: "approved",
    },
  },

  {
    id: "real-wine-kendall-jackson-gnarly-classtype",
    describe:
      "TTB's ugliest real class/type string: 'DESSERT /PORT/SHERRY/(COOKING) WINE', " +
      "with an orphaned space before the first slash and a parenthesised alternative " +
      "in the middle. No label prints this verbatim; a label saying 'LATE HARVEST' " +
      "or 'PORT' is what the agent will actually see. Tests that class/type " +
      "matching handles slash-delimited alternatives rather than exact strings. " +
      "Also the only fixture carrying a vintage and a multi-part appellation.",
    labelSays: "KENDALL-JACKSON / KNIGHTS VALLEY / 2010 / 15.0% ALC BY VOL / 750ML",
    expect: "class/type check returns review, not fail, when the label prints one alternative",
    application: {
      ttbId: "12027001000408",
      applicationId: "COLA 12027001000408",
      beverageType: "wine",
      brandName: "KENDALL-JACKSON",
      fancifulName: "SEMINAR A TRACE RIDGE VINEYARD",
      classType: "DESSERT /PORT/SHERRY/(COOKING) WINE",
      classTypeCode: "88",
      alcoholContent: "15.0",
      netContents: "750 MILLILITERS",
      // Registry renders Item 8 as "<DBA>, <legal entity>" when both are recorded.
      bottlerName: "VINWOOD, JACKSON FAMILY WINES, INC., 18700 GEYSERVILLE AVE, GEYSERVILLE, CA 95441",
      labelCompanyName: "KENDALL-JACKSON VINEYARDS & WINERY",
      serialNumber: "12VW01",
      plantRegistryNumber: "BW-CA-5256",
      wineAppellation: "KNIGHTS VALLEY, SONOMA COUNTY",
      wineVintage: "2010",
      countryOfOrigin: "CALIFORNIA",
      originCode: "01",
      isImport: false,
      applicationType: "cola",
      status: "approved",
    },
  },

  {
    id: "real-import-stout-guinness",
    describe:
      "A real corporate-name near-miss, not a synthetic one: the legal applicant " +
      "is 'DIAGEO - GUINNESS USA INC.' (spaced hyphen) and the approved label " +
      "name is 'DIAGEO-GUINNESS USA' (tight hyphen, no 'INC.'). Exactly the " +
      "punctuation-and-legal-suffix case, sourced from TTB rather than invented. " +
      "Also an imported product whose class/type code (952) differs from the " +
      "domestic code for the same words (902 = ALE).",
    labelSays: "GUINNESS / EXTRA STOUT / 5.6% ALC/VOL / 11.2 FL OZ / IMPORTED BY DIAGEO-GUINNESS USA, NORWALK, CT",
    expect: "pass; whitespace, hyphens and 'INC.' must not drive a bottler mismatch",
    application: {
      ttbId: "12181001000061",
      applicationId: "COLA 12181001000061",
      beverageType: "malt_beverage",
      brandName: "GUINNESS",
      fancifulName: "N/A",
      classType: "ALE",
      classTypeCode: "952",
      alcoholContent: "5.6",
      netContents: "11.2 FL OZ",
      bottlerName: "DIAGEO - GUINNESS USA INC., 801 MAIN AVE, NORWALK, CT 06851",
      labelCompanyName: "DIAGEO-GUINNESS USA",
      serialNumber: "12I060",
      plantRegistryNumber: "CT-I-213",
      countryOfOrigin: "IRELAND",
      originCode: "5E",
      isImport: true,
      applicationType: "cola",
      status: "approved",
    },
  },

  {
    id: "real-bourbon-buffalo-trace",
    describe:
      "The one fixture whose counterpart artwork we actually retrieved and read " +
      "(back label 'Buffalo Trace KSBW 750ml 90P Back.jpg' on this COLA). Every " +
      "value in `labelSays` below is transcribed from that image, so this pair is " +
      "an end-to-end ground truth: the filing says 'STRAIGHT BOURBON WHISKY' and " +
      "the printed label says 'KENTUCKY STRAIGHT BOURBON WHISKEY'. Modern form, " +
      "so no ABV or net contents were filed even though the label states both. " +
      "Also a multi-location filing: Item 2 lists EIGHT plant registry numbers " +
      "(DSP-CA-63, DSP-IN-21057, DSP-KY-12, DSP-KY-24, DSP-KY-113, DSP-MD-11, " +
      "DSP-ME-2, DSP-NH-21006), which is why the certificate carries the " +
      "qualification below. `plantRegistryNumber` holds only the principal " +
      "location - see COLA-FORM-NOTES.md, it should become an array.",
    labelSays:
      "BUFFALO TRACE / KENTUCKY STRAIGHT BOURBON WHISKEY / 45% ALC/VOL (90 PROOF) 750ML / " +
      "DISTILLED, AGED & BOTTLED BY BUFFALO TRACE DISTILLERY, FRANKFORT, KY / " +
      "GOVERNMENT WARNING: (all caps, bold header)",
    expect:
      "pass; class/type passes only if whisky/whiskey and the 'KENTUCKY' prefix " +
      "are both tolerated, and ABV/net contents are not_applicable for matching",
    application: {
      ttbId: "24009001000244",
      applicationId: "COLA 24009001000244",
      beverageType: "distilled_spirits",
      brandName: "BUFFALO TRACE",
      fancifulName: "SBS",
      classType: "STRAIGHT BOURBON WHISKY",
      classTypeCode: "101",
      bottlerName:
        "BUFFALO TRACE DISTILLERY, BUFFALO TRACE DISTILLERY, INC., 113 GREAT BUFFALO TRACE, FRANKFORT, KY 40601",
      labelCompanyName: "BUFFALO TRACE DISTILLERY",
      serialNumber: "240013",
      plantRegistryNumber: "DSP-KY-113",
      countryOfOrigin: "KENTUCKY",
      originCode: "22",
      isImport: false,
      applicationType: "cola",
      status: "approved",
      qualifications: ["EACH CONTAINER MUST BE CODED TO INDICATE ACTUAL PLACE OF BOTTLING."],
    },
  },

  // ===========================================================================
  // GROUP 2 - DERIVED FIXTURES
  //
  // Each takes a real filing above as its base and changes exactly ONE field.
  // No `ttbId`: these filings do not exist and must never be cited as real.
  // The regulatory basis for tolerating most of these differences is the
  // "Allowable Revisions" table printed on TTB F 5100.31 itself, item 3.b,
  // which permits a bottler to change, WITHOUT refiling, the "spelling
  // (including punctuation marks, changing letters from upper case to lower
  // case and vice versa, and abbreviations) of words" - for wine, distilled
  // spirits and malt beverages alike. A label that differs from its
  // application only in those respects is therefore compliant by construction.
  // ===========================================================================

  {
    id: "derived-case-only-difference",
    describe:
      "Case-only difference in the brand name. Base: COLA 11354001000132. " +
      "Allowable Revision 3.b explicitly permits changing letters from upper to " +
      "lower case and back without refiling.",
    labelSays: "MAKER'S MARK",
    expect: "pass - case must be normalised away",
    application: {
      applicationId: "DERIVED-11354001000132-CASE",
      beverageType: "distilled_spirits",
      brandName: "Maker's Mark",
      classType: "Kentucky Straight Bourbon Whisky",
      classTypeCode: "101",
      alcoholContent: "45",
      netContents: "750 MILLILITERS",
      bottlerName: "MAKER'S MARK DISTILLERY, INC.",
      serialNumber: "110017",
      plantRegistryNumber: "DSP-KY-44",
      countryOfOrigin: "KENTUCKY",
      isImport: false,
      status: "approved",
    },
  },

  {
    id: "derived-curly-vs-straight-apostrophe",
    describe:
      "Typographic apostrophe U+2019 in the application against the ASCII " +
      "apostrophe U+0027 on the label. Base: COLA 11354001000132, whose registry " +
      "record uses the straight form. Design software substitutes the curly form " +
      "silently, so this is the single most common false failure in practice. " +
      "Allowable Revision 3.b covers punctuation marks.",
    labelSays: "MAKER'S MARK  (straight apostrophe, U+0027)",
    expect: "pass - Unicode punctuation must be folded before comparison",
    application: {
      applicationId: "DERIVED-11354001000132-APOSTROPHE",
      beverageType: "distilled_spirits",
      brandName: "MAKER’S MARK",
      classType: "STRAIGHT BOURBON WHISKY",
      classTypeCode: "101",
      alcoholContent: "45",
      netContents: "750 MILLILITERS",
      bottlerName: "MAKER’S MARK DISTILLERY, INC.",
      serialNumber: "110017",
      plantRegistryNumber: "DSP-KY-44",
      countryOfOrigin: "KENTUCKY",
      isImport: false,
      status: "approved",
    },
  },

  {
    id: "derived-whisky-vs-whiskey-spelling",
    describe:
      "The spelling case in isolation. Base: COLA 24009001000244, where we " +
      "confirmed against the artwork that TTB filed 'WHISKY' and the printed " +
      "label reads 'WHISKEY'. Both spellings are lawful under 27 CFR part 5; " +
      "TTB's class/type codes use 'WHISKY' universally.",
    labelSays: "KENTUCKY STRAIGHT BOURBON WHISKEY",
    expect: "pass - whisky and whiskey are the same designation",
    application: {
      applicationId: "DERIVED-24009001000244-SPELLING",
      beverageType: "distilled_spirits",
      brandName: "BUFFALO TRACE",
      classType: "KENTUCKY STRAIGHT BOURBON WHISKY",
      classTypeCode: "101",
      bottlerName: "BUFFALO TRACE DISTILLERY, INC.",
      serialNumber: "240013",
      plantRegistryNumber: "DSP-KY-113",
      countryOfOrigin: "KENTUCKY",
      isImport: false,
      status: "approved",
    },
  },

  {
    id: "derived-abv-abbreviation-expanded",
    describe:
      "Same alcohol content, different rendering: the application spells out " +
      "'Alcohol by Volume' while the label uses the near-universal abbreviation " +
      "'ALC/VOL'. Base: COLA 11354001000132. 27 CFR 5.65(b)(3) authorises 'alc', " +
      "'%', '/' and 'vol' as abbreviations, and 5.65(b)(4) lists BOTH '40% alc/vol' " +
      "and '40% Alcohol by Volume' as compliant statements of the same fact. The " +
      "form's Allowable Revision 3.b separately permits changing abbreviations " +
      "without refiling.",
    labelSays: "45% ALC/VOL (90 PROOF)",
    expect: "pass - abbreviation and expansion are equivalent; compare the number, not the wording",
    application: {
      applicationId: "DERIVED-11354001000132-ABBREV",
      beverageType: "distilled_spirits",
      brandName: "MAKER'S MARK",
      classType: "STRAIGHT BOURBON WHISKY",
      classTypeCode: "101",
      alcoholContent: "45% Alcohol by Volume",
      netContents: "750 Milliliters",
      bottlerName: "MAKER'S MARK DISTILLERY, INC.",
      serialNumber: "110017",
      plantRegistryNumber: "DSP-KY-44",
      countryOfOrigin: "KENTUCKY",
      isImport: false,
      status: "approved",
    },
  },

  {
    id: "derived-legal-suffix-expanded",
    describe:
      "Company-name legal suffix written out in full on the application " +
      "('Incorporated') against the abbreviated form on the label ('INC.'). " +
      "Base: COLA 11354001000132. This is the synthetic twin of the real " +
      "DIAGEO - GUINNESS USA INC. / DIAGEO-GUINNESS USA divergence above.",
    labelSays: "DISTILLED AND BOTTLED BY MAKER'S MARK DISTILLERY, INC., LORETTO, KY",
    expect:
      "pass - equivalent legal suffixes (Inc./Incorporated, Co./Company, " +
      "LLC/L.L.C., Ltd./Limited, Corp./Corporation) must be folded",
    application: {
      applicationId: "DERIVED-11354001000132-SUFFIX",
      beverageType: "distilled_spirits",
      brandName: "MAKER'S MARK",
      classType: "STRAIGHT BOURBON WHISKY",
      classTypeCode: "101",
      alcoholContent: "45",
      netContents: "750 MILLILITERS",
      bottlerName: "Maker's Mark Distillery, Incorporated, Loretto, Kentucky",
      serialNumber: "110017",
      plantRegistryNumber: "DSP-KY-44",
      countryOfOrigin: "KENTUCKY",
      isImport: false,
      status: "approved",
    },
  },

  {
    id: "derived-abv-genuinely-wrong",
    describe:
      "A real defect, not a formatting artifact. The application declares 45% but " +
      "the artwork prints 40% - a 5-point gap, far outside the plus/minus 0.3 " +
      "percentage-point tolerance 27 CFR 5.65(c) allows. Base: COLA 11354001000132. This is " +
      "the control that proves ABV normalisation has not been loosened into " +
      "uselessness by the abbreviation and case rules above.",
    labelSays: "40% ALC/VOL (80 PROOF)",
    expect: "FAIL - and the explanation must state both numbers and the tolerance",
    application: {
      applicationId: "DERIVED-11354001000132-WRONG-ABV",
      beverageType: "distilled_spirits",
      brandName: "MAKER'S MARK",
      classType: "STRAIGHT BOURBON WHISKY",
      classTypeCode: "101",
      alcoholContent: "45",
      netContents: "750 MILLILITERS",
      bottlerName: "MAKER'S MARK DISTILLERY, INC.",
      serialNumber: "110017",
      plantRegistryNumber: "DSP-KY-44",
      countryOfOrigin: "KENTUCKY",
      isImport: false,
      status: "approved",
    },
  },

  {
    id: "derived-import-missing-country-of-origin",
    describe:
      "An incomplete application rather than a bad label: the filing is flagged " +
      "imported but carries no country of origin, so there is nothing to verify " +
      "the label's mandatory origin statement against. Base: COLA 16062001000172. " +
      "27 CFR 5.69 requires a country-of-origin statement on imported spirits. " +
      "The failure belongs to the application, and the message must say so - " +
      "telling an agent the LABEL is wrong here would send them to the wrong party.",
    labelSays: "PRODUCT OF SCOTLAND",
    expect:
      "FAIL, attributed to the application (missing mandatory field), not to the label",
    application: {
      applicationId: "DERIVED-16062001000172-NO-ORIGIN",
      beverageType: "distilled_spirits",
      brandName: "THE GLENLIVET",
      classType: "SINGLE MALT SCOTCH WHISKY",
      classTypeCode: "153",
      alcoholContent: "40",
      netContents: "750 MILLILITERS",
      bottlerName: "PERNOD RICARD USA, LLC, PURCHASE, NY",
      labelCompanyName: "THE GLENLIVET DISTILLING COMPANY",
      serialNumber: "16P032",
      plantRegistryNumber: "NY-I-15204",
      // countryOfOrigin deliberately absent while isImport is true.
      isImport: true,
      status: "approved",
    },
  },
];

/** Real filings only - safe to cite in documentation and demos. */
export const realApplicationFixtures: ApplicationFixture[] = applicationFixtures.filter(
  (f) => f.application.ttbId !== undefined,
);

/** Synthetic single-field perturbations. Never present these as real TTB records. */
export const derivedApplicationFixtures: ApplicationFixture[] = applicationFixtures.filter(
  (f) => f.application.ttbId === undefined,
);

/** Convenience lookup by fixture id. */
export function fixtureById(id: string): ApplicationFixture | undefined {
  return applicationFixtures.find((f) => f.id === id);
}
