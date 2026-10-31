// @vitest-environment node
/**
 * THE SCOPE MIGRATIONS WAIT FOR A FIRST SLICE, THE MESSAGE SAYS SO, AND AN
 * OLDER SLICE STAMPING LAST CANNOT HIDE A CLOSURE (land/all recheck,
 * 2026-10-27, deploy findings 4 and 5).
 *
 * WHAT WAS WRONG.
 *   - 20261025110000 and 20261026110000 RAISE until
 *     job_board_meta.slice_stats.build names their job-board build or later,
 *     and only a slice of that build writes it, at the end of its board loop,
 *     minutes after an OPTIONS request already answers the build. The
 *     generated message told Lovable to check with an OPTIONS request, so
 *     following it handed Lovable a failing migration, and 20261025110000's
 *     refusal said "apply this file once .95 serves", which contradicts the
 *     OPTIONS answer Lovable had just seen. Lovable edits failing migrations
 *     (20261011212000); an edit that dropped the build check would bound the
 *     repair on .92's buildSince and mark real .92 closures suspect.
 *   - Both files mark the closures a scoped read wrote since buildSince. But
 *     firstSliceOf keeps buildSince only while the build that wrote last is
 *     its own: a .92 slice that began before the deploy and stamps after .96's
 *     first slice flips slice_stats back, and .96's next slice restarts
 *     buildSince later. Closures .96 wrote in between fell before the bound
 *     and stayed unmarked.
 *
 * WHAT HOLDS NOW, with the real policy, the real ledger and the real files:
 *   - the two rules are "slice:job-board@<build>", ordered exactly as
 *     fn:job-board@<build>, and the message tells Lovable to read the status
 *     action's sliceStats.build, that OPTIONS answers earlier, and that the
 *     remedy for a refusal is the same file again, unedited; a message with no
 *     such rule keeps its old wording;
 *   - 20261025110000 refuses in 20261026110000's words;
 *   - in Postgres, a closure written six minutes before the buildSince a
 *     reset left behind is still marked, and one two hours before is not.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as L from "../../scripts/deploy-ledger.mjs";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const policy = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
const migs = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const fileOf = (stamp: string) => migs.find((m) => m.startsWith(`${stamp}_`))!;
const repoBuild = (fn: string) => L.buildOf(fn, readFileSync(resolve(ROOT, "supabase/functions", fn, "index.ts"), "utf8"));
const rows = (live: Record<string, string>) => ["job-board", "process-email-queue"].map((fn) => {
  const want = repoBuild(fn);
  const have = live[fn] ?? null;
  return { fn, want, have, state: L.rowState(want, have) };
});
const LIVE = { "job-board": "job-board.2026-09-09.92", "process-email-queue": "process-email-queue.2026-10-14.1" };
const FILES = ["20261014120000", "20261025110000", "20261026110000"].map(fileOf);

describe("the policy names the slice each scope migration waits for", () => {
  it("20261025110000 waits for .95's slice and 20261026110000 for .96's", () => {
    expect(policy.migrationOrder["20261025110000"]?.after).toBe("slice:job-board@2026-09-09.95");
    expect(policy.migrationOrder["20261026110000"]?.after).toBe("slice:job-board@2026-09-09.96");
  });
});

describe("the message says what to read, and what to do if a file refuses", () => {
  const phases = L.migrationPhases(FILES, policy, rows(LIVE));
  const note = (stamp: string) => phases.afterFunctions.find((p: { file: string }) => p.file.startsWith(stamp))?.note ?? "";

  it("both scope files wait after the functions, for the status action's sliceStats.build, not an OPTIONS answer", () => {
    expect(phases.errors).toEqual([]);
    expect(phases.afterFunctions.map((p: { file: string }) => p.file.slice(0, 14))).toEqual(["20261014120000", "20261025110000", "20261026110000"]);
    for (const [stamp, build] of [["20261025110000", "2026-09-09.95"], ["20261026110000", "2026-09-09.96"]]) {
      expect(note(stamp)).toContain(`the job-board status action's sliceStats.build reads ${build} or later`);
      expect(note(stamp)).toMatch(/an OPTIONS answer is not enough/);
      expect(note(stamp)).toMatch(/If the file refuses, wait for the next slice and apply the same file again, unedited/);
      expect(note(stamp)).not.toMatch(/once job-board answers/);
    }
    expect(note("20261014120000")).toBe("once process-email-queue answers process-email-queue.2026-10-14.2 or later");
  });

  it("the step's lead names the status action and no longer sends every file to an OPTIONS request", () => {
    const lines: string[] = L.lovableMessage({ head: "abc12345", draftOf: "land/all", phases, toDeploy: [] });
    const lead = lines.find((l) => /^\d+\. Only once/.test(l)) ?? "";
    expect(lead).toMatch(/"sliceStats\.build" is what the job-board status action \(a POST of \{"action":"status"\}\) reports, which comes later/);
    expect(lead).not.toMatch(/check with an OPTIONS request/);
    expect(lines.filter((l) => /sliceStats\.build reads 2026-09-09\.9[56] or later/.test(l))).toHaveLength(2);
  });

  it("a message with no slice rule keeps its wording", () => {
    const only = L.migrationPhases([FILES[0]], policy, rows(LIVE));
    const lines: string[] = L.lovableMessage({ head: "abc12345", draftOf: "land/all", phases: only, toDeploy: [] });
    expect(lines.some((l) => /Only once the function each one names answers its build \(check with an OPTIONS request\)/.test(l))).toBe(true);
  });

  it("a slice rule orders like fn:job-board: met once that build serves, an error when main never reaches it or it names another function", () => {
    const met = L.migrationPhases(FILES, policy, rows({ "job-board": "job-board.2026-09-09.96", "process-email-queue": "process-email-queue.2026-10-14.2" }));
    expect(met.errors).toEqual([]);
    expect(met.afterFunctions).toEqual([]);
    expect(met.pre.find((p: { file: string }) => p.file.startsWith("20261025110000"))?.note).toBe("job-board already answers job-board.2026-09-09.96");
    const never = L.migrationPhases([FILES[1]], { migrationOrder: { "20261025110000": { after: "slice:job-board@2026-09-09.99" } } }, rows(LIVE));
    expect(never.errors.join("\n")).toMatch(/waits for job-board\.2026-09-09\.99, but main carries job-board\.2026-09-09\.\d+: that step can never come/);
    const other = L.migrationPhases([FILES[1]], { migrationOrder: { "20261025110000": { after: "slice:agent-mcp@2026-10-11.38" } } }, rows(LIVE));
    expect(other.errors.join("\n")).toMatch(/after "slice:agent-mcp@2026-10-11\.38" is neither/);
  });
});

describe("20261025110000 refuses in 20261026110000's words", () => {
  it("wait for sliceStats.build, then the same file again, unedited; never 'once .95 serves'", () => {
    const sql = readFileSync(resolve(MIG_DIR, fileOf("20261025110000")), "utf8");
    const raise = /RAISE EXCEPTION 'self-check 20261025110000: job_board_meta\.slice_stats names build[^;]+;/.exec(sql)?.[0] ?? "";
    expect(raise).toMatch(/Wait until the job-board status action''s sliceStats\.build reads 2026-09-09\.95/);
    expect(raise).toMatch(/then apply the same file again, unedited/);
    expect(raise).not.toMatch(/apply this file once \.95 serves/);
  });
});

/**
 * THE RESET. .96's first slice began at 12:00 and stamped; a .92 slice that
 * began before the deploy stamped after it; .96's next slice began at 12:08
 * and stamped buildSince 12:08. A scope-shaped closure .96 wrote at 12:02 is
 * the one the old bound lost.
 */
