import { randomBytes } from "node:crypto";

/**
 * Real, cryptographically-strong canary token generation.
 *
 * Tokens are built from `node:crypto`'s `randomBytes`, which is backed by the
 * operating system's CSPRNG (never `Math.random()`, which is not
 * cryptographically secure and must not be used for anything that needs to
 * be unguessable).
 *
 * Format: `cwt_<64 lowercase hex chars>`
 *   - `cwt_` prefix makes tokens easy to recognize and grep for on purpose
 *     (this is a *feature* for a honeytoken: you want it to be unmistakably
 *     yours when it turns up somewhere it shouldn't).
 *   - 32 random bytes = 256 bits of entropy, encoded as 64 hex characters.
 */

export const CANARY_TOKEN_PREFIX = "cwt_";

/** Number of random bytes used to build the secret portion of a token. */
export const TOKEN_ENTROPY_BYTES = 32;

/** Regex a valid CanaryWeave token must match. */
export const TOKEN_PATTERN = /^cwt_[0-9a-f]{64}$/;

/**
 * Generate a brand-new, high-entropy canary token string.
 *
 * Uses `crypto.randomBytes`, which draws from the platform CSPRNG
 * (`/dev/urandom` on POSIX, `CryptGenRandom`/`BCryptGenRandom` on Windows).
 */
export function generateCanaryToken(): string {
  const secret = randomBytes(TOKEN_ENTROPY_BYTES).toString("hex");
  return `${CANARY_TOKEN_PREFIX}${secret}`;
}

/** True if `value` looks like a well-formed CanaryWeave token. */
export function isValidCanaryToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
