/**
 * The Government Health Warning — 27 CFR 16.21.
 *
 * This check is unlike every other one in the system. The warning does not
 * appear on the application at all, so there is nothing to match it against;
 * it is checked against the statute itself. The applicant does not get to tell
 * us what it says. It either reproduces the mandated text or it does not.
 *
 * A junior agent described the failure mode precisely: "people try to get
 * creative with the warning all the time. Smaller font, different wording,
 * burying it in tiny text. I caught one last month where they used 'Government
 * Warning' in title case instead of all caps. Rejected."
 *
 * So this module checks four independent things, and reports them separately
 * because they are separately fixable:
 *
 *   1. Presence      — is a warning there at all?
 *   2. Wording       — is the text word-for-word the statutory text?
 *   3. Capitalisation— is "GOVERNMENT WARNING:" in full capitals?
 *   4. Prominence    — is the header bold, and the whole thing legibly sized?
 *
 * The wording check produces a word-level diff rather than a boolean, because
 * "this is wrong" is useless to an agent who has to write a rejection letter.
 * "The word 'may' was replaced by 'might'" is actionable.
 */

import type { DiffSegment, WarningReading } from "./types";

/**
 * The mandatory statement, verbatim, as prescribed by 27 CFR 16.21.
 *
 * Cross-checked against the eCFR — see docs/REGULATORY-NOTES.md. Treat this
 * constant as legislation, not as code: do not "tidy" the punctuation, do not
 * change the spacing, do not reflow it. A single altered character silently
 * changes what this product enforces.
 */
export const STATUTORY_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not " +
  "drink alcoholic beverages during pregnancy because of the risk of birth " +
  "defects. (2) Consumption of alcoholic beverages impairs your ability to " +
  "drive a car or operate machinery, and may cause health problems.";

/** The header that must appear in full capitals, per 16.21. */
export const WARNING_HEADER = "GOVERNMENT WARNING:";

/**
 * Split into comparable words.
 *
 * Case and typographic variation are folded here because they are assessed by
 * dedicated checks; mixing them into the wording diff would report the same
 * defect twice and bury the substantive change. Punctuation is kept attached
 * to its word so a missing full stop or a dropped "(2)" is visible in the diff.
 */
function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

/**
 * Word-level diff via longest common subsequence.
 *
 * The warning is ~50 words, so the O(n*m) table is trivially small and an exact
 * LCS is affordable. An approximate diff would be the wrong trade here: this
 * output is the evidence an agent acts on.
 */
export function diffWords(expected: string, actual: string): DiffSegment[] {
  const a = words(expected);
  const b = words(actual);

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (op: DiffSegment["op"], text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.op === op) last.text += " " + text;
    else segments.push({ op, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("delete", a[i]); // present in the statute, absent from the label
      i++;
    } else {
      push("insert", b[j]); // present on the label, not in the statute
      j++;
    }
  }
  while (i < a.length) push("delete", a[i++]);
  while (j < b.length) push("insert", b[j++]);

  return segments;
}

export interface WarningAssessment {
  /** True when the wording is word-for-word correct (ignoring case and spacing). */
  wordingExact: boolean;
  /** Word-level diff against the statute; empty of edits when exact. */
  diff: DiffSegment[];
  /** Count of words on the label that are not in the statute. */
  insertions: number;
  /** Count of statutory words missing from the label. */
  deletions: number;
  /** Is "GOVERNMENT WARNING:" rendered in full capitals? */
  headerAllCaps: boolean;
  /** Is the header bold, as required for prominence? */
  headerBold: boolean;
  /** Is the statement legibly sized rather than shrunk to hide it? */
  legibleSize: boolean;
  /** Every defect found, phrased for a compliance agent. */
  problems: string[];
}

/**
 * Assess a warning as read from a label.
 *
 * Takes the `WarningReading` rather than a bare string because capitalisation
 * and boldness are visual properties the transcription alone cannot carry — the
 * reader has to report them explicitly, and this function will not guess.
 */
export function assessWarning(reading: WarningReading): WarningAssessment {
  const diff = diffWords(STATUTORY_WARNING, reading.text);
  const insertions = diff
    .filter((segment) => segment.op === "insert")
    .reduce((total, segment) => total + segment.text.split(" ").length, 0);
  const deletions = diff
    .filter((segment) => segment.op === "delete")
    .reduce((total, segment) => total + segment.text.split(" ").length, 0);

  const wordingExact = insertions === 0 && deletions === 0;
  const problems: string[] = [];

  if (!wordingExact) {
    const parts: string[] = [];
    if (deletions > 0) parts.push(`${deletions} word${deletions === 1 ? "" : "s"} missing`);
    if (insertions > 0) parts.push(`${insertions} word${insertions === 1 ? "" : "s"} added or altered`);
    problems.push(
      `Warning text does not match the statutory wording (${parts.join(", ")}).`,
    );
  }

  /*
   * Belt and braces: trust the reader's flag, but also check the transcription
   * directly. If the label really does read "GOVERNMENT WARNING:" the verbatim
   * text will contain it in capitals, whatever the flag says.
   *
   * Whitespace is flattened first. On a real bottle the heading frequently
   * wraps — "GOVERNMENT" on one line, "WARNING:" on the next — and a raw
   * substring test rejects that compliant label while its sibling wording check
   * passes the identical string, so the report contradicted itself. Non-breaking
   * and full-width spaces fold here too.
   */
  const flattened = reading.text.normalize("NFKC").replace(/\s+/g, " ");
  const headerAllCaps = reading.headerIsAllCaps && flattened.includes(WARNING_HEADER);
  if (!headerAllCaps) {
    problems.push(
      'The heading "GOVERNMENT WARNING:" must appear in capital letters.',
    );
  }

  if (!reading.headerIsBold) {
    problems.push('The heading "GOVERNMENT WARNING:" must appear in bold type.');
  }

  if (!reading.legibleSize) {
    problems.push(
      "The warning appears too small or too low-contrast to be readily legible.",
    );
  }

  return {
    wordingExact,
    diff,
    insertions,
    deletions,
    headerAllCaps,
    headerBold: reading.headerIsBold,
    legibleSize: reading.legibleSize,
    problems,
  };
}
