/**
 * The extraction contract shared by every reader implementation.
 *
 * One schema and one prompt, used by all providers, so that swapping the vision
 * model changes only *how well* the label is read and never *what* is read.
 * That is what keeps the rules engine provider-agnostic: it consumes a
 * `LabelExtraction` and has no idea which model produced it.
 */

import * as z from "zod/v4";

/**
 * A single field as transcribed from the artwork.
 *
 * `text` is verbatim. `confidence` is the reader's own estimate that it read
 * the characters correctly — not a judgement about compliance, which is never
 * the reader's business.
 */
const fieldReading = z.object({
  text: z
    .string()
    .describe(
      "The text exactly as printed on the label, preserving original capitalisation, punctuation and spacing.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "How confident you are that you transcribed these characters correctly. 1.0 = perfectly legible, 0.3 = a guess from a blurred or obscured area.",
    ),
});

const warningReading = z.object({
  text: z
    .string()
    .describe(
      "The complete health warning text exactly as printed, including the heading, preserving original capitalisation.",
    ),
  confidence: z.number().min(0).max(1),
  headerIsAllCaps: z
    .boolean()
    .describe(
      'True only if the words GOVERNMENT WARNING are printed in full capital letters. False if printed as "Government Warning" or any other casing.',
    ),
  headerIsBold: z
    .boolean()
    .describe(
      "True if the GOVERNMENT WARNING heading is in noticeably heavier or bolder type than the sentences that follow it.",
    ),
  legibleSize: z
    .boolean()
    .describe(
      "True if the warning is comfortably readable at the size shown. False if it is hidden in tiny type or has too little contrast against its background.",
    ),
  appearance: z.object({
    textColorHex: z
      .string()
      .describe(
        'The colour of the warning TEXT itself as printed, as a hex value like "#3a3a35". Sample the ink, not the panel around it.',
      ),
    backgroundColorHex: z
      .string()
      .describe(
        'The colour immediately BEHIND the warning text, as a hex value like "#f2eee1".',
      ),
    capHeightPercentOfLabel: z
      .number()
      .describe(
        "Height of a capital letter in the warning, as a percentage of the whole label's height. A warning whose capitals are a hundredth of the label height is 1.",
      ),
  }),
});

/**
 * The full extraction.
 *
 * Every field is nullable and the prompt is emphatic about when to use null,
 * because "absent from the label" and "present but I could not read it" lead to
 * different regulatory outcomes and must never be conflated.
 */
export const labelExtractionSchema = z.object({
  brandName: fieldReading
    .nullable()
    .describe("The brand name — usually the largest and most prominent text."),
  classType: fieldReading
    .nullable()
    .describe(
      'The class or type designation, e.g. "Kentucky Straight Bourbon Whiskey", "Cabernet Sauvignon", "India Pale Ale".',
    ),
  alcoholContent: fieldReading
    .nullable()
    .describe(
      'The alcohol content statement exactly as printed, e.g. "45% Alc./Vol. (90 Proof)" or "ALC. 12.5% BY VOL.".',
    ),
  netContents: fieldReading
    .nullable()
    .describe('The net contents, e.g. "750 mL", "75 cl", "12 FL OZ".'),
  bottlerName: fieldReading
    .nullable()
    .describe(
      'The bottler, producer, distiller or importer line, including the city and state if shown, e.g. "BOTTLED BY OLD TOM DISTILLERY, BARDSTOWN, KY".',
    ),
  countryOfOrigin: fieldReading
    .nullable()
    .describe('A country of origin statement, e.g. "PRODUCT OF SCOTLAND".'),
  governmentWarning: warningReading
    .nullable()
    .describe("The government health warning paragraph, if present."),
  imageQuality: z.object({
    score: z
      .number()
      .min(0)
      .max(1)
      .describe("Overall legibility of this image, 1.0 being a clean flat scan."),
    issues: z
      .array(z.string())
      .describe(
        'Specific problems affecting readability, e.g. "glare across lower third", "photographed at roughly 30 degrees", "out of focus".',
      ),
    tooPoorToReview: z
      .boolean()
      .describe(
        "True only if the image is so poor that a compliance decision cannot responsibly be made from it and a new photograph must be requested.",
      ),
  }),
  labelLegibility: z.object({
    score: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "How readable the label's mandatory information would be to a person of ordinary eyesight holding the actual container. Judge the PRINTING, not the photograph: assume the picture were perfect and ask whether the type is large enough and contrasted enough to read.",
      ),
    belowOrdinaryEyesight: z
      .boolean()
      .describe(
        "True if mandatory information — especially the health warning — is printed too small or in too little contrast for a person of ordinary eyesight to read under ordinary conditions. Set this ONLY for a fault in the label's design, never because the photograph is poor.",
      ),
    issues: z
      .array(z.string())
      .describe(
        'Specific legibility faults in the printing, e.g. "warning set in roughly 1mm type", "pale grey text on a white panel".',
      ),
  }),
  notes: z
    .array(z.string())
    .describe(
      "Anything else a compliance reviewer should know that does not belong in a field above. Keep to a maximum of three short observations, or return an empty array.",
    ),
});

