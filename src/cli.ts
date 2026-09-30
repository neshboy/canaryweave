#!/usr/bin/env node
import { Command } from "commander";
import {
  createAndRegisterCanary,
  findEntry,
  loadRegistry,
  recordSeed,
  saveRegistry,
} from "./registry.js";
import { seedFile } from "./seed.js";
import { defaultLogPath, defaultRegistryPath } from "./paths.js";
import { appendLogEntry } from "./log.js";
import { buildCodeSearchUrl, GithubSearchError, searchGithubCode } from "./github.js";
import type { CanaryEntry } from "./registry.js";

const program = new Command();

program
  .name("canaryweave")
  .description(
    "Honeytoken-based data-leak detector: generate canary tokens, seed them into files, " +
      "and check whether they've leaked onto public GitHub.",
  )
  .version("0.1.0");

program
  .command("generate")
  .description("Generate a new canary token and register it")
  .requiredOption("--label <name>", "human-readable label for this canary")
  .option("--registry <path>", "path to the registry file", defaultRegistryPath())
  .action(async (opts: { label: string; registry: string }) => {
    const entry = await createAndRegisterCanary(opts.registry, opts.label);
    console.log(`Generated canary token for "${entry.label}"`);
    console.log(`  id:    ${entry.id}`);
    console.log(`  token: ${entry.token}`);
    console.log(`Registered in ${opts.registry}`);
  });

program
  .command("seed")
  .description("Insert a registered canary token into a target file")
  .argument("<file>", "path to the file to seed")
  .requiredOption("--token <id>", "registry id, full token, or label to seed")
  .option("--registry <path>", "path to the registry file", defaultRegistryPath())
  .action(async (file: string, opts: { token: string; registry: string }) => {
    const registry = await loadRegistry(opts.registry);
    const entry = findEntry(registry, opts.token);
    if (!entry) {
      console.error(`No registry entry found matching "${opts.token}"`);
      process.exitCode = 1;
      return;
    }

    const method = await seedFile(file, entry.token, entry.label);
    recordSeed(registry, entry.id, {
      file,
      seededAt: new Date().toISOString(),
      method,
    });
    await saveRegistry(opts.registry, registry);

    const how =
      method === "placeholder"
        ? "replaced a {{CANARY}} placeholder"
        : "appended a labeled canary comment";
    console.log(`Seeded canary "${entry.label}" into ${file} (${how}).`);
  });

program
  .command("check")
  .description("Check registered canary token(s) against GitHub code search")
  .option("--token <id>", "check only this registry id, full token, or label")
  .option("--registry <path>", "path to the registry file", defaultRegistryPath())
  .option("--log <path>", "path to the audit log file", defaultLogPath())
  .action(async (opts: { token?: string; registry: string; log: string }) => {
    const registry = await loadRegistry(opts.registry);

    let targets: CanaryEntry[];
    if (opts.token) {
      const entry = findEntry(registry, opts.token);
      if (!entry) {
        console.error(`No registry entry found matching "${opts.token}"`);
        process.exitCode = 1;
        return;
      }
      targets = [entry];
    } else {
      targets = registry.entries;
    }

    if (targets.length === 0) {
      console.log("No canary tokens registered yet. Run `canaryweave generate` first.");
      return;
    }

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      console.log(
        "No GITHUB_TOKEN set. GitHub's code search API requires authentication " +
          "for every request (it returns 401 with no Authorization header at all) - " +
          "set GITHUB_TOKEN to a personal access token (no special scopes needed) " +
          "before running `check`, or every check below will fail with an auth error.",
      );
    }

    let anyHit = false;
    let anyError = false;

    for (const entry of targets) {
      const query = entry.token;
      const checkedAt = new Date().toISOString();
      try {
        const result = await searchGithubCode(query, githubToken);
        const matches = result.items.map((item) => `${item.repository}: ${item.htmlUrl}`);
        const status = result.totalCount > 0 ? "hit" : "clean";
        if (status === "hit") anyHit = true;

        await appendLogEntry(opts.log, {
          checkedAt,
          entryId: entry.id,
          label: entry.label,
          source: "github",
          query,
          status,
          matchCount: result.totalCount,
          matches,
        });

        if (status === "hit") {
          console.log(`[LEAK DETECTED] "${entry.label}" (${entry.id}): ${result.totalCount} hit(s)`);
          for (const m of matches) console.log(`    -> ${m}`);
        } else {
          console.log(`[clean] "${entry.label}" (${entry.id}): no matches on GitHub code search`);
        }
      } catch (err) {
        anyError = true;
        const message = err instanceof Error ? err.message : String(err);
        await appendLogEntry(opts.log, {
          checkedAt,
          entryId: entry.id,
          label: entry.label,
          source: "github",
          query,
          status: "error",
          matchCount: 0,
          matches: [],
          error: message,
        });

        if (err instanceof GithubSearchError && err.status === 401) {
          console.error(
            `[error] "${entry.label}": GitHub requires authentication for code search. ` +
              `Set GITHUB_TOKEN to a personal access token and try again. (${message})`,
          );
        } else if (err instanceof GithubSearchError && err.status === 403) {
          console.error(
            `[error] "${entry.label}": GitHub rate-limited this request. ` +
              `Wait a bit and try again, or use a GITHUB_TOKEN with a higher quota. (${message})`,
          );
        } else {
          console.error(`[error] "${entry.label}": ${message}`);
        }
      }
    }

    console.log(`\nAudit log updated at ${opts.log}`);
    if (anyHit) {
      // Confirmed leak(s) take priority over errors: 2 is reserved for this.
      process.exitCode = 2;
    } else if (anyError) {
      // Distinguish "clean" from "the tool couldn't actually check anything"
      // (e.g. missing/expired GITHUB_TOKEN, all requests 401ing) so cron/CI
      // callers don't mistake a broken check run for a clean one.
      process.exitCode = 1;
    }
  });

program
  .command("list")
  .description("List all registered canary tokens")
  .option("--registry <path>", "path to the registry file", defaultRegistryPath())
  .action(async (opts: { registry: string }) => {
    const registry = await loadRegistry(opts.registry);
    if (registry.entries.length === 0) {
      console.log("No canary tokens registered yet. Run `canaryweave generate` first.");
      return;
    }

    for (const entry of registry.entries) {
      console.log(`${entry.label}`);
      console.log(`  id:      ${entry.id}`);
      console.log(`  token:   ${entry.token}`);
      console.log(`  created: ${entry.createdAt}`);
      if (entry.seededIn.length === 0) {
        console.log(`  seeded:  (not seeded anywhere yet)`);
      } else {
        console.log(`  seeded:`);
        for (const s of entry.seededIn) {
          console.log(`    - ${s.file} (${s.method}, ${s.seededAt})`);
        }
      }
      console.log("");
    }
  });

// Exported for tests / debugging, harmless in production use.
export { buildCodeSearchUrl };

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
