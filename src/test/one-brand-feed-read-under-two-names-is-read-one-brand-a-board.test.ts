// @vitest-environment node
/**
 * ONE BRAND FEED READ UNDER TWO NAMES IS READ ONE BRAND A BOARD.
 *
 * The sixth D7 page pair (docs/company-profiles/name-gate-dry-run.md, table 1,
 * SEO-036): /jobs/company/talent.reyesholdings.com ("Reyes Beverage Group")
 * and /jobs/company/jobportal.martinbrower.com ("Martin Brower") printed the
 * same page once names and numbers were out, because both catalogue entries
 * read one Reyes Holdings iCIMS feed, unfiltered. Measured 2026-10-25: the two
 * hosts' /api/jobs answers are byte-identical (673 postings, seven pages), both
 * tokens served the same 497 rows, and the board's search returned requisition
 * 37671 twice under two employers. Every posting names its own company, in
 * four fields that agree on all 673: Reyes Beverage Group 306, Reyes Coca-Cola
 * Bottling 173, Martin Brower 145, Reyes Fleet Management 32, Reyes Holdings 17.
 * The feed filters by &brand= on the server, and the five filtered totals add
 * up to the whole.
 *
 * So each board reads its own brand: the two carried entries gain `brand` in
 * place (no catalogue index moves, no name or token changes), the other three
 * brands get boards of their own appended after JPMorgan Chase, fetchIcims
 * adds &brand= only for an entry that names one, and migration 20261025110000
 * moves the other brands' rows off the two carried boards as untracked exits
 * (never closures: they are open on their own boards), after job-board .95
 * serves.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { JOB_SOURCES as COPY } from "../../supabase/functions/layoff-filings/board-sources";
import { codeOf } from "./helpers/strip-comments";
import * as L from "../../scripts/deploy-ledger.mjs";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
type Src = (typeof JOB_SOURCES)[number] & { brand?: string };
const BRANDS: Array<[string, string]> = [
  ["jobportal.martinbrower.com", "Martin Brower"],
  ["talent.reyesholdings.com", "Reyes Beverage Group"],
  ["jobportal.reyescocacola.com", "Reyes Coca-Cola Bottling"],
  ["jobportal.reyesfleet.com", "Reyes Fleet Management"],
  ["jobportal.reyesholdings.com", "Reyes Holdings"],
];

describe("the catalogue: five Reyes boards, each one brand of the shared feed", () => {
  it("each Reyes board is iCIMS and reads the brand its name says, in the feed's own spelling", () => {
    for (const [token, name] of BRANDS) {
      const s = JOB_SOURCES.filter((x) => x.token === token) as Src[];
      expect(s.length, token).toBe(1);
      expect(s[0], token).toMatchObject({ source: "icims", name, brand: name });
    }
  });

  it("brand appears on these five iCIMS entries, Exelon's six (trust round 3) and nowhere else", () => {
    const EXELON = ["careers.delmarva.com", "careers.comed.com", "careers.bge.com", "careers.peco.com", "careers.pepco.com", "careers.atlanticcityelectric.com"];
    const branded = (JOB_SOURCES as Src[]).filter((s) => s.brand !== undefined);
    expect(branded.map((s) => s.token).sort()).toEqual([...BRANDS.map(([t]) => t), ...EXELON].sort());
    for (const s of branded) expect(s.source).toBe("icims");
  });

  it("the two carried boards keep their catalogue places and names; the three new ones come after JPMorgan Chase", () => {
    const at = (t: string) => JOB_SOURCES.findIndex((s) => s.token === t);
    expect(at("jobportal.martinbrower.com")).toBe(28180);
    expect(at("talent.reyesholdings.com")).toBe(41021);
    expect(at("jpmc~~CX_1001")).toBe(44519);
    expect([at("jobportal.reyescocacola.com"), at("jobportal.reyesfleet.com"), at("jobportal.reyesholdings.com")]).toEqual([44520, 44521, 44522]);
    expect(JOB_SOURCES.length).toBe(44523);
  });

  it("layoff-filings' copy carries the same five, field for field", () => {
    const pick = (l: Src[]) => l.filter((s) => BRANDS.some(([t]) => t === s.token)).map((s) => JSON.stringify(s));
    expect(pick(COPY as Src[])).toEqual(pick(JOB_SOURCES as Src[]));
    expect(readFileSync(resolve(ROOT, "supabase/functions/layoff-filings/board-sources.ts"), "utf8")).toBe(readFileSync(resolve(ROOT, "supabase/functions/job-board/sources.ts"), "utf8"));
  });
});

describe("the reader: an entry with a brand asks the feed for that brand only", () => {
  const code = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
  it("fetchIcims is the one place job-board builds an iCIMS feed URL, and it adds &brand= only when the entry names one", () => {
    const urls = code.match(/\/api\/jobs\?/g) ?? [];
    expect(urls.length).toBe(1);
    expect(code).toContain("`https://${s.token}/api/jobs?page=${page}&limit=${pageSize}${s.brand ? `&brand=${encodeURIComponent(s.brand)}` : \"\"}`");
  });
  it("the brand is sent encoded, as the feed spells it (spaces and hyphens survive the round trip)", () => {
    for (const [, name] of BRANDS) expect(decodeURIComponent(encodeURIComponent(name))).toBe(name);
    expect(encodeURIComponent("Reyes Coca-Cola Bottling")).toBe("Reyes%20Coca-Cola%20Bottling");
  });
});

describe("the deploy: this branch rides job-board .95 with JPMorgan Chase", () => {
  const policy = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
  it("trust/ branches belong to oracle-regionless, so they share its .95 with oh/integration", () => {
    expect(L.workstreamOf(policy, "trust/pages")).toBe("oracle-regionless");
    expect([...L.sharedReservation(policy, { ref: "origin/oh/integration", head: "trust/pages", mainJobBoard: "job-board.2026-09-09.93" })]).toEqual(["job-board.2026-09-09.95"]);
  });
  it("the Reyes migration waits for .95 to serve, and the names migration goes before it", () => {
    // A slice rule since the land/all recheck: the file waits for .95's first slice, which comes after its OPTIONS answer.
    expect(policy.migrationOrder["20261025110000"]?.after).toBe("slice:job-board@2026-09-09.95");
    expect(policy.migrationOrder["20261025100000"]?.before).toEqual(["fn:job-board"]);
  });
});

const MIG = "20261025110000_the_reyes_boards_keep_only_their_own_brand.sql";
describe("migration 20261025110000 on a real Postgres", () => {
  let db: PGlite;
  const sql = () => readFileSync(resolve(ROOT, "supabase/migrations", MIG), "utf8");
  const SINCE = "2026-10-26T10:00:00Z";
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
      INSERT INTO public.job_board_meta (k, v) VALUES ('slice_stats', '{"build":"2026-09-09.95","buildSince":"${SINCE}"}');
      INSERT INTO public.job_board_postings (id, source, company_token, company, title, category, apply_url, first_seen) VALUES
        ${post("talent.reyesholdings.com", 1, "careers-reyesbeveragegroup.icims.com")},
        ${post("talent.reyesholdings.com", 2, "careers-reyescocacola.icims.com")},
        ${post("talent.reyesholdings.com", 3, "careers-martinbrower.icims.com")},
        ${post("talent.reyesholdings.com", 4, "aucareers-reyesholdings.icims.com")},
        ${post("jobportal.martinbrower.com", 1, "careers-reyesbeveragegroup.icims.com")},
        ${post("jobportal.martinbrower.com", 2, "careers-reyescocacola.icims.com")},
        ${post("jobportal.martinbrower.com", 3, "careers-martinbrower.icims.com")},
        ${post("jobportal.martinbrower.com", 5, "nzcareers-reyesholdings.icims.com")},
        ${post("jobportal.martinbrower.com", 6, "careers-reyesfleetmanagement.icims.com")},
        ${post("jobportal.martinbrower.com", 7, "careers-reyesholdings.icims.com")},
        ${post("jobportal.reyescocacola.com", 2, "careers-reyescocacola.icims.com")},
        ${post("careers.example.com", 9, "careers-reyescocacola.icims.com")};
      INSERT INTO public.job_board_closures (posting_id, source, company_token, closed_at, batch_removed, batch_live_before) VALUES
        ('icims:talent.reyesholdings.com:20', 'icims', 'talent.reyesholdings.com', '2026-10-26T12:00:00Z', 232, 497),
        ('icims:jobportal.martinbrower.com:21', 'icims', 'jobportal.martinbrower.com', '2026-10-26T12:00:00Z', 386, 497),
        ('icims:talent.reyesholdings.com:22', 'icims', 'talent.reyesholdings.com', '2026-10-26T13:00:00Z', 3, 265),
        ('icims:talent.reyesholdings.com:23', 'icims', 'talent.reyesholdings.com', '2026-10-20T12:00:00Z', 300, 497),
        ('icims:careers.example.com:24', 'icims', 'careers.example.com', '2026-10-26T12:00:00Z', 300, 400);
    `);
    await db.exec(sql());
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });
  const ids = async (token: string) => (await db.query<{ id: string }>(`SELECT id FROM public.job_board_postings WHERE company_token = $1 ORDER BY id`, [token])).rows.map((r) => r.id.split(":").pop());

  it("talent.reyesholdings.com keeps only Reyes Beverage Group's portal; Martin Brower keeps its own portals, New Zealand's included", async () => {
    expect(await ids("talent.reyesholdings.com")).toEqual(["1"]);
    expect(await ids("jobportal.martinbrower.com")).toEqual(["3", "5"]);
  });

  it("every row it moves is an untracked exit, never a closure, and no other board is touched", async () => {
    const ex = (await db.query<{ posting_id: string; exit_reason: string }>(`SELECT posting_id, exit_reason FROM public.job_board_exits ORDER BY posting_id`)).rows;
    expect(ex.map((r) => r.posting_id)).toEqual([
      "icims:jobportal.martinbrower.com:1", "icims:jobportal.martinbrower.com:2", "icims:jobportal.martinbrower.com:6", "icims:jobportal.martinbrower.com:7",
      "icims:talent.reyesholdings.com:2", "icims:talent.reyesholdings.com:3", "icims:talent.reyesholdings.com:4",
    ]);
    expect(new Set(ex.map((r) => r.exit_reason))).toEqual(new Set(["untracked"]));
    expect(await ids("jobportal.reyescocacola.com")).toEqual(["2"]);
    expect(await ids("careers.example.com")).toEqual(["9"]);
  });

  it("a closure the scoped read wrote before the move, a batch of more than 30% of the board since .95's first slice, is marked suspect and listed; nothing else", async () => {
    const c = (await db.query<{ posting_id: string; suspect: boolean }>(`SELECT posting_id, suspect FROM public.job_board_closures ORDER BY event_id`)).rows;
    expect(c.map((r) => [r.posting_id.split(":").pop(), r.suspect])).toEqual([["20", true], ["21", true], ["22", false], ["23", false], ["24", false]]);
    const listed = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.job_board_closure_repairs WHERE repair = 'reyes_brand_scope_trust_pages'`)).rows[0].n;
    expect(listed).toBe(2);
  });

  it("is safe to run again", async () => {
    await db.exec(sql());
    expect(await ids("talent.reyesholdings.com")).toEqual(["1"]);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.job_board_exits`)).rows[0].n).toBe(7);
  });

  it("refuses to run while an older build serves, since its unscoped read would put the rows back", async () => {
    await db.exec(`UPDATE public.job_board_meta SET v = '{"build":"2026-09-09.93","buildSince":"2026-10-20T00:00:00Z"}' WHERE k = 'slice_stats'`);
    await expect(db.exec(sql())).rejects.toThrow(/20261025110000.*2026-09-09\.95/);
    await db.exec(`UPDATE public.job_board_meta SET v = '{"build":"2026-09-09.95","buildSince":"${SINCE}"}' WHERE k = 'slice_stats'`);
  });
});
