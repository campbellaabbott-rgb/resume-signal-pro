// @vitest-environment node
/**
 * A MIGRATION STAMPED EARLIER TOUCHES NOTHING A LATER STAMP DEFINED (spec
 * 2026-10-11 §3.2-3.3; built after the review of 9fe3bc0d found neither check
 * existed).
 *
 * Migration stamps need not sort in deploy order: wave 4's 20261011* deploys
 * after profiles' 20261012*. If an unapplied migration defines or alters an
 * object that an applied migration with a later stamp defines, applying it
 * puts the older definition back. The ledger now exits 7 and names both files
 * (lateStampViolations), and exits 8 when a function's live build is later
 * than the one main carries (liveAheadRows): a deploy from main would roll it
 * back.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lateStampViolations, liveAheadRows, objectsOf } from "../../scripts/deploy-ledger.mjs";

const SQL: Record<string, string> = {
  "20261011100000_early.sql": `
    -- CREATE FUNCTION public.mentioned_in_prose() is no object
    CREATE OR REPLACE FUNCTION public.employer_key(p text) RETURNS text LANGUAGE sql AS $$ SELECT p $$;
    ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS x int;`,
  "20261011101000_unrelated.sql": "CREATE TABLE IF NOT EXISTS public.mcp_calls_daily (day date);",
  "20261012100000_later.sql": `
    CREATE OR REPLACE FUNCTION "public"."employer_key"(p_name text, p_source text) RETURNS text LANGUAGE sql AS $$ SELECT p_name $$;
    CREATE TABLE public.employer_profiles (k text);`,
  "20261012110000_later_table.sql": "CREATE TABLE public.job_board_postings_shadow (id text); CREATE INDEX IF NOT EXISTS jbp_idx ON public.job_board_postings (id);",
};
const sqlOf = (f: string) => SQL[f];

describe("what a migration defines and touches", () => {
  it("reads CREATE, ALTER and DROP by bare name, a function by name alone, and never a comment", () => {
    const o = objectsOf(SQL["20261011100000_early.sql"]);
    expect([...o.defines]).toEqual(["employer_key"]);
    expect([...o.touches].sort()).toEqual(["employer_key", "job_board_postings"]);
    expect(o.touches.has("mentioned_in_prose")).toBe(false);
    expect([...objectsOf("DROP FUNCTION IF EXISTS public.mcp_anon_check_v2(text, integer); CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS a_idx ON t (x);").touches].sort())
      .toEqual(["a_idx", "mcp_anon_check_v2"]);
  });
});

describe("the late-stamp rule", () => {
  it("an unapplied earlier migration that redefines what a later applied one defines is named, with both files", () => {
    const v = lateStampViolations(["20261011100000_early.sql", "20261011101000_unrelated.sql"], ["20261012100000_later.sql", "20261012110000_later_table.sql"], sqlOf);
    expect(v).toEqual([{ pending: "20261011100000_early.sql", applied: "20261012100000_later.sql", objects: ["employer_key"] }]);
  });

  it("an earlier APPLIED migration never counts, nor an index on a table that a later file only reads", () => {
    expect(lateStampViolations(["20261012100000_later.sql"], ["20261011100000_early.sql"], sqlOf)).toEqual([]);
    // 20261012110000 defines an index ON job_board_postings, not the table itself.
    expect(lateStampViolations(["20261011100000_early.sql"], ["20261012110000_later_table.sql"], sqlOf)).toEqual([]);
  });

  it("this checkout's own pending migrations revert nothing an applied migration with a later stamp defines", () => {
    const dir = resolve(__dirname, "../../supabase/migrations");
    const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f));
    const pending = files.filter((f) => f.startsWith("20261011"));
    const later = files.filter((f) => f.slice(0, 14) > "20261011999999");
    expect(lateStampViolations(pending, later, (f) => readFileSync(resolve(dir, f), "utf8"))).toEqual([]);
  });
});

describe("main behind production", () => {
  it("a row whose live build is later than main's is named; live and deploy rows are not", () => {
    const rows = [
      { fn: "a", want: "a.2026-10-11.2", have: "a.2026-10-11.3", state: "live-ahead" },
      { fn: "b", want: "b.2026-10-11.2", have: "b.2026-10-11.2", state: "live" },
      { fn: "c", want: "c.2026-10-11.2", have: "c.2026-10-09.1", state: "deploy" },
    ];
    expect(liveAheadRows(rows).map((r: { fn: string }) => r.fn)).toEqual(["a"]);
  });

  it("the report exits 7 for a late stamp and 8 for main behind production, after the order rules and before an unreachable function", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/deploy-ledger.mjs"), "utf8");
    expect(src).toMatch(/phases\.errors\.length \? 6 : late\.length \? 7 : liveAhead\.length \? 8\s*: unreachable\.length \? 4 : unbumped\.length \? 2 : 0/);
    expect(src).toMatch(/const late = lateStampViolations\(\[\.\.\.mig\.pending, \.\.\.mig\.hold\], mig\.applied,/);
  });
});

describe("section 49 reads both", () => {
  const runSection49 = (json: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "vd49-late-"));
    try {
      mkdirSync(join(dir, "scripts", "verify-deploy.d"), { recursive: true });
      writeFileSync(join(dir, "scripts", "deploy-ledger.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(json))});\n`);
      const body = readFileSync(resolve(__dirname, "../../scripts/verify-deploy.d/49-deploy-ledger.sh"), "utf8");
      return execFileSync("bash", ["-c", body], { cwd: dir, encoding: "utf8", timeout: 30_000 }).split("\n").filter(Boolean);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const base = { head: "abc", checkout: { refusal: null }, toDeploy: [], unreachable: [], unbumped: [], sharedOnly: [], noMarker: [], migrations: { pending: [], hold: [] }, phases: { errors: [] }, rows: [] };

  it("a late stamp and a function live ahead of main are each a FAIL naming what to fix", () => {
    const lines = runSection49({
      ...base,
      late: [{ pending: "20261011100000_early.sql", applied: "20261012100000_later.sql", objects: ["employer_key"] }],
      liveAhead: [{ fn: "agent-mcp", want: "agent-mcp.2026-10-11.2", have: "agent-mcp.2026-10-11.3", state: "live-ahead" }],
    });
    expect(lines.some((l) => /^FAIL  late stamp: 20261011100000_early\.sql touches employer_key, which the later, applied 20261012100000_later\.sql defines/.test(l)), lines.join("\n")).toBe(true);
    expect(lines.some((l) => /^FAIL  agent-mcp answers agent-mcp\.2026-10-11\.3, later than the agent-mcp\.2026-10-11\.2 main carries/.test(l)), lines.join("\n")).toBe(true);
  });

  it("the JSON the section reads carries the applied list's length, never the list (a pipe takes 64 KB before exit cuts it off)", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/deploy-ledger.mjs"), "utf8");
    expect(src).toMatch(/const \{ applied, \.\.\.migOut \} = mig;/);
    expect(src).toMatch(/migrations: \{ \.\.\.migOut, appliedCount: applied\.length \}/);
  });
});
