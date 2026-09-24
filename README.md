# CanaryWeave

CanaryWeave is a honeytoken-based data-leak detector. It generates unique,
individually-traceable "canary" strings, helps you seed them into places you
want to monitor (a `.env.example`-style template, a doc, a config file), and
then checks whether any of your planted tokens have shown up somewhere they
shouldn't - alerting you the moment a canary you planted surfaces outside
your control, which is a strong signal that whatever surrounds it also
leaked.

## Why honeytokens

Canary/honeytokens are an established technique used by security teams:
instead of (or in addition to) trying to prevent every possible leak, you
plant a unique, meaningless-but-traceable string somewhere a real secret
would live. If that exact string ever turns up in a public place, you know
with near certainty that the file, repo, or system it was embedded in has
leaked - because nobody could have gotten that string any other way. It
doesn't stop leaks, but it gives you a tripwire for them, often long before
you'd otherwise find out.

## What CanaryWeave actually does (v1)

- **Generates** cryptographically-random canary tokens (`node:crypto`
  `randomBytes`, 256 bits of entropy each), tagged with a label and creation
  time, stored in a local JSON registry (`.canaryweave/registry.json`).
- **Seeds** a token into a target file, either by replacing a `{{CANARY}}`
  placeholder (great for a `.env.example`-style template) or, if there's no
  placeholder, by appending a clearly labeled comment in a syntax appropriate
  to the file type.
