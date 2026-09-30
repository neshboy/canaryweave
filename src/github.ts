/**
 * A real (not mocked-in-production) checker against the GitHub REST "search
 * code" API: https://docs.github.com/en/rest/search/search#search-code
 *
 * `GET https://api.github.com/search/code?q=<token>`
 *
 * As of this writing, GitHub's `/search/code` endpoint returns
 * `401 Requires authentication` for every request that has no
 * `Authorization` header at all - unlike most other GitHub search endpoints
 * (e.g. `/search/repositories`), which do work unauthenticated. We verified
 * this directly against the live API while building this tool. In
 * practice that means a `GITHUB_TOKEN` (a plain personal access token with
 * no special scopes is enough) is *required* to use `canaryweave check`,
 * not just a nice-to-have for higher rate limits. Authenticated requests
 * are still rate-limited (a low per-minute quota dedicated to code search),
 * just not rejected outright.
 *
 * This is the only leak-detection channel CanaryWeave v1 implements - see
 * the README "Limitations" section for why other sources (Pastebin-style
 * sites, other search engines) are explicitly out of scope for now.
 */

const GITHUB_API_BASE = "https://api.github.com";

/** Abort a code search request if the API hasn't responded within this long. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface GithubCodeSearchItem {
  path: string;
  repository: string;
  htmlUrl: string;
}

export interface GithubCodeSearchResult {
  totalCount: number;
  items: GithubCodeSearchItem[];
  /** True if GitHub reported this result set as incomplete (it timed out server-side). */
  incompleteResults: boolean;
}

export class GithubSearchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "GithubSearchError";
  }
}

/** Build the request URL for a GitHub code search for `token`. Exported for unit testing. */
export function buildCodeSearchUrl(token: string): string {
  const params = new URLSearchParams({ q: token });
  return `${GITHUB_API_BASE}/search/code?${params.toString()}`;
}

/** Build the request headers, adding `Authorization` only when a token is supplied. */
export function buildCodeSearchHeaders(githubToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "canaryweave-cli",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }
  return headers;
}

/** Parse a raw GitHub `/search/code` JSON body into our normalized result shape. */
export function parseCodeSearchResponse(data: unknown): GithubCodeSearchResult {
  const obj = (data ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(obj.items) ? obj.items : [];

  const items: GithubCodeSearchItem[] = rawItems.map((raw) => {
    const item = raw as Record<string, unknown>;
    const repo = item.repository as Record<string, unknown> | undefined;
    return {
      path: typeof item.path === "string" ? item.path : "",
      repository: typeof repo?.full_name === "string" ? repo.full_name : "unknown",
      htmlUrl: typeof item.html_url === "string" ? item.html_url : "",
    };
  });

  return {
    totalCount: typeof obj.total_count === "number" ? obj.total_count : items.length,
    items,
    incompleteResults: obj.incomplete_results === true,
  };
}

/**
 * Perform a real GitHub code search for `token`. Requires network access.
 * Throws `GithubSearchError` on a non-2xx response (this is how rate
 * limiting - HTTP 403/422 - surfaces to callers).
 */
export async function searchGithubCode(
  token: string,
  githubToken?: string,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<GithubCodeSearchResult> {
  const url = buildCodeSearchUrl(token);
  const headers = buildCodeSearchHeaders(githubToken);

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new GithubSearchError(
        `GitHub code search timed out after ${timeoutMs}ms`,
        0,
      );
    }
    throw err;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throw new GithubSearchError(
      `GitHub code search failed with status ${response.status}`,
      response.status,
      body,
    );
  }

  const data = await response.json();
  return parseCodeSearchResponse(data);
}
