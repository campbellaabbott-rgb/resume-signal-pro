// @vitest-environment node
/**
 * A POSTING AGE IS NEVER OUR DISCOVERY DATE.
 *
 * WHAT HAPPENED (M16). get_application_lifecycle (20261009131000) measured
 * days_standing from the employer's date OR, where the employer gave none,
 * from first_seen, our crawler's discovery stamp, which has been mass-reset
 * more than once (the 2.8-day-median incident). Account printed it as "Still
 * posted - N+ days". The check endpoint built beside it would have been a
 * second reader of the same ledger, and the design's own rule for it was "no
 * first_seen in any age expression".
 *
 * THE PROPERTY.
 *   - posting_truth, company_facts and api_expensive_take (20261206100000)
 *     do not read first_seen at all.
 *   - The live get_application_lifecycle is 20261206110000's, and its
 *     days_standing is measured from posted_at alone. first_seen survives in
 *     its body only in the re-post comparison ("we saw it go back up after we
 *     saw it come down"), never in arithmetic.
 *   - Run in a real Postgres: an undated posting has no days_standing,
 *     whether it is still posted or came down; a dated one is measured from
 *     the employer's date, never negative; a lap-dated closure still keeps
 *     its row with no duration; the re-post probe answers as before; anon is
 *     refused and a signed-in account is answered.
 *   - The same id, come back after its takedown and stamped missing again,
 *     is going down with no duration and no closure date, as the check says
 *     (20261009131000 gave it the old takedown, and Account stored it).
 *   - A U.S. federal row (OD16, 2026-11-19) is handed on with our first
 *     sighting only as on_board_since, a stamp and never a day count, and its
 *     feed date is a feed date: USAJOBS re-dates reposted announcements, so
 *     the check and the shaper give it no age either.
 * The teeth: the pre-fix definition, run over the same rows, gives the
 * undated posting forty days from our first sighting, and the static checks
 * catch it in that file's text.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";
import { truthFromRow, type PostingTruthRow } from "../../supabase/functions/public-api/posting-truth";
import { postingAge } from "../../supabase/functions/public-api/date-classes";
import { federalFacts } from "../../supabase/functions/public-api/federal-rows";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");
const TRUTH = "20261206100000_a_posting_is_answered_by_what_we_saw_of_it.sql";
const M16 = "20261206110000_an_account_row_ages_from_the_employers_date.sql";
const PRE_FIX = "20261009131000_a_tracker_row_reads_the_closure_log_by_the_day_and_a_free_account_has_bounds.sql";

/** Code only: line-leading `--` comments dropped. */
const sqlCode = (t: string) => t.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

/** One function's body, cut at the dollar tag it opened with. */
function bodyOf(sql: string, fn: string): string {
  const at = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (at < 0) return "";
  const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at));
  if (!tag) return "";
  const open = at + tag.index + tag[0].length;
  return sql.slice(open, sql.indexOf(tag[1], open));
}

/** The newest migration that creates the function: the definition the database runs. */
function liveFile(fn: string): string {
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort()
    .filter((f) => read(f).includes(`CREATE OR REPLACE FUNCTION public.${fn}(`));
  return files[files.length - 1];
}

