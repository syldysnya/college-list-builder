/**
 * Secret resolution: environment variable first, then the macOS login Keychain
 * (`security find-generic-password`). This mirrors the backend's env→Keychain
 * lookup so API keys live in the OS Keychain during local development — never in
 * a repo file an agent with filesystem access could read — while still falling
 * back to platform env vars in hosted environments (e.g. Vercel), which have no
 * Keychain.
 *
 * Store a key locally once with:
 *   security add-generic-password -a "$USER" -s <NAME> -w '<value>'
 * (add -U to update an existing entry). `<NAME>` is the same var name a hosted
 * env would use, e.g. GOOGLE_GENERATIVE_AI_API_KEY.
 *
 * Framework-free: no imports from Next/React.
 */
import { execFileSync } from "node:child_process";

// --- Keychain CLI (named — no magic strings) ---------------------------------
const KEYCHAIN_BINARY = "security";
const KEYCHAIN_FIND = "find-generic-password";
const FLAG_ACCOUNT = "-a"; // account (we use $USER)
const FLAG_SERVICE = "-s"; // service (the secret name)
const FLAG_PASSWORD_ONLY = "-w"; // print only the password to stdout

/** Reads one Keychain generic password; "" when absent or unavailable (e.g. off-macOS). */
export type KeychainReader = (service: string, account?: string) => string;

/**
 * The real reader. Shells out to `security`. A non-zero exit (not found) or a
 * missing binary (non-macOS host) throws — we swallow both to "" so callers see
 * a uniform "absent" signal and stay cross-platform.
 */
export const readKeychain: KeychainReader = (service, account) => {
  const args = [KEYCHAIN_FIND];
  if (account) args.push(FLAG_ACCOUNT, account);
  args.push(FLAG_SERVICE, service, FLAG_PASSWORD_ONLY);
  try {
    return execFileSync(KEYCHAIN_BINARY, args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

/** Injectable sources for `resolveSecret` — defaults hit the real env + Keychain. */
export interface SecretSources {
  env?: Record<string, string | undefined>;
  keychain?: KeychainReader;
}

/**
 * Resolve a secret by name. Order: env var → Keychain under the login account
 * ($USER) → Keychain with no account. Returns "" if found nowhere; the caller
 * decides whether that is fatal.
 */
export function resolveSecret(name: string, sources: SecretSources = {}): string {
  const env = sources.env ?? process.env;
  const keychain = sources.keychain ?? readKeychain;

  const fromEnv = (env[name] ?? "").trim();
  if (fromEnv) return fromEnv;

  const account = (env.USER ?? "").trim();
  const fromAccount = account ? keychain(name, account) : "";
  if (fromAccount) return fromAccount;

  return keychain(name);
}
