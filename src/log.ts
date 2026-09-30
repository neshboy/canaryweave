import { loadJsonStore, saveJsonStore, type VersionedEntries } from "./jsonStore.js";

/** One check attempt against one canary token, recorded for the audit trail. */
export interface CheckLogEntry {
  /** ISO-8601 timestamp of when the check ran. */
  checkedAt: string;
  /** Registry entry id that was checked. */
  entryId: string;
  /** Label of the canary at the time it was checked (for readability). */
  label: string;
  /** Which external source was queried. Only "github" exists in v1. */
  source: "github";
  /** The literal query string sent to the source. */
  query: string;
  /** Outcome of the check. */
  status: "clean" | "hit" | "error";
  /** Number of matches found (0 for "clean"). */
  matchCount: number;
  /** Human-readable locations of any matches (e.g. GitHub file URLs). */
  matches: string[];
  /** Error message, present only when status is "error". */
  error?: string;
}

export type CanaryLogData = VersionedEntries<CheckLogEntry>;

/** Load the audit log from `path`, returning an empty log if it does not exist yet. */
export async function loadLog(path: string): Promise<CanaryLogData> {
  return loadJsonStore<CheckLogEntry>(path, "Log");
}

/** Persist the audit log to `path`, creating parent directories as needed. */
export async function saveLog(path: string, data: CanaryLogData): Promise<void> {
  return saveJsonStore(path, data);
}

/** Append `entry` to the audit log stored at `path` and persist it. */
export async function appendLogEntry(path: string, entry: CheckLogEntry): Promise<CanaryLogData> {
  const log = await loadLog(path);
  log.entries.push(entry);
  await saveLog(path, log);
  return log;
}
