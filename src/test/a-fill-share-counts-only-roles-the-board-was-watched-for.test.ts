/**
 * A FILL SHARE COUNTS ONLY ROLES THE BOARD WAS WATCHED FOR (20261012121000,
 * ghost spec Track 1, A4), and the A2 helper it reads (20261012120000).
 *
 * Executed in pglite against the re-issued get_company_fill_curve, with the
 * function it replaces (20261008110000) run on the same rows as the "before":
 *
 *   - delayed entry: a flat takedown hazard of 0.0186 a day (true 14-day share
 *     1 - e^(-14 x 0.0186) = 0.2293) on boards we began reading 21, 30, 45 and
 *     60 days ago, and on one read only every few days. The old chain counted
 *     the roles that were already up when we arrived from age 0 and printed a
 *     fraction of the truth; the new one is within two points;
 *   - a board with no takedowns, batched with 24 others, answers 25 rows (a
 *     numeric division by zero would have failed the whole batch);
 *   - the share sits inside its own interval where relists land early and
 *     fills late (the old interval excluded it);
 *   - `sufficient` needs 21 days of tracking;
 *   - multi_site_title_share reads a Centria-shaped board (one title at many
 *     locations) as 1 and an ordinary one as 0;
 *   - the board total comes from the newest complete read that states one,
 *     never from a NULL-overwritten day, an error visit or a read older than a
 *     week, and Workday's 2,000 is the cap.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { liveDefinitionOf } from "./helpers/live-sql";

const MIG = resolve(__dirname, "../../supabase/migrations");
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");
const HELPER = read("20261012120000_a_relist_warning_never_reads_another_site.sql");
const NEW = read("20261012121000_a_fill_share_counts_only_roles_the_board_was_watched_for.sql");
const OLD = read("20261008110000_a_role_is_counted_once_and_a_posting_seen_again_never_came_down.sql");

const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    title text, location text, region_code text,
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '', title text,
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer, absence_basis text);
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz);
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read','lap_proven','lap_pending','unprovable','unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_watch (
    company_token text PRIMARY KEY, first_observed_on date NOT NULL, first_observed_basis text NOT NULL,
    is_censored boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on));
  CREATE OR REPLACE ${liveDefinitionOf("normalize_close_title").body}
$$;
`;

const DAY = 86_400_000;
const LAMBDA = 0.0186;
const TRUE_R14 = 1 - Math.exp(-14 * LAMBDA);
const iso = (ms: number) => new Date(ms).toISOString();
const q = (s: string | null) => (s === null ? "NULL" : `'${s.replace(/'/g, "''")}'`);

interface Rows { postings: string[]; closures: string[]; exits: string[] }

/**
 * One board under a flat hazard. Roles are posted every day for 89 days, 40 a
 * day, each with a deterministic takedown time (stratified exponential). We
 * began reading the board `enrolledDaysAgo` days ago and read it every
 * `readEvery` days: a role we were not reading when it was posted is first
 * seen at our next read, and one taken down before that read is never seen at
 * all. Roles past 30 days age out (the fence), as the collector does.
 */
