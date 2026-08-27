/**
 * Google Gemini vision reader.
 *
 * Present for two reasons. First, its free tier means this prototype can be
 * deployed and evaluated at zero cost, which matters for a government pilot
 * that has no procurement vehicle behind it. Second, and more importantly, a
 * second working implementation is what proves the reader seam is real rather
 * than aspirational — an interface with one implementation is just indirection.
 *
 * Uses the REST endpoint directly rather than the Google SDK: one fewer
 * dependency, a smaller deployment, and the request shape stays visible in the
 * file where it can be reasoned about.
 */

import type { LabelExtraction } from "../ttb/types";
import { EXTRACTION_PROMPT, labelExtractionSchema } from "./schema";
import { ReaderError, type LabelReader, type ReadRequest, type ReadResult } from "./types";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Gemini's structured-output schema, written out by hand.
 *
 * Deliberately not generated from the Zod schema. Gemini accepts a restricted
 * OpenAPI subset with its own nullability convention, and a converter that
 * silently emits something Gemini merely tolerates would produce subtly
 * different extractions from the same prompt — exactly the divergence the
 * reader seam exists to prevent. Written by hand, any drift is a visible diff.
 */
const FIELD_READING = {
  type: "OBJECT",
  nullable: true,
  properties: {
    text: { type: "STRING" },
    confidence: { type: "NUMBER" },
  },
  required: ["text", "confidence"],
} as const;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    brandName: FIELD_READING,
    classType: FIELD_READING,
    alcoholContent: FIELD_READING,
    netContents: FIELD_READING,
    bottlerName: FIELD_READING,
    countryOfOrigin: FIELD_READING,
    governmentWarning: {
      type: "OBJECT",
      nullable: true,
      properties: {
        text: { type: "STRING" },
        confidence: { type: "NUMBER" },
        headerIsAllCaps: { type: "BOOLEAN" },
        headerIsBold: { type: "BOOLEAN" },
        legibleSize: { type: "BOOLEAN" },
      },
      required: ["text", "confidence", "headerIsAllCaps", "headerIsBold", "legibleSize"],
    },
    imageQuality: {
      type: "OBJECT",
      properties: {
        score: { type: "NUMBER" },
        issues: { type: "ARRAY", items: { type: "STRING" } },
        tooPoorToReview: { type: "BOOLEAN" },
      },
      required: ["score", "issues", "tooPoorToReview"],
    },
    notes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["imageQuality", "notes"],
} as const;

export class GeminiReader implements LabelReader {
  readonly id = "gemini";
  readonly displayName = "Gemini (Google)";
  readonly isOffline = false;

