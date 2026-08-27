/**
 * The reader seam.
 *
 * TTB's IT administrator told us their firewall blocked the last vendor's ML
 * endpoints and half that pilot's features silently stopped working. The right
 * answer to that is not to pick a different vendor — it is to make the vendor a
 * detail. Everything above this interface is provider-agnostic; everything
 * provider-specific lives in one file behind it.
 *
 * Consequences that matter:
 *   - The rules engine, the API route and the UI never import a vendor SDK.
 *   - The test suite runs against a deterministic reader, so the entire
 *     decision layer is verifiable with no network and no API key.
 *   - An on-premises deployment inside a restricted network swaps one file.
 */

import type { LabelExtraction } from "../ttb/types";

export interface ReadRequest {
  /** Raw image bytes. */
  image: Buffer | Uint8Array;
  /** MIME type, e.g. "image/png". */
  mimeType: string;
}

export interface ReadResult {
  extraction: LabelExtraction;
  /** Milliseconds spent inside the reader, measured by the reader itself. */
  elapsedMs: number;
  /** Identifies the implementation and model, e.g. "anthropic:claude-opus-5". */
  reader: string;
  /**
   * Token usage where the provider reports it, for cost and latency visibility.
   *
   * `thinkingTokens` earns its place: reasoning is invisible in the output yet
   * dominates response time, so when a transcription call is unexpectedly slow
   * this number answers "is the model thinking, or is it the network?" without
   * guesswork. On this task it should be small.
   */
  usage?: { inputTokens?: number; outputTokens?: number; thinkingTokens?: number };
}

export interface LabelReader {
  /** Stable identifier, e.g. "anthropic". Used for logging and the UI selector. */
  readonly id: string;
  /** Name shown to an agent in the reader selector. */
  readonly displayName: string;
  /** False when the implementation reaches outside the local network. */
  readonly isOffline: boolean;
  /** True when the implementation has what it needs to run (e.g. a key). */
  isAvailable(): boolean;
  read(request: ReadRequest): Promise<ReadResult>;
}

/**
 * Raised when a reader cannot complete. Carries a message written for a
 * compliance agent rather than a developer, because it is surfaced in the UI.
 */
export class ReaderError extends Error {
  /**
   * Discriminant, checked by `isReaderError` instead of `instanceof`.
   *
   * A bundler that loads this module twice — via a barrel re-export and via a
   * direct import — produces two distinct class identities, and `instanceof`
   * then silently returns false for a perfectly good ReaderError. That is not
   * hypothetical: it swallowed a "this model is no longer available" 404 and
   * reported it to the operator as "usually a network or firewall problem",
   * sending them to debug a firewall over a one-word config change. A property
   * check cannot fail that way.
   */
  readonly isReaderError = true as const;

  constructor(
    message: string,
    readonly options: {
      /** Safe to show to an end user. */
      userMessage: string;
      /** True when retrying the same request might succeed. */
      retryable: boolean;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "ReaderError";
  }
}

/** Identity check that survives duplicate module instances. */
export function isReaderError(error: unknown): error is ReaderError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as ReaderError).isReaderError === true
  );
}