/** first_seen inside arithmetic on a line: a duration, an age, or a date minus it. */
const AGE_ARITHMETIC = /EXTRACT\s*\(\s*epoch|86400|\bage\s*\(|now\(\)\s*-|-\s*[\w.(]*first_seen|first_seen\s*\)*\s*-/i;
function firstSeenInArithmetic(code: string): string[] {
  return code.split("\n").filter((l) => /first_seen/.test(l) && AGE_ARITHMETIC.test(l)).map((l) => l.trim());
}
/** The days_standing expression: from its CASE to its alias. */
function daysStandingExpr(code: string): string {
  const end = code.indexOf("AS days_standing");
  return end < 0 ? "" : code.slice(code.lastIndexOf("CASE", end), end);
}

describe("no age is built from our discovery date (the text)", () => {
  it("the truth functions do not read first_seen at all", () => {
    const code = sqlCode(read(TRUTH));
    for (const fn of ["posting_truth", "company_facts", "api_expensive_take"]) {
      const body = bodyOf(code, fn);
      expect(body.length, `${fn} was not found`).toBeGreaterThan(500);
      expect(body, fn).not.toMatch(/first_seen/);
    }
    expect(code).not.toMatch(/first_seen/);
  });

  it("the live lifecycle is M16's, and its days_standing reads posted_at alone", () => {
    expect(liveFile("get_application_lifecycle")).toBe(M16);
    const body = sqlCode(bodyOf(read(M16), "get_application_lifecycle"));
    const expr = daysStandingExpr(body);
    expect(expr, "the expression is a duration").toMatch(/86400/);
    expect(expr).toMatch(/posted_at/);
    expect(expr).not.toMatch(/first_seen/);
    expect(firstSeenInArithmetic(body)).toEqual([]);
    expect(body.match(/first_seen/g), "first_seen is left only in the re-post comparison").toHaveLength(1);
    expect(body).toMatch(/p2\.first_seen >= cl\.closed_at/);
  });

  it("no coalesce of the employer's date with our discovery date remains in either file", () => {
    const COALESCED = /COALESCE\(\s*[\w.]*posted_at\s*,\s*[\w.]*first_seen\s*\)/i;
    expect(sqlCode(read(TRUTH))).not.toMatch(COALESCED);
    expect(sqlCode(read(M16))).not.toMatch(COALESCED);
  });

  it("the check's shaper has no discovery date to read, and an undated posting gets no age", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/public-api/posting-truth.ts"), "utf8");
    expect(src).not.toMatch(/first_seen|firstSeen/);
    const now = new Date("2026-12-06T12:00:00Z");
    const row: PostingTruthRow = {
      pt_id: "greenhouse:acme:1", pt_source: "greenhouse", pt_token: "acme", pt_title: "Clerk", pt_company: "Acme",
      pt_row_found: true, pt_listed: true, pt_in_window: true, pt_missing_since: null, pt_posted_at: null,
      pt_has_closure: false, pt_closed_at: null, pt_seen_gone_at: null, pt_closures: 0, pt_untrusted_gone_at: null,
      pt_untrusted_kind: null, pt_aged_at: null, pt_board_known: true,
      pt_bucket: "full_read", pt_read_at: "2026-12-06T09:00:00Z", pt_read_state: "ok", pt_capped: false,
    };
    const opts = { now, withheldSources: [], withheldReason: "withheld" };
    expect(truthFromRow(row.pt_id, row, opts).age).toMatchObject({ postedAt: null, day: null, days: null, dateClass: "none" });
    const dated = truthFromRow(row.pt_id, { ...row, pt_posted_at: "2026-12-01T08:00:00Z" }, opts);
    expect(dated.age).toMatchObject({ day: "2026-12-01", days: 5, dateClass: "employer" });
  });

  it("a federal row prints on_board_since, never an age, and its feed date gives no age either", () => {
    const now = new Date("2026-12-06T12:00:00Z");
    // USAJOBS re-dates a reposted announcement: its date is a feed date.
    expect(postingAge("usajobs", "2026-12-05", now)).toMatchObject({ day: "2026-12-05", days: null, dateClass: "feed_date_moves_on_edit" });
    const row: PostingTruthRow = {
      pt_id: "usajobs:usajobs:881700000", pt_source: "usajobs", pt_token: "usajobs", pt_title: "Transportation Security Officer", pt_company: "Transportation Security Administration",
      pt_row_found: true, pt_listed: true, pt_in_window: true, pt_missing_since: null, pt_posted_at: "2026-12-05T00:00:00Z",
      pt_has_closure: false, pt_closed_at: null, pt_seen_gone_at: null, pt_closures: 0, pt_untrusted_gone_at: null,
      pt_untrusted_kind: null, pt_aged_at: null, pt_board_known: true,
      pt_bucket: "full_read", pt_read_at: "2026-12-06T09:00:00Z", pt_read_state: "ok", pt_capped: false,
    };
    expect(truthFromRow(row.pt_id, row, { now, withheldSources: [], withheldReason: "withheld" }).age).toMatchObject({ days: null, dateClass: "feed_date_moves_on_edit" });
    // The first sighting is handed on verbatim as on_board_since: no field of
    // the federal block is a number of days.
    const facts = federalFacts({
      id: row.pt_id, source: "usajobs", company: row.pt_company, whoMayApply: "Open to the public", hiringPaths: ["public"],
      closesAt: "2026-12-20T23:59:59Z", firstSeen: "2026-09-01T03:00:00Z", applyUrl: null,
    })!;
    expect(facts.onBoardSince).toBe("2026-09-01T03:00:00Z");
    expect(Object.values(facts).filter((v) => typeof v === "number")).toEqual([]);
    // No key names an age or a day count ("agency" is the employer, not an age).
    expect(Object.keys(facts).filter((k) => /^(age|days)$|Age$|Days$/.test(k))).toEqual([]);
  });

  it("teeth: the same checks find the defect in the pre-fix definition", () => {
    const body = sqlCode(bodyOf(read(PRE_FIX), "get_application_lifecycle"));
    expect(daysStandingExpr(body)).toMatch(/first_seen/);
    expect(firstSeenInArithmetic(body).length).toBeGreaterThan(0);
  });
});

// ── the behaviour, in a real Postgres ────────────────────────────────────────
const U1 = "00000000-0000-4000-8000-0000000000a1";
const STAND_INS = `
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
  CREATE TABLE public.user_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, company text, role text, label text,
    location text, status text, job_id text, apply_url text, job_posting text, fit_missing jsonb, kit jsonb,
    posting_closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text, title text, posted_at timestamptz, first_seen timestamptz, missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    posting_id text NOT NULL, closed_at timestamptz NOT NULL, posted_at timestamptz, first_seen timestamptz,
    company_token text, title text, absence_basis text, superseded boolean NOT NULL DEFAULT false, suspect boolean NOT NULL DEFAULT false);
`;
const ROWS = `
  INSERT INTO public.job_board_postings (id, company_token, title, posted_at, first_seen, missing_since) VALUES
    ('gh:acme:undated', 'acme', 'Clerk', NULL, now() - interval '40 days', NULL),
    ('gh:acme:dated', 'acme', 'Analyst', now() - interval '5 days', now() - interval '1 day', NULL),
    ('gh:acme:future', 'acme', 'Porter', now() + interval '1 day', now() - interval '1 hour', NULL),
    -- served again under a new id, undated, first seen after the closure below.
    ('gh:acme:writer-again', 'acme', 'Writer', NULL, now() - interval '1 day', NULL),
    -- the same id, listed again after its takedown below, missing again.
    ('gh:acme:back', 'acme', 'Mason', now() - interval '10 days', now() - interval '10 days', now() - interval '3 hours');
  INSERT INTO public.job_board_closures (posting_id, closed_at, posted_at, first_seen, company_token, title, absence_basis) VALUES
    ('gh:acme:closed-undated', now() - interval '2 days', NULL, now() - interval '20 days', 'acme', 'Baker', 'full_read'),
    ('gh:acme:closed-dated', now() - interval '2 days', now() - interval '12 days', now() - interval '3 days', 'acme', 'Cook', 'full_read'),
    ('gh:acme:lap', now() - interval '2 days', now() - interval '12 days', now() - interval '12 days', 'acme', 'Chef', 'lap_backfill'),
    ('gh:acme:writer', now() - interval '3 days', now() - interval '20 days', now() - interval '20 days', 'acme', 'Writer', 'full_read'),
    ('gh:acme:back', now() - interval '20 days', now() - interval '30 days', now() - interval '30 days', 'acme', 'Mason', 'full_read');
  INSERT INTO public.user_applications (user_id, company, job_id)
    SELECT '${U1}', 'Acme', x FROM unnest(ARRAY['gh:acme:undated', 'gh:acme:dated', 'gh:acme:future', 'gh:acme:closed-undated',
      'gh:acme:closed-dated', 'gh:acme:lap', 'gh:acme:writer', 'gh:acme:back']) AS x;
`;
const IDS = ["gh:acme:undated", "gh:acme:dated", "gh:acme:future", "gh:acme:closed-undated", "gh:acme:closed-dated", "gh:acme:lap", "gh:acme:writer", "gh:acme:back"];

type Lc = { job_id: string; outcome: string; days_standing: string | null; closed_at_is_observation: boolean; closed_at: unknown; relisted: boolean };
async function lifecycle(db: PGlite): Promise<Map<string, Lc>> {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${U1}', false), set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated;`);
  try {
    const { rows } = await db.query<Lc>("SELECT job_id, outcome, days_standing, closed_at_is_observation, closed_at, relisted FROM public.get_application_lifecycle($1::text[])", [IDS]);
    return new Map(rows.map((r) => [r.job_id, r]));
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);");
  }
}
const days = (m: Map<string, Lc>, id: string) => (m.get(id)!.days_standing === null ? null : Number(m.get(id)!.days_standing));

