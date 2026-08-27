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

/**
 * Hard ceiling on tracked keys.
 *
 * The sweep only removes EXPIRED entries, so an attacker rotating a key value
 * every request grew the map without bound inside a single window and then paid
 * for a full O(n) scan on every subsequent request — the cleanup itself became
 * the amplification. Past this ceiling the oldest entries are evicted outright.
 */
const MAX_TRACKED_KEYS = 10_000;

/** Discard expired entries so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }

  // If everything is still live, evict oldest-first. Map preserves insertion
  // order, so the first entries are the ones closest to expiring anyway.
  if (windows.size > MAX_TRACKED_KEYS) {
    const excess = windows.size - MAX_TRACKED_KEYS;
    let removed = 0;
    for (const key of windows.keys()) {
      windows.delete(key);
      if (++removed >= excess) break;
    }
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

  // Sweep BEFORE inserting, so a rotating-key flood cannot outrun the cleanup.
  if (windows.size >= MAX_TRACKED_KEYS) sweep(now);

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
 * Header order matters and is the whole point of this function.
 *
 * The first version read the LEFTMOST entry of `x-forwarded-for`, which is
 * whatever the client typed. Rotating that value defeated the limiter
 * completely — 300 requests, zero rejections. A client-supplied header cannot
 * be an identity.
 *
 * So: prefer headers the platform sets and the client cannot forge, and when
 * falling back to `x-forwarded-for` take the RIGHTMOST entry — the address the
 * nearest trusted proxy observed, which is the last hop a client cannot append
 * past. Still imperfect behind an unknown proxy chain, and still a speed bump
 * rather than a security control; see the README's limitations.
 */
export function clientKey(headers: Headers): string {
  // Set by Vercel's edge, stripped from any client-supplied value.
  const platform =
    headers.get("x-vercel-forwarded-for") ?? headers.get("cf-connecting-ip");
  if (platform) return platform.trim();

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return "unknown";
}