export type LabelExtractionPayload = z.infer<typeof labelExtractionSchema>;

/**
 * The extraction prompt.
 *
 * Two things about this prompt matter more than anything else, and both are
 * repeated deliberately:
 *
 *   1. TRANSCRIBE, DO NOT JUDGE. The moment a model starts deciding whether a
 *      label complies, the decision leaves the auditable rules engine and
 *      becomes unexplainable. Compliance verdicts are computed downstream from
 *      this transcription.
 *
 *   2. DO NOT TIDY. Models want to be helpful and will silently correct
 *      "Government Warning" to "GOVERNMENT WARNING", or expand "ALC/VOL". Each
 *      such helpful correction destroys exactly the evidence we need — a junior
 *      agent rejected a label last month for that precise casing error.
 */
export const EXTRACTION_PROMPT = `You are transcribing an alcohol beverage label for a compliance reviewer at the U.S. Alcohol and Tobacco Tax and Trade Bureau.

Your only job is to READ the label and report what is printed on it. You are not assessing whether the label is compliant, and you must not correct, tidy, normalise or complete anything you read. Another system makes all compliance decisions from your transcription, and it depends on that transcription being faithful.

Rules:

1. TRANSCRIBE EXACTLY. Preserve capitalisation exactly as printed. If the label says "Government Warning" in title case, write "Government Warning" — do not change it to capitals. If it says "ALC/VOL", do not expand it to "Alcohol by Volume". Preserve punctuation, including the exact apostrophes used.

2. ABSENT IS NOT THE SAME AS UNREADABLE. Return null for a field only when that information genuinely does not appear on the label. If text is present but you cannot make it out, return your best reading with a LOW confidence value instead of null. These lead to different outcomes and must not be confused.

3. BE HONEST ABOUT CONFIDENCE. Use the full range. Crisp printed text warrants 0.95 or above. Text obscured by glare, curvature, motion blur or an oblique angle should be scored to reflect how much you are guessing. An overconfident wrong reading is far more damaging here than an honest uncertain one.

4. THE HEALTH WARNING NEEDS VISUAL DETAIL, NOT JUST TEXT. Report separately whether the words GOVERNMENT WARNING are in full capitals, whether that heading is in bolder type than the sentences after it, and whether the whole statement is comfortably legible rather than shrunk or low-contrast. Judge these from what you see, and transcribe the heading in its actual case.

5. REPORT IMAGE PROBLEMS PLAINLY. If the photograph is angled, glared, blurred, cropped or badly lit, say so in the issues list. Set tooPoorToReview only when the image genuinely cannot support a compliance decision.

6. KEEP TWO DIFFERENT PROBLEMS APART. "The photograph is bad" and "the label is printed illegibly" are separate findings with opposite consequences, and you must not merge them.
   - imageQuality describes the PICTURE. A perfect label photographed badly scores low here.
   - labelLegibility describes the PRINTING. Ask yourself: if this photograph were flawless, could a person of ordinary eyesight, holding the bottle in ordinary light, read the mandatory information — above all the health warning? A label whose warning is set in minute type or in barely-there contrast fails legibility even in a pin-sharp photograph.
   If the picture is too poor to tell the difference, say so in imageQuality and leave belowOrdinaryEyesight false rather than guessing.

Read the entire label, including small print around the edges and any text running vertically or around a curve.`;
