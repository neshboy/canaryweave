import { join } from "node:path";

/** Directory (relative to cwd, unless overridden) where CanaryWeave keeps its local state. */
export const DEFAULT_DATA_DIR = ".canaryweave";

export function defaultRegistryPath(baseDir: string = process.cwd()): string {
  return join(baseDir, DEFAULT_DATA_DIR, "registry.json");
}

export function defaultLogPath(baseDir: string = process.cwd()): string {
  return join(baseDir, DEFAULT_DATA_DIR, "log.json");
}
