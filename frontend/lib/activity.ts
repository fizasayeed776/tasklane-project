export function activityGlyph(verb: string): string {
  if (verb.includes("assigned")) return "\u2197";
  if (verb.includes("status")) return "\u21bb";
  if (verb.includes("comment")) return "\u201c";
  return "+";
}
