/**
 * REAL end-to-end test against the live GitHub REST code search API.
 *
 * This file is intentionally named `*.live.test.ts` and is EXCLUDED from
 * the default `npm test` run (see package.json / vitest.config.ts), because
 * it requires real network access and (see below) real GitHub credentials.
 *
 * Run it explicitly with: `npm run test:live`
 *
 * What it proves: a canary token that has never been generated before (and
 * therefore cannot exist in any public repository) comes back "clean" from
 * a real call to `GET https://api.github.com/search/code`. This is the one
 * genuinely-networked assertion in the suite; everything else in
 * `tests/github.test.ts` mocks the HTTP layer for determinism.
 *
 * Honest caveat discovered while building this: GitHub's `/search/code`
 * endpoint requires authentication for *every* request, including ones that
 * would otherwise be perfectly good unauthenticated public searches (we
 * confirmed this with a raw `curl` against the live API: no Authorization
 * header gets you `401 Requires authentication`, whereas e.g.
 * `/search/repositories` works fine unauthenticated). Without a real
 * `GITHUB_TOKEN` in the environment, this test still makes a real network
 * call and asserts the real (documented) auth-required behavior rather than
 * skipping silently or faking a "clean" result. If `GITHUB_TOKEN` *is* set,
 * it runs the full clean-result assertion end-to-end.
 */
import { describe, expect, it } from "vitest";
import { generateCanaryToken } from "../src/token.js";
import { searchGithubCode } from "../src/github.js";

describe("live: GitHub code search", () => {
  const githubToken = process.env.GITHUB_TOKEN;

  it(
    "reports a freshly generated, never-published canary token as not found",
    async () => {
      const neverPublishedToken = generateCanaryToken();

      if (!githubToken) {
        // Real network call, real assertion about real (current) GitHub
        // behavior: unauthenticated code search is rejected outright.
        await expect(searchGithubCode(neverPublishedToken)).rejects.toMatchObject({
          status: 401,
        });
        console.warn(
          "[canaryweave live test] No GITHUB_TOKEN set: confirmed GitHub's live " +
            "code-search API rejects unauthenticated requests (401), which is the " +
            "real current behavior. Set GITHUB_TOKEN to also exercise the full " +
            "clean-result path end-to-end.",
        );
        return;
      }

      const result = await searchGithubCode(neverPublishedToken, githubToken);
      expect(result.totalCount).toBe(0);
      expect(result.items).toEqual([]);
    },
    20_000,
  );
});
