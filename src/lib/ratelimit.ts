/**
 * In-memory fixed-window rate limiter.
 *
 * This prototype is deployed publicly so Treasury reviewers can test it without
 * credentials. That also means anyone who finds the URL can spend the operator's
 * API budget, so some limit is not optional.
 *
 * Deliberately in-memory and deliberately simple. On serverless the counter
 * resets whenever an instance is recycled and is not shared between concurrent
 * instances, so this is a speed bump against casual abuse, not a security
 * control. A production deployment would move the counter to Redis or to the
 * platform's edge middleware — noted in the README's limitations, because
 * pretending a Map is a rate limiter would be worse than saying what it is.
 */

interface Window {
  count: number;
  /** Epoch milliseconds at which this window expires. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Discard expired entries so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();

  // Cheap amortised cleanup; the map only ever holds active windows.
  if (windows.size > 1000) sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds,
  };
}

/**
 * Best-effort client identity.
 *
 * Behind Vercel's proxy the client address is in x-forwarded-for; the first
 * entry is the original client. Spoofable, which is another reason this is a
 * speed bump rather than a control.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
