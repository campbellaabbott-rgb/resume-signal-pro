// @vitest-environment node
/**
 * TRENDING FIELDS READ ONLY BOARDS WATCHED THROUGH BOTH WEEKS (S14X-038), AND
 * THE WEEKLY SERIES COUNTS A RE-LISTED POSTING IN ITS OWN WEEK (NB-46).
 *
 * /hiring-trends says postings from boards catalogued mid-window are left
 * out, and nothing left them out; and both readers dropped a posting from the
 * week it was dated once it came down as a same-title re-list, which drains
 * older weeks faster than newer ones. On pglite, with the live definitions
 * (20261008111500, 20261008111000) first and then this round's two files
 * (20261112191000 for the field table, 20261112191500 for the weekly series):
 *   board A has been watched sixty days: 25 postings dated in each window,
 *     one posting from the prior week came down as a re-list and its new
 *     posting is dated in the last week;
 *   board B was first observed five days ago with 400 postings and a takedown
 *     in the last week; board C has no watch row and 50 postings.
 * The live readers count B and C and drop the re-listed original; the new
 * ones count A alone, the original in its own week, and B's takedown nowhere.
 * Both new readers hold the same watched-board clause and neither drops a
 * superseded closure from the posting legs.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, files.find((f) => f.startsWith(prefix))!), "utf8");
const TRENDS_WAS = mig("20261008111000_");
const FIELDS_WAS = mig("20261008111500_");
const FIX = mig("20261112191000_") + "\n" + mig("20261112191500_");

const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text NOT NULL, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, first_seen timestamptz NOT NULL, experience_band text, remote boolean NOT NULL DEFAULT false);
  CREATE TABLE public.job_board_closures (
    posting_id text NOT NULL, company_token text NOT NULL, category text NOT NULL DEFAULT '',
    posted_at timestamptz, first_seen timestamptz, closed_at timestamptz NOT NULL,
    superseded boolean NOT NULL DEFAULT false, suspect boolean, absence_basis text);
  CREATE TABLE public.job_board_board_watch (
    company_token text PRIMARY KEY, first_observed_on date NOT NULL, first_observed_basis text NOT NULL DEFAULT 'board_state',
    is_censored boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
`;

const live = (tok: string, prefix: string, n: number, daysAgo: number) => `
  INSERT INTO public.job_board_postings (id, company_token, category, posted_at, first_seen)
  SELECT '${prefix}:' || i, '${tok}', 'finance', now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}) + interval '1 hour'
  FROM generate_series(1, ${n}) i;`;

const FIXTURE = `
  INSERT INTO public.job_board_board_watch (company_token, first_observed_on) VALUES
    ('a', current_date - 60), ('b', current_date - 5);
  ${live("a", "a-last", 25, 2)}
  ${live("a", "a-prior", 25, 10)}
  -- A's re-list: the original, dated in the prior week, came down as superseded;
  -- its new posting is dated in the last week.
  INSERT INTO public.job_board_closures (posting_id, company_token, category, posted_at, first_seen, closed_at, superseded, absence_basis)
  VALUES ('a-orig', 'a', 'finance', now() - interval '10 days', now() - interval '10 days' + interval '1 hour', now() - interval '2 days', true, 'full_read');
  INSERT INTO public.job_board_postings (id, company_token, category, posted_at, first_seen)
  VALUES ('a-relist', 'a', 'finance', now() - interval '2 days', now() - interval '2 days' + interval '1 hour');
  -- The closure log is three weeks deep, so prior7 is published.
  INSERT INTO public.job_board_closures (posting_id, company_token, category, posted_at, first_seen, closed_at, absence_basis)
  VALUES ('a-old', 'a', 'finance', NULL, NULL, now() - interval '20 days', 'full_read');
  ${live("b", "b", 400, 2)}
  INSERT INTO public.job_board_closures (posting_id, company_token, category, posted_at, first_seen, closed_at, absence_basis)
  VALUES ('b-gone', 'b', 'finance', NULL, NULL, now() - interval '1 day', 'full_read');
  ${live("c", "c", 50, 2)}
`;

type Field = { category: string; last7: number; prior7: number | null };
type Week = { week_start: string; new_postings: number; closed: number; live_new: number };
const sum = (ws: Week[], k: keyof Week) => ws.reduce((s, w) => s + Number(w[k]), 0);

let db: PGlite;
let fieldsWas: Field;
let weeksWas: Week[];
let fieldsNow: Field;
let weeksNow: Week[];
let viaDefault: Field;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(FIXTURE);
  await db.exec(TRENDS_WAS);
  await db.exec(FIELDS_WAS);
  fieldsWas = (await db.query<Field>(`SELECT * FROM public.get_trending_categories()`)).rows.find((r) => r.category === "finance")!;
  weeksWas = (await db.query<Week>(`SELECT * FROM public.get_hiring_trends()`)).rows;
  await db.exec(FIX);
  fieldsNow = (await db.query<Field>(`SELECT * FROM public.get_trending_categories(14)`)).rows.find((r) => r.category === "finance")!;
  viaDefault = (await db.query<Field>(`SELECT * FROM public.get_trending_categories()`)).rows.find((r) => r.category === "finance")!;
  weeksNow = (await db.query<Week>(`SELECT * FROM public.get_hiring_trends()`)).rows;
});

describe("the live readers (the positive control)", () => {
  it("count the board catalogued five days ago and the undated board in the last week, and drop the re-listed original", () => {
    expect(fieldsWas.last7).toBe(25 + 1 + 400 + 50);
    expect(fieldsWas.prior7).toBe(25);
    expect(sum(weeksWas, "new_postings")).toBe(51 + 400 + 50);
    expect(sum(weeksWas, "closed")).toBe(2);
  });
});

describe("the field table", () => {
  it("counts only the board watched through both windows, with the re-listed original in its own week", () => {
    expect(fieldsNow.last7).toBe(25 + 1);
    expect(fieldsNow.prior7).toBe(25 + 1);
  });

  it("answers the cache's no-argument call through its default, and never widens below fourteen days", async () => {
    expect(viaDefault).toEqual(fieldsNow);
    const seven = (await db.query<Field>(`SELECT * FROM public.get_trending_categories(7)`)).rows.find((r) => r.category === "finance")!;
    expect(seven).toEqual(fieldsNow);
  });
});

describe("the weekly series", () => {
  it("counts the watched board alone, the re-listed original included, and no takedown from a board watched for five days", () => {
    expect(sum(weeksNow, "new_postings")).toBe(51 + 1);
    expect(sum(weeksNow, "live_new")).toBe(51);
    expect(sum(weeksNow, "closed")).toBe(1);
  });

  it("keeps its shape", async () => {
    const cols = (await db.query<{ a: string[] }>(`SELECT proargnames AS a FROM pg_proc WHERE oid = 'public.get_hiring_trends()'::regprocedure`)).rows[0].a;
    expect(cols).toEqual(["week_start", "new_postings", "entry_new", "remote_new", "closed", "closed_flagged", "live_new"]);
  });
});

describe("one rule in both readers", () => {
  it("both bodies hold the same watched-board clause on the closed leg, and neither drops a superseded closure from a posting leg", async () => {
    const src = async (sig: string) => (await db.query<{ s: string }>(`SELECT prosrc AS s FROM pg_proc WHERE oid = '${sig}'::regprocedure`)).rows[0].s;
    for (const s of [await src("public.get_trending_categories(integer)"), await src("public.get_hiring_trends()")]) {
      expect(s).toContain("FROM public.job_board_board_watch w");
      expect(s).toContain("c.company_token IN (SELECT company_token FROM watched)");
      expect(s).not.toContain("AND NOT c.superseded");
    }
  });

  it("both stay SECURITY DEFINER with the page's roles able to call them and nothing granted to PUBLIC", async () => {
    const r = (await db.query<{ sig: string; anon: boolean; auth: boolean; pub: boolean; definer: boolean }>(`
      SELECT p.oid::regprocedure::text AS sig,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
             EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS pub,
             p.prosecdef AS definer
        FROM pg_proc p WHERE p.proname IN ('get_trending_categories', 'get_hiring_trends') ORDER BY 1`)).rows;
    expect(r).toEqual([
      { sig: "get_hiring_trends()", anon: true, auth: true, pub: false, definer: true },
      { sig: "get_trending_categories(integer)", anon: true, auth: true, pub: false, definer: true },
    ]);
  });

  it("the census names the field table by the signature it has", async () => {
    const c = (await db.query<{ c: { allowlisted_not_callable: string[] } }>(`SELECT public.client_callable_census() AS c`)).rows[0].c;
    expect(c.allowlisted_not_callable).not.toContain("public.get_trending_categories(integer)");
    expect(c.allowlisted_not_callable).not.toContain("public.get_trending_categories()");
  });

  it("the files run twice", async () => {
    await db.exec(FIX);
    expect((await db.query<Field>(`SELECT * FROM public.get_trending_categories()`)).rows.find((r) => r.category === "finance")).toEqual(fieldsNow);
  });

  it("each end-state block refuses a reader re-issued without its watched-board clause", async () => {
    const field = mig("20261112191000_").replace("AND p.company_token IN (SELECT company_token FROM watched)", "");
    const series = mig("20261112191500_").replace("AND company_token IN (SELECT company_token FROM watched)\n    GROUP BY 1\n  )\n  SELECT", "GROUP BY 1\n  )\n  SELECT");
    expect(field).not.toBe(mig("20261112191000_"));
    expect(series).not.toBe(mig("20261112191500_"));
    for (const [sql, msg] of [[field, /get_trending_categories: a leg is not held/], [series, /get_hiring_trends: a leg is not held/]] as const) {
      await expect(db.exec(`BEGIN;\n${sql}`)).rejects.toThrow(msg);
      await db.exec("ROLLBACK");
    }
    expect((await db.query<Field>(`SELECT * FROM public.get_trending_categories()`)).rows.find((r) => r.category === "finance")).toEqual(fieldsNow);
  });
});
