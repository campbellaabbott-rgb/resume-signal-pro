// @vitest-environment node
/**
 * A POSTING CHECK NAMES ITS STATE FROM WHAT WE SAW.
 *
 * WHAT HAPPENED. The API4 design answered "is this job real?" with a new
 * per-posting state machine beside the one Account already runs
 * (get_application_lifecycle), with title-based re-list witnesses that the
 * hiring-record gate refuses on lap boards, and with an "open" sentence that
 * asserted a read listed the posting on boards read a window at a time
 * (critique-api B-2, B-4, 2.11). Two state machines over one ledger can
 * disagree; a title match on a board that lists one title in many places is
 * not the same role.
 *
 * And the first build of this check answered from the wrong record. The
 * collector deletes a posting's row the moment it logs ANY closure, superseded
 * and suspect ones included (job-board closeVanishedChunk). Dropping those
 * closures left a posting we listed and saw go with no record at all, so the
 * check called it not_carried: "we never listed it". And it read a trusted
 * closure before the row, so an id that came back after its takedown and was
 * missing again read "closed" on the OLD date, and a posting closed twice
 * never said it came back (adversarial review, 2026-11-18).
 *
 * THE PROPERTY. posting_truth (20261206100000), run in a real Postgres over
 * stand-ins with the columns its SQL reads, and shaped by
 * public-api/posting-truth.ts, names each posting's state from our own
 * records by its id alone, the newest record deciding:
 *   open (with the same id coming back after a trusted closure said so),
 *   going_down (stamped missing after any closure; came back, if a trusted
 *   closure came before), closed (the newest record is a trusted closure; a
 *   lap-dated one said as the day we first saw it gone; two of them mean the
 *   id came back between), gone_unconfirmed (the newest record is a closure
 *   the collector did not trust: listed, gone, no takedown counted),
 *   aged_out (a tombstone, or listed past the window), not_carried,
 *   board_not_carried, withheld, unknown_id.
 * Account (get_application_lifecycle, M16) and the check, run over the same
 * rows, say the same thing happened. Its closure read is the lifecycle's
 * token-first one: planned through the board's curve index, never a scan of
 * the ledger. It answers ten ids at most.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";
import {
  POSTING_TRUTH_MAX_IDS,
  TRUTH_COPY,
  TRUTH_STATES,
  idsToAsk,
  preCheck,
  truthsOf,
  type PostingTruth,
  type PostingTruthRow,
  type TruthOptions,
} from "../../supabase/functions/public-api/posting-truth";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const MIG = (f: string) => readFileSync(resolve(__dirname, "../../supabase/migrations", f), "utf8");
const MIGRATION = MIG("20261206100000_a_posting_is_answered_by_what_we_saw_of_it.sql");
/** Account's lifecycle before the API4 lane, and M16's. */
const LIFECYCLE_PRE = MIG("20261009131000_a_tracker_row_reads_the_closure_log_by_the_day_and_a_free_account_has_bounds.sql");
const LIFECYCLE_M16 = MIG("20261206110000_an_account_row_ages_from_the_employers_date.sql");

const STAND_INS = `
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, company text, title text,
    posted_at timestamptz, first_seen timestamptz NOT NULL DEFAULT now(), effective_posted timestamptz,
    missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    posting_id text, source text, company_token text NOT NULL, company text, title text,
    category text NOT NULL DEFAULT '', first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL,
    superseded boolean NOT NULL DEFAULT false, suspect boolean NOT NULL DEFAULT false, batch_live_before integer,
    absence_basis text);
  -- The ledger's index set, as the migrations leave it (20260906090000 and earlier).
  CREATE INDEX job_board_closures_closed_at_idx ON public.job_board_closures (closed_at);
  CREATE INDEX job_board_closures_curve_idx ON public.job_board_closures (company_token, closed_at DESC)
    INCLUDE (posted_at, superseded, suspect, batch_live_before, category);
  CREATE TABLE public.job_board_aged_out (
    id text PRIMARY KEY, source text, company_token text, posted_at timestamptz, aged_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on));
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY, bucket text NOT NULL, lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_verifications (
    company_token text PRIMARY KEY, verified_at timestamptz NOT NULL DEFAULT now(), feed_total integer);
  -- What Account's lifecycle reads besides the two ledgers.
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role') $$;
  CREATE TABLE public.user_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, company text, role text, label text,
    location text, status text, job_id text, apply_url text, job_posting text, fit_missing jsonb, kit jsonb,
    posting_closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
`;

