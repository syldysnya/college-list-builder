/**
 * Per-IP rate limiting for the expensive `/api/chat` endpoint.
 *
 * Serverless functions are ephemeral and distributed, so an in-memory counter
 * can't see requests across instances (each cold start is a blank slate). This
 * uses Upstash Redis — a shared, REST-based store that works in the edge
 * runtime — via a sliding-window limit.
 *
 * The limiter is OPTIONAL. When the Upstash env vars are absent (local dev,
 * tests, or a preview without them configured), `getRateLimiter` returns null
 * and the caller lets every request through; limiting only activates where the
 * two env vars are set (i.e. production).
 *
 * Env-only (no Keychain): middleware runs in the edge runtime, which cannot
 * shell out to `security`, so these are read straight from `process.env` rather
 * than through `resolveSecret`.
 *
 * Framework-free: no imports from Next/React.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/** Sliding window: at most `RATE_LIMIT_MAX` chat requests per IP per window. */
export const RATE_LIMIT_MAX = 15;
export const RATE_LIMIT_WINDOW = "1 h" as const;
/** Redis key namespace so this app's counters don't collide with others. */
const RATE_LIMIT_PREFIX = "college-list:chat";

/**
 * Where the Upstash REST credentials live, in preference order. Vercel's native
 * Upstash/KV integration provisions `KV_REST_API_*`; a hand-rolled Upstash setup
 * uses `UPSTASH_REDIS_REST_*`. We accept either so the limiter works with both
 * (named — no magic strings at the lookup site).
 */
const URL_ENV_VARS = ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"] as const;
const TOKEN_ENV_VARS = ["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"] as const;

/** First non-empty value among `names` in `env`, or "" when none is set. */
function firstEnv(env: Record<string, string | undefined>, names: readonly string[]): string {
  for (const name of names) {
    const value = (env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

/** Header Vercel sets with the client IP chain; the first hop is the client. */
const HEADER_FORWARDED_FOR = "x-forwarded-for";
const FORWARDED_FOR_SEPARATOR = ",";
/** Fallback bucket when no IP header is present. */
const ANON_IP = "anon";

/**
 * The client IP from the forwarded-for chain (first hop), or `ANON_IP` when the
 * header is missing or empty. Pure + header-injectable so it is unit-testable
 * without a live request.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get(HEADER_FORWARDED_FOR);
  if (!forwarded) return ANON_IP;
  const first = forwarded.split(FORWARDED_FOR_SEPARATOR)[0]?.trim();
  return first ? first : ANON_IP;
}

/** Built once per runtime; stays null until (and unless) both env vars exist. */
let limiter: Ratelimit | null = null;

/**
 * The shared limiter, or null when Upstash isn't configured (dev/test/preview).
 * A null return means "limiting disabled — allow the request". `env` is
 * injectable for tests; the real Redis connection always reads `process.env`.
 */
export function getRateLimiter(
  env: Record<string, string | undefined> = process.env
): Ratelimit | null {
  const url = firstEnv(env, URL_ENV_VARS);
  const token = firstEnv(env, TOKEN_ENV_VARS);
  if (!url || !token) return null;
  if (limiter === null) {
    limiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW),
      prefix: RATE_LIMIT_PREFIX,
    });
  }
  return limiter;
}
