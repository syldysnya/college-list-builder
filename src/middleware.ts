/**
 * Edge middleware: per-IP rate limit on the expensive `/api/chat` endpoint.
 *
 * Runs before the route function, so a limited request never spins up the
 * (paid) LLM pipeline. When Upstash isn't configured (`getRateLimiter` returns
 * null — dev/test/preview) every request passes through untouched.
 */
import { NextRequest, NextResponse } from "next/server";
import { clientIpFromHeaders, getRateLimiter } from "@/lib/ratelimit";
import { content } from "@/lib/content";

const STATUS_TOO_MANY_REQUESTS = 429;

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const limiter = getRateLimiter();
  if (limiter === null) return NextResponse.next();

  const { success } = await limiter.limit(clientIpFromHeaders(request.headers));
  if (success) return NextResponse.next();

  return NextResponse.json(
    { error: content.ui.errorRateLimit },
    { status: STATUS_TOO_MANY_REQUESTS }
  );
}

/** Only guard the chat endpoint; everything else is static or cheap. */
export const config = { matcher: "/api/chat" };
