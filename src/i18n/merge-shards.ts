/**
 * STRING SHARDS: how three groups add strings without sharing a file.
 *
 * The main locale files (src/i18n/locales/<lng>.json) belong to the design
 * system. The listing components write only src/i18n/shards/listing/<lng>.json
 * under the top-level key "listing"; the company page writes only
 * src/i18n/shards/company/<lng>.json under "companyProfile". At start-up each
 * language's shards are deep-merged into its one `translation` namespace, so a
 * component calls t("listing.…") like any other key.
 *
 * The rules, held by src/test/every-shard-string-is-loaded-translated-and-scanned.test.ts:
 *   - a shard defines keys only under its own root key;
 *   - a shard may not define a key that main or another shard defines (a
 *     collision would make which text wins depend on merge order);
 *   - each shard has the same key set in all nine languages.
 *
 * Pure: no i18next, no import.meta. src/i18n/index.ts feeds it the globbed files.
 */
export type Bundle = Record<string, unknown>;

/** The one top-level key each shard directory may write under. */
export const SHARD_ROOT_KEYS: Readonly<Record<string, string>> = {
  listing: "listing",
  company: "companyProfile",
};

export interface Shard {
  /** The directory name: "listing", "company". */
  name: string;
  bundle: Bundle;
}

const isPlainObject = (v: unknown): v is Bundle => !!v && typeof v === "object" && !Array.isArray(v);

/** A new object: `source` deep-merged over `target`. Neither input is mutated. */
export function deepMerge(target: Bundle, source: Bundle): Bundle {
  const out: Bundle = { ...target };
  for (const [k, v] of Object.entries(source)) {
    const cur = out[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out;
}

/** "./shards/listing/en.json" → { name: "listing", lng: "en" }; null for anything else. */
export function parseShardPath(path: string): { name: string; lng: string } | null {
  const m = String(path).match(/(?:^|\/)shards\/([a-z0-9-]+)\/([A-Za-z-]+)\.json$/);
  return m ? { name: m[1], lng: m[2] } : null;
}

/** The leaf key paths of a bundle, dotted. */
export function leafKeys(o: unknown, prefix = ""): string[] {
  if (!isPlainObject(o)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) out.push(...leafKeys(v, p));
    else out.push(p);
  }
  return out;
}

/** Every key path (leaf or branch) a bundle defines. */
function allPaths(o: unknown, prefix = ""): string[] {
  if (!isPlainObject(o)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p);
    out.push(...allPaths(v, p));
  }
  return out;
}

/**
 * What breaks the rules: a top-level key outside the shard's root, and any
 * LEAF a shard defines that main or an earlier shard already defines (or that
 * lands on a branch of theirs). Empty means the merge is order-independent.
 */
export function shardProblems(main: Bundle, shards: Shard[]): string[] {
  const problems: string[] = [];
  const owned = new Map<string, string>();
  for (const p of allPaths(main)) owned.set(p, "main");
  for (const s of shards) {
    const root = SHARD_ROOT_KEYS[s.name];
    if (!root) {
      problems.push(`shard "${s.name}" has no registered root key`);
      continue;
    }
    for (const top of Object.keys(s.bundle)) {
      if (top !== root) problems.push(`shard "${s.name}" writes outside "${root}": ${top}`);
    }
    for (const leaf of leafKeys(s.bundle)) {
      const by = owned.get(leaf);
      if (by) problems.push(`shard "${s.name}" redefines ${leaf} (already in ${by})`);
    }
    for (const p of allPaths(s.bundle)) if (!owned.has(p)) owned.set(p, `shard "${s.name}"`);
  }
  return problems;
}

/**
 * Merge a language's shards into its main bundle. A shard that breaks the
 * rules is still merged UNDER main (main's text wins) so a collision can
 * never silently replace a reviewed main-locale sentence at run time; the
 * guard test fails the build on it either way.
 */
export function mergeShards(main: Bundle, shards: Shard[]): Bundle {
  let merged = main;
  for (const s of [...shards].sort((a, b) => a.name.localeCompare(b.name))) {
    merged = deepMerge(s.bundle, merged);
  }
  return merged;
}

/** The shards in a glob result for one language (fr-CA reads fr). */
export function shardsFor(modules: Record<string, unknown>, lng: string): Shard[] {
  const want = lng === "fr-CA" ? "fr" : lng;
  const out: Shard[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const parsed = parseShardPath(path);
    if (!parsed || parsed.lng !== want) continue;
    const bundle = isPlainObject(mod) && isPlainObject((mod as Bundle).default) ? ((mod as Bundle).default as Bundle) : mod;
    if (isPlainObject(bundle)) out.push({ name: parsed.name, bundle });
  }
  return out;
}
