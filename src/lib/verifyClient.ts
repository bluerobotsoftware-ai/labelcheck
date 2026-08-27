/**
 * Browser-side client for POST /api/verify.
 *
 * Shared by the single-label and batch screens so both get identical retry and
 * error behaviour. Two problems this exists to solve:
 *
 *   1. Both screens called `response.json()` unconditionally. A response that
 *      is not JSON — a proxy's HTML error page, a gateway timeout, an empty
 *      502 — threw inside the try block and every one of them was reported to
 *      the agent as "check your connection", which is both wrong and useless.
 *
 *   2. A batch run has no business giving up the moment it is rate limited.
 *      429 is a "wait" signal, not a failure, and the server tells us how long.
 */

import type { Application, VerificationReport } from "./ttb/types";

export interface VerifySuccess {
  ok: true;
  report: VerificationReport;
  isDemoReader: boolean;
}

export interface VerifyFailure {
  ok: false;
  message: string;
  retryable: boolean;
}

export type VerifyOutcome = VerifySuccess | VerifyFailure;

/** How many times to wait out a 429 before giving up on one label. */
const MAX_RATE_LIMIT_RETRIES = 4;

/** Ceiling on a single backoff wait, so a run cannot stall indefinitely. */
const MAX_BACKOFF_MS = 15_000;

export async function verifyLabel(
  image: File,
  application: Application,
  options: { signal?: AbortSignal } = {},
): Promise<VerifyOutcome> {
  for (let attempt = 0; ; attempt++) {
    const body = new FormData();
    body.append("image", image);
    body.append("application", JSON.stringify(application));

    let response: Response;
    try {
      response = await fetch("/api/verify", {
        method: "POST",
        body,
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, message: "Cancelled.", retryable: false };
      }
      return {
        ok: false,
        message: "Could not reach the server. Check your connection and try again.",
        retryable: true,
      };
    }

    // Rate limited: wait for as long as the server asked, then try again.
    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, MAX_BACKOFF_MS)
        // No header: exponential backoff with a little jitter, so a batch's
        // parallel workers do not all retry on the same tick.
        : Math.min(500 * 2 ** attempt + Math.random() * 250, MAX_BACKOFF_MS);
      await sleep(wait, options.signal);
      continue;
    }

    const payload = await readJson(response);

    if (!response.ok) {
      return {
        ok: false,
        message:
          payload?.message ??
          `The server returned an error (${response.status}). Please try again.`,
        retryable: payload?.retryable ?? response.status >= 500,
      };
    }

    if (!payload?.report) {
      return {
        ok: false,
        message: "The server returned an unexpected response. Please try again.",
        retryable: true,
      };
    }

    return {
      ok: true,
      report: payload.report as VerificationReport,
      isDemoReader: Boolean(payload.isDemoReader),
    };
  }
}

/** Parse a JSON body, returning null rather than throwing on anything else. */
async function readJson(
  response: Response,
): Promise<{ message?: string; retryable?: boolean; report?: unknown; isDemoReader?: boolean } | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
