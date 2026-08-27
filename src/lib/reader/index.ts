/**
 * Reader selection.
 *
 * Resolution order is by configuration, not by preference: whichever provider
 * the operator has supplied a key for is the one that runs. An explicit
 * LABEL_READER setting overrides the search entirely, which is how a restricted
 * deployment pins itself to a specific implementation.
 */

import { AnthropicReader } from "./anthropic";
import { GeminiReader } from "./gemini";
import { MockReader } from "./mock";
import type { LabelReader } from "./types";

export * from "./types";
export { AnthropicReader } from "./anthropic";
export { GeminiReader } from "./gemini";
export { MockReader, COMPLIANT_SPIRITS } from "./mock";

/**
 * Every implementation, in the order they are considered.
 *
 * Gemini leads because its free tier makes an unfunded pilot deployable; a
 * deployment with both keys present can pin the other with LABEL_READER.
 */
function allReaders(): LabelReader[] {
  return [new GeminiReader(), new AnthropicReader()];
}

/** Readers that could actually run right now, for the UI's selector. */
export function availableReaders(): LabelReader[] {
  return allReaders().filter((reader) => reader.isAvailable());
}

/**
 * The reader this request should use.
 *
 * Falls back to the demo reader when nothing is configured so the interface
 * remains explorable — but that reader announces itself, and callers must
 * surface `isOffline`/`id` rather than quietly presenting fixed data as a
 * reading of the uploaded image.
 */
export function selectReader(preferred?: string): LabelReader {
  const readers = allReaders();
  const requested = preferred ?? process.env.LABEL_READER;

  if (requested) {
    const match = readers.find((reader) => reader.id === requested);
    if (match?.isAvailable()) return match;
    if (requested === "mock") return new MockReader();
  }

  return readers.find((reader) => reader.isAvailable()) ?? new MockReader();
}

/** True when at least one real vision provider is configured. */
export function hasRealReader(): boolean {
  return availableReaders().length > 0;
}
