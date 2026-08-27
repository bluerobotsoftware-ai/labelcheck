/**
 * Shared presentation of verdicts and recommendations.
 *
 * One source of truth for how an outcome looks, so a "fail" is identical
 * wherever it appears — a single check row, the summary banner, a batch table.
 *
 * Every verdict is carried by THREE signals: a colour, a shape, and a word.
 * Around one man in twelve has some form of colour vision deficiency, and this
 * is a tool where mistaking "reject" for "approve" has consequences that reach
 * an applicant. Colour alone is never load-bearing.
 */

import type { Recommendation, Verdict } from "@/lib/ttb/types";

export interface VerdictStyle {
  /** Shown next to the shape. Never omitted. */
  label: string;
  /** A distinct glyph per verdict, legible without colour. */
  glyph: string;
  text: string;
  background: string;
  border: string;
}

export const VERDICT_STYLES: Record<Verdict, VerdictStyle> = {
  pass: {
    label: "Matches",
    glyph: "✓",
    text: "text-[var(--color-pass)]",
    background: "bg-[var(--color-pass-bg)]",
    border: "border-[var(--color-pass)]",
  },
  review: {
    label: "Check by eye",
    glyph: "!",
    text: "text-[var(--color-review)]",
    background: "bg-[var(--color-review-bg)]",
    border: "border-[var(--color-review)]",
  },
  fail: {
    label: "Problem",
    glyph: "✕",
    text: "text-[var(--color-fail)]",
    background: "bg-[var(--color-fail-bg)]",
    border: "border-[var(--color-fail)]",
  },
  unreadable: {
    label: "Could not read",
    glyph: "?",
    text: "text-[var(--color-review)]",
    background: "bg-[var(--color-review-bg)]",
    border: "border-[var(--color-review)]",
  },
  not_applicable: {
    label: "Not required",
    glyph: "–",
    text: "text-[var(--color-muted)]",
    background: "bg-[var(--color-muted-bg)]",
    border: "border-[var(--color-line)]",
  },
};

export interface RecommendationStyle {
  /** Plain language, not jargon: an agent reads this first and acts on it. */
  title: string;
  glyph: string;
  text: string;
  background: string;
  border: string;
}

export const RECOMMENDATION_STYLES: Record<Recommendation, RecommendationStyle> = {
  approve: {
    title: "No problems found",
    glyph: "✓",
    text: "text-[var(--color-pass)]",
    background: "bg-[var(--color-pass-bg)]",
    border: "border-[var(--color-pass)]",
  },
  needs_review: {
    title: "Needs your eyes",
    glyph: "!",
    text: "text-[var(--color-review)]",
    background: "bg-[var(--color-review-bg)]",
    border: "border-[var(--color-review)]",
  },
  reject: {
    title: "Problems found",
    glyph: "✕",
    text: "text-[var(--color-fail)]",
    background: "bg-[var(--color-fail-bg)]",
    border: "border-[var(--color-fail)]",
  },
};

/** Small inline badge for use in tables and check rows. */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const style = VERDICT_STYLES[verdict];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[15px] font-semibold whitespace-nowrap ${style.background} ${style.text} ${style.border}`}
    >
      <span aria-hidden="true">{style.glyph}</span>
      {style.label}
    </span>
  );
}
