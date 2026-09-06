import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CATALOG,
  CODE_SOURCE,
  MIN_EXPECTED_BOARDS,
  SOURCES_PATH,
  stripTsComments,
  type CatalogEntry,
} from "./helpers/catalog";

/**
 * "VERIFIED DIRECT FROM HOLLANDAMERICAGROUP" UNDERCUT THE CLAIM IT SAT ON.
 *
 * 148 of 1,433 served employers (10.3%) rendered as one run-together word,
 * because the name was derived by title-casing the ATS token during census
 * discovery and the employer's real display name was never captured.
 *
 * THE RESTRAINT IS THE POINT. 2,397 registry entries matched the same shape
 * when the corrections shipped (2,612 across the whole catalog as read today)
 * and many are CORRECT — Wonderschool, Candidhealth and Technergetics are real
 * one-word brands. A splitter guessing where words divide would corrupt real
 * names to fix cosmetic ones, so every correction had to come from the
 * employer's own hosted board. These tests defend that rule, not the specific
 * names: the risk here is not a wrong name today, it is someone later
 * "finishing the job" with a heuristic.
 *
 * HOW THIS FILE WENT BLIND (2026-09-06). The registry used to be rebuilt here
 * by two regexes over the raw text of sources.ts — one for `{ name: ... }`
 * object literals, one for `s("name", "vendor", "token")` calls. The catalog
 * was then repacked into 406 packed string literals to get the edge function
 * back under the deploy cap, and those regexes went from seeing 44,544 boards
 * to seeing 465. Twenty-two of the twenty-four corrected boards read as
 * `registry="undefined"`. The parser is no longer written here: the catalog is
 * read through src/test/helpers/catalog.ts, which knows all three entry forms,
 * refuses to return a short parse, and is shared with the other catalog guards
 * so they cannot go blind one at a time again.
 */
const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const MIG = readFileSync(
  resolve(MIG_DIR, readdirSync(MIG_DIR).find((f) => f.includes("an_employer_name_comes_from_the_employer"))!),
  "utf8",
);
/** SQL with `--` comment lines dropped. Assert SQL CODE against this, prose against MIG. */
const sql = MIG.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

const keyOf = (source: string, token: string) => `${source}:${token}`;

// (source, token) -> name, over the WHOLE catalog and every entry form.
// Ingest writes company from the registry entry, so this map is what the next
// rotation will put on the page.
const registry = new Map<string, string>();
const entriesByKey = new Map<string, CatalogEntry[]>();
for (const entry of CATALOG) {
  const k = keyOf(entry.source, entry.token);
  registry.set(k, entry.name);
  const bucket = entriesByKey.get(k);
  if (bucket) bucket.push(entry);
  else entriesByKey.set(k, [entry]);
}

// Each VALUES row of the migration: ('source', 'token', 'name')
const rows = [...sql.matchAll(/\n\s*\('(\w+)', '([^']+)', '((?:[^']|'')*)'\)/g)]
  .map((m) => ({ source: m[1], token: m[2], name: m[3].replace(/''/g, "'") }));

/**
 * Exactly what census discovery produced: the ATS tenant slug, title-cased.
 * A "correction" equal to this is the mangled name wearing a capital letter.
 */
const censusMangleOf = (token: string) => token.split("~")[0];

/** Every .ts of the job-board edge function, comments blanked (house rule). */
const jobBoardCode = (): Array<{ file: string; code: string }> => {
  const dir = dirname(SOURCES_PATH);
  const files = [
    ...readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => resolve(dir, f)),
    ...readdirSync(resolve(dir, "vendors")).filter((f) => f.endsWith(".ts"))
      .map((f) => resolve(dir, "vendors", f)),
  ];
  return files.map((file) => ({
    file: file.slice(ROOT.length + 1),
    // sources.ts is 4.5MB of catalog; the shared reader already stripped it.
    code: file === SOURCES_PATH ? CODE_SOURCE : stripTsComments(readFileSync(file, "utf8")),
  }));
};

