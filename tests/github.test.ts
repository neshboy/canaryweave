import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCodeSearchHeaders,
  buildCodeSearchUrl,
  GithubSearchError,
  parseCodeSearchResponse,
  searchGithubCode,
} from "../src/github.js";

describe("buildCodeSearchUrl", () => {
  it("builds the documented /search/code endpoint with the token as the q param", () => {
    const url = buildCodeSearchUrl("cwt_abc123");
    expect(url).toBe("https://api.github.com/search/code?q=cwt_abc123");
  });

  it("URL-encodes tokens with special characters safely", () => {
    const url = buildCodeSearchUrl("cwt_a b&c");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("cwt_a b&c");
  });
});

describe("buildCodeSearchHeaders", () => {
  it("omits Authorization when no GitHub token is supplied", () => {
    const headers = buildCodeSearchHeaders();
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBe("application/vnd.github+json");
  });

  it("adds a Bearer Authorization header when a GitHub token is supplied", () => {
    const headers = buildCodeSearchHeaders("ghp_secret");
    expect(headers.Authorization).toBe("Bearer ghp_secret");
  });
});

describe("parseCodeSearchResponse", () => {
  it("parses a realistic GitHub search-code response body", () => {
    const body = {
      total_count: 2,
      incomplete_results: false,
      items: [
        {
          path: "config/.env",
          html_url: "https://github.com/someone/leaky-repo/blob/main/config/.env",
          repository: { full_name: "someone/leaky-repo" },
        },
        {
          path: "notes.txt",
          html_url: "https://github.com/other/repo/blob/main/notes.txt",
          repository: { full_name: "other/repo" },
        },
      ],
    };

    const result = parseCodeSearchResponse(body);
    expect(result.totalCount).toBe(2);
    expect(result.incompleteResults).toBe(false);
    expect(result.items).toEqual([
      {
        path: "config/.env",
        repository: "someone/leaky-repo",
        htmlUrl: "https://github.com/someone/leaky-repo/blob/main/config/.env",
      },
      {
        path: "notes.txt",
        repository: "other/repo",
        htmlUrl: "https://github.com/other/repo/blob/main/notes.txt",
      },
    ]);
  });

  it("treats a zero-result response as clean", () => {
    const result = parseCodeSearchResponse({ total_count: 0, incomplete_results: false, items: [] });
    expect(result.totalCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("tolerates missing/malformed fields without throwing", () => {
    expect(() => parseCodeSearchResponse({})).not.toThrow();
    expect(() => parseCodeSearchResponse(null)).not.toThrow();
    const result = parseCodeSearchResponse({ items: [{ path: "x" }] });
    expect(result.items[0]).toEqual({ path: "x", repository: "unknown", htmlUrl: "" });
  });
});

describe("searchGithubCode (HTTP layer, mocked for determinism)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls the correct URL/headers and returns a parsed clean result", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ total_count: 0, incomplete_results: false, items: [] }),
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await searchGithubCode("cwt_doesnotexist", undefined);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toBe("https://api.github.com/search/code?q=cwt_doesnotexist");
    expect((calledInit as RequestInit).headers).toMatchObject({ Accept: "application/vnd.github+json" });
    expect(result.totalCount).toBe(0);
  });

  it("returns matches when the mocked response reports hits", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            path: "leak.txt",
            html_url: "https://github.com/x/y/blob/main/leak.txt",
            repository: { full_name: "x/y" },
          },
        ],
      }),
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    const result = await searchGithubCode("cwt_leaked", "ghp_test");
    expect(result.totalCount).toBe(1);
    expect(result.items[0]?.repository).toBe("x/y");

    const [, calledInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((calledInit as RequestInit).headers).toMatchObject({ Authorization: "Bearer ghp_test" });
  });

  it("throws GithubSearchError on a non-2xx response (e.g. rate limiting)", async () => {
    const mockResponse = {
      ok: false,
      status: 403,
      text: async () => "API rate limit exceeded",
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

    await expect(searchGithubCode("cwt_x")).rejects.toBeInstanceOf(GithubSearchError);
    await expect(searchGithubCode("cwt_x")).rejects.toMatchObject({ status: 403 });
  });
});
