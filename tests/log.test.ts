import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLogEntry, loadLog, type CheckLogEntry } from "../src/log.js";

let dir: string;
let logPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "canaryweave-log-"));
  logPath = join(dir, ".canaryweave", "log.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sampleEntry: CheckLogEntry = {
  checkedAt: "2026-01-01T00:00:00.000Z",
  entryId: "11111111-1111-1111-1111-111111111111",
  label: "prod-db-config",
  source: "github",
  query: "cwt_" + "a".repeat(64),
  status: "clean",
  matchCount: 0,
  matches: [],
};

describe("loadLog", () => {
  it("returns an empty log when no file exists yet", async () => {
    expect(await loadLog(logPath)).toEqual({ version: 1, entries: [] });
  });
});

describe("appendLogEntry", () => {
  it("creates the log file and persists the first entry", async () => {
    await appendLogEntry(logPath, sampleEntry);
    const reloaded = await loadLog(logPath);
    expect(reloaded.entries).toEqual([sampleEntry]);
  });

  it("preserves an audit trail across multiple checks, in order", async () => {
    await appendLogEntry(logPath, sampleEntry);
    const hitEntry: CheckLogEntry = {
      ...sampleEntry,
      checkedAt: "2026-01-02T00:00:00.000Z",
      status: "hit",
      matchCount: 1,
      matches: ["someone/leaky-repo: https://github.com/someone/leaky-repo/blob/main/.env"],
    };
    await appendLogEntry(logPath, hitEntry);

    const reloaded = await loadLog(logPath);
    expect(reloaded.entries).toHaveLength(2);
    expect(reloaded.entries[0]?.status).toBe("clean");
    expect(reloaded.entries[1]?.status).toBe("hit");
    expect(reloaded.entries[1]?.matches).toContain(
      "someone/leaky-repo: https://github.com/someone/leaky-repo/blob/main/.env",
    );
  });

  it("records error outcomes (e.g. rate limiting) for the audit trail", async () => {
    const errorEntry: CheckLogEntry = {
      ...sampleEntry,
      status: "error",
      error: "GitHub code search failed with status 403",
    };
    await appendLogEntry(logPath, errorEntry);
    const reloaded = await loadLog(logPath);
    expect(reloaded.entries[0]?.status).toBe("error");
    expect(reloaded.entries[0]?.error).toMatch(/403/);
  });
});
