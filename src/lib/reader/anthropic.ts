/**
 * Claude vision reader.
 *
 * Latency is the governing constraint here, not accuracy. TTB abandoned a
 * previous vendor because it took 30-40 seconds per label; their stated bar is
 * "about 5 seconds". Three decisions follow from that and are marked below:
 * low effort, a compact schema, and a caller-side image downscale.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { LabelExtraction } from "../ttb/types";
import { EXTRACTION_PROMPT, labelExtractionSchema } from "./schema";
import { isReaderError, ReaderError, type LabelReader, type ReadRequest, type ReadResult } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

/** MIME types the vision endpoint accepts. */
const SUPPORTED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export class AnthropicReader implements LabelReader {
  readonly id = "anthropic";
  readonly displayName = "Claude (Anthropic)";
  readonly isOffline = false;

  private client: Anthropic | null = null;

  isAvailable(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new ReaderError("ANTHROPIC_API_KEY is not set", {
          userMessage:
            "The label reader is not configured on this server. Set ANTHROPIC_API_KEY and restart.",
          retryable: false,
        });
      }
      // 20s ceiling: well past our 5s target, but short enough that a hung
      // request surfaces as an error the agent can act on rather than a spinner.
      this.client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
    }
    return this.client;
  }

  async read({ image, mimeType }: ReadRequest): Promise<ReadResult> {
    if (!SUPPORTED.has(mimeType)) {
      throw new ReaderError(`Unsupported media type: ${mimeType}`, {
        userMessage: `${mimeType} images cannot be read. Please upload a JPEG, PNG, GIF or WebP.`,
        retryable: false,
      });
    }

    const client = this.getClient();
    const started = Date.now();

    try {
      const response = await client.messages.parse({
        model: MODEL,
        // Generous enough for a full warning transcription plus notes, small
        // enough that a runaway generation cannot stall the request.
        max_tokens: 2048,
        output_config: {
          format: zodOutputFormat(labelExtractionSchema),
          // Transcription is perception, not reasoning. Low effort keeps us
          // inside the latency budget; raising it measurably slows the call
          // without improving what the model reads off the page.
          effort: "low",
        },
        system: EXTRACTION_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType as "image/png",
                  data: Buffer.from(image).toString("base64"),
                },
              },
              {
                type: "text",
                text: "Transcribe this label according to your instructions.",
              },
            ],
          },
        ],
      });

      const parsed = response.parsed_output;
      if (!parsed) {
        throw new ReaderError("Model returned no parseable output", {
          userMessage:
            "The label could not be read. Please try again, or upload a clearer image.",
          retryable: true,
        });
      }

      return {
        extraction: parsed as LabelExtraction,
        elapsedMs: Date.now() - started,
        reader: `anthropic:${MODEL}`,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
        },
      };
    } catch (error) {
      if (isReaderError(error)) throw error;
      throw translate(error);
    }
  }
}

/**
 * Turn SDK errors into messages a compliance agent can act on.
 *
 * Deliberately specific: "add credit to your account" and "try again in a
 * moment" call for different responses, and collapsing both into "an error
 * occurred" wastes the agent's time.
 */
function translate(error: unknown): ReaderError {
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    if (status === 401 || status === 403) {
      return new ReaderError(`Authentication failed (${status})`, {
        userMessage:
          "The label reader's API key was rejected. Check the key configured on this server.",
        retryable: false,
        cause: error,
      });
    }
    if (status === 429) {
      return new ReaderError("Rate limited", {
        userMessage:
          "The label reader is temporarily rate limited. Wait a few seconds and try again.",
        retryable: true,
        cause: error,
      });
    }
    if (status === 400 && /credit|billing/i.test(error.message)) {
      return new ReaderError("Insufficient credit", {
        userMessage:
          "The label reader's account has no remaining credit. Top up the account to continue.",
        retryable: false,
        cause: error,
      });
    }
    if (status !== undefined && status >= 500) {
      return new ReaderError(`Upstream error (${status})`, {
        userMessage:
          "The label reader is temporarily unavailable. Please try again in a moment.",
        retryable: true,
        cause: error,
      });
    }
  }

  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ReaderError("Request timed out", {
      userMessage:
        "Reading the label took too long and was stopped. Try again, or use a smaller image.",
      retryable: true,
      cause: error,
    });
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return new ReaderError("Connection failed", {
      userMessage:
        "Could not reach the label reader. This is usually a network or firewall problem.",
      retryable: true,
      cause: error,
    });
  }

  return new ReaderError(
    error instanceof Error ? error.message : "Unknown reader failure",
    {
      userMessage: "The label could not be read. Please try again.",
      retryable: true,
      cause: error,
    },
  );
}
