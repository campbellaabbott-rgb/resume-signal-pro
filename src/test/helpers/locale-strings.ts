/**
 * WHAT A READER OF EACH LANGUAGE IS ACTUALLY SERVED: the main locale file
 * with every string shard merged in, exactly as src/i18n/index.ts merges them.
 *
 * Claim guards that scanned src/i18n/locales/*.json alone would let a banned
 * phrase live in src/i18n/shards/<group>/<lng>.json unseen. Every prose scan
 * reads through here instead.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { mergeShards, type Bundle, type Shard } from "../../i18n/merge-shards";

export const I18N_DIR = resolve(__dirname, "../../i18n");
export const LOCALE_DIR = join(I18N_DIR, "locales");
export const SHARD_DIR = join(I18N_DIR, "shards");

/** "en.json", "de.json", … — the nine main locale files. */
export const LOCALE_FILES: string[] = readdirSync(LOCALE_DIR).filter((f) => f.endsWith(".json")).sort();

/** Shard directory names present on disk: "listing", "company", … */
export function shardNames(): string[] {
  if (!existsSync(SHARD_DIR)) return [];
  return readdirSync(SHARD_DIR).filter((d) => statSync(join(SHARD_DIR, d)).isDirectory()).sort();
}

export function readMainLocale(file: string): Bundle {
  return JSON.parse(readFileSync(join(LOCALE_DIR, file), "utf8")) as Bundle;
}

/** Every shard's file for one language ("de.json"), parsed. */
export function readShards(file: string): Shard[] {
  return shardNames()
    .map((name) => ({ name, path: join(SHARD_DIR, name, file) }))
    .filter((s) => existsSync(s.path))
    .map((s) => ({ name: s.name, bundle: JSON.parse(readFileSync(s.path, "utf8")) as Bundle }));
}

/** The main locale with its shards merged, as the app serves it. */
export function readLocale(file: string): Bundle {
  return mergeShards(readMainLocale(file), readShards(file));
}

/** [dotted key, value] for every string a bundle holds. */
export function stringLeaves(o: unknown, prefix = ""): Array<[string, string]> {
  if (typeof o === "string") return [[prefix, o]];
  if (Array.isArray(o)) return o.flatMap((v, i) => stringLeaves(v, `${prefix}[${i}]`));
  if (o && typeof o === "object") {
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => stringLeaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

/** Only the strings that came from shards, for one language. */
export function shardLeaves(file: string): Array<[string, string]> {
  return readShards(file).flatMap((s) => stringLeaves(s.bundle));
}

/**
 * Phrases no listing or company string may carry, in any language, whatever
 * file it lives in (design spec 0.1): the board says where a job comes from,
 * never that it is "verified"; a takedown is never a fill; an early click is
 * never promised a reader.
 */
export const LISTING_BANNED_PHRASES: Array<[name: string, re: RegExp]> = [
  ["verified openings/roles", /\bverified (?:open|opening|role|job|posting)|verifizierte (?:offene|Stellen)|verificad[oa]s? (?:abiert|vacante|empleo)|vérifié(?:e|es|s)? (?:ouvert|offre|poste)|सत्यापित (?:खुले|नौकरी)|geverifieerde (?:vacature|open)|verificad[oa]s? (?:abert|vaga)|beripikadong (?:bukas|trabaho)/i],
  ["early applicants get read", /early applicants get read/i],
  ["a takedown called a fill", /\bfilled (?:by day|\d|in \d)|\bFilled \d|filled by day/i],
  ["zero ghost jobs", /zero ghost jobs/i],
];
