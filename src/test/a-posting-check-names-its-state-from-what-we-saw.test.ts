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
 * THE PROPERTY. posting_truth (20261206100000), run in a real Postgres over
 * stand-ins with the columns its SQL reads, and shaped by
 * public-api/posting-truth.ts, names each posting's state from our own
 * records by its id alone:
 *   open (with the same id coming back after a trusted closure said so),
 *   going_down (stamped missing, no trusted closure: suspect and superseded
 *   closures are not takedowns), closed (and a lap-dated closure said as the
 *   day we first saw it gone), aged_out (a tombstone, or listed past the
 *   window), not_carried, board_not_carried, withheld, unknown_id.
 * Its closure read is the lifecycle's token-first one: planned through the
 * board's curve index, never a scan of the ledger. It answers ten ids at most.
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

const MIGRATION = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261206100000_a_posting_is_answered_by_what_we_saw_of_it.sql"),
  "utf8",
);

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
    ('workday:${WD}:x1', 'workday', '${WD}', 'Acme', 'Planner', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days', NULL),
    ('greenhouse:darkco:1', 'greenhouse', 'darkco', 'Dark Co', 'Baker', now() - interval '4 days', now() - interval '4 days', now() - interval '4 days', NULL);

  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, title, posted_at, closed_at, absence_basis, suspect, superseded) VALUES
    -- Came down ten days ago, and the same id is served again.
    ('greenhouse:fullco:2', 'greenhouse', 'fullco', 'Full Co', 'Engineer', now() - interval '20 days', now() - interval '10 days', 'full_read', false, false),
    ('greenhouse:fullco:4', 'greenhouse', 'fullco', 'Full Co', 'Writer', now() - interval '12 days', now() - interval '2 days', 'full_read', false, false),
    -- Gone, and dated only by the lap that could first see it.
    ('greenhouse:fullco:5', 'greenhouse', 'fullco', 'Full Co', 'Cook', now() - interval '25 days', now() - interval '4 days', 'lap_backfill', false, false),
    -- A feed that went dark, and a superseded closure: neither is a takedown.
    ('greenhouse:fullco:6', 'greenhouse', 'fullco', 'Full Co', 'Nurse', now() - interval '8 days', now() - interval '1 day', 'full_read', true, false),
    ('greenhouse:fullco:7', 'greenhouse', 'fullco', 'Full Co', 'Chef', now() - interval '8 days', now() - interval '1 day', 'full_read', false, true),
    -- A different posting with the SAME title, served now: no title is matched.
    ('greenhouse:fullco:old-analyst', 'greenhouse', 'fullco', 'Full Co', 'Analyst', now() - interval '40 days', now() - interval '20 days', 'full_read', false, false);

  INSERT INTO public.job_board_aged_out (id, source, company_token, posted_at, aged_at) VALUES
    ('greenhouse:fullco:8', 'greenhouse', 'fullco', now() - interval '31 days', now() - interval '1 day'),
    ('greenhouse:fullco:8u', 'greenhouse', 'fullco', NULL, now() - interval '1 day');

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

  it("going down: stamped missing with no trusted closure, and a suspect or superseded closure is no takedown", () => {
    for (const id of ["greenhouse:fullco:3", "greenhouse:fullco:6", "greenhouse:fullco:7"]) {
      expect(T.get(id)!.state, id).toBe("going_down");
      expect(T.get(id)!.sentence).toBe(TRUTH_COPY.goingDown);
      expect(T.get(id)!.closedAt).toBeNull();
    }
  });

  it("closed: a trusted takedown, dated", () => {
    const t = T.get("greenhouse:fullco:4")!;
    expect(t.state).toBe("closed");
    expect(t.closedAtIsObservation).toBe(false);
    expect(t.closedAt).not.toBeNull();
    expect(t.sentence).toMatch(/^Came down from the employer's system by \d{4}-\d{2}-\d{2}\.$/);
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

  it("its closure read reaches the curve index through each posting's token, as the lifecycle's does", async () => {
    const at = MIGRATION.indexOf("  cl AS (", MIGRATION.indexOf("FUNCTION public.posting_truth("));
    expect(at, "posting_truth's cl CTE was not found").toBeGreaterThan(0);
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
        `EXPLAIN WITH ids AS (SELECT DISTINCT x AS jid FROM unnest($1::text[]) AS x) SELECT * FROM (${cte}) cl`,
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
