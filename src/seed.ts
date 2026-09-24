import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

export const CANARY_PLACEHOLDER = "{{CANARY}}";

export interface SeedInsertion {
  content: string;
  method: "placeholder" | "appended";
}

/** Line-comment syntax used when appending a canary, keyed by file extension. */
const COMMENT_STYLES: Record<string, { open: string; close?: string }> = {
  ".js": { open: "//" },
  ".mjs": { open: "//" },
  ".cjs": { open: "//" },
  ".ts": { open: "//" },
  ".tsx": { open: "//" },
  ".jsx": { open: "//" },
  ".java": { open: "//" },
  ".go": { open: "//" },
  ".c": { open: "//" },
  ".h": { open: "//" },
  ".cpp": { open: "//" },
  ".cs": { open: "//" },
  ".rs": { open: "//" },
  ".swift": { open: "//" },
  ".kt": { open: "//" },
  ".env": { open: "#" },
  ".sh": { open: "#" },
  ".bash": { open: "#" },
  ".py": { open: "#" },
  ".rb": { open: "#" },
  ".yml": { open: "#" },
  ".yaml": { open: "#" },
  ".toml": { open: "#" },
  ".ini": { open: "#" },
  ".cfg": { open: "#" },
  ".conf": { open: "#" },
  ".html": { open: "<!--", close: "-->" },
  ".htm": { open: "<!--", close: "-->" },
  ".xml": { open: "<!--", close: "-->" },
  ".md": { open: "<!--", close: "-->" },
  ".sql": { open: "--" },
};

function commentLineFor(filePath: string, label: string, token: string): string {
  const style = COMMENT_STYLES[extname(filePath).toLowerCase()] ?? { open: "#" };
  const body = `CANARYWEAVE canary [${label}] - do not remove: ${token}`;
  return style.close ? `${style.open} ${body} ${style.close}` : `${style.open} ${body}`;
}

/**
 * Insert `token` into `content`.
 *
 * If a `{{CANARY}}` placeholder is present, the *first* occurrence is
 * replaced with the raw token value (so it blends naturally into a template
 * file, e.g. a `.env.example`). Otherwise, a clearly labeled comment line
 * carrying the token is appended at the end of the file, using a comment
 * syntax appropriate to the file's extension.
 */
export function insertCanaryToken(
  content: string,
  token: string,
  label: string,
  filePath: string,
): SeedInsertion {
  if (content.includes(CANARY_PLACEHOLDER)) {
    return {
      content: content.replace(CANARY_PLACEHOLDER, token),
      method: "placeholder",
    };
  }

  const needsLeadingNewline = content.length > 0 && !content.endsWith("\n");
  const separator = needsLeadingNewline ? "\n" : "";
  const line = commentLineFor(filePath, label, token);
  return {
    content: `${content}${separator}${line}\n`,
    method: "appended",
  };
}

/** Read `filePath`, insert the canary token, and write the result back. Returns the method used. */
export async function seedFile(
  filePath: string,
  token: string,
  label: string,
): Promise<"placeholder" | "appended"> {
  const original = await readFile(filePath, "utf8");
  const { content, method } = insertCanaryToken(original, token, label, filePath);
  await writeFile(filePath, content, "utf8");
  return method;
}
