import { describe, it, expect } from "vitest";
import { clientIpFromHeaders, getRateLimiter } from "./ratelimit";

describe("clientIpFromHeaders", () => {
  it("returns the first hop of the x-forwarded-for chain", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIpFromHeaders(headers)).toBe("1.2.3.4");
  });

  it("trims whitespace around the ip", () => {
    const headers = new Headers({ "x-forwarded-for": "  9.9.9.9  " });
    expect(clientIpFromHeaders(headers)).toBe("9.9.9.9");
  });

  it("falls back to anon when the header is absent", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("anon");
  });

  it("falls back to anon when the header is empty", () => {
    const headers = new Headers({ "x-forwarded-for": "" });
    expect(clientIpFromHeaders(headers)).toBe("anon");
  });
});

describe("getRateLimiter", () => {
  it("returns null when both Upstash env vars are absent (limiting disabled)", () => {
    expect(getRateLimiter({})).toBeNull();
  });

  it("returns null when only the url is present", () => {
    expect(getRateLimiter({ UPSTASH_REDIS_REST_URL: "https://example.upstash.io" })).toBeNull();
  });

  it("returns null when only the token is present", () => {
    expect(getRateLimiter({ UPSTASH_REDIS_REST_TOKEN: "token" })).toBeNull();
  });
});
