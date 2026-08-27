/**
 * POST /api/verify — read one label and check it against one application.
 *
 * The route is deliberately thin. It validates input, picks a reader, and hands
 * the extraction to the rules engine; it contains no compliance logic of its
 * own. Everything that decides an outcome lives in src/lib/ttb, where it is
 * unit-tested without a network.
 *
 * The API key stays on the server. That is the reason this is a server route at
 * all rather than a browser fetch straight to the provider.
 */

import { NextResponse } from "next/server";
import { selectReader } from "@/lib/reader";
import { isReaderError } from "@/lib/reader/types";
import { verify } from "@/lib/ttb/rules";
import type { Application, BeverageType, LabelExtraction } from "@/lib/ttb/types";
import { measureWarningContrast } from "@/lib/ttb/pixelContrast";
import { clientKey, rateLimit } from "@/lib/ratelimit";

/** Node runtime: the Anthropic SDK and Buffer are not available on the edge. */
export const runtime = "nodejs";

/**
 * Upload ceiling.
 *
 * The client downscales before sending, so anything approaching this is either
 * a raw camera file that slipped through or an attempt to exhaust the server.
 * Rejecting early costs nothing; sending a 12 MB image to a vision model costs
 * both money and the latency budget.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const BEVERAGE_TYPES = new Set<BeverageType>([
  "distilled_spirits",
  "wine",
  "malt_beverage",
]);

/**
 * Per-IP budget.
 *
 * Sized against the batch feature: a 300-label run at concurrency 4 must not
 * throttle itself. An earlier limit of 60/minute meant a single office IP
 * submitting 300 labels got 60 processed and 240 permanently failed — the
 * headline feature defeated by its own protection.
 */
const RATE_LIMIT = { limit: 400, windowMs: 60_000 };

/**
 * Maximum length of any single application field.
 *
 * Nothing here bounded input, and `brandName` flows into `levenshtein`, which
 * is O(n·m). A single unauthenticated request carrying multi-megabyte strings
 * held the Node event loop for over five seconds and returned a 40 MB response
 * — and because the runtime is single-threaded, that blocks every other user of
 * the instance, not just the caller. The longest field a real COLA carries is a
 * bottler line of perhaps 120 characters.
 */
const MAX_FIELD_LENGTH = 300;

/** Ceiling on the serialised application, checked before JSON.parse. */
const MAX_APPLICATION_BYTES = 8 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const limit = rateLimit(clientKey(request.headers), RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Too many labels submitted at once. Try again in ${limit.retryAfterSeconds} seconds.`,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("The upload could not be read. Please try again.");
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return badRequest("No label image was included with this request.");
  }
  if (file.size === 0) {
    return badRequest("The uploaded file is empty.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return badRequest(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB — please use a smaller photograph.`,
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return badRequest(
      `${file.type || "That file type"} cannot be read. Please upload a JPEG, PNG, GIF or WebP image.`,
    );
  }

  const applicationRaw = form.get("application");
  if (typeof applicationRaw !== "string") {
    return badRequest("No application data was included with this request.");
  }
  // Bound before parsing: a huge string is cheap to send and expensive to parse.
  if (applicationRaw.length > MAX_APPLICATION_BYTES) {
    return badRequest("The application data is too large. Check the values entered.");
  }

  let application: Application;
  try {
    application = parseApplication(JSON.parse(applicationRaw));
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "The application data was not valid.",
    );
  }

  const requestedReader = form.get("reader");
  const reader = selectReader(
    typeof requestedReader === "string" && requestedReader ? requestedReader : undefined,
  );

  try {
    const image = Buffer.from(await file.arrayBuffer());

    /*
     * Confirm the bytes are the image they claim to be.
     *
     * `file.type` is supplied by the client and was trusted on declaration
     * alone, so any payload renamed to .png was forwarded to the vision model
     * and billed to the operator's key. The magic-number check costs eight
     * bytes of comparison and closes that.
     */
    const actualType = sniffImageType(image);
    if (!actualType) {
      return badRequest(
        "That file is not a readable image. Please upload a JPEG, PNG, GIF or WebP photograph of the label.",
      );
    }

    const result = await reader.read({ image, mimeType: actualType });

    /*
     * Measure the warning's contrast from the actual pixels before the rules
     * run.
     *
     * The reader is asked only WHERE the warning is. Asking it for the two
     * colours and computing the ratio from those worked until the same image
     * was submitted four times and produced approve, reject, reject, approve —
     * it samples a slightly different pixel each run, and near a threshold that
     * flips the verdict. The rules engine is deterministic and says so; feeding
     * it a coin flip made that promise false.
     */
    const extraction = await withMeasuredContrast(result.extraction, image);

    const report = verify(application, extraction, {
      extractionMs: result.elapsedMs,
      reader: result.reader,
    });

    return NextResponse.json({
      report,
      // Surfaced so the UI can warn loudly when fixed demo data is standing in
      // for a real reading of the uploaded image.
      readerId: reader.id,
      isDemoReader: reader.id === "mock",
      usage: result.usage,
    });
  } catch (error) {
    if (isReaderError(error)) {
      return NextResponse.json(
        {
          error: "reader_failed",
          message: error.options.userMessage,
          retryable: error.options.retryable,
        },
        { status: error.options.retryable ? 503 : 500 },
      );
    }
    console.error("Unexpected verification failure:", error);
    return NextResponse.json(
      {
        error: "internal_error",
        message: "Something went wrong while checking this label. Please try again.",
        retryable: true,
      },
      { status: 500 },
    );
  }
}

