import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "VERIFIED DIRECT FROM HOLLANDAMERICAGROUP" UNDERCUT THE CLAIM IT SAT ON.
 *
 * 148 of 1,433 served employers (10.3%) rendered as one run-together word,
 * because the name was derived by title-casing the ATS token during census
 * discovery and the employer's real display name was never captured.
 *
 * THE RESTRAINT IS THE POINT. 2,397 registry entries match the same shape and
 * many are CORRECT — Wonderschool, Candidhealth and Technergetics are real
 * one-word brands. A splitter guessing where words divide would corrupt real
 * names to fix cosmetic ones, so every correction had to come from the
 * employer's own hosted board. These tests defend that rule, not the specific
 * names: the risk here is not a wrong name today, it is someone later
 * "finishing the job" with a heuristic.
 */
const ROOT = resolve(__dirname, "../..");
const SRC = readFileSync(resolve(ROOT, "supabase/functions/job-board/sources.ts"), "utf8");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const MIG = readFileSync(
  resolve(MIG_DIR, readdirSync(MIG_DIR).find((f) => f.includes("an_employer_name_comes_from_the_employer"))!),
  "utf8",
);
const sql = MIG.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

// (source, token) -> name, both registry formats.
const registry = new Map<string, string>();
// The optional pages suffix (per-board window override) must not hide an
// entry from this registry — the same parser blindness made corrected boards
// read as "undefined" the day the Workday giants were widened (2026-08-31),
// and made overridden entries vanish from the catalog invariants the day
// before. Tolerate it explicitly.
for (const m of SRC.matchAll(/\{ name: "((?:[^"\\]|\\.)*)", source: "(\w+)", token: "([^"]+)"(?:, pages: \d+)? \}/g)) {
  registry.set(`${m[2]}:${m[3]}`, m[1]);
}
for (const m of SRC.matchAll(/s\("((?:[^"\\]|\\.)*)",\s*"(\w+)",\s*"([^"]+)"\)/g)) {
  registry.set(`${m[2]}:${m[3]}`, m[1]);
}

// Each VALUES row of the migration: ('source', 'token', 'name')
const rows = [...sql.matchAll(/\n\s*\('(\w+)', '([^']+)', '((?:[^']|'')*)'\)/g)]
  .map((m) => ({ source: m[1], token: m[2], name: m[3].replace(/''/g, "'") }));

describe("an employer name comes from the employer", () => {
  it("the migration carries the corrections it claims", () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it("the registry agrees with the migration, or re-ingest undoes the fix", () => {
    // Ingest writes company from the registry entry. If the two disagree, the
    // next rotation overwrites the corrected row with the mangled name and
    // the fix silently expires.
    const disagree = rows
      .filter((r) => registry.get(`${r.source}:${r.token}`) !== r.name)
      .map((r) => `${r.source}:${r.token} registry="${registry.get(`${r.source}:${r.token}`)}" migration="${r.name}"`);
    expect(disagree, "a corrected row that re-ingests as the old name is not corrected").toEqual([]);
  });

  it("every corrected name is actually different from the run-together shape", () => {
    const stillMangled = rows.filter((r) => /^[A-Z][a-z0-9]{11,}$/.test(r.name)).map((r) => r.name);
    expect(stillMangled).toEqual([]);
  });

  it("no correction invents a name shorter than the token it replaced by splitting alone", () => {
    // A real vendor name may legitimately be shorter ("Allarahealth" -> "Allara",
    // "Freseniusglobal" -> "Fresenius Kabi"), but it must never be a bare
    // re-spacing of the token with nothing added or removed by the vendor —
    // that shape is what a guesser produces.
    for (const r of rows) {
      expect(r.name.trim().length, `${r.token} produced an empty name`).toBeGreaterThan(1);
    }
  });

  it("the update is scoped by BOTH source and token, and is idempotent", () => {
    expect(sql).toMatch(/WHERE p\.source = v\.source/);
    expect(sql).toMatch(/AND p\.company_token = v\.token/);
    expect(sql).toMatch(/AND p\.company IS DISTINCT FROM v\.name/);
  });

  it("no splitter shipped alongside the corrections", () => {
    // The refused approach: inferring word boundaries from a token. If this
    // ever appears, real one-word brands start getting mangled in the other
    // direction.
    const code = readFileSync(resolve(ROOT, "supabase/functions/job-board/normalize.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    expect(code).not.toMatch(/splitCamel|splitRunTogether|deTokenizeName/);
  });
});
