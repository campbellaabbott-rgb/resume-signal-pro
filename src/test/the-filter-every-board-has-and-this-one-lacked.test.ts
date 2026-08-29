/**
 * EMPLOYMENT TYPE, END TO END OR NOT AT ALL.
 *
 * Nine of sixteen vendors state full-time/part-time/contract in the very list
 * payloads the ingest already fetches (measured live 2026-08-28 — ashby
 * "FullTime", lever categories.commitment, workable employment_type,
 * smartrecruiters typeOfEmployment, recruitee employment_type_code, personio
 * <schedule>, pinpoint employment_type_text, icims data.employment_type,
 * usajobs PositionSchedule). Two were already threaded through the salary
 * logic and thrown away. The board had no column, no filter, nothing.
 *
 * The five-filters incident is the reason this file pins EVERY layer: a
 * filter that reaches the browse path and not the RPCs silently downgrades
 * every search that uses it. And the one-function-one-signature guard caught
 * this migration's first draft dropping only the PRE-210000 overloads —
 * PGRST203 on every call — before it shipped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const NORM = strip(read("supabase/functions/job-board/normalize.ts"));
const BOARD = strip(read("supabase/functions/job-board/index.ts"));
const FILTERS = strip(read("supabase/functions/job-board/filters.ts"));
const MIG = read("supabase/migrations/20260828122000_employment_type_rides_every_path.sql");
const JOBS = strip(read("src/pages/Jobs.tsx"));
const DIGEST = strip(read("supabase/functions/send-search-digest/index.ts"));

describe("capture: structured fields only, nine vendors", () => {
  it("the mapper is closed-domain and never guesses from prose", () => {
    expect(NORM).toMatch(/export function normalizeEmploymentType/);
    for (const v of ["full_time", "part_time", "contract", "temporary", "internship"]) {
      expect(NORM).toContain(`"${v}"`);
    }
    expect(NORM, "an unknown vocabulary word must return null, not a guess").toMatch(/return null;\n\}/);
  });

  it("all nine vendors wire it", () => {
    const wires = NORM.match(/employmentType: normalizeEmploymentType\(/g) ?? [];
    expect(wires.length, "a vendor's capture vanished").toBeGreaterThanOrEqual(9);
  });
});

describe("the value reaches storage and every query path", () => {
  it("row write and stated-only patch", () => {
    expect(BOARD).toMatch(/employment_type: j\.employmentType \?\? null/);
    expect(BOARD, "vendor silence must never overwrite a stated value")
      .toContain('put("employment_type", (row as Record<string, unknown>).employment_type, (prev as Record<string, unknown>).employment_type, false)');
  });

  it("browse path binds and selects it", () => {
    expect(BOARD).toMatch(/q\.in\("employment_type", applied\.employmentType\.split\(","\)\)/);
    expect(BOARD).toMatch(/remote,work_mode,employment_type,department/);
  });

  it("all seven RPC sites pass it, spread-guarded for the deploy window", () => {
    const sites = BOARD.match(/p_employment_type: applied\.employmentType/g) ?? [];
    expect(sites.length, "a ranked/count/rescue site dropped the filter — the five-filters incident").toBe(7);
  });

  it("filters.ts validates the closed domain and names junk in ignoredFilters", () => {
    expect(FILTERS).toMatch(/EMPLOYMENT_TYPES = \["full_time", "part_time", "contract", "temporary", "internship"\]/);
    expect(FILTERS).toMatch(/ignored\.push\("employmentType"\)/);
    expect(FILTERS, "must be RPC-bound or the single-derivation guard lies").toMatch(/"employmentType",/);
  });
});

describe("the migration ships whole", () => {
  it("drops the LIVE overloads, not only the ancient ones", () => {
    // The exact defect the one-function-one-signature guard caught in draft:
    // a verbatim body copy carries the previous migration's DROP list, which
    // names the signatures THAT migration replaced — not the ones it created.
    expect(MIG).toMatch(/DROP FUNCTION IF EXISTS public\.search_jobs\(text, timestamptz, text, boolean, text, text, text\[\], numeric, text\[\], timestamptz, integer, text, integer, integer, text\[\], boolean, boolean, numeric, text, integer, text\);/);
  });

  it("binds inline via quote_literal — no positional shifts", () => {
    expect(MIG).toMatch(/v_etypes := ARRAY\(/);
    expect(MIG).toMatch(/quote_literal\(array_to_string\(v_etypes, ','\)\)/);
    expect(MIG, "fuzzy needs its own static predicate")
      .toMatch(/p_employment_type IS NULL OR p\.employment_type = ANY/);
  });

  it("returns the column and counts its coverage", () => {
    expect(MIG).toMatch(/work_mode text, employment_type text/);
    expect(MIG).toMatch(/'employmentType', count\(\*\) FILTER \(WHERE employment_type IS NOT NULL\)/);
  });
});

describe("intent lifts arm themselves on coverage", () => {
  it("'part time' lifts into the filter ONLY above the coverage floor", () => {
    // Against a thin corpus the lift would REPLACE a working literal-text
    // search with a near-empty filter — the exact downgrade the work-mode
    // lifts were measured not to be. The sentinel trips the caller's-own-
    // filter conflict rule, so below the floor the words stay in the query
    // and behaviour is byte-identical to before the lifts existed.
    expect(BOARD).toMatch(/etCovRaw >= 0\.25/);
    expect(BOARD).toMatch(/employmentType: "__uncovered"/);
    expect(BOARD, "the lift rules themselves").toMatch(/patch: \{ employmentType: "part_time" \}/);
    expect(BOARD).toMatch(/patch: \{ employmentType: "internship" \}/);
    expect(BOARD, "a caller's explicit filter must keep winning")
      .toMatch(/employmentType: \["employmentType"\]/);
  });
});

describe("the corrections RPC patches it — the silently-dropped-field class", () => {
  it("apply_posting_corrections carries the employment_type CASE branch", () => {
    // The fourth appearance of one defect class in a week: a hand-built
    // object dropping fields it was not taught. Measured live: hours after
    // .47, THREE typed rows corpus-wide — inserts only — because every
    // re-ingest patch went through an RPC that hand-lists its columns.
    const CORR = read("supabase/migrations/20260828140000_the_corrections_rpc_dropped_the_new_column.sql");
    expect(CORR).toMatch(/employment_type = CASE WHEN patch\.p \? 'employment_type'/);
    expect(CORR, "the comment must warn the next field-adder").toMatch(/ADDING A PATCHED FIELD AT THE EDGE REQUIRES ADDING IT HERE/);
  });
});

describe("the person can see, share, save and be mailed the filter", () => {
  it("control, URL both directions, chips, zero-help", () => {
    expect(JOBS).toMatch(/aria-label=\{t\("jobsPage\.employmentType\.label"/);
    expect(JOBS).toMatch(/initial\.get\("etype"\)/);
    expect(JOBS).toMatch(/p\.set\("etype", employmentType\)/);
    expect(JOBS).toMatch(/key: `etype:\$\{et\}`/);
    expect(JOBS).toMatch(/etype: \{ employmentType: "" \}/);
  });

  it("saved searches and the digest carry it", () => {
    const LIB = strip(read("src/lib/job-search-params.ts"));
    expect(LIB).toMatch(/if \(p\.employmentType\) qs\.set\("etype", p\.employmentType\)/);
    expect(LIB).toMatch(/employmentType: p\.employmentType \|\| undefined/);
    expect(DIGEST).toMatch(/employmentType: p\.employmentType \|\| undefined/);
    expect(JOBS, "the save site must store it").toMatch(/employmentType: employmentType \|\| undefined/);
  });
});
