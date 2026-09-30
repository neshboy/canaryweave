import { randomUUID } from "node:crypto";
import { generateCanaryToken } from "./token.js";
import { loadJsonStore, saveJsonStore, type VersionedEntries } from "./jsonStore.js";

/** Where a canary token was planted. */
export interface SeedRecord {
  /** Path to the file the token was written into. */
  file: string;
  /** ISO-8601 timestamp of when it was seeded. */
  seededAt: string;
  /** How it was inserted: replacing a `{{CANARY}}` placeholder, or appended. */
  method: "placeholder" | "appended";
}

/** A single registered canary token and everything CanaryWeave knows about it. */
export interface CanaryEntry {
  /** Stable internal id (UUID v4), independent of the token value itself. */
  id: string;
  /** The actual secret canary string. */
  token: string;
  /** Human-readable label describing what this canary is protecting. */
  label: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Everywhere this token has been seeded, in order. */
  seededIn: SeedRecord[];
}

/** On-disk shape of the registry file. */
export type RegistryData = VersionedEntries<CanaryEntry>;

/**
 * Load the registry from `path`. If the file does not exist yet, returns an
 * empty registry (this is the normal state for a brand-new project) rather
 * than throwing.
 */
export async function loadRegistry(path: string): Promise<RegistryData> {
  return loadJsonStore<CanaryEntry>(path, "Registry");
}

/** Persist `data` to `path`, creating parent directories as needed. */
export async function saveRegistry(path: string, data: RegistryData): Promise<void> {
  return saveJsonStore(path, data);
}

/**
 * Create a new canary token, register it under `label`, persist the
 * registry, and return the new entry.
 */
export async function createAndRegisterCanary(
  path: string,
  label: string,
): Promise<CanaryEntry> {
  const registry = await loadRegistry(path);

  const entry: CanaryEntry = {
    id: randomUUID(),
    token: generateCanaryToken(),
    label,
    createdAt: new Date().toISOString(),
    seededIn: [],
  };

  registry.entries.push(entry);
  await saveRegistry(path, registry);
  return entry;
}

/** Find a registered entry by its id, its full token, or (as a last resort) its label. */
export function findEntry(
  registry: RegistryData,
  needle: string,
): CanaryEntry | undefined {
  return (
    registry.entries.find((e) => e.id === needle) ??
    registry.entries.find((e) => e.token === needle) ??
    registry.entries.find((e) => e.label === needle)
  );
}

/** Record that `token`'s entry has been seeded into `file`. Mutates and returns the registry. */
export function recordSeed(
  registry: RegistryData,
  entryId: string,
  seed: SeedRecord,
): CanaryEntry {
  const entry = registry.entries.find((e) => e.id === entryId);
  if (!entry) {
    throw new Error(`No registry entry with id "${entryId}"`);
  }
  entry.seededIn.push(seed);
  return entry;
}
