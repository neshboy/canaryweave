import { mkdtemp, readFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CANARY_PLACEHOLDER, insertCanaryToken, seedFile } from "../src/seed.js";

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "canaryweave-seed-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("insertCanaryToken (pure logic)", () => {
  it("replaces a {{CANARY}} placeholder with the raw token", () => {
    const content = `KEY_A=1\nKEY_B=${CANARY_PLACEHOLDER}\nKEY_C=3\n`;
    const { content: result, method } = insertCanaryToken(content, "cwt_deadbeef", "label", "x.env");
    expect(method).toBe("placeholder");
    expect(result).toBe("KEY_A=1\nKEY_B=cwt_deadbeef\nKEY_C=3\n");
    expect(result).not.toContain(CANARY_PLACEHOLDER);
  });

  it("only replaces the first placeholder occurrence", () => {
    const content = `${CANARY_PLACEHOLDER} and ${CANARY_PLACEHOLDER}`;
    const { content: result } = insertCanaryToken(content, "cwt_x", "label", "x.txt");
    expect(result).toBe(`cwt_x and ${CANARY_PLACEHOLDER}`);
  });

  it("appends a comment with the correct style for a known extension when no placeholder exists", () => {
    const { content: result, method } = insertCanaryToken(
      "print('hi')\n",
      "cwt_abc123",
      "python-config",
      "settings.py",
    );
    expect(method).toBe("appended");
    expect(result).toContain("# CANARYWEAVE canary [python-config] - do not remove: cwt_abc123");
    expect(result.startsWith("print('hi')\n")).toBe(true);
  });

  it("uses HTML-comment style for markdown/html files", () => {
    const { content: result } = insertCanaryToken("# Title\n", "cwt_xyz", "doc", "NOTES.md");
    expect(result).toContain("<!-- CANARYWEAVE canary [doc] - do not remove: cwt_xyz -->");
  });

  it("adds a newline separator before appending when the file lacks a trailing newline", () => {
    const { content: result } = insertCanaryToken("no trailing newline", "cwt_x", "l", "f.txt");
    expect(result).toBe("no trailing newline\n# CANARYWEAVE canary [l] - do not remove: cwt_x\n");
  });

  it("appends cleanly to empty content", () => {
    const { content: result, method } = insertCanaryToken("", "cwt_x", "l", "f.sh");
    expect(method).toBe("appended");
    expect(result).toBe("# CANARYWEAVE canary [l] - do not remove: cwt_x\n");
  });
});

describe("seedFile (real fixture file I/O)", () => {
  it("inserts the token into a copy of the real .env.example fixture at the placeholder", async () => {
    const target = join(dir, "example.env.example");
    await copyFile(join(FIXTURES_DIR, "example.env.example"), target);

    const method = await seedFile(target, "cwt_realtoken0000", "prod-secret");
    expect(method).toBe("placeholder");

    const written = await readFile(target, "utf8");
    expect(written).toContain("API_KEY=cwt_realtoken0000");
    expect(written).not.toContain(CANARY_PLACEHOLDER);
    // Untouched lines survive seeding intact.
    expect(written).toContain("APP_NAME=example-app");
    expect(written).toContain("DATABASE_URL=postgres://user:pass@localhost:5432/example");
  });

  it("appends a labeled comment to a real fixture file with no placeholder", async () => {
    const target = join(dir, "no-placeholder.py");
    await copyFile(join(FIXTURES_DIR, "no-placeholder.py"), target);

    const method = await seedFile(target, "cwt_appended0000", "script-canary");
    expect(method).toBe("appended");

    const written = await readFile(target, "utf8");
    expect(written).toContain("# CANARYWEAVE canary [script-canary] - do not remove: cwt_appended0000");
    expect(written).toContain('if __name__ == "__main__":'); // original content preserved
  });
});