function flatHazardBoard(tok: string, now: number, enrolledDaysAgo: number, readEvery = 1, perDay = 40): Rows {
  const rows: Rows = { postings: [], closures: [], exits: [] };
  const enrolled = now - enrolledDaysAgo * DAY;
  const nextRead = (t: number) => {
    if (t <= enrolled) return enrolled;
    const k = Math.ceil((t - enrolled) / (readEvery * DAY));
    return enrolled + k * readEvery * DAY;
  };
  for (let d = 89; d >= 1; d--) {
    for (let j = 0; j < perDay; j++) {
      const posted = now - d * DAY - (j % 8) * 3_600_000;
      const u = (j + 0.5) / perDay;
      const life = (-Math.log(1 - u) / LAMBDA) * DAY;
      const closesAt = posted + life;
      const ageOutAt = posted + 30 * DAY + 2 * 3_600_000;
      const firstSeen = nextRead(posted);
      const id = `${tok}:${d}:${j}`;
      const endAt = Math.min(closesAt, ageOutAt);
      if (endAt < firstSeen || firstSeen > now) continue; // never seen
      if (closesAt <= ageOutAt && closesAt <= now) {
        // We see the takedown at the first read after it.
        const seenGone = Math.min(nextRead(closesAt), now);
        rows.closures.push(`(${q(id)}, 'greenhouse', ${q(tok)}, 'engineering', 'Role ${j}', ${q(iso(firstSeen))}, ${q(iso(posted))}, ${q(iso(seenGone))}, false, NULL, 5000, 'full_read')`);
      } else if (ageOutAt <= now) {
        rows.exits.push(`(${q(id)}, 'greenhouse', ${q(tok)}, 'engineering', 'aged_out', ${q(iso(ageOutAt))}, ${q(iso(posted))})`);
      } else {
        rows.postings.push(`(${q(id)}, 'greenhouse', ${q(tok)}, 'engineering', 'Role ${j}', 'Austin, TX', 'tx', ${q(iso(posted))}, ${q(iso(posted))}, ${q(iso(firstSeen))}, ${q(iso(now))}, NULL)`);
      }
    }
  }
  return rows;
}

function insertSql(r: Rows): string {
  const out: string[] = [];
  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  for (const c of chunk(r.postings, 500)) out.push(`INSERT INTO public.job_board_postings (id, source, company_token, category, title, location, region_code, posted_at, effective_posted, first_seen, last_seen, missing_since) VALUES ${c.join(",")};`);
  for (const c of chunk(r.closures, 500)) out.push(`INSERT INTO public.job_board_closures (posting_id, source, company_token, category, title, first_seen, posted_at, closed_at, superseded, suspect, batch_live_before, absence_basis) VALUES ${c.join(",")};`);
  for (const c of chunk(r.exits, 500)) out.push(`INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at) VALUES ${c.join(",")};`);
  return out.join("\n");
}

function boardMeta(tok: string, enrolledDaysAgo: number, bucket = "full_read"): string {
  return `
    INSERT INTO public.job_board_company_snapshots VALUES (${q(tok)}, current_date - 30, 2000);
    INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES (${q(tok)}, ${q(bucket)});
    INSERT INTO public.job_board_board_watch (company_token, first_observed_on, first_observed_basis)
      VALUES (${q(tok)}, current_date - ${enrolledDaysAgo}, 'company_snapshot');`;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? NaN : Number(v));

async function curve(db: PGlite, toks: string[]): Promise<Record<string, Row>> {
  const { rows } = await db.query<Row>(`SELECT * FROM public.get_company_fill_curve($1)`, [toks]);
  return Object.fromEntries(rows.map((r) => [String(r.company_token), r]));
}

let NOW = 0;
let newDb: PGlite;
let oldDb: PGlite;
const BOARDS: Array<{ tok: string; enrolled: number; readEvery: number }> = [
  { tok: "W21", enrolled: 21, readEvery: 1 },
  { tok: "W30", enrolled: 30, readEvery: 1 },
  { tok: "W45", enrolled: 45, readEvery: 1 },
  { tok: "W60", enrolled: 60, readEvery: 1 },
  { tok: "W45R3", enrolled: 45, readEvery: 3 },
];

beforeAll(async () => {
  NOW = Date.now();
  const fixture = BOARDS.map((b) => insertSql(flatHazardBoard(b.tok, NOW, b.enrolled, b.readEvery)) + boardMeta(b.tok, b.enrolled)).join("\n");
  newDb = new PGlite();
  await newDb.exec(SCHEMA);
  await newDb.exec(fixture);
  await newDb.exec(HELPER);
  await newDb.exec(NEW);
  oldDb = new PGlite();
  await oldDb.exec(SCHEMA);
  await oldDb.exec(fixture);
  await oldDb.exec(OLD);
}, 120_000);

