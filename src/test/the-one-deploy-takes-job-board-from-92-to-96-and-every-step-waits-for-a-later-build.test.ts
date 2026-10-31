// @vitest-environment node
/**
 * THE ONE DEPLOY TAKES JOB-BOARD FROM .92 STRAIGHT TO .96, AND EVERY STEP THAT
 * WAITS FOR A BUILD TAKES A LATER ONE (land/all, 2026-10-27).
 *
 * The owner asked for everything ready to land in one Lovable session: wave 4
 * (.93), oracle-regionless and trust/pages (.95) and trust round 3 (.96) were
 * planned as three deploys, and none of .93 or .95 ever served. So production
 * goes from the live job-board 2026-09-09.92 to .96, and layoff-filings from
 * 2026-10-09.3 to 2026-10-26.1, in one message. This proves, with the real
 * policy (docs/deploy-ledger.json) and the real files:
 *   - the ledger orders the two name migrations (20261025100000,
 *     20261026100000) before the functions, and the two scope migrations
 *     (20261025110000 waiting for .95's first slice, 20261026110000 for
 *     .96's) after them, each "or later", so .96 releases both and no rule is
 *     unmeetable;
 *   - R1's 20261014120000 waits for process-email-queue .14.2 or later, and
 *     the perk sweep's 20261012111000 goes first (its function already serves);
 *   - wave 4's held 20261011103000 stays held in this message and is
 *     releasable once .96 and agent-mcp .38 serve (a second step);
 *   - the Reyes migration, written for .95, runs under .96 (the one-deploy
 *     case), refuses under .92, and still runs only once;
 *   - the build checks in both scope migrations compare "or later" on the
 *     build's day and sequence, never equality;
 *   - the name-sync lane at version 6 starts over from any stored version,
 *     with every RENAMED_TOKENS token and every override's board, so version
 *     5 never needs to have run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as L from "../../scripts/deploy-ledger.mjs";
import { nameSyncQueue } from "../../supabase/functions/job-board/name-sync";
import { codeOf, sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const policy = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
const migs = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const fileOf = (stamp: string) => {
  const f = migs.find((m) => m.startsWith(`${stamp}_`));
  if (!f) throw new Error(`no migration ${stamp}`);
  return f;
};
const repoBuild = (fn: string) => L.buildOf(fn, readFileSync(resolve(ROOT, "supabase/functions", fn, "index.ts"), "utf8"));

// What production answered on 2026-10-27 (the --draft run of land/all), and what the repository carries.
const LIVE: Record<string, string> = {
  "job-board": "job-board.2026-09-09.92",
  "layoff-filings": "layoff-filings.2026-10-09.3",
  "process-email-queue": "process-email-queue.2026-10-14.1",
  "agent-mcp": "agent-mcp.2026-10-09.71",
  "employer-profiles": "employer-profiles.2026-10-12.2",
};
const rowsWith = (live: Record<string, string>) => Object.keys(LIVE).map((fn) => {
  const want = repoBuild(fn);
  const have = live[fn] ?? null;
  return { fn, want, have, state: L.rowState(want, have) };
});

// The pending files this test cares about (the ledger reads the staged-runner record for the rest).
const PENDING = [
  "20261011103000", "20261012111000", "20261014120000",
  "20261025100000", "20261025110000", "20261026100000", "20261026110000",
].map(fileOf);
const HELD = [fileOf("20261011103000")];
const ORDERED = PENDING.filter((f) => !HELD.includes(f));

describe("the repository's builds are the ones the one deploy ships", () => {
  it("job-board .96 and layoff-filings 2026-10-26.1, over the live .92 and 2026-10-09.3", () => {
    expect(repoBuild("job-board")).toBe("job-board.2026-09-09.96");
    expect(repoBuild("layoff-filings")).toBe("layoff-filings.2026-10-26.1");
    const rows = rowsWith(LIVE);
    expect(rows.find((r) => r.fn === "job-board")?.state).toBe("deploy");
    expect(rows.find((r) => r.fn === "layoff-filings")?.state).toBe("deploy");
  });
});

describe("the ledger's order for one message, with .93 and .95 never served", () => {
  const phases = L.migrationPhases(ORDERED, policy, rowsWith(LIVE));
  const names = (p: Array<{ file: string }>) => p.map((x) => x.file.slice(0, 14));

  it("no rule is unmeetable", () => {
    expect(phases.errors).toEqual([]);
  });

  it("the two name migrations and the perk sweep go before the functions", () => {
    expect(names(phases.pre)).toEqual(["20261012111000", "20261025100000", "20261026100000"]);
    expect(phases.pre.find((p) => p.file.startsWith("20261025100000"))?.note).toBe("before job-board");
    expect(phases.pre.find((p) => p.file.startsWith("20261026100000"))?.note).toBe("before job-board");
  });

  it("R1's drain and both scope migrations wait for the build they name or later, which .96 and .14.2 are", () => {
    expect(names(phases.afterFunctions)).toEqual(["20261014120000", "20261025110000", "20261026110000"]);
    const note = (s: string) => phases.afterFunctions.find((p) => p.file.startsWith(s))?.note;
    // Each waits for its build's first slice (sliceStats.build), which comes after the OPTIONS answer (land/all recheck).
    expect(note("20261025110000")).toBe(L.sliceNote("2026-09-09.95"));
    expect(note("20261026110000")).toBe(L.sliceNote("2026-09-09.96"));
    expect(L.buildAtLeast(repoBuild("job-board"), "job-board.2026-09-09.95")).toBe(true);
    expect(L.buildAtLeast(repoBuild("job-board"), "job-board.2026-09-09.96")).toBe(true);
    expect(L.buildAtLeast(repoBuild("process-email-queue"), "process-email-queue.2026-10-14.2")).toBe(true);
  });

  it("once .96 serves, the Reyes rule written for .95 is met: an after rule is 'or later', never equality", () => {
    const after = L.migrationPhases(ORDERED, policy, rowsWith({ ...LIVE, "job-board": "job-board.2026-09-09.96", "process-email-queue": "process-email-queue.2026-10-14.2" }));
    expect(after.errors).toEqual([]);
    expect(after.afterFunctions).toEqual([]);
    expect(after.pre.find((p) => p.file.startsWith("20261025110000"))?.note).toBe("job-board already answers job-board.2026-09-09.96");
  });

  it("wave 4's hold stays held in this message, and is releasable once .96 and agent-mcp .38 serve", () => {
    const now = L.holdStates(HELD, policy, rowsWith(LIVE));
    expect(now.errors).toEqual([]);
    expect(now.holds).toHaveLength(1);
    expect(now.holds[0].releasable).toBe(false);
    const later = L.holdStates(HELD, policy, rowsWith({ ...LIVE, "job-board": repoBuild("job-board")!, "agent-mcp": repoBuild("agent-mcp")! }));
    expect(later.holds[0].releasable).toBe(true);
    expect(later.holds[0].conditions.map((c: { met: boolean }) => c.met)).toEqual([true, true]);
  });
});

describe("the scope migrations' own build checks are 'or later'", () => {
  for (const [stamp, n] of [["20261025110000", 95], ["20261026110000", 96]] as const) {
    it(`${stamp} accepts the day after 2026-09-09 or that day at .${n} and above`, () => {
      const sql = sqlCodeOf(readFileSync(resolve(MIG_DIR, fileOf(stamp)), "utf8"));
      expect(sql).toMatch(/split_part\(v_build, '\.', 1\) > '2026-09-09'/);
      expect(sql).toMatch(new RegExp(`split_part\\(v_build, '\\.', 2\\)::int >= ${n}\\)`));
      expect(sql).not.toMatch(/v_build\s*=\s*'2026-09-09\.\d+'/);
    });
  }
});

describe("20261025110000, written for .95, under .96 (the one deploy)", () => {
  let db: PGlite;
  const sql = () => readFileSync(resolve(MIG_DIR, fileOf("20261025110000")), "utf8");
  const SINCE = "2026-10-27T10:00:00Z";
  const post = (token: string, req: number, host: string) =>
    `('icims:${token}:${req}', 'icims', '${token}', 'X', 'Role ${req}', 'other', 'https://${host}/jobs/${req}/job', now() - interval '3 days')`;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz DEFAULT now());
      CREATE TABLE public.job_board_postings (
        id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text, title text, category text,
        apply_url text, first_seen timestamptz, posted_at timestamptz, department text, country text, region_code text,
        work_mode text, employment_type text, experience_band text, min_years int, salary_min_annual numeric,
        salary_max_annual numeric, salary_period text, salary_currency text, missing_since timestamptz);
      CREATE TABLE public.job_board_exits (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text, company_token text, company text,
        title text, category text, exit_reason text NOT NULL CHECK (exit_reason IN ('removed', 'aged_out', 'backdated', 'untracked', 'board_dormant')),
        posted_at timestamptz, days_on_board numeric, origin_basis text, exited_at timestamptz, department text, country text,
        region_code text, work_mode text, employment_type text, experience_band text, min_years int,
        salary_min_annual numeric, salary_max_annual numeric, salary_period text, salary_currency text);
      CREATE TABLE public.job_board_closures (
        event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text NOT NULL, source text NOT NULL,
        company_token text NOT NULL, company text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '', closed_at timestamptz NOT NULL DEFAULT now(),
        suspect boolean NOT NULL DEFAULT false, batch_removed int, batch_live_before int);
      INSERT INTO public.job_board_meta (k, v) VALUES ('slice_stats', '{"build":"2026-09-09.92","buildSince":"2026-10-09T00:00:00Z"}');
      INSERT INTO public.job_board_postings (id, source, company_token, company, title, category, apply_url, first_seen) VALUES
        ${post("talent.reyesholdings.com", 1, "careers-reyesbeveragegroup.icims.com")},
        ${post("talent.reyesholdings.com", 2, "careers-reyescocacola.icims.com")},
        ${post("jobportal.martinbrower.com", 3, "careers-martinbrower.icims.com")},
        ${post("jobportal.martinbrower.com", 6, "careers-reyesfleetmanagement.icims.com")};
      INSERT INTO public.job_board_closures (posting_id, source, company_token, closed_at, batch_removed, batch_live_before) VALUES
        ('icims:talent.reyesholdings.com:20', 'icims', 'talent.reyesholdings.com', '2026-10-27T12:00:00Z', 232, 497),
        ('icims:talent.reyesholdings.com:23', 'icims', 'talent.reyesholdings.com', '2026-10-26T12:00:00Z', 300, 497);
    `);
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });
  const ids = async (token: string) => (await db.query<{ id: string }>(`SELECT id FROM public.job_board_postings WHERE company_token = $1 ORDER BY id`, [token])).rows.map((r) => r.id.split(":").pop());

  it("refuses while the live .92 serves, so applied too early it changes nothing", async () => {
    await expect(db.exec(sql())).rejects.toThrow(/20261025110000.*2026-09-09\.92.*2026-09-09\.95 or later/);
    expect(await ids("talent.reyesholdings.com")).toEqual(["1", "2"]);
  });

  it("runs once .96's first slice is stamped: the other brands' rows leave as untracked exits, and only a closure since .96 began is suspect", async () => {
    await db.exec(`UPDATE public.job_board_meta SET v = '{"build":"2026-09-09.96","buildSince":"${SINCE}"}' WHERE k = 'slice_stats'`);
    await db.exec(sql());
    expect(await ids("talent.reyesholdings.com")).toEqual(["1"]);
    expect(await ids("jobportal.martinbrower.com")).toEqual(["3"]);
    const ex = (await db.query<{ exit_reason: string }>(`SELECT exit_reason FROM public.job_board_exits`)).rows;
    expect(ex.map((r) => r.exit_reason)).toEqual(["untracked", "untracked"]);
    const c = (await db.query<{ posting_id: string; suspect: boolean }>(`SELECT posting_id, suspect FROM public.job_board_closures ORDER BY event_id`)).rows;
    expect(c.map((r) => [r.posting_id.split(":").pop(), r.suspect])).toEqual([["20", true], ["23", false]]);
  });

  it("is safe to run again under .96", async () => {
    await db.exec(sql());
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.job_board_exits`)).rows[0].n).toBe(2);
  });
});

describe("the name-sync lane at version 6 needs no version 5", () => {
  const index = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));

  it("version 6, and the lane runs whenever the stored version is any other", () => {
    expect(index).toMatch(/const NAME_SYNC_VERSION = 6;/);
    expect(index).toMatch(/\?\.version !== NAME_SYNC_VERSION\)/);
  });

  it("its tokens are every RENAMED_TOKENS entry and every board an override names, not a version's own list", () => {
    expect(index).toMatch(/for \(const tk of RENAMED_TOKENS\) tokens\.add\(tk\);/);
    expect(index).toMatch(/for \(const s of JOB_SOURCES\) if \(overrideFor\(s\.token, overrides\) !== null\) tokens\.add\(s\.token\);/);
  });

  it("a progress record left by version 4 (the live .92's) starts the walk over from the first token", () => {
    const q = nameSyncQueue(["b", "a", "c"], { version: 4, after: "b", retry: ["a"] }, 6);
    expect(q).toEqual({ tokens: ["a", "b", "c"], retry: new Set(), resumeAfter: "" });
  });
});