const WD = "acme~wd5~Careers";
const FIXTURES = `
  -- A board read to its end, read two hours ago.
  INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('fullco', 'full_read'), ('${WD}', 'lap_proven'), ('darkco', 'full_read');
  INSERT INTO public.job_board_board_state (company_token, observed_on, source, observed_at, feed_total, state) VALUES
    ('fullco', current_date, 'greenhouse', now() - interval '2 hours', 40, 'ok'),
    ('fullco', current_date - 1, 'greenhouse', now() - interval '26 hours', 40, 'ok'),
    -- Workday, capped: its last complete read stated exactly 2,000.
    ('${WD}', current_date, 'workday', now() - interval '3 hours', 2000, 'ok'),
    -- A full-read board whose newest read failed.
    ('darkco', current_date, 'greenhouse', now() - interval '1 hour', NULL, 'error'),
    ('darkco', current_date - 1, 'greenhouse', now() - interval '25 hours', 12, 'ok');
  INSERT INTO public.job_board_verifications (company_token) VALUES ('fullco'), ('${WD}'), ('darkco');

  INSERT INTO public.job_board_postings (id, source, company_token, company, title, posted_at, first_seen, effective_posted, missing_since) VALUES
    ('greenhouse:fullco:1', 'greenhouse', 'fullco', 'Full Co', 'Analyst', now() - interval '5 days', now() - interval '1 day', now() - interval '5 days', NULL),
    ('greenhouse:fullco:2', 'greenhouse', 'fullco', 'Full Co', 'Engineer', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days', NULL),
    ('greenhouse:fullco:3', 'greenhouse', 'fullco', 'Full Co', 'Designer', now() - interval '9 days', now() - interval '9 days', now() - interval '9 days', now() - interval '1 hour'),
    ('greenhouse:fullco:4', 'greenhouse', 'fullco', 'Full Co', 'Writer', now() - interval '12 days', now() - interval '12 days', now() - interval '12 days', now() - interval '3 days'),
    ('greenhouse:fullco:6', 'greenhouse', 'fullco', 'Full Co', 'Nurse', now() - interval '8 days', now() - interval '8 days', now() - interval '8 days', now() - interval '2 hours'),
    ('greenhouse:fullco:7', 'greenhouse', 'fullco', 'Full Co', 'Chef', now() - interval '8 days', now() - interval '8 days', now() - interval '8 days', now() - interval '2 hours'),
    ('greenhouse:fullco:9', 'greenhouse', 'fullco', 'Full Co', 'Porter', now() - interval '40 days', now() - interval '40 days', now() - interval '40 days', NULL),
    ('greenhouse:fullco:undated', 'greenhouse', 'fullco', 'Full Co', 'Clerk', NULL, now() - interval '12 days', now() - interval '12 days', NULL),
    -- Came down twenty days ago, listed again under the same id, and stamped
    -- missing three hours ago: going down again, not the old takedown.
    ('greenhouse:fullco:back', 'greenhouse', 'fullco', 'Full Co', 'Mason', now() - interval '10 days', now() - interval '10 days', now() - interval '10 days', now() - interval '3 hours'),
    ('workday:${WD}:x1', 'workday', '${WD}', 'Acme', 'Planner', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', NULL),
    ('greenhouse:darkco:1', 'greenhouse', 'darkco', 'Dark Co', 'Baker', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days', NULL);

  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, absence_basis, suspect, superseded) VALUES
    -- Came down ten days ago, and the same id is served again.
    ('greenhouse:fullco:2', 'greenhouse', 'fullco', 'Full Co', 'Engineer', now() - interval '20 days', now() - interval '10 days', 'full_read', false, false),
    ('greenhouse:fullco:4', 'greenhouse', 'fullco', 'Full Co', 'Writer', now() - interval '12 days', now() - interval '2 days', 'full_read', false, false),
    -- Gone, and dated only by the lap that could first see it.
    ('greenhouse:fullco:5', 'greenhouse', 'fullco', 'Full Co', 'Cook', now() - interval '25 days', now() - interval '4 days', 'lap_backfill', false, false),
    -- A feed that went dark, and a superseded closure: neither is a takedown.
    -- Each id came back after it and is stamped missing again (above).
    ('greenhouse:fullco:6', 'greenhouse', 'fullco', 'Full Co', 'Nurse', now() - interval '8 days', now() - interval '1 day', 'full_read', true, false),
    ('greenhouse:fullco:7', 'greenhouse', 'fullco', 'Full Co', 'Chef', now() - interval '8 days', now() - interval '1 day', 'full_read', false, true),
    -- The same two kinds as the collector leaves them: the row deleted.
    ('greenhouse:fullco:sus', 'greenhouse', 'fullco', 'Full Co', 'Plumber', now() - interval '9 days', now() - interval '1 day', 'full_read', true, false),
    ('greenhouse:fullco:sup', 'greenhouse', 'fullco', 'Full Co', 'Tiler', now() - interval '9 days', now() - interval '1 day', 'full_read', false, true),
    -- The takedown before greenhouse:fullco:back came back.
    ('greenhouse:fullco:back', 'greenhouse', 'fullco', 'Full Co', 'Mason', now() - interval '30 days', now() - interval '20 days', 'full_read', false, false),
    -- Closed, listed again, closed again: no row.
    ('greenhouse:fullco:twice', 'greenhouse', 'fullco', 'Full Co', 'Roofer', now() - interval '30 days', now() - interval '20 days', 'full_read', false, false),
    ('greenhouse:fullco:twice', 'greenhouse', 'fullco', 'Full Co', 'Roofer', now() - interval '30 days', now() - interval '2 days', 'full_read', false, false),
    -- Closed, listed again, then gone in a way the collector did not count.
    ('greenhouse:fullco:back-sup', 'greenhouse', 'fullco', 'Full Co', 'Joiner', now() - interval '30 days', now() - interval '20 days', 'full_read', false, false),
    ('greenhouse:fullco:back-sup', 'greenhouse', 'fullco', 'Full Co', 'Joiner', now() - interval '30 days', now() - interval '2 days', 'full_read', false, true),
    -- Closed, listed again, then aged out of the window (the tombstone below).
    ('greenhouse:fullco:back-aged', 'greenhouse', 'fullco', 'Full Co', 'Welder', now() - interval '50 days', now() - interval '40 days', 'full_read', false, false),
    -- A tombstone its closure's delete left behind: the closure is newer.
    ('greenhouse:fullco:tomb-old', 'greenhouse', 'fullco', 'Full Co', 'Carver', now() - interval '35 days', now() - interval '2 days', 'full_read', false, false),
    -- A different posting with the SAME title, served now: no title is matched.
    ('greenhouse:fullco:old-analyst', 'greenhouse', 'fullco', 'Full Co', 'Analyst', now() - interval '40 days', now() - interval '20 days', 'full_read', false, false);

  INSERT INTO public.job_board_aged_out (id, source, company_token, posted_at, aged_at) VALUES
    ('greenhouse:fullco:8', 'greenhouse', 'fullco', now() - interval '31 days', now() - interval '1 day'),
    ('greenhouse:fullco:8u', 'greenhouse', 'fullco', NULL, now() - interval '1 day'),
    ('greenhouse:fullco:back-aged', 'greenhouse', 'fullco', now() - interval '31 days', now() - interval '1 day'),
    ('greenhouse:fullco:tomb-old', 'greenhouse', 'fullco', now() - interval '35 days', now() - interval '10 days');

  -- Ballast so the planner has a ledger to choose an index over.
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, closed_at)
    SELECT 'greenhouse:board' || (g % 50) || ':' || g, 'greenhouse', 'board' || (g % 50), 'Board', 'Role', now() - (g || ' minutes')::interval
      FROM generate_series(1, 5000) g;
  ANALYZE public.job_board_closures;
`;

