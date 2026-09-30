import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Shared on-disk shape used by both the registry and the audit log: a
 * versioned array of entries of some type `E`.
 */
export interface VersionedEntries<E> {
  version: 1;
  entries: E[];
}

export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Load a `{ version: 1, entries: E[] }` JSON store from `path`, returning an
 * empty store if the file does not exist yet (or is empty) rather than
 * throwing. Throws if the file exists but doesn't have a valid `entries`
 * array, using `label` (e.g. "Registry", "Log") in the error message.
 */
export async function loadJsonStore<E>(
  path: string,
  label: string,
): Promise<VersionedEntries<E>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    throw err;
  }

  if (raw.trim() === "") {
    return { version: 1, entries: [] };
  }

  const parsed = JSON.parse(raw) as Partial<VersionedEntries<E>>;
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`${label} file at ${path} is malformed: missing "entries" array`);
  }
  return { version: 1, entries: parsed.entries };
}

/** Persist `data` to `path`, creating parent directories as needed. */
export async function saveJsonStore<E>(
  path: string,
  data: VersionedEntries<E>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const serialized = JSON.stringify(data, null, 2) + "\n";
  await writeFile(path, serialized, "utf8");
}
