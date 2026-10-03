#!/usr/bin/env node
/**
 * check-encoding.mjs
 *
 * Fails if any git-tracked text file in the repository:
 *   1. Is not valid UTF-8, OR
 *   2. Contains mojibake sequences (e.g. the CP1252 smart-quote pattern
 *      that appears as a 3-byte sequence starting with U+0393 + U+00C7,
 *      or the euro-sign pattern starting with U+00E2 + U+20AC)
 *      (Windows-1252 bytes decoded as Latin-1 then re-encoded as UTF-8)
 *
 * Usage:
 *   node scripts/check-encoding.mjs
 *   npm run check:quality
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── Config ──────────────────────────────────────────────────────────────────

// Binary extensions we skip entirely (images, fonts, compiled assets, etc.)
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".br",
  ".pyc",
  ".pyo",
  ".so",
  ".dll",
  ".exe",
  ".lock", // package-lock.json etc. are fine but huge — skip for speed
  ".map", // source maps
  ".coverage",
]);

// Known mojibake patterns (Windows-1252 / Latin-1 decoded as UTF-8).
// Patterns use Unicode escapes so this file does not trigger its own check.
const MOJIBAKE_PATTERNS = [
  // U+0393 (Γ) followed by U+00C7 (Ç) — CP1252 smart-quote as UTF-8 mojibake
  new RegExp("\u0393\u00c7", "u"),
  // U+00E2 (â) followed by U+20AC (€) — CP1252 euro/curly-quote mojibake
  new RegExp("\u00e2\u20ac", "u"),
  // U+00C3 (Ã) followed by U+00A9 (©) — CP1252 é mojibake
  new RegExp("\u00c3\u00a9", "u"),
  // U+00E2 (â) + U+201A (‚) + U+00AC (¬) — € variant mojibake
  new RegExp("\u00e2\u201a\u00ac", "u"),
  // U+00C3 (Ã) followed by NBSP — non-breaking-space mojibake
  new RegExp("\u00c3\u00a0", "u"),
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Check whether a Buffer is valid UTF-8 without BOM. */
function isValidUtf8(buf) {
  try {
    // TextDecoder in Node ≥ 18 throws on invalid sequences when fatal=true
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Return true if the string contains any known mojibake pattern. */
function hasMojibake(text) {
  return MOJIBAKE_PATTERNS.some((re) => re.test(text));
}

// ── Main ─────────────────────────────────────────────────────────────────────

// Get the repo root (one level up from scripts/)
const scriptDir = path.dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const repoRoot = path.resolve(scriptDir, "..");

// List all files tracked by git
let trackedFiles;
try {
  trackedFiles = execSync("git ls-files", { cwd: repoRoot, encoding: "utf-8" })
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
} catch (err) {
  console.error("check-encoding: could not run `git ls-files`:", err.message);
  process.exit(1);
}

const errors = [];

for (const relPath of trackedFiles) {
  const ext = path.extname(relPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) continue;

  const absPath = path.join(repoRoot, relPath);

  let buf;
  try {
    buf = readFileSync(absPath);
  } catch {
    // File may have been deleted between `git ls-files` and now — skip
    continue;
  }

  // 1. UTF-8 validity
  if (!isValidUtf8(buf)) {
    errors.push(`NOT UTF-8: ${relPath}`);
    continue; // no point checking mojibake on an invalid encoding
  }

  // 2. Mojibake
  const text = buf.toString("utf-8");
  if (hasMojibake(text)) {
    // Report the first offending line for context
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (hasMojibake(lines[i])) {
        errors.push(
          `MOJIBAKE  (line ${i + 1}): ${relPath}  →  ${lines[i].trim().slice(0, 80)}`,
        );
        break;
      }
    }
  }
}

if (errors.length > 0) {
  console.error("\ncheck-encoding FAILED — encoding issues found:\n");
  errors.forEach((e) => console.error("  ✗ " + e));
  console.error(`\n${errors.length} file(s) need attention.\n`);
  process.exit(1);
} else {
  console.log(
    `check-encoding: all ${trackedFiles.length} tracked text files are valid UTF-8 with no mojibake.`,
  );
  process.exit(0);
}
