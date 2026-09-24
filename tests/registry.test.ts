import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAndRegisterCanary,
  findEntry,
  loadRegistry,
  recordSeed,
  saveRegistry,
  type RegistryData,
} from "../src/registry.js";
import { isValidCanaryToken } from "../src/token.js";

let dir: string;
let registryPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "canaryweave-registry-"));
  registryPath = join(dir, ".canaryweave", "registry.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadRegistry", () => {
  it("returns an empty registry when the file does not exist", async () => {
    const registry = await loadRegistry(registryPath);
    expect(registry).toEqual({ version: 1, entries: [] });
  });

  it("throws on a malformed registry file", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, ".canaryweave"), { recursive: true });
    await writeFile(registryPath, JSON.stringify({ not: "a registry" }), "utf8");
    await expect(loadRegistry(registryPath)).rejects.toThrow(/malformed/);
  });
});

describe("createAndRegisterCanary + round-trip", () => {
  it("creates a valid, uniquely-identified entry and persists it", async () => {
    const entry = await createAndRegisterCanary(registryPath, "prod-db-config");

    expect(entry.label).toBe("prod-db-config");
    expect(isValidCanaryToken(entry.token)).toBe(true);
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.seededIn).toEqual([]);
    expect(() => new Date(entry.createdAt).toISOString()).not.toThrow();

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0]).toEqual(entry);
  });

  it("appends multiple entries across calls without clobbering earlier ones", async () => {
    const first = await createAndRegisterCanary(registryPath, "one");
    const second = await createAndRegisterCanary(registryPath, "two");

    const registry = await loadRegistry(registryPath);
    expect(registry.entries.map((e) => e.id)).toEqual([first.id, second.id]);
    expect(first.token).not.toBe(second.token);
  });

  it("round-trips through saveRegistry/loadRegistry byte-for-byte in structure", async () => {
    const data: RegistryData = {
      version: 1,
      entries: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          token: "cwt_" + "a".repeat(64),
          label: "manual-entry",
          createdAt: "2026-01-01T00:00:00.000Z",
          seededIn: [
            { file: "config.env.example", seededAt: "2026-01-02T00:00:00.000Z", method: "placeholder" },
          ],
        },
      ],
    };
    await saveRegistry(registryPath, data);
    const reloaded = await loadRegistry(registryPath);
    expect(reloaded).toEqual(data);
  });
});

describe("findEntry", () => {
  it("finds by id, token, or label", async () => {
    const entry = await createAndRegisterCanary(registryPath, "findable");
    const registry = await loadRegistry(registryPath);

    expect(findEntry(registry, entry.id)?.id).toBe(entry.id);
    expect(findEntry(registry, entry.token)?.id).toBe(entry.id);
    expect(findEntry(registry, "findable")?.id).toBe(entry.id);
    expect(findEntry(registry, "does-not-exist")).toBeUndefined();
  });
});

describe("recordSeed", () => {
  it("appends a seed record to the matching entry and persists via saveRegistry", async () => {
    const entry = await createAndRegisterCanary(registryPath, "to-be-seeded");
    const registry = await loadRegistry(registryPath);

    recordSeed(registry, entry.id, {
      file: "README.md",
      seededAt: "2026-03-01T00:00:00.000Z",
      method: "appended",
    });
    await saveRegistry(registryPath, registry);

    const reloaded = await loadRegistry(registryPath);
    expect(reloaded.entries[0]?.seededIn).toEqual([
      { file: "README.md", seededAt: "2026-03-01T00:00:00.000Z", method: "appended" },
    ]);
  });

  it("throws when the entry id is unknown", () => {
    const registry: RegistryData = { version: 1, entries: [] };
    expect(() =>
      recordSeed(registry, "missing-id", {
        file: "x",
        seededAt: "2026-01-01T00:00:00.000Z",
        method: "appended",
      }),
    ).toThrow(/No registry entry/);
  });
});