let db: PGlite;
let before: Map<string, Lc>;
let after: Map<string, Lc>;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_DEFAULTS);
  await db.exec(STAND_INS);
  await db.exec(read(PRE_FIX));
  await db.exec(ROWS);
  before = await lifecycle(db);
  await db.exec(read(M16));
  await db.exec(read(M16)); // safe to re-run
  after = await lifecycle(db);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("an account row ages from the employer's date (pglite)", () => {
  it("teeth: before M16 an undated posting read forty days from our first sighting", () => {
    expect(days(before, "gh:acme:undated")).toBeCloseTo(40, 0);
    expect(days(before, "gh:acme:closed-undated")).toBeCloseTo(18, 0);
  });

  it("an undated posting has no days_standing, still posted or came down", () => {
    expect(after.get("gh:acme:undated")).toMatchObject({ outcome: "still_standing", days_standing: null });
    expect(after.get("gh:acme:closed-undated")).toMatchObject({ outcome: "came_down", days_standing: null });
  });

  it("a dated posting is measured from the employer's date, whatever we first saw", () => {
    expect(days(after, "gh:acme:dated")).toBeCloseTo(5, 0);
    expect(days(after, "gh:acme:closed-dated")).toBeCloseTo(10, 0);
  });

  it("an employer's date in the future reads as today, never a negative age", () => {
    expect(days(after, "gh:acme:future")).toBe(0);
  });

  it("a lap-dated closure keeps its row and has no duration", () => {
    expect(after.get("gh:acme:lap")).toMatchObject({ outcome: "came_down", days_standing: null, closed_at_is_observation: true });
  });

  it("the re-post probe answers as it did", () => {
    expect(before.get("gh:acme:writer")!.outcome).toBe("came_down_relisted");
    expect(after.get("gh:acme:writer")!.outcome).toBe("came_down_relisted");
    for (const id of IDS.filter((x) => x !== "gh:acme:back")) expect(after.get(id)!.outcome, id).toBe(before.get(id)!.outcome);
  });

  it("the same id come back and missing again is going down: no old closure date, no duration, and it came back", () => {
    expect(before.get("gh:acme:back"), "teeth: the pre-fix answer was the old takedown").toMatchObject({ outcome: "came_down", relisted: false });
    expect(days(before, "gh:acme:back")).toBeCloseTo(10, 0);
    expect(after.get("gh:acme:back")).toMatchObject({ outcome: "going_down", closed_at: null, days_standing: null, relisted: true, closed_at_is_observation: false });
  });

  it("refuses anon and answers a signed-in account", async () => {
    await db.exec("SET ROLE anon");
    try {
      await expect(db.query("SELECT * FROM public.get_application_lifecycle(ARRAY['gh:acme:dated'])")).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("RESET ROLE");
    }
    expect(after.size).toBe(IDS.length);
  });
});