const OPTS: TruthOptions = {
  now: new Date(),
  withheldSources: ["usajobs", "smartrecruiters"],
  withheldReason: "WITHHELD: not available through this API.",
};

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_DEFAULTS);
  await db.exec(STAND_INS);
  await db.exec(MIGRATION);
  await db.exec(FIXTURES);
}, 120_000);
afterAll(async () => { await db?.close(); });

/** A row as PostgREST hands it over: timestamps as ISO strings, not Dates. */
const asJson = (row: Record<string, unknown>): PostingTruthRow =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) as unknown as PostingTruthRow;

/** posting_truth as the service role, the only role it answers. */
async function rowsFor(ids: string[]): Promise<PostingTruthRow[]> {
  await db.exec("SET ROLE service_role");
  try {
    return (await db.query<Record<string, unknown>>("SELECT * FROM public.posting_truth($1::text[])", [ids])).rows.map(asJson);
  } finally {
    await db.exec("RESET ROLE");
  }
}

/** Ask in batches of ten, as a caller must, and shape every id. */
async function check(ids: string[]): Promise<Map<string, PostingTruth>> {
  const ask = idsToAsk(ids, OPTS);
  const rows: PostingTruthRow[] = [];
  for (let i = 0; i < ask.length; i += POSTING_TRUTH_MAX_IDS) rows.push(...(await rowsFor(ask.slice(i, i + POSTING_TRUTH_MAX_IDS))));
  return new Map(truthsOf(ids, rows, { ...OPTS, now: new Date() }).map((t) => [t.id, t]));
}

