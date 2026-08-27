/**
 * Similarity scoring for the "close, but a human should look" tier.
 *
 * The normalisation ladder answers "are these the same?". This module answers
 * "how far apart are they?", which is what separates a typo an agent should
 * glance at from a genuinely different product that should be rejected.
 *
 * Nothing here decides anything on its own. It produces a number; `rules.ts`
 * owns the thresholds, so the policy lives in one auditable place.
 */

/**
 * Levenshtein edit distance, iterative with two rows.
 *
 * O(n*m) time, O(min(n,m)) space. Label fields are short — brand names,
 * class/type designations — so this never approaches a performance concern.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Iterate over the shorter string to keep the row small.
  if (a.length > b.length) [a, b] = [b, a];

  let previous = Array.from({ length: a.length + 1 }, (_, i) => i);
  let current = new Array<number>(a.length + 1);

  for (let j = 1; j <= b.length; j++) {
    current[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[i] = Math.min(
        current[i - 1] + 1, // insertion
        previous[i] + 1, // deletion
        previous[i - 1] + substitutionCost, // substitution
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[a.length];
}

/**
 * Edit distance expressed as a 0-1 similarity, normalised by the longer string.
 * 1 means identical; 0 means nothing in common.
 */
export function editSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Jaccard similarity over token sets: |intersection| / |union|.
 *
 * Complements edit distance because it is insensitive to word order and to
 * long shared prefixes. "Kentucky Straight Bourbon Whiskey" vs "Straight
 * Bourbon Whiskey, Kentucky" scores poorly on edit distance and perfectly
 * here — which is the correct reading for a class/type designation.
 */
export function tokenSetSimilarity(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 && bTokens.length === 0) return 1;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Does `haystack` contain every token of `needle`, in any order?
 *
 * Labels carry more text than applications do. An application's bottler field
 * might read "Old Tom Distillery" while the label prints "BOTTLED BY OLD TOM
 * DISTILLERY, BARDSTOWN, KENTUCKY". The application's value being wholly
 * present is a satisfied requirement, not a mismatch.
 */
export function containsAllTokens(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  const pool = new Set(haystack);
  return needle.every((token) => pool.has(token));
}

/**
 * Combined score used for the review tier: the more generous of edit
 * similarity and token-set similarity.
 *
 * Taking the maximum is deliberate. The two measures fail on different shapes
 * of difference, so a low score from both is far stronger evidence of a real
 * mismatch than a low score from either alone.
 */
export function combinedSimilarity(
  a: string,
  b: string,
  aTokens: string[],
  bTokens: string[],
): number {
  return Math.max(editSimilarity(a, b), tokenSetSimilarity(aTokens, bTokens));
}