/**
 * Validate the application payload.
 *
 * Hand-written rather than schema-generated so the error messages read like
 * something a compliance agent would understand: this text is shown in the UI.
 */
function parseApplication(raw: unknown): Application {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("The application data was not valid.");
  }
  const input = raw as Record<string, unknown>;

  const beverageType = input.beverageType;
  if (typeof beverageType !== "string" || !BEVERAGE_TYPES.has(beverageType as BeverageType)) {
    throw new Error("Choose a beverage type: distilled spirits, wine or malt beverage.");
  }

  const brandName = text(input.brandName, "Brand name");
  if (!brandName) throw new Error("Enter the brand name from the application.");

  const classType = text(input.classType, "Class or type");
  if (!classType) throw new Error("Enter the class or type designation from the application.");

  return {
    applicationId: text(input.applicationId, "Application reference"),
    beverageType: beverageType as BeverageType,
    brandName,
    classType,
    alcoholContent: text(input.alcoholContent, "Alcohol content"),
    netContents: text(input.netContents, "Net contents"),
    bottlerName: text(input.bottlerName, "Bottler name"),
    labelCompanyName: text(input.labelCompanyName, "Trade name"),
    countryOfOrigin: text(input.countryOfOrigin, "Country of origin"),
    isImport: input.isImport === true,
  };
}

/**
 * Trim a value to a bounded string, or undefined when it carries nothing.
 *
 * The length check rejects rather than truncates. Silently shortening an
 * application field would mean comparing the label against something the
 * applicant did not file, and reporting the result as authoritative.
 */
function text(value: unknown, fieldName: string): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length > MAX_FIELD_LENGTH) {
    throw new Error(
      `${fieldName} is too long (${value.length} characters; the limit is ${MAX_FIELD_LENGTH}).`,
    );
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Attach a pixel-measured contrast ratio to the warning, where possible.
 *
 * Returns the extraction unchanged when there is no warning, no bounds, or the
 * region cannot be measured. Absence of a measurement must never read as a
 * pass: `rules.ts` simply falls back to the checks that do not depend on it.
 */
async function withMeasuredContrast(
  extraction: LabelExtraction,
  image: Buffer,
): Promise<LabelExtraction> {
  const warning = extraction.governmentWarning;
  if (!warning?.bounds) return extraction;

  const measured = await measureWarningContrast(image, warning.bounds);
  if (!measured) return extraction;

  return {
    ...extraction,
    governmentWarning: {
      ...warning,
      appearance: {
        measuredContrast: measured.contrast,
        textColorHex: measured.darkerHex,
        backgroundColorHex: measured.lighterHex,
      },
    },
  };
}

/**
 * Identify an image from its leading bytes.
 *
 * Returns the true media type, or null when the bytes are not one of the four
 * formats the readers accept. Deliberately returns the SNIFFED type rather than
 * the declared one, so what reaches the provider is what the file actually is.
 */
function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: "GIF87a" or "GIF89a"
  if (bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a") {
    return "image/gif";
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: "bad_request", message }, { status: 400 });
}