describe("an employer name comes from the employer", () => {
  it("the registry is read from the whole catalog, not the parsable fraction", () => {
    // The guard below compares 24 corrections against the registry. If the
    // reader can only see part of the catalog, "they all agree" is a statement
    // about the part it could parse — which is how 22 of 24 corrections read as
    // `undefined` and nobody noticed the fix had expired.
    expect(
      CATALOG.length,
      "the catalog reader has gone blind to an entry form",
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_BOARDS);
    expect(registry.size).toBeGreaterThanOrEqual(MIN_EXPECTED_BOARDS);
  });

  it("the migration carries the corrections it claims", () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it("every corrected board is in the catalog, registered exactly once", () => {
    // A correction keyed to a board that is not in the catalog corrects nothing
    // and will never be re-asserted by ingest. A board registered TWICE makes
    // the agreement check below meaningless: the registry keeps the last
    // writer, so ingest could still be writing the other name.
    const missing = rows
      .filter((r) => !entriesByKey.has(keyOf(r.source, r.token)))
      .map((r) => keyOf(r.source, r.token));
    expect(missing, "a correction with no catalog board behind it").toEqual([]);

    const duplicated = rows
      .map((r) => entriesByKey.get(keyOf(r.source, r.token)) ?? [])
      .filter((bucket) => bucket.length > 1)
      .map((bucket) =>
        `${keyOf(bucket[0].source, bucket[0].token)} registered ${bucket.length}x: ` +
        bucket.map((e) => `"${e.name}"(${e.form}@${e.index})`).join(", "),
      );
    expect(duplicated, "two registry entries for one board: the name ingest writes is a coin flip").toEqual([]);
  });

  it("the registry agrees with the migration, or re-ingest undoes the fix", () => {
    // Ingest writes company from the registry entry. If the two disagree, the
    // next rotation overwrites the corrected row with the mangled name and
    // the fix silently expires.
    const disagree = rows
      .filter((r) => registry.get(keyOf(r.source, r.token)) !== r.name)
      .map((r) => `${keyOf(r.source, r.token)} registry="${registry.get(keyOf(r.source, r.token))}" migration="${r.name}"`);
    expect(disagree, "a corrected row that re-ingests as the old name is not corrected").toEqual([]);
  });

  it("an entry carrying pages or agency is still in the registry", () => {
    // This used to be a comment. Twice — the day the Workday giants were
    // widened (2026-08-31) and the day the agency flag landed — a parser that
    // did not tolerate an optional trailing field dropped those entries, and a
    // corrected employer that later gained `pages` or `agency: true` would have
    // vanished from this registry and had its name fix expire on re-ingest. A
    // comment cannot fail; this can.
    const withPages = CATALOG.filter((e) => e.pages !== undefined);
    const withAgency = CATALOG.filter((e) => e.agency !== undefined);
    expect(withPages.length, "no entry carries `pages` — this check has gone vacuous").toBeGreaterThan(0);
    expect(withAgency.length, "no entry carries `agency` — this check has gone vacuous").toBeGreaterThan(0);

    const dropped = [...withPages, ...withAgency]
      .filter((e) => registry.get(keyOf(e.source, e.token)) !== e.name)
      .map((e) => `${keyOf(e.source, e.token)} ("${e.name}") is not in the registry it belongs to`);
    expect(dropped).toEqual([]);
  });

  it("every corrected name is actually different from the run-together shape", () => {
    const stillMangled = rows.filter((r) => /^[A-Z][a-z0-9]{11,}$/.test(r.name)).map((r) => r.name);
    expect(stillMangled).toEqual([]);

    // Length-independent form of the same property: the mangle was the ATS
    // tenant slug, title-cased. A short slug ("roshalimaging") produces a short
    // mangled name that the shape regex above lets through, so compare against
    // what discovery actually emitted rather than against a length threshold.
    const reMangled = rows
      .filter((r) => r.name.toLowerCase() === censusMangleOf(r.token).toLowerCase())
      .map((r) => `${r.token} "corrected" to its own tenant slug: "${r.name}"`);
    expect(reMangled).toEqual([]);
  });

  it("no correction produces an empty or one-character name", () => {
    // The rule this file defends — a name must come from the vendor, never from
    // re-spacing the token — is NOT decidable from the corrected name: "Essentia
    // Health" was read from the vendor's own board and is also, letter for
    // letter, a re-spacing of `essentiahealth`. The process rule is enforced by
    // "no splitter shipped" below; what is checkable here is that no correction
    // collapsed to nothing. Do not rename this test back into a claim it cannot
    // make.
    for (const r of rows) {
      expect(r.name.trim().length, `${r.token} produced an empty name`).toBeGreaterThan(1);
    }
  });

  it("the update is scoped by BOTH source and token, and is idempotent", () => {
    // Pin the property on EVERY statement that writes company, not the presence
    // of three spellings somewhere in the file: a second, unscoped UPDATE
    // appended below the first would satisfy a `toMatch` on the whole script
    // while rewriting the company of every posting in the table.
    const updates = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => /\bUPDATE\b/i.test(s) && /\bSET\b[\s\S]*\bcompany\b/i.test(s));
    expect(updates.length, "no UPDATE ... SET company found — the migration moved").toBeGreaterThan(0);

    for (const stmt of updates) {
      const head = stmt.slice(0, 60).replace(/\s+/g, " ");
      // Alias-agnostic: the join must be on the vendor AND the tenant token.
      expect(stmt, `unscoped by source: ${head}`).toMatch(/\.\s*source\s*=\s*\w+\s*\.\s*source/i);
      expect(stmt, `unscoped by token: ${head}`).toMatch(/\.\s*company_token\s*=\s*\w+\s*\.\s*token/i);
      expect(stmt, `not idempotent: ${head}`).toMatch(/\bcompany\s+IS\s+DISTINCT\s+FROM\b/i);
    }
  });

  it("no splitter shipped alongside the corrections", () => {
    // The refused approach: inferring word boundaries from a token. If this
    // ever appears, real one-word brands start getting mangled in the other
    // direction. Pin the MECHANISM as well as the three names it was nearly
    // shipped under — a splitter renamed `prettifyTenant` is still a splitter —
    // and scan the whole edge function, not just normalize.ts, since the file a
    // name is derived in can move.
    const files = jobBoardCode();
    expect(
      files.map((f) => f.file).filter((f) => f.endsWith("/normalize.ts")).length,
      "normalize.ts is no longer in the scanned set — this guard is scanning the wrong place",
    ).toBe(1);
    expect(files.length).toBeGreaterThan(5);

    const named = /splitCamel|splitRunTogether|deTokenizeName/;
    // …and the mechanism itself: inserting a space at a lower→upper boundary.
    const mechanism = /\[a-z0-9\]\)\s*\(\[A-Z\]|\[a-z\]\)\s*\(\[A-Z\]|\[a-z0-9\]\)\s*\(\?=\[A-Z\]|\[a-z\]\)\s*\(\?=\[A-Z\]/;
    const offenders = files
      .filter((f) => named.test(f.code) || mechanism.test(f.code))
      .map((f) => f.file);
    expect(offenders, "a token splitter reached the job-board function").toEqual([]);
  });
});
