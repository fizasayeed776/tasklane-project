import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { activityGlyph } from "@/lib/activity";

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

describe("activityGlyph", () => {
  it("returns the expected glyph for each activity type", () => {
    expect(activityGlyph("task_assigned")).toBe("\u2197");
    expect(activityGlyph("status_changed")).toBe("\u21bb");
    expect(activityGlyph("comment_added")).toBe("\u201c");
    expect(activityGlyph("task_created")).toBe("+");
    expect(activityGlyph("other_event")).toBe("+");
  });
});

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
