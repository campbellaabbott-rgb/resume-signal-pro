// @vitest-environment node
/**
 * THE EMPLOYER FIGURES PASS THE HIRING-RECORD GATE, UNDER ONE GLOBAL BUDGET.
 *
 * WHAT HAPPENED. The API4 design printed an employer's day-30 share wherever
 * sufficient_30 held, and per-title 90-day closure and re-list counts on
 * every board: the counts owner decision GD5 hides on boards read in laps
 * (Domino's logged 23,594 down and 0 back), around the gate the page, the
 * profile bake and MCP already share (_shared/hiring-record-gate.ts). And an
 * uncached employer figure costs 0.3-3.24 s of database time, with a global
 * per-minute cap on only one of the four surfaces that would print one
 * (critique-api B-2, B-3).
 *
 * THE PROPERTY.
 *   1. Over a grid of fill-curve rows (every bucket, watch floor or none,
 *      sufficient or refused for each day-30 reason, events or none, median
 *      reached or censored), every employer number the check prints is one
 *      the hiring-record gate admits, and every refusal prints the gate's own
 *      reason with a sentence. posting-truth.ts takes the gate from
 *      _shared/hiring-record-gate.ts and keeps no rule of its own beyond one
 *      stricter refusal ('events').
 *   2. No title-based witness exists: posting_truth compares no title, and
 *      the shaper carries no per-title count.
 *   3. In a real Postgres: company_facts computes an uncached employer only
 *      while the ONE global employer_compute bucket has room, 10 a minute,
 *      whatever cap a caller passes; past it the employer answers
 *      not_computed_yet and nothing is computed; a cached sheet costs no
 *      budget. api_expensive_take grants whole requests under a key's minute
 *      and day caps and the endpoint's global cap, and names the cap that
 *      bound. Meter rows older than two days and cache rows older than 24
 *      hours are deleted in the call.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";
import {
  EMPLOYER_COMPUTE_BUCKET,
  EMPLOYER_COMPUTE_PER_MINUTE,
  NOT_COMPUTED_YET,
  employerFactsOf,
  type CompanyFactsRow,
} from "../../supabase/functions/public-api/posting-truth";
import { DAY_30_REASONS, hiringRecordGate } from "../../supabase/functions/_shared/hiring-record-gate";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MIGRATION = read("supabase/migrations/20261206100000_a_posting_is_answered_by_what_we_saw_of_it.sql");
const SHAPER = read("supabase/functions/public-api/posting-truth.ts");
/** Code only: line-leading comments dropped, nothing else. */
const codeOf = (src: string, lead: RegExp) => src.split("\n").filter((l) => !lead.test(l)).join("\n");
const SQL_CODE = codeOf(MIGRATION, /^\s*--/);
const TS_CODE = codeOf(SHAPER, /^\s*(?:\/\/|\/\*|\*)/);

// ── 1. the gate decides every printed figure ────────────────────────────────
const BUCKETS = ["full_read", "lap_proven", "lap_pending", "unprovable", "unobserved", null];
const DAY30 = [
  { sufficient_30: true, insufficient_reason_30: null },
  ...DAY_30_REASONS.map((r) => ({ sufficient_30: false, insufficient_reason_30: r })),
  { sufficient_30: undefined, insufficient_reason_30: null },
];
const grid = (): Array<Record<string, unknown>> => {
  const out: Array<Record<string, unknown>> = [];
  for (const bucket of BUCKETS) for (const watched of ["2026-09-01", null]) for (const d of DAY30) {
    for (const events of [0, 5, 121]) for (const censored of [true, false]) for (const sufficient of [true, false]) {
      out.push({
        company_token: "b", observability_bucket: bucket, watched_from: watched, ...d, events_30: events,
        still_open_30: "0.6", still_open_30_lo: "0.5", still_open_30_hi: "0.7", taken_down_30: "0.4", relists_30: 3, n_at_risk_30: 90,
        cohort_from: "2026-09-02", cohort_to: "2026-10-30", sufficient, dated_coverage: "0.9", tracking_days: 60,
        fill_rate_14: "0.2", fill_rate_14_lo: "0.1", fill_rate_14_hi: "0.3", still_open_14: "0.8",
        median_censored: censored, median_days_to_fill: censored ? null : "17", filled_roles_90d: 40, relisted_roles_90d: 6,
        multi_site_title_share: "0.05",
      });
    }
  }
  return out;
};
const asRow = (facts: Record<string, unknown>): CompanyFactsRow => ({ cf_token: "b", cf_state: "cached", cf_facts: facts, cf_computed_at: "2026-12-06T00:00:00Z" });