const IDS = [
  "greenhouse:fullco:1", "greenhouse:fullco:2", "greenhouse:fullco:3", "greenhouse:fullco:4", "greenhouse:fullco:5",
  "greenhouse:fullco:6", "greenhouse:fullco:7", "greenhouse:fullco:8", "greenhouse:fullco:8u", "greenhouse:fullco:9",
  "greenhouse:fullco:nothing", "greenhouse:fullco:undated", `workday:${WD}:x1`, `workday:${WD}:none`,
  "greenhouse:unknownco:1", "greenhouse:darkco:1", "smartrecruiters:srco:1", "usajobs:fed:1", "not-an-id",
  "greenhouse:fullco:sus", "greenhouse:fullco:sup", "greenhouse:fullco:back", "greenhouse:fullco:twice",
  "greenhouse:fullco:back-sup", "greenhouse:fullco:back-aged", "greenhouse:fullco:tomb-old",
];

let T: Map<string, PostingTruth>;
beforeAll(async () => { T = await check(IDS); }, 120_000);

describe("a posting check names its state from what we saw (pglite)", () => {
  it("answers every id asked, once, in order", () => {
    expect([...T.keys()]).toEqual(IDS);
    for (const t of T.values()) expect(TRUTH_STATES).toContain(t.state);
  });

  it("open: listed at our last read and inside the window, worded by the read", () => {
    const t = T.get("greenhouse:fullco:1")!;
    expect(t.state).toBe("open");
    expect(t.sentence).toBe("We read the employer's whole board 2 hours ago and this posting was listed.");
    expect(t.relisted).toEqual({ sameIdCameBack: false });
    expect(t).toMatchObject({ title: "Analyst", company: "Full Co", source: "greenhouse", companyToken: "fullco" });
  });

  it("open, and the same id came back after a trusted closure", () => {
    const t = T.get("greenhouse:fullco:2")!;
    expect(t.state).toBe("open");
    expect(t.relisted).toEqual({ sameIdCameBack: true });
    expect(t.sentence.endsWith(TRUTH_COPY.sameIdCameBack)).toBe(true);
  });

  it("no title is matched: a closed posting with this title on the board does not make it a re-post", () => {
    expect(T.get("greenhouse:fullco:1")!.relisted).toEqual({ sameIdCameBack: false });
  });

  it("going down: stamped missing after any closure, and a suspect or superseded closure is no takedown", () => {
    for (const id of ["greenhouse:fullco:3", "greenhouse:fullco:6", "greenhouse:fullco:7"]) {
      expect(T.get(id)!.state, id).toBe("going_down");
      expect(T.get(id)!.sentence).toBe(TRUTH_COPY.goingDown);
      expect(T.get(id)!.closedAt).toBeNull();
      expect(T.get(id)!.relisted, "a closure we do not count is not a takedown the id came back from").toEqual({ sameIdCameBack: false });
    }
  });

  it("closed: a trusted takedown, dated, newer than the row its delete left behind", () => {
    const t = T.get("greenhouse:fullco:4")!;
    expect(t.state).toBe("closed");
    expect(t.closedAtIsObservation).toBe(false);
    expect(t.closedAt).not.toBeNull();
    expect(t.sentence).toMatch(/^Came down from the employer's system by \d{4}-\d{2}-\d{2}\.$/);
    expect(t.relisted).toEqual({ sameIdCameBack: false });
  });

  it("a posting we listed and saw go, in a way the collector did not count, is gone_unconfirmed, never not_carried", () => {
    const sus = T.get("greenhouse:fullco:sus")!;
    expect(sus.state).toBe("gone_unconfirmed");
    expect(sus.sentence).toMatch(/^Our reads found it gone from the employer's board by \d{4}-\d{2}-\d{2}, along with so much of the board at once/);
    expect(sus.unconfirmed).toMatchObject({ kind: "suspect" });
    const sup = T.get("greenhouse:fullco:sup")!;
    expect(sup.state).toBe("gone_unconfirmed");
    expect(sup.sentence).toMatch(/^Our reads found it gone from the employer's board by \d{4}-\d{2}-\d{2}, while a posting with the same title was still listed there/);
    expect(sup.unconfirmed).toMatchObject({ kind: "superseded" });
    for (const t of [sus, sup]) {
      expect(t.state).not.toBe("not_carried");
      expect(t.sentence).not.toMatch(/never listed it|no record of this id/);
      expect(t.closedAt, "no takedown is counted, so none is dated").toBeNull();
      expect(t.unconfirmed?.seenGoneAt).not.toBeNull();
      expect(t.relisted).toEqual({ sameIdCameBack: false });
      expect(t).toMatchObject({ title: expect.any(String), company: "Full Co" });
      expect(t.age, "the employer's date the closure carried").toMatchObject({ days: 9, dateClass: "employer" });
    }
  });

  it("came back after its takedown and missing again: going down, the same id came back, no old closure date", () => {
    const t = T.get("greenhouse:fullco:back")!;
    expect(t.state).toBe("going_down");
    expect(t.relisted).toEqual({ sameIdCameBack: true });
    expect(t.sentence).toBe(`${TRUTH_COPY.goingDown} ${TRUTH_COPY.sameIdCameBack}`);
    expect(t.closedAt).toBeNull();
    expect(t.age, "the row's own employer date, not the old closure's").toMatchObject({ days: 10 });
  });

  it("closed twice: the newest takedown's date, and the same id came back between", () => {
    const t = T.get("greenhouse:fullco:twice")!;
    expect(t.state).toBe("closed");
    expect(t.relisted).toEqual({ sameIdCameBack: true });
    expect(Math.round((Date.now() - Date.parse(t.closedAt!)) / 86_400_000)).toBe(2);
    expect(t.sentence.endsWith(TRUTH_COPY.sameIdCameBack)).toBe(true);
  });

  it("came back after a takedown, then gone uncounted: gone_unconfirmed, and it came back", () => {
    const t = T.get("greenhouse:fullco:back-sup")!;
    expect(t.state).toBe("gone_unconfirmed");
    expect(t.relisted).toEqual({ sameIdCameBack: true });
    expect(t.unconfirmed).toMatchObject({ kind: "superseded" });
  });

  it("a tombstone newer than the takedown is the same id come back and aged out; an older one is the closure's leftover", () => {
    const aged = T.get("greenhouse:fullco:back-aged")!;
    expect(aged.state).toBe("aged_out");
    expect(aged.relisted).toEqual({ sameIdCameBack: true });
    const old = T.get("greenhouse:fullco:tomb-old")!;
    expect(old.state).toBe("closed");
    expect(old.relisted).toEqual({ sameIdCameBack: false });
  });

  it("closed by a lap: the date is the day we first saw it gone, and is said so", () => {
    const t = T.get("greenhouse:fullco:5")!;
    expect(t.state).toBe("closed");
    expect(t.closedAtIsObservation).toBe(true);
    expect(t.sentence).toMatch(/^We first saw it gone from the employer's system on \d{4}-\d{2}-\d{2}; it came down on or before that day\.$/);
    expect(t.age?.days, "the age is the employer's date carried by the closure").toBe(25);
  });

  it("aged out: a tombstone, worded by whether the employer dated it", () => {
    const dated = T.get("greenhouse:fullco:8")!;
    expect(dated.state).toBe("aged_out");
    expect(dated.sentence).toMatch(/^Still advertised by the employer when its own date passed our 30-day window on \d{4}-\d{2}-\d{2}/);
    expect(dated.age?.days).toBe(31);
    const undated = T.get("greenhouse:fullco:8u")!;
    expect(undated.state).toBe("aged_out");
    expect(undated.sentence).toMatch(/the employer gives it no date/);
    expect(undated.age).toMatchObject({ days: null, dateClass: "none" });
  });

  it("aged out: still listed but past the window is not open", () => {
    const t = T.get("greenhouse:fullco:9")!;
    expect(t.state).toBe("aged_out");
    expect(t.sentence).toBe(TRUTH_COPY.agedOutPending);
  });

  it("not carried on a board read in full names the window fence and nothing else", () => {
    const t = T.get("greenhouse:fullco:nothing")!;
    expect(t.state).toBe("not_carried");
    expect(t.sentence).toBe(TRUTH_COPY.notCarriedFullRead);
    expect(t.age).toBeNull();
  });

  it("not carried on a capped Workday board names the part of the board we never read", () => {
    const t = T.get(`workday:${WD}:none`)!;
    expect(t.state).toBe("not_carried");
    expect(t.sentence).toBe(TRUTH_COPY.notCarriedInParts);
    expect(t.read).toMatchObject({ bucket: "lap_proven", capped: true, inParts: true });
  });

  it("a board read in parts never says the read listed the posting", () => {
    const t = T.get(`workday:${WD}:x1`)!;
    expect(t.state).toBe("open");
    expect(t.sentence).toBe("This board is read in parts; we last read part of it 3 hours ago.");
    expect(t.age).toMatchObject({ days: 2, dateClass: "employer_relative" });
  });

  it("a full-read board whose newest read failed does not say when the posting was listed", () => {
    const t = T.get("greenhouse:darkco:1")!;
    expect(t.state).toBe("open");
    expect(t.sentence).toBe(TRUTH_COPY.openFullReadIncomplete);
    expect(t.read).toMatchObject({ bucket: "full_read", readState: "error", inParts: true });
  });

  it("a board we do not read, a withheld source, and an id we do not issue", () => {
    expect(T.get("greenhouse:unknownco:1")).toMatchObject({ state: "board_not_carried", sentence: TRUTH_COPY.boardNotCarried, age: null });
    for (const id of ["smartrecruiters:srco:1", "usajobs:fed:1"]) {
      expect(T.get(id)).toMatchObject({ state: "withheld", sentence: OPTS.withheldReason, age: null, title: null });
    }
    expect(T.get("not-an-id")).toMatchObject({ state: "unknown_id", sentence: TRUTH_COPY.unknownId });
  });

  it("withheld and malformed ids never reach the database", () => {
    expect(idsToAsk(IDS, OPTS)).not.toContain("smartrecruiters:srco:1");
    expect(idsToAsk(IDS, OPTS)).not.toContain("not-an-id");
    expect(preCheck("greenhouse:fullco:1", OPTS)).toBeNull();
    const tokens = new Set(["srboard"]);
    expect(preCheck("greenhouse:srboard:1", { ...OPTS, withheldTokens: tokens })?.state, "a withheld employer's token").toBe("withheld");
  });

  it("the age is the employer's date: an undated posting has none, whatever we first saw", () => {
    expect(T.get("greenhouse:fullco:undated")!.age).toMatchObject({ postedAt: null, days: null, dateClass: "none" });
    expect(T.get("greenhouse:fullco:1")!.age, "posted five days ago, first seen yesterday").toMatchObject({ days: 5, dateClass: "employer" });
  });
});

describe("posting_truth reads ten ids at most, and by the board first", () => {
  it("answers the first ten distinct ids of an eleven-id call", async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `greenhouse:fullco:n${String(i).padStart(2, "0")}`);
    const rows = await rowsFor(ids);
    expect(rows.map((r) => r.pt_id)).toEqual(ids.slice(0, 10));
  });

  it("an id the rows do not answer is a failed read, never a state", () => {
    expect(() => truthsOf(["greenhouse:fullco:1"], [], OPTS)).toThrow(/no row/);
  });

  it("reads every closure of an id once: the trusted count and the untrusted witness come from the same read", async () => {
    const [twice, sus] = await rowsFor(["greenhouse:fullco:twice", "greenhouse:fullco:sus"]).then((r) =>
      ["greenhouse:fullco:twice", "greenhouse:fullco:sus"].map((id) => r.find((x) => x.pt_id === id)!));
    expect(twice).toMatchObject({ pt_has_closure: true, pt_closures: 2, pt_untrusted_gone_at: null, pt_untrusted_kind: null });
    expect(sus).toMatchObject({ pt_has_closure: false, pt_closures: 0, pt_untrusted_kind: "suspect", pt_row_found: false });
    expect(sus.pt_untrusted_gone_at).not.toBeNull();
  });

  it("its closure read reaches the curve index through each posting's token, as the lifecycle's does", async () => {
    const at = MIGRATION.indexOf("  seen AS (", MIGRATION.indexOf("FUNCTION public.posting_truth("));
    expect(at, "posting_truth's closure read (the seen CTE) was not found").toBeGreaterThan(0);
    let depth = 0;
    let cte = "";
    for (let j = MIGRATION.indexOf("(", at); j < MIGRATION.length; j++) {
      if (MIGRATION[j] === "(") depth++;
      else if (MIGRATION[j] === ")" && --depth === 0) { cte = MIGRATION.slice(MIGRATION.indexOf("(", at) + 1, j); break; }
    }
    expect(cte).toMatch(/c\.company_token = split_part\(ids\.jid, ':', 2\)/);
    await db.exec("SET enable_seqscan = off");
    try {
      const { rows } = await db.query<{ "QUERY PLAN": string }>(
        `EXPLAIN WITH ids AS (SELECT DISTINCT x AS jid FROM unnest($1::text[]) AS x) SELECT * FROM (${cte}) seen`,
        [["greenhouse:board7:7", "greenhouse:board9:nope"]],
      );
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(plan, plan).toMatch(/(?:using|Bitmap Index Scan on) job_board_closures_curve_idx/);
      expect(plan).toMatch(/Index Cond: \(company_token = /);
      expect(plan).not.toMatch(/Seq Scan on job_board_closures/);
    } finally {
      await db.exec("RESET enable_seqscan");
    }
  });
});

// ── Account and the check, over the same rows ────────────────────────────────
const U1 = "00000000-0000-4000-8000-0000000000a1";
/** Ids Account's tracker can hold: each has a row or a closure. */
const TRACKED = [
  "greenhouse:fullco:1", "greenhouse:fullco:2", "greenhouse:fullco:3", "greenhouse:fullco:4", "greenhouse:fullco:5",
  "greenhouse:fullco:6", "greenhouse:fullco:7", "greenhouse:fullco:sus", "greenhouse:fullco:sup",
  "greenhouse:fullco:back", "greenhouse:fullco:twice",
];
/** What each check state may be called on Account (get_application_lifecycle's outcomes). */
const SAME_THING: Record<string, string[]> = {
  open: ["still_standing", "came_down_relisted"],
  going_down: ["going_down"],
  closed: ["came_down", "came_down_relisted"],
  gone_unconfirmed: ["not_observed"],
};

type Lc = { job_id: string; outcome: string; closed_at: string | null; relisted: boolean };
async function lifecycle(): Promise<Map<string, Lc>> {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${U1}', false), set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated;`);
  try {
    const { rows } = await db.query<Lc>("SELECT job_id, outcome, closed_at, relisted FROM public.get_application_lifecycle($1::text[])", [TRACKED]);
    return new Map(rows.map((r) => [r.job_id, r]));
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false);");
  }
}
const disagreements = (lc: Map<string, Lc>): string[] => TRACKED.flatMap((id) => {
  const t = T.get(id)!;
  const o = lc.get(id)?.outcome ?? "(no answer)";
  return (SAME_THING[t.state] ?? []).includes(o) ? [] : [`${id}: check ${t.state}, Account ${o}`];
});

let before: Map<string, Lc>;
let after: Map<string, Lc>;
beforeAll(async () => {
  await db.exec(LIFECYCLE_PRE);
  await db.exec(`INSERT INTO public.user_applications (user_id, company, job_id) SELECT '${U1}', 'Full Co', x FROM unnest(ARRAY['${TRACKED.join("','")}']) AS x;`);
  before = await lifecycle();
  await db.exec(LIFECYCLE_M16);
  after = await lifecycle();
}, 120_000);

describe("Account and the check say the same thing happened (pglite)", () => {
  it("every tracked id: the check's state and Account's outcome name the same event", () => {
    expect(after.size).toBe(TRACKED.length);
    expect(disagreements(after)).toEqual([]);
  });

  it("the id that came back and is going down again: going_down on both, came back on both, no closure date on Account", () => {
    expect(after.get("greenhouse:fullco:back")).toMatchObject({ outcome: "going_down", closed_at: null, relisted: true });
    expect(T.get("greenhouse:fullco:back")!.relisted).toEqual({ sameIdCameBack: true });
  });

  it("a closure the collector did not count, with no row: Account says not_observed, the check gone_unconfirmed", () => {
    for (const id of ["greenhouse:fullco:sus", "greenhouse:fullco:sup"]) {
      expect(after.get(id)!.outcome, id).toBe("not_observed");
      expect(T.get(id)!.state, id).toBe("gone_unconfirmed");
    }
  });

  it("teeth: before M16 Account answered the came-back id with its old takedown, which it then stores for good", () => {
    expect(before.get("greenhouse:fullco:back")).toMatchObject({ outcome: "came_down", relisted: false });
    expect(before.get("greenhouse:fullco:back")!.closed_at).not.toBeNull();
    expect(disagreements(before)).toEqual(["greenhouse:fullco:back: check going_down, Account came_down"]);
  });
});

describe("teeth: the witnesses the review found missing are load-bearing", () => {
  const rowOf = async (id: string) => (await rowsFor([id]))[0];

  it("without the untrusted-closure witness, a posting we listed and saw go reads as one we never had", async () => {
    const r = await rowOf("greenhouse:fullco:sup");
    expect(truthsOf([r.pt_id], [{ ...r, pt_untrusted_gone_at: null, pt_untrusted_kind: null }], OPTS)[0].state).toBe("not_carried");
  });

  it("without the trusted count, a posting closed twice never says it came back", async () => {
    const r = await rowOf("greenhouse:fullco:twice");
    expect(truthsOf([r.pt_id], [{ ...r, pt_closures: 1 }], OPTS)[0].relisted).toEqual({ sameIdCameBack: false });
  });

  it("reading the closure before the row answers the came-back id with its old date", async () => {
    const r = await rowOf("greenhouse:fullco:back");
    // The row as a closure-first reader sees it: the missing stamp ignored.
    const closureFirst = truthsOf([r.pt_id], [{ ...r, pt_row_found: false, pt_missing_since: null }], OPTS)[0];
    expect(closureFirst).toMatchObject({ state: "closed", relisted: { sameIdCameBack: false } });
  });
});