  isAvailable(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async read({ image, mimeType }: ReadRequest): Promise<ReadResult> {
    if (!SUPPORTED.has(mimeType)) {
      throw new ReaderError(`Unsupported media type: ${mimeType}`, {
        userMessage: `${mimeType} images cannot be read. Please upload a JPEG, PNG, GIF or WebP.`,
        retryable: false,
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ReaderError("GEMINI_API_KEY is not set", {
        userMessage:
          "The label reader is not configured on this server. Set GEMINI_API_KEY and restart.",
        retryable: false,
      });
    }

    const started = Date.now();

    // Abort rather than hang: a stalled request must surface as an actionable
    // error, not an indefinite spinner.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(
        `${ENDPOINT}/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: EXTRACTION_PROMPT }] },
            contents: [
              {
                parts: [
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: Buffer.from(image).toString("base64"),
                    },
                  },
                  { text: "Transcribe this label according to your instructions." },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
              // Transcription should be deterministic. Any creativity here is
              // the model inventing label text that is not on the bottle.
              temperature: 0,
              maxOutputTokens: 2048,
            },
          }),
        },
      );

      if (!response.ok) {
        throw translateHttp(response.status, await safeText(response));
      }

      const payload = (await response.json()) as GeminiResponse;
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new ReaderError("Gemini returned no content", {
          userMessage:
            "The label could not be read. Please try again, or upload a clearer image.",
          retryable: true,
        });
      }

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (cause) {
        throw new ReaderError("Gemini returned malformed JSON", {
          userMessage: "The label reader returned an unreadable response. Please try again.",
          retryable: true,
          cause,
        });
      }

      /*
       * Validate, do not cast.
       *
       * `as LabelExtraction` asserts a shape rather than checking one, and
       * Gemini's `required` is a strong hint rather than a guarantee. A response
       * with `governmentWarning.text: null` crashed the rules engine; other
       * shapes crashed the browser into a blank screen. The schema was already
       * written and already used by the sibling reader — the bug was not
       * applying it here.
       */
      const validated = labelExtractionSchema.safeParse(normalise(raw as Partial<LabelExtraction>));
      if (!validated.success) {
        throw new ReaderError(
          `Gemini response failed validation: ${validated.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}`,
          {
            userMessage:
              "The label reader returned an unexpected response. Please try again, or upload a clearer image.",
            retryable: true,
          },
        );
      }

      return {
        extraction: validated.data as LabelExtraction,
        elapsedMs: Date.now() - started,
        reader: `gemini:${MODEL}`,
        usage: {
          inputTokens: payload.usageMetadata?.promptTokenCount,
          outputTokens: payload.usageMetadata?.candidatesTokenCount,
        },
      };
    } catch (error) {
      if (error instanceof ReaderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ReaderError("Request timed out", {
          userMessage:
            "Reading the label took too long and was stopped. Try again, or use a smaller image.",
          retryable: true,
          cause: error,
        });
      }
      throw new ReaderError(
        error instanceof Error ? error.message : "Unknown reader failure",
        {
          userMessage:
            "Could not reach the label reader. This is usually a network or firewall problem.",
          retryable: true,
          cause: error,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Fill in anything the model omitted.
 *
 * `required` in Gemini's schema is a strong hint rather than a hard guarantee,
 * so the rules engine must never receive a half-built object. Missing optional
 * fields become explicit nulls; a missing quality block is treated as unknown
 * rather than as good, since assuming a clear image is the unsafe direction.
 */
function normalise(raw: Partial<LabelExtraction>): LabelExtraction {
  return {
    brandName: raw.brandName ?? null,
    classType: raw.classType ?? null,
    alcoholContent: raw.alcoholContent ?? null,
    netContents: raw.netContents ?? null,
    bottlerName: raw.bottlerName ?? null,
    countryOfOrigin: raw.countryOfOrigin ?? null,
    governmentWarning: raw.governmentWarning ?? null,
    imageQuality: raw.imageQuality ?? {
      score: 0.5,
      issues: ["The reader did not report image quality."],
      tooPoorToReview: false,
    },
    notes: raw.notes ?? [],
  };
}

function translateHttp(status: number, body: string): ReaderError {
  if (status === 400 && /API key not valid/i.test(body)) {
    return new ReaderError("Invalid API key", {
      userMessage:
        "The label reader's API key was rejected. Check the key configured on this server.",
      retryable: false,
    });
  }
  if (status === 403) {
    return new ReaderError("Forbidden", {
      userMessage:
        "The label reader's API key does not have access to this model. Check the key's permissions.",
      retryable: false,
    });
  }
  if (status === 404) {
    return new ReaderError(`Model ${MODEL} not found`, {
      userMessage: `The configured model "${MODEL}" is not available to this API key. Set GEMINI_MODEL to a model your account can use.`,
      retryable: false,
    });
  }
  if (status === 429) {
    return new ReaderError("Rate limited", {
      userMessage:
        "The label reader's free-tier quota is exhausted for the moment. Wait a minute and try again.",
      retryable: true,
    });
  }
  if (status >= 500) {
    return new ReaderError(`Upstream error (${status})`, {
      userMessage:
        "The label reader is temporarily unavailable. Please try again in a moment.",
      retryable: true,
    });
  }
  return new ReaderError(`HTTP ${status}: ${body.slice(0, 200)}`, {
    userMessage: "The label could not be read. Please try again.",
    retryable: true,
  });
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