- **Checks** your registered tokens against the real
  [GitHub REST code search API](https://docs.github.com/en/rest/search/search#search-code)
  (`GET /search/code?q=<token>`), the single most common place accidentally
  committed secrets get discovered by others.
- **Logs** every check to a local audit trail (`.canaryweave/log.json`): when
  it ran, what was queried, and what (if anything) came back.

Nothing here is faked or simulated: token generation is a real CSPRNG, the
registry and log are real files you can open and read, and the GitHub check
is a real HTTP call to a real, public API.

## Install / quick start

```bash
git clone <this-repo>
cd canaryweave
npm install
npm run build

# or, during development, skip the build step:
npm run dev -- generate --label demo
```

### 1. Generate a canary token

```bash
$ canaryweave generate --label "prod-db-config"
Generated canary token for "prod-db-config"
  id:    6d518d1b-2d5e-42de-8e57-7ac59e823ae9
  token: cwt_6e07c97c1f67c01e666eba522a65122f283b726f36aebaa1f841f13ee862032a
Registered in .canaryweave/registry.json
```

### 2. Seed it into a file you want to monitor

Given a template like:

```
# config.env.example
APP=demo
SECRET_KEY={{CANARY}}
```

```bash
$ canaryweave seed config.env.example --token 6d518d1b-2d5e-42de-8e57-7ac59e823ae9
Seeded canary "prod-db-config" into config.env.example (replaced a {{CANARY}} placeholder).
```

`config.env.example` now contains the real token in place of `{{CANARY}}`.
If the file has no placeholder, CanaryWeave appends a clearly labeled
comment instead (e.g. `# CANARYWEAVE canary [label] - do not remove: cwt_...`
for a `.py`/`.env`/`.yml` file, or an HTML-style comment for `.md`/`.html`).

You can pass `--token` as the registry id, the full token string, or the
label - whichever's convenient.

### 3. Check whether it has leaked

```bash
$ export GITHUB_TOKEN=ghp_your_personal_access_token   # see Limitations below - this is required
$ canaryweave check
[clean] "prod-db-config" (6d518d1b-2d5e-42de-8e57-7ac59e823ae9): no matches on GitHub code search

Audit log updated at .canaryweave/log.json
```

If a token *does* turn up, you'll see something like:

```
[LEAK DETECTED] "prod-db-config" (6d518d1b-2d5e-42de-8e57-7ac59e823ae9): 1 hit(s)
    -> someone/leaky-repo: https://github.com/someone/leaky-repo/blob/main/config.env
```

and the process exits with code `2` so it's easy to wire into a cron job or
CI check that pages someone.

### 4. List everything you've registered

```bash
$ canaryweave list
prod-db-config
  id:      6d518d1b-2d5e-42de-8e57-7ac59e823ae9
  token:   cwt_6e07c97c1f67c01e666eba522a65122f283b726f36aebaa1f841f13ee862032a
  created: 2026-09-24T08:47:52.782Z
  seeded:
    - config.env.example (placeholder, 2026-09-24T08:48:09.630Z)
```

## Where data lives

Everything CanaryWeave tracks locally lives under `.canaryweave/` in your
current directory: `registry.json` (your tokens + where you seeded them) and
`log.json` (the audit trail of every check). Both are plain JSON you can
read, back up, or diff. `.canaryweave/` is gitignored by default in this
repo so you don't accidentally commit real tokens from your own testing.

## Limitations (read this before relying on it)

- **Only GitHub code search in v1.** That's the one real, concrete,
  no-paid-API-key-required leak-detection channel this tool implements.
  Pastebin-style sites, other search engines, dark-web scrapers, etc. would
  each need their own connector and are explicitly out of scope for this
  release. Don't assume CanaryWeave is watching anywhere but public GitHub.
- **`GITHUB_TOKEN` is effectively required, not optional.** We initially
  assumed (as the GitHub docs' general search guidance implies) that
  unauthenticated code search would work with tight rate limits. While
  building this, we confirmed directly against the live API that GitHub's
  `/search/code` endpoint now returns `401 Requires authentication` for
  *every* request with no `Authorization` header - unlike most other search
  endpoints (e.g. `/search/repositories`), which still work unauthenticated.
  In practice you need a GitHub personal access token (no special scopes
  required, since code search itself only needs to be able to search public
  code) set as `GITHUB_TOKEN` for `canaryweave check` to do anything useful.
  Without it, checks fail with a clear authentication error rather than
  silently doing nothing.
- **Even authenticated, code search is rate-limited** to a small number of
  requests per minute. Checking a large number of tokens in a tight loop
  will get you `403`s; CanaryWeave records these as `"error"` entries in the
  audit log rather than crashing, but it does not currently implement
  automatic backoff/retry.
- **A clean result is not proof of no leak.** GitHub code search only
  indexes public repositories (and does so with some delay, and with
  documented exclusions for very large files, forks, etc.). A token could be
  sitting in a private repo, a leaked database dump, a paste site, or a
  Slack channel and CanaryWeave v1 would report "clean" regardless. Treat a
  hit as a strong positive signal, and a clean result as "no leak found on
  public GitHub code search today" - not as a guarantee.

## Testing

```bash
npm test        # offline, deterministic - covers token generation, registry
                 # round-trips, file-seeding logic, and the GitHub client's
                 # request-building/response-parsing against mocked HTTP
npm run test:live  # REAL network call to the live GitHub search API
                    # (see tests/github.live.test.ts for exactly what it does
                    # and why it behaves differently with/without GITHUB_TOKEN)
```

`npm test` needs no network access and no credentials - it's the suite that
should always pass. `npm run test:live` is a separate, clearly-marked
end-to-end sanity check against the real GitHub API; it's excluded from the
default run because it depends on network access and (per the limitation
above) GitHub credentials.

## Project layout

```
src/
  token.ts     real crypto.randomBytes-based token generation
  registry.ts  JSON-backed canary registry (create/find/record-seed)
  seed.ts      file-insertion logic (placeholder replace / comment append)
  github.ts    GitHub code search client (URL/header building, response parsing, HTTP call)
  log.ts       JSON-backed audit trail of check results
  paths.ts     default on-disk locations for registry/log
  cli.ts       commander-based CLI wiring the above into `generate`/`seed`/`check`/`list`
tests/
  *.test.ts        offline, deterministic tests (run by `npm test`)
  github.live.test.ts  real network E2E test (run by `npm run test:live`)
  fixtures/        real sample files used by the seed tests
```

## License

MIT, see [LICENSE](./LICENSE).