const RESET_SINCE = "2026-10-31T12:08:00Z";
const BASE = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz DEFAULT now());
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text, title text, category text,
    apply_url text, first_seen timestamptz, location text, country text, posted_at timestamptz, department text, region_code text,
    work_mode text, employment_type text, experience_band text, min_years int, salary_min_annual numeric,
    salary_max_annual numeric, salary_period text, salary_currency text, missing_since timestamptz);
  CREATE TABLE public.job_board_exits (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text, company_token text, company text,
    title text, category text, exit_reason text NOT NULL, posted_at timestamptz, days_on_board numeric, origin_basis text,
    exited_at timestamptz, department text, country text, region_code text, work_mode text, employment_type text,
    experience_band text, min_years int, salary_min_annual numeric, salary_max_annual numeric, salary_period text, salary_currency text);
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text NOT NULL, source text NOT NULL,
    company_token text NOT NULL, company text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '', closed_at timestamptz NOT NULL DEFAULT now(),
    suspect boolean NOT NULL DEFAULT false, batch_removed int, batch_live_before int);
  INSERT INTO public.job_board_meta (k, v) VALUES ('slice_stats', '{"build":"2026-09-09.96","buildSince":"${RESET_SINCE}"}');
`;
const suspects = async (db: PGlite) => new Map((await db.query<{ posting_id: string; suspect: boolean }>(
  `SELECT posting_id, suspect FROM public.job_board_closures`)).rows.map((r) => [r.posting_id.split(":").pop()!, r.suspect]));

describe("an older slice stamping last cannot hide a closure from 20261025110000", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(BASE + `
      INSERT INTO public.job_board_closures (posting_id, source, company_token, closed_at, batch_removed, batch_live_before) VALUES
        ('icims:talent.reyesholdings.com:60', 'icims', 'talent.reyesholdings.com', '2026-10-31T12:02:00Z', 232, 497),
        ('icims:jobportal.martinbrower.com:61', 'icims', 'jobportal.martinbrower.com', '2026-10-31T12:05:00Z', 386, 497),
        ('icims:talent.reyesholdings.com:62', 'icims', 'talent.reyesholdings.com', '2026-10-31T10:00:00Z', 232, 497),
        ('icims:talent.reyesholdings.com:63', 'icims', 'talent.reyesholdings.com', '2026-10-31T12:03:00Z', 3, 265);
    `);
    await db.exec(readFileSync(resolve(MIG_DIR, fileOf("20261025110000")), "utf8"));
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

  it("a scope-shaped closure six minutes before the reset buildSince is marked; one two hours before, or a small batch, is not", async () => {
    const c = await suspects(db);
    expect(c.get("60"), "12:02, 232 of 497, before a buildSince of 12:08").toBe(true);
    expect(c.get("61"), "12:05, 386 of 497").toBe(true);
    expect(c.get("62"), "10:00, two hours before the first slice").toBe(false);
    expect(c.get("63"), "3 of 265").toBe(false);
  });
});

describe("an older slice stamping last cannot hide a closure from 20261026110000", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(BASE + `
      CREATE TABLE public.job_board_closure_repairs (event_id bigint PRIMARY KEY, repair text NOT NULL, marked_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO public.job_board_postings (id, source, company_token, company, title, category, apply_url, first_seen) VALUES
        ('icims:careers.ynvgroup.com:70', 'icims', 'careers.ynvgroup.com', 'YNV Group', 'Role 70', 'other', 'https://careers-ynvgroup.icims.com/jobs/70/job', now()),
        ('icims:careers.ynvgroup.com:71', 'icims', 'careers.ynvgroup.com', 'YNV Group', 'Role 71', 'other', 'https://careers-ynvgroup.icims.com/jobs/71/job', now());
      INSERT INTO public.job_board_closures (posting_id, source, company_token, closed_at, batch_removed, batch_live_before) VALUES
        ('icims:careers.monifai.com:70', 'icims', 'careers.monifai.com', '2026-10-31T12:02:00Z', 2, 9),
        ('icims:careers.monifai.com:71', 'icims', 'careers.monifai.com', '2026-10-31T10:00:00Z', 2, 9);
    `);
    await db.exec(readFileSync(resolve(MIG_DIR, fileOf("20261026110000")), "utf8"));
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

  it("Teknowledge closing YNV Group's requisition six minutes before the reset buildSince is marked; two hours before is not", async () => {
    const c = await suspects(db);
    expect(c.get("70"), "12:02, its requisition stored on careers-ynvgroup").toBe(true);
    expect(c.get("71"), "10:00, two hours before the first slice").toBe(false);
  });
});