/** Every place the shaper prints, or refuses, something the gate did not decide. */
function gateViolations(shape: typeof employerFactsOf): string[] {
  const bad: string[] = [];
  for (const facts of grid()) {
    const f = shape("b", asRow(facts));
    const g = hiringRecordGate(facts);
    const at = JSON.stringify({ b: facts.observability_bucket, w: facts.watched_from, s30: facts.sufficient_30, r: facts.insufficient_reason_30, e: facts.events_30, c: facts.median_censored, s: facts.sufficient });
    if (f.stillAdvertisedAtDay30 && !g.share30.ok) bad.push(`share printed past the gate's ${g.share30.reason}: ${at}`);
    if (f.stillAdvertisedAtDay30 && !(Number(facts.events_30) > 0)) bad.push(`share printed over no event: ${at}`);
    if (!f.stillAdvertisedAtDay30) {
      const want = g.share30.ok ? "events" : g.share30.reason;
      if (f.unknownReason !== want) bad.push(`refused as ${f.unknownReason}, the gate says ${want}: ${at}`);
      if (!f.sentence) bad.push(`refused with no sentence: ${at}`);
    }
    if (f.medianDaysToTakedown !== null && !g.median.ok) bad.push(`median printed past the gate's ${g.median.reason}: ${at}`);
    if (f.medianDaysToTakedown === null && !g.median.ok && f.medianUnknownReason !== g.median.reason) {
      bad.push(`median refused as ${f.medianUnknownReason}, the gate says ${g.median.reason}: ${at}`);
    }
  }
  return bad;
}