describe("delayed entry: the share is the share of roles we watched", () => {
  it("the old chain printed a fraction of the truth on boards we began reading recently", async () => {
    const old = await curve(oldDb, BOARDS.map((b) => b.tok));
    const ratio = num(old.W21.fill_rate_14) / TRUE_R14;
    expect(ratio, `old W21 ${old.W21.fill_rate_14} against ${TRUE_R14.toFixed(4)}`).toBeLessThan(0.85);
  });

  it("the new chain is within two points of the truth on every enrolment age and on a board read every three days", async () => {
    const now = await curve(newDb, BOARDS.map((b) => b.tok));
    for (const b of BOARDS) {
      const r = now[b.tok];
      expect(Math.abs(num(r.fill_rate_14) - TRUE_R14), `${b.tok}: ${r.fill_rate_14} against ${TRUE_R14.toFixed(4)}`).toBeLessThan(0.02);
      expect(num(r.fill_rate_14_lo)).toBeLessThanOrEqual(num(r.fill_rate_14));
      expect(num(r.fill_rate_14_hi)).toBeGreaterThanOrEqual(num(r.fill_rate_14));
    }
  });

  it("a board read in laps (no watch floor) has an empty 14-day chain, which is not sufficient", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(insertSql(flatHazardBoard("LAP", NOW, 45)) + boardMeta("LAP", 45, "lap_proven"));
    await db.exec(HELPER);
    await db.exec(NEW);
    const r = (await curve(db, ["LAP"])).LAP;
    expect(r.sufficient).toBe(false);
    expect(num(r.n_at_risk_14)).toBe(0);
    expect(r.watched_from).toBeNull();
  });
});

describe("a board with no takedowns cannot fail its batch", () => {
  it("a zero-event board batched with 24 others answers 25 rows", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    const toks: string[] = [];
    const sql: string[] = [];
    for (let i = 0; i < 24; i++) {
      const tok = `B${i}`;
      toks.push(tok);
      sql.push(insertSql(flatHazardBoard(tok, NOW, 45, 1, 6)) + boardMeta(tok, 45));
    }
    // ZERO: roles live and aged out, nothing ever taken down.
    sql.push(`INSERT INTO public.job_board_postings (id, source, company_token, title, location, posted_at, effective_posted, first_seen)
      SELECT 'Z:'||g, 'paylocity', 'ZERO', 'Crew Member', 'Dallas, TX', now() - (g || ' days')::interval, now() - (g || ' days')::interval, now() - (g || ' days')::interval
      FROM generate_series(1, 29) g;`);
    sql.push(`INSERT INTO public.job_board_exits (posting_id, source, company_token, exit_reason, exited_at, posted_at)
      SELECT 'ZX:'||g, 'paylocity', 'ZERO', 'aged_out', now() - (g || ' days')::interval, now() - ((g + 30) || ' days')::interval
      FROM generate_series(1, 20) g;`);
    sql.push(boardMeta("ZERO", 60));
    toks.push("ZERO");
    await db.exec(sql.join("\n"));
    await db.exec(HELPER);
    await db.exec(NEW);
    const rows = await curve(db, toks);
    expect(Object.keys(rows)).toHaveLength(25);
    const z = rows.ZERO;
    expect(num(z.still_open_14)).toBe(1);
    expect(num(z.fill_rate_14_lo)).toBe(0);
    expect(num(z.fill_rate_14_hi)).toBe(0);
    expect(z.sufficient).toBe(false);
  });
});

