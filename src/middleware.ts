/**
 * Edge middleware: per-IP rate limit on the expensive `/api/chat` endpoint.
 *
 * Runs before the route function, so a limited request never spins up the
 * (paid) LLM pipeline. When Upstash isn't configured (`getRateLimiter` returns
 * null — dev/test/preview) every request passes through untouched.
 *
 * Fail-open: rate limiting is best-effort protection, not a correctness gate. If
 * the counter store is unreachable (an Upstash outage, or the brief window while
 * a rotated token is being re-synced), we let the request through rather than
 * take the chat endpoint offline with a 500.
 */
import { NextRequest, NextResponse } from "next/server";
import { clientIpFromHeaders, getRateLimiter } from "@/lib/ratelimit";
import { content } from "@/lib/content";

const STATUS_TOO_MANY_REQUESTS = 429;

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const limiter = getRateLimiter();
  if (limiter === null) return NextResponse.next();

  let success: boolean;
  try {
    ({ success } = await limiter.limit(clientIpFromHeaders(request.headers)));
  } catch {
    // Store unreachable — fail open (allow) instead of 500-ing the endpoint.
    return NextResponse.next();
  }
  if (success) return NextResponse.next();

  return NextResponse.json(
    { error: content.ui.errorRateLimit },
    { status: STATUS_TOO_MANY_REQUESTS }
  );
}

/** Only guard the chat endpoint; everything else is static or cheap. */
export const config = { matcher: "/api/chat" };