describe("every employer figure the check prints is one the hiring-record gate admits", () => {
  it("over the whole grid, with both outcomes reached", () => {
    const rows = grid();
    expect(rows.length).toBeGreaterThan(1000);
    expect(gateViolations(employerFactsOf)).toEqual([]);
    const printed = rows.filter((r) => employerFactsOf("b", asRow(r)).stillAdvertisedAtDay30 !== null).length;
    expect(printed, "the grid reaches a printed share").toBeGreaterThan(0);
    expect(printed, "and refuses most").toBeLessThan(rows.length / 4);
  });

  it("takes the gate from the shared module and defines no gate of its own", () => {
    expect(TS_CODE).toMatch(/from "\.\.\/_shared\/hiring-record-gate\.ts"/);
    expect(TS_CODE).toMatch(/hiringRecordGate\(facts\)/);
    expect(TS_CODE).not.toMatch(/function\s+hiringRecordGate|LAP_MODE_BUCKETS\s*=|RELIST_CONTROL_MIN_ROLES\s*=/);
  });

  it("answers no title-based witness: posting_truth compares no title and the shaper counts none", () => {
    const body = SQL_CODE.slice(SQL_CODE.indexOf("FUNCTION public.posting_truth("), SQL_CODE.indexOf("COMMENT ON FUNCTION public.posting_truth("));
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toMatch(/\btitle\b/);
    expect(body).not.toMatch(/lower\s*\(\s*[\w.]*title/i);
    expect(body).not.toMatch(/title\s*(?:=|<>|LIKE|ILIKE|~)|(?:=|<>|LIKE|ILIKE|~)\s*[\w.(]*title\b/i);
    for (const word of ["sameTitle", "newerSameTitle", "titleIsMultiSite", "relists90d", "closures90d"]) {
      expect(TS_CODE, word).not.toContain(word);
    }
  });

  it("teeth: a shaper that prints wherever sufficient_30 holds is caught", () => {
    const naive: typeof employerFactsOf = (token, row) => {
      const facts = row!.cf_facts as Record<string, unknown>;
      const real = employerFactsOf(token, row);
      return facts.sufficient_30 === true
        ? { ...real, stillAdvertisedAtDay30: { share: 0.6, lo: 0.5, hi: 0.7, cohortFrom: null, cohortTo: null, events: 0, takenDown: null, relists: null, n: null }, unknownReason: null, sentence: null }
        : real;
    };
    const bad = gateViolations(naive);
    expect(bad.some((b) => b.startsWith("share printed past the gate's lap"))).toBe(true);
    expect(bad.some((b) => b.startsWith("share printed past the gate's unproven read"))).toBe(true);
    expect(bad.some((b) => b.startsWith("share printed over no event"))).toBe(true);
  });
});

// ── 3. one global budget, in a real Postgres ────────────────────────────────
const STAND_INS = `
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, company text, title text,
    posted_at timestamptz, first_seen timestamptz NOT NULL DEFAULT now(), effective_posted timestamptz, missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text NOT NULL, company text, title text, posted_at timestamptz,
    closed_at timestamptz NOT NULL, superseded boolean NOT NULL DEFAULT false, suspect boolean NOT NULL DEFAULT false, absence_basis text);
  CREATE TABLE public.job_board_aged_out (id text PRIMARY KEY, posted_at timestamptz, aged_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), feed_total integer, state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on));
  CREATE TABLE public.job_board_board_observability (company_token text PRIMARY KEY, bucket text NOT NULL);
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, verified_at timestamptz NOT NULL DEFAULT now());
  -- The fill curve, stubbed: one row per token asked, and a log of every token it was asked to compute.
  CREATE TABLE public.fill_curve_calls (tok text NOT NULL);
  CREATE FUNCTION public.get_company_fill_curve(p_tokens text[])
  RETURNS TABLE (company_token text, observability_bucket text, sufficient_30 boolean, insufficient_reason_30 text, events_30 integer)
  LANGUAGE plpgsql AS $$
  BEGIN
    INSERT INTO public.fill_curve_calls (tok) SELECT unnest(p_tokens);
    RETURN QUERY SELECT x, 'lap_proven'::text, false, 'lap'::text, 0 FROM unnest(p_tokens) AS x;
  END $$;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_DEFAULTS);
  await db.exec(STAND_INS);
  await db.exec(MIGRATION);
}, 120_000);
afterAll(async () => { await db?.close(); });

type Facts = { cf_token: string; cf_state: string; cf_computed_at: Date | null };
type Take = { et_granted: number; et_bound: string | null; et_retry_after_s: number; et_minute_left: number | null; et_day_left: number | null };
const toks = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `t${String(from + i).padStart(2, "0")}`);

/** One scenario, one transaction: now() and so the minute cannot move under it. */
async function scenario<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("DELETE FROM public.api_expensive_meter; DELETE FROM public.company_fact_cache; DELETE FROM public.fill_curve_calls; SET LOCAL ROLE service_role;");
    return fn(tx);
  });
}
const facts = async (tx: Transaction, tokens: string[]) =>
  (await tx.query<Facts>("SELECT cf_token, cf_state, cf_computed_at FROM public.company_facts($1::text[])", [tokens])).rows;
const take = async (tx: Transaction, endpoint: string, subject: string | null, n: number, perMin: number | null, perDay: number | null, global: number | null, partial = false) =>
  (await tx.query<Take>("SELECT * FROM public.api_expensive_take($1, $2, $3, $4, $5, $6, $7)", [endpoint, subject, n, perMin, perDay, global, partial])).rows[0];
const computedCount = async (tx: Transaction) => (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM public.fill_curve_calls")).rows[0].n;
const states = (rows: Facts[]) => Object.fromEntries(rows.map((r) => [r.cf_token, r.cf_state]));

describe("one global budget for uncached employer facts (pglite)", () => {
  it("the cap is ten a minute in the database, and the shaper says the same number", () => {
    const m = /c_employer_compute_per_minute constant integer := (\d+);/.exec(SQL_CODE);
    expect(m, "the constant is in the migration's code").toBeTruthy();
    expect(Number(m![1])).toBe(EMPLOYER_COMPUTE_PER_MINUTE);
    expect(EMPLOYER_COMPUTE_PER_MINUTE).toBe(10);
    expect(SQL_CODE).toContain(`c_employer_compute constant text := '${EMPLOYER_COMPUTE_BUCKET}';`);
  });

  it("ten uncached employers are computed, the eleventh is not, and a cached one costs nothing", async () => {
    await scenario(async (tx) => {
      const first = await facts(tx, toks(0, 10));
      expect(first.every((r) => r.cf_state === "computed")).toBe(true);
      expect(await computedCount(tx)).toBe(10);
      const more = await facts(tx, toks(10, 13));
      expect(more.map((r) => r.cf_state)).toEqual([NOT_COMPUTED_YET, NOT_COMPUTED_YET, NOT_COMPUTED_YET]);
      expect(await computedCount(tx), "past the budget nothing is computed").toBe(10);
      const again = await facts(tx, toks(0, 3));
      expect(again.map((r) => r.cf_state)).toEqual(["cached", "cached", "cached"]);
      expect(await computedCount(tx)).toBe(10);
    });
  });

  it("a call larger than the room left computes what fits, in token order, and the rest wait", async () => {
    await scenario(async (tx) => {
      await facts(tx, toks(0, 4));
      const s = states(await facts(tx, toks(4, 12)));
      expect(Object.values(s).filter((v) => v === "computed").length).toBe(6);
      expect(s.t10).toBe(NOT_COMPUTED_YET);
      expect(s.t11).toBe(NOT_COMPUTED_YET);
    });
  });

  it("the bucket is shared: a direct take spends the same room, and a caller's larger cap is ignored", async () => {
    await scenario(async (tx) => {
      const t = await take(tx, EMPLOYER_COMPUTE_BUCKET, "any-key", 7, 1000, 1000, 1000, true);
      expect(t.et_granted).toBe(7);
      const s = Object.values(states(await facts(tx, toks(0, 10))));
      expect(s.filter((v) => v === "computed").length).toBe(3);
      expect(s.filter((v) => v === NOT_COMPUTED_YET).length).toBe(7);
      const after = await take(tx, EMPLOYER_COMPUTE_BUCKET, null, 1, null, null, 5000, true);
      expect(after).toMatchObject({ et_granted: 0, et_bound: "global" });
      expect(after.et_retry_after_s).toBeGreaterThan(0);
      expect(after.et_retry_after_s).toBeLessThanOrEqual(60);
    });
  });

  it("a stale sheet is recomputed against the budget; a fresh one is read", async () => {
    await scenario(async (tx) => {
      await tx.exec(`INSERT INTO public.company_fact_cache (kind, company_token, facts, computed_at) VALUES
        ('fill_curve', 'fresh', '{}'::jsonb, now() - interval '5 hours'),
        ('fill_curve', 'stale', '{}'::jsonb, now() - interval '7 hours')`);
      expect(states(await facts(tx, ["fresh", "stale"]))).toEqual({ fresh: "cached", stale: "computed" });
      expect(await computedCount(tx)).toBe(1);
    });
  });
});

describe("api_expensive_take rations a key, an endpoint and the day (pglite)", () => {
  it("whole requests under the key's minute cap; the one that does not fit is refused whole, naming the minute", async () => {
    await scenario(async (tx) => {
      for (let i = 0; i < 10; i++) expect((await take(tx, "/v1/check", "key-1", 10, 100, 2000, 600)).et_granted).toBe(10);
      const t = await take(tx, "/v1/check", "key-1", 10, 100, 2000, 600);
      expect(t).toMatchObject({ et_granted: 0, et_bound: "minute", et_minute_left: 0 });
      expect(t.et_retry_after_s).toBeGreaterThan(0);
      expect(t.et_retry_after_s).toBeLessThanOrEqual(60);
      expect((await take(tx, "/v1/check", "key-2", 10, 100, 2000, 600)).et_granted, "another key has its own minute").toBe(10);
    });
  });

  it("the day cap binds and says when the UTC day ends", async () => {
    await scenario(async (tx) => {
      expect((await take(tx, "/v1/check", "key-1", 10, 1000, 25, null)).et_granted).toBe(10);
      expect((await take(tx, "/v1/check", "key-1", 10, 1000, 25, null)).et_granted).toBe(10);
      const t = await take(tx, "/v1/check", "key-1", 10, 1000, 25, null);
      expect(t).toMatchObject({ et_granted: 0, et_bound: "day", et_day_left: 5 });
      expect(t.et_retry_after_s).toBeLessThanOrEqual(86_400);
      expect((await take(tx, "/v1/check", "key-1", 5, 1000, 25, null)).et_granted, "a request that fits is still granted").toBe(5);
    });
  });

  it("the endpoint's global cap binds across keys", async () => {
    await scenario(async (tx) => {
      expect((await take(tx, "/v1/check", "key-1", 10, 1000, 10000, 15)).et_granted).toBe(10);
      expect(await take(tx, "/v1/check", "key-2", 10, 1000, 10000, 15)).toMatchObject({ et_granted: 0, et_bound: "global" });
      expect((await take(tx, "/v1/check", "key-2", 5, 1000, 10000, 15)).et_granted).toBe(5);
    });
  });

  it("refuses a call with no endpoint", async () => {
    await expect(scenario((tx) => take(tx, " ", "k", 1, 1, 1, 1))).rejects.toThrow(/needs an endpoint/);
  });
});

describe("retention is done in the call (pglite)", () => {
  it("meter rows older than two days and cache rows older than a day are deleted; younger ones are kept", async () => {
    await scenario(async (tx) => {
      await tx.exec(`
        INSERT INTO public.api_expensive_meter (endpoint, subject, span, window_start, used) VALUES
          ('/v1/check', 'old', 'day', date_trunc('day', now()) - interval '3 days', 9),
          ('/v1/check', 'young', 'day', date_trunc('day', now()) - interval '1 day', 9);
        INSERT INTO public.company_fact_cache (kind, company_token, facts, computed_at) VALUES
          ('fill_curve', 'old', '{}'::jsonb, now() - interval '25 hours'),
          ('fill_curve', 'young', '{}'::jsonb, now() - interval '2 hours');`);
      await take(tx, "/v1/check", "k", 1, 10, 10, 10);
      const meter = (await tx.query<{ subject: string }>("SELECT subject FROM public.api_expensive_meter WHERE subject IN ('old', 'young') ORDER BY 1")).rows.map((r) => r.subject);
      expect(meter).toEqual(["young"]);
      await facts(tx, ["young"]);
      const cache = (await tx.query<{ company_token: string }>("SELECT company_token FROM public.company_fact_cache ORDER BY 1")).rows.map((r) => r.company_token);
      expect(cache).toEqual(["young"]);
    });
  });
});