describe("the interval contains its own share", () => {
  it("relists early and fills late: outside the old interval, inside the new one", async () => {
    // 120 roles posted 25 days ago on a board read in full since 80 days ago:
    // 60 re-posted on day 1, 40 taken down for good on day 12, 20 still up.
    // 150 more posted 5 days ago and still up, so the risk set halves between
    // the relists and the fills: R(14) = 0.778 x 40/60 = 0.519, while the
    // counted fill share is 40/100 and the old bounds 0.4 x (1 - S) sit near
    // 0.26-0.33.
    const make = () => [
      `INSERT INTO public.job_board_closures (posting_id, source, company_token, title, first_seen, posted_at, closed_at, superseded, batch_live_before, absence_basis)
        SELECT 'I:'||g, 'greenhouse', 'IV', 'Role', now() - interval '25 days', now() - interval '25 days', now() - interval '24 days', true, 5000, 'full_read'
        FROM generate_series(1, 60) g;`,
      `INSERT INTO public.job_board_closures (posting_id, source, company_token, title, first_seen, posted_at, closed_at, superseded, batch_live_before, absence_basis)
        SELECT 'J:'||g, 'greenhouse', 'IV', 'Role', now() - interval '25 days', now() - interval '25 days', now() - interval '13 days', false, 5000, 'full_read'
        FROM generate_series(1, 40) g;`,
      `INSERT INTO public.job_board_postings (id, source, company_token, title, location, posted_at, effective_posted, first_seen)
        SELECT 'K:'||g, 'greenhouse', 'IV', 'Role', 'Austin, TX', now() - interval '25 days', now() - interval '25 days', now() - interval '25 days'
        FROM generate_series(1, 20) g;`,
      `INSERT INTO public.job_board_postings (id, source, company_token, title, location, posted_at, effective_posted, first_seen)
        SELECT 'L:'||g, 'greenhouse', 'IV', 'Role', 'Austin, TX', now() - interval '5 days', now() - interval '5 days', now() - interval '5 days'
        FROM generate_series(1, 150) g;`,
      boardMeta("IV", 80),
    ].join("\n");
    const oldI = new PGlite(); await oldI.exec(SCHEMA); await oldI.exec(make()); await oldI.exec(OLD);
    const newI = new PGlite(); await newI.exec(SCHEMA); await newI.exec(make()); await newI.exec(HELPER); await newI.exec(NEW);
    const o = (await curve(oldI, ["IV"])).IV;
    const n = (await curve(newI, ["IV"])).IV;
    const outside = num(o.fill_rate_14) < num(o.fill_rate_14_lo) || num(o.fill_rate_14) > num(o.fill_rate_14_hi);
    expect(outside, `old: ${o.fill_rate_14} [${o.fill_rate_14_lo}, ${o.fill_rate_14_hi}]`).toBe(true);
    expect(num(n.fill_rate_14)).toBeGreaterThanOrEqual(num(n.fill_rate_14_lo));
    expect(num(n.fill_rate_14)).toBeLessThanOrEqual(num(n.fill_rate_14_hi));
  });
});

describe("honest sufficiency", () => {
  it("a board with every other term met but ten days of tracking is not sufficient", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(insertSql(flatHazardBoard("T45", NOW, 45, 1, 60)) + boardMeta("T45", 45));
    await db.exec(HELPER);
    await db.exec(NEW);
    const before = (await curve(db, ["T45"])).T45;
    expect(before.sufficient, "the board as built passes").toBe(true);
    // The same board, its log only ten days deep (tracking_days reads the first closure and first sighting).
    await db.exec(`DELETE FROM public.job_board_closures WHERE company_token = 'T45' AND closed_at < now() - interval '10 days';
                   UPDATE public.job_board_postings SET first_seen = GREATEST(first_seen, now() - interval '10 days') WHERE company_token = 'T45';`);
    const after = (await curve(db, ["T45"])).T45;
    expect(num(after.tracking_days)).toBeLessThan(21);
    expect(after.sufficient).toBe(false);
  });
});

