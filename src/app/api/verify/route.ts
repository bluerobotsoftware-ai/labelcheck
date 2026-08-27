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
import { ReaderError } from "@/lib/reader/types";
import { verify } from "@/lib/ttb/rules";
import type { Application, BeverageType } from "@/lib/ttb/types";
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

/** Per-IP budget. Generous for a reviewer, restrictive for a scraper. */
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

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
    const result = await reader.read({ image, mimeType: file.type });
    const report = verify(application, result.extraction, {
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
    if (error instanceof ReaderError) {
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

  const brandName = text(input.brandName);
  if (!brandName) throw new Error("Enter the brand name from the application.");

  const classType = text(input.classType);
  if (!classType) throw new Error("Enter the class or type designation from the application.");

  return {
    applicationId: text(input.applicationId),
    beverageType: beverageType as BeverageType,
    brandName,
    classType,
    alcoholContent: text(input.alcoholContent),
    netContents: text(input.netContents),
    bottlerName: text(input.bottlerName),
    countryOfOrigin: text(input.countryOfOrigin),
    isImport: input.isImport === true,
  };
}

/** Trim a value to a string, or undefined when it carries nothing. */
function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: "bad_request", message }, { status: 400 });
}
