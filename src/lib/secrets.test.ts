import { describe, it, expect } from "vitest";
import { resolveSecret, readKeychain } from "./secrets";

const NAME = "TEST_SECRET_NAME";

describe("resolveSecret", () => {
  it("prefers the environment variable when set (never consulting the Keychain)", () => {
    const keychain = () => "from-keychain";
    expect(resolveSecret(NAME, { env: { [NAME]: "from-env" }, keychain })).toBe("from-env");
  });

  it("trims surrounding whitespace from the env value", () => {
    expect(resolveSecret(NAME, { env: { [NAME]: "  spaced  " }, keychain: () => "" })).toBe("spaced");
  });

  it("falls back to the Keychain under the login account ($USER) when env is unset", () => {
    const calls: Array<{ service: string; account?: string }> = [];
    const keychain = (service: string, account?: string) => {
      calls.push({ service, account });
      return account === "alice" ? "acct-secret" : "";
    };
    expect(resolveSecret(NAME, { env: { USER: "alice" }, keychain })).toBe("acct-secret");
    expect(calls[0]).toEqual({ service: NAME, account: "alice" });
  });

  it("falls back to an account-less Keychain lookup when the account lookup misses", () => {
    const keychain = (_service: string, account?: string) => (account ? "" : "no-acct-secret");
    expect(resolveSecret(NAME, { env: { USER: "bob" }, keychain })).toBe("no-acct-secret");
  });

  it("returns an empty string when the secret is found nowhere", () => {
    expect(resolveSecret(NAME, { env: {}, keychain: () => "" })).toBe("");
  });
});

describe("readKeychain", () => {
  it("returns an empty string for a nonexistent service (and off-macOS, where `security` is absent)", () => {
    expect(readKeychain("college-list-builder-nonexistent-service-xyz")).toBe("");
  });
});