describe("the multi-site share and the board total", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(`
      -- Centria-shaped: ten titles, each live at ten locations.
      INSERT INTO public.job_board_postings (id, company_token, title, location, region_code, posted_at, effective_posted, first_seen)
        SELECT 'C:'||g, 'centria', 'Behavior Technician ' || (g % 10), 'Town ' || (g / 10) || ', MI', 'mi', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days'
        FROM generate_series(0, 99) g;
      -- Ordinary: fifty distinct titles at one office; a req-id suffix is not a different title.
      INSERT INTO public.job_board_postings (id, company_token, title, location, region_code, posted_at, effective_posted, first_seen)
        SELECT 'A:'||g, 'affirm', 'Engineer ' || g || ' - 1234' || g, 'San Francisco, CA', 'ca', NULL, now() - interval '3 days', now() - interval '3 days'
        FROM generate_series(0, 49) g;
      -- The same title at the same place twice is one site.
      INSERT INTO public.job_board_postings (id, company_token, title, location, region_code, posted_at, effective_posted, first_seen)
        VALUES ('S:1', 'samesite', 'Nurse', 'Boise, ID', 'id', now(), now(), now()), ('S:2', 'samesite', 'Nurse (R-4821)', 'Boise, ID', 'id', now(), now(), now());
      -- Board totals.
      INSERT INTO public.job_board_board_state (company_token, observed_on, source, observed_at, feed_total, state) VALUES
        ('affirm', current_date - 1, 'greenhouse', now() - interval '1 day', 203, 'ok'),
        ('affirm', current_date, 'greenhouse', now() - interval '1 hour', NULL, 'ok'),           -- a mid-feed visit wrote NULL over the day
        ('centria', current_date, 'greenhouse', now() - interval '2 hours', 1262, 'error'),      -- an error visit: not a complete read
        ('centria', current_date - 2, 'greenhouse', now() - interval '2 days', 1250, 'ok'),
        ('aah~wd1~External', current_date, 'workday', now() - interval '3 hours', 2000, 'ok'),
        ('bass', current_date, 'greenhouse', now() - interval '5 hours', 31, 'empty'),
        ('stale', current_date - 9, 'greenhouse', now() - interval '9 days', 40, 'ok');
    `);
    await db.exec(HELPER);
    await db.exec(NEW);
  });

  it("reads one title at many locations as 1 and distinct titles as 0, and an unknown board as unknown", async () => {
    const { rows } = await db.query<Row>(`SELECT * FROM public.board_multi_site_title_share(ARRAY['centria','affirm','samesite','nobody'])`);
    const by = Object.fromEntries(rows.map((r) => [String(r.company_token), r]));
    expect(num(by.centria.multi_site_title_share)).toBe(1);
    expect(num(by.centria.multi_site_n)).toBe(100);
    expect(num(by.affirm.multi_site_title_share)).toBe(0);
    expect(num(by.samesite.multi_site_title_share)).toBe(0);
    expect(by.nobody.multi_site_title_share).toBeNull();
    const c = await curve(db, ["centria", "affirm"]);
    expect(num(c.centria.multi_site_title_share)).toBe(1);
    expect(num(c.affirm.undated_open), "Affirm's fifty rows carry no employer date").toBe(50);
  });

  it("takes the board total from the newest complete read that states one, with that read's time", async () => {
    const c = await curve(db, ["affirm", "centria", "aah~wd1~External", "bass", "stale", "nobody"]);
    expect(num(c.affirm.feed_total), "not the NULL the day's later visit wrote").toBe(203);
    expect(new Date(String(c.affirm.feed_read_at)).getTime()).toBeLessThan(Date.now() - 20 * 3_600_000);
    expect(num(c.centria.feed_total), "not the error visit's").toBe(1250);
    expect(c.centria.feed_state).toBe("ok");
    expect(c["aah~wd1~External"].feed_capped, "Workday's 2,000 is the cap").toBe(true);
    expect(c.affirm.feed_capped).toBe(false);
    expect(num(c.bass.feed_total), "a read whose roles are all older than our window is complete").toBe(31);
    expect(c.bass.feed_state).toBe("empty");
    expect(c.stale.feed_total, "older than a week is no total").toBeNull();
    expect(c.stale.feed_capped).toBeNull();
    expect(c.nobody.feed_total).toBeNull();
  });
});

describe("the file", () => {
  it("is safe to run twice", async () => {
    await expect(newDb.exec(NEW)).resolves.toBeDefined();
    await expect(newDb.exec(HELPER)).resolves.toBeDefined();
  });
  it("keeps anon EXECUTE on the reader the page calls, and the helper private", async () => {
    const { rows } = await newDb.query<{ a: boolean; h: boolean; i: boolean }>(`SELECT
      has_function_privilege('anon', 'public.get_company_fill_curve(text[])', 'EXECUTE') AS a,
      has_function_privilege('anon', 'public.board_multi_site_title_share(text[])', 'EXECUTE') AS h,
      has_function_privilege('anon', 'public.get_repost_index()', 'EXECUTE') AS i`);
    expect(rows[0]).toEqual({ a: true, h: false, i: false });
  });
  it("sits in this round's range, after the helper it calls", () => {
    expect("20261012121000" > "20261012120000").toBe(true);
    expect(NEW).toContain("FROM public.board_multi_site_title_share(p_tokens)");
  });
});
