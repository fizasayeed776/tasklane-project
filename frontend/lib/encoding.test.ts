import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

describe("source encoding", () => {
  it("contains no common mojibake sequences in app or lib TypeScript", () => {
    const forbiddenSequences = [
      "\u0393",
      "\u2229\u255c",
      "\u00e2\u20ac",
      "\u00c3",
    ];
    const files = [
      ...sourceFiles(path.join(frontendRoot, "app")),
      ...sourceFiles(path.join(frontendRoot, "lib")),
    ];
    const matches = files.flatMap((file) => {
      const contents = readFileSync(file, "utf8");
      return forbiddenSequences.some((sequence) => contents.includes(sequence))
        ? [path.relative(frontendRoot, file)]
        : [];
    });

    expect(matches).toEqual([]);
  });
});
