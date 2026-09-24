import { describe, expect, it } from "vitest";
import {
  CANARY_TOKEN_PREFIX,
  generateCanaryToken,
  isValidCanaryToken,
  TOKEN_ENTROPY_BYTES,
  TOKEN_PATTERN,
} from "../src/token.js";

describe("generateCanaryToken", () => {
  it("produces a token with the expected prefix and shape", () => {
    const token = generateCanaryToken();
    expect(token.startsWith(CANARY_TOKEN_PREFIX)).toBe(true);
    expect(TOKEN_PATTERN.test(token)).toBe(true);
  });

  it("encodes exactly TOKEN_ENTROPY_BYTES of randomness as hex", () => {
    const token = generateCanaryToken();
    const hex = token.slice(CANARY_TOKEN_PREFIX.length);
    // 1 byte -> 2 hex chars
    expect(hex).toHaveLength(TOKEN_ENTROPY_BYTES * 2);
    // charset check: lowercase hex only
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it("has real entropy: 256 bits from 32 random bytes", () => {
    expect(TOKEN_ENTROPY_BYTES).toBe(32);
    const token = generateCanaryToken();
    const hex = token.slice(CANARY_TOKEN_PREFIX.length);
    const bits = (hex.length / 2) * 8;
    expect(bits).toBe(256);
  });

  it("generates no collisions across 10,000 tokens (statistical uniqueness)", () => {
    const seen = new Set<string>();
    const count = 10_000;
    for (let i = 0; i < count; i++) {
      seen.add(generateCanaryToken());
    }
    expect(seen.size).toBe(count);
  });

  it("does not use Math.random to source entropy", () => {
    // Sanity check that the module's output isn't derived from Math.random:
    // stub it out to something deterministic and confirm token output is
    // still unpredictable / does not collide, i.e. randomness comes from
    // elsewhere (node:crypto).
    const original = Math.random;
    try {
      Math.random = () => 0.5;
      const a = generateCanaryToken();
      const b = generateCanaryToken();
      expect(a).not.toBe(b);
    } finally {
      Math.random = original;
    }
  });

  it("has enough distinct hex characters across many tokens to look like real randomness", () => {
    // Crude distribution smoke-test: across many tokens, every hex digit
    // (0-9a-f) should show up. A biased/fake generator would likely skew
    // heavily toward a subset.
    const digitsSeen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const hex = generateCanaryToken().slice(CANARY_TOKEN_PREFIX.length);
      for (const ch of hex) digitsSeen.add(ch);
    }
    expect(digitsSeen.size).toBe(16);
  });
});

describe("isValidCanaryToken", () => {
  it("accepts freshly generated tokens", () => {
    expect(isValidCanaryToken(generateCanaryToken())).toBe(true);
  });

  it("rejects malformed strings", () => {
    expect(isValidCanaryToken("not-a-token")).toBe(false);
    expect(isValidCanaryToken("cwt_tooshort")).toBe(false);
    expect(isValidCanaryToken("cwt_" + "g".repeat(64))).toBe(false); // invalid hex char
    expect(isValidCanaryToken("")).toBe(false);
  });
});
