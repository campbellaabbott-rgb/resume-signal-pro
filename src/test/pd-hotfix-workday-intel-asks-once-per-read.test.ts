// @vitest-environment node
/**
 * PD HOTFIX 2026-10-24: A COMPANY PAGE ASKS ONCE PER READ WHETHER ITS
 * WORKDAY TENANT HOSTS ANOTHER EMPLOYER (migration 20261012137000).
 *
 * Live on 2026-10-24, get_company_intel answered 500 57014 after 15 seconds
 * on every Workday token, a made-up one included, while stripe answered in
 * 0.3 seconds. 20261012135000 had put its hosting-tenant helper inside an OR
 * arm of the snapshot series and of the postings predicate; the helper is a
 * STABLE SQL function with its own search_path, so it is never inlined, and
 * inside an OR it ran once per row, each run a scan of the override table.
 *
 * On pglite, in the live order (the 20261012136000 test's boot), then the
 * fix, under Supabase's default grants, over a few thousand snapshot rows and
 * a few hundred override rows. Each claim has its positive control on the
 * database without the fix:
 *   (a) the helper runs once per call, counted by a stand-in that bumps a
 *       sequence, and the generic plan reads it through an InitPlan;
 *   (b) both readers return byte-identical JSON before and after, for every
 *       kind of token;
 *   (c) signatures, security, volatility, settings, owner and grants are
 *       unchanged, and no function is created;
 *   (d) the file is safe to run twice;
 *   (e) its self-check refuses the per-row shape and drifted grants, and the
 *       rewrite refuses a live body it does not know.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 300_000, testTimeout: 120_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const mig = (prefix: string) => readFileSync(resolve(MIGRATIONS, files.find((f) => f.startsWith(prefix))!), "utf8");
const FIX = mig("20261012137000_");
const VERIFY = (FIX.match(/DO \$verify\$[\s\S]*?\n\$verify\$;/) ?? [""])[0];

const STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text NOT NULL DEFAULT '',
    category text, country text, salary_currency text, salary_min_annual numeric, missing_since timestamptz,
    effective_posted timestamptz NOT NULL DEFAULT now(), agency boolean NOT NULL DEFAULT false
  );
  CREATE TABLE public.company_profiles (company_token text PRIMARY KEY, employee_count int, employee_basis text, yc_batch text);
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_company_snapshots (company_token text, snapshot_date date, company text NOT NULL DEFAULT '', open_roles int NOT NULL DEFAULT 0, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
`;

let n = 0;
const posts = (source: string, token: string, company: string, k: number, pay: number, category: string, country = "US") =>
  Array.from({ length: k }, () => `('${source}:${token}:${n++}', '${source}', '${token}', '${company}', '${category}', '${country}', 'USD', ${pay}, NULL, now() - interval '2 days')`);

// A tenant that hosts another employer's site (an override names one site).
const JCREW = "jcrew~wd1~JCrewCareers";
const MADEWELL = "jcrew~wd1~MadewellCareers";
// A tenant whose sites are one employer (pooled).
const MEIJER_STORES = "meijer~wd5~Meijer_Stores_Hourly";
const MEIJER_CORP = "meijer~wd5~Meijer_Corporate";
// A Workday site with postings and no snapshot row at all.
const NO_SNAPS = "acme~wd5~NoSnapshots";
const MADE_UP_WD = "zzzz-none~wd1~Careers";
const MADE_UP_PLAIN = "zzzz-none-plain";

const SNAPSHOT_BOARDS = 500;
const SNAPSHOT_DAYS = 7;
const BULK_ROWS = SNAPSHOT_BOARDS * SNAPSHOT_DAYS;
const OVERRIDES = 400;

const SEED = `
  INSERT INTO public.job_board_postings (id, source, company_token, company, category, country, salary_currency, salary_min_annual, missing_since, effective_posted) VALUES
  ${[
    ...posts("workday", JCREW, "J.Crew", 5, 60000, "retail"),
    ...posts("workday", MADEWELL, "Madewell", 3, 40000, "retail", "CA"),
    ...posts("workday", MEIJER_STORES, "Meijer", 6, 30000, "retail"),
    ...posts("workday", MEIJER_CORP, "Meijer", 4, 90000, "finance"),
    ...posts("workday", NO_SNAPS, "Acme", 4, 70000, "engineering", "GB"),
    ...posts("greenhouse", "everlane", "Everlane", 4, 55000, "retail"),
  ].join(",\n  ")};
  -- Other employers in the same fields, so the similar lists have rows.
  INSERT INTO public.job_board_postings (id, source, company_token, company, category, country, salary_currency, salary_min_annual, effective_posted)
  SELECT 'bulk:' || b || ':' || k,
         CASE WHEN b % 3 = 0 THEN 'workday' ELSE 'greenhouse' END,
         CASE WHEN b % 3 = 0 THEN 'other' || b || '~wd1~Site' ELSE 'board' || b END,
         'Employer ' || b,
         (ARRAY['retail', 'finance', 'engineering'])[1 + b % 3],
         'US', 'USD', 40000 + b * 10, now() - interval '3 days'
    FROM generate_series(1, 150) b, generate_series(1, 4) k;
  -- The override table: J.Crew's full-token row and Meijer's bare slug, then
  -- bare brand slugs and other tenants' full-token rows.
  INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('${JCREW}', 'J.Crew'), ('meijer', 'Meijer');
  INSERT INTO public.company_name_overrides (slug, display_name)
  SELECT CASE WHEN g % 2 = 0 THEN 'brand' || g ELSE 'tenant' || g || '~wd1~Site' END, 'Name ' || g
    FROM generate_series(3, ${OVERRIDES}) g;
  -- Seven days of snapshots on ${SNAPSHOT_BOARDS} boards, a third of them Workday sites.
  INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles)
  SELECT CASE WHEN b % 3 = 0 THEN 'other' || b || '~wd1~Site' ELSE 'board' || b END, current_date - d, b + d
    FROM generate_series(1, ${SNAPSHOT_BOARDS}) b, generate_series(0, ${SNAPSHOT_DAYS - 1}) d;
  INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles) VALUES
    ('${JCREW}', current_date - 6, 100), ('${JCREW}', current_date, 5),
    ('${MADEWELL}', current_date - 6, 3), ('${MADEWELL}', current_date, 3),
    ('${MEIJER_STORES}', current_date - 6, 2), ('${MEIJER_STORES}', current_date, 6),
    ('${MEIJER_CORP}', current_date - 6, 2), ('${MEIJER_CORP}', current_date, 4),
    ('everlane', current_date - 6, 9), ('everlane', current_date, 4);
`;

// The live helper's rule, plus a sequence bump per evaluation. Same language,
// volatility and setting, so the planner treats it exactly as it treats the
// real one (never inlined).
const COUNTING_HELPER = `
  CREATE SEQUENCE public.helper_calls;
  CREATE OR REPLACE FUNCTION public.workday_site_is_own_employer(p_token text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = public
  AS $site$
    SELECT nextval('public.helper_calls') > 0
       AND COALESCE(p_token, '') ~ '^[^~]+~wd[0-9]+~'
       AND EXISTS (SELECT 1 FROM public.company_name_overrides o
                    WHERE position('~' IN o.slug) > 0
                      AND split_part(o.slug, '~', 1) = split_part(p_token, '~', 1))
  $site$;
`;

const strip = (sql: string) => sql.replace(/NOTIFY pgrst[^;]*;/g, "");

async function boot(opts: { fix?: boolean; counting?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(STAND_INS);
  await db.exec(strip(mig("20260723021844_")));
  await db.exec(mig("20260827140000_"));
  await db.exec(mig("20261009160200_"));
  await db.exec(mig("20261012100000_"));
  await db.exec(mig("20261012101000_"));
  await db.exec(mig("20261012135000_"));
  await db.exec(strip(mig("20261012136000_")));
  await db.exec(SEED);
  if (opts.counting) await db.exec(COUNTING_HELPER);
  if (opts.fix) await db.exec(FIX);
  return db;
}

const intelJson = async (db: PGlite, t: string) =>
  (await db.query<{ j: string }>("SELECT public.get_company_intel($1)::text AS j", [t])).rows[0].j;
const similarJson = async (db: PGlite, t: string) =>
  (await db.query<{ j: string }>("SELECT public.get_similar_companies($1, 20)::text AS j", [t])).rows[0].j;

/** Helper evaluations during one statement. */
async function callsDuring(db: PGlite, sql: string, params: unknown[]) {
  await db.exec("ALTER SEQUENCE public.helper_calls RESTART");
  await db.query(sql, params);
  const r = await db.query<{ n: string }>("SELECT (CASE WHEN is_called THEN last_value ELSE 0 END)::text AS n FROM public.helper_calls");
  return Number(r.rows[0].n);
}

/** The generic plan of a reader's body, as the SQL function plans it (parameters are not folded). */
async function genericPlan(db: PGlite, fn: string, args: string, call: string) {
  const src = (await db.query<{ s: string }>("SELECT prosrc AS s FROM pg_proc WHERE oid = $1::regprocedure", [fn])).rows[0].s;
  const body = src.replace(/\bp_token\b/g, "$1").replace(/\bp_limit\b/g, "$2").trim().replace(/;\s*$/, "");
  await db.exec("DEALLOCATE ALL; SET plan_cache_mode = force_generic_plan;");
  await db.exec(`PREPARE reader_plan(${args}) AS ${body}`);
  const rows = (await db.query<Record<string, string>>(`EXPLAIN (COSTS OFF) EXECUTE reader_plan(${call})`)).rows;
  await db.exec("DEALLOCATE ALL; RESET plan_cache_mode;");
  return rows.map((r) => r["QUERY PLAN"]);
}

async function median(db: PGlite, sql: string, params: unknown[], runs = 3) {
  await db.query(sql, params); // warm
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await db.query(sql, params);
    ms.push(performance.now() - t0);
  }
  return ms.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

const ATTRS = `
  SELECT p.prosecdef AS definer, p.provolatile AS volatile, p.proparallel AS parallel, p.proisstrict AS strict,
         COALESCE(array_to_string(p.proconfig, ','), '') AS config, pg_get_function_result(p.oid) AS result,
         pg_get_function_identity_arguments(p.oid) AS args, p.proowner::regrole::text AS owner,
         (SELECT l.lanname FROM pg_language l WHERE l.oid = p.prolang) AS language,
         COALESCE((SELECT string_agg(z.x, ',' ORDER BY z.x)
                     FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type AS x
                             FROM aclexplode(p.proacl) a) z), 'default') AS acl
    FROM pg_proc p WHERE p.oid = $1::regprocedure`;
const READERS = ["public.get_company_intel(text)", "public.get_similar_companies(text,integer)"];
const ALL_THREE = [...READERS, "public.workday_site_is_own_employer(text)"];
type Attrs = {
  definer: boolean; volatile: string; parallel: string; strict: boolean; config: string; result: string;
  args: string; owner: string; language: string; acl: string;
};
const attrs = async (db: PGlite, fn: string) => (await db.query<Attrs>(ATTRS, [fn])).rows[0];
const can = async (db: PGlite, role: string, fn: string) =>
  (await db.query<{ ok: boolean }>("SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS ok", [role, fn])).rows[0].ok;

let before: PGlite, after: PGlite, countBefore: PGlite, countAfter: PGlite;
beforeAll(async () => {
  [before, after, countBefore, countAfter] = await Promise.all([
    boot(), boot({ fix: true }), boot({ counting: true }), boot({ counting: true, fix: true }),
  ]);
});

describe("(a) the hosting-tenant helper runs once per call, not once per row", () => {
  it("positive control: before the fix, one Workday read ran it once per snapshot row it reached", async () => {
    const intel = await callsDuring(countBefore, "SELECT public.get_company_intel($1)", [MEIJER_STORES]);
    const madeUp = await callsDuring(countBefore, "SELECT public.get_company_intel($1)", [MADE_UP_WD]);
    expect(intel, "every snapshot row of the window outside the tenant reached the Workday arm").toBeGreaterThanOrEqual(BULK_ROWS);
    expect(madeUp, "a made-up Workday token with no postings paid the same").toBeGreaterThanOrEqual(BULK_ROWS);
    // The postings predicate too: once per posting on the tenant's other site.
    expect(await callsDuring(countBefore, "SELECT public.get_similar_companies($1, 20)", [MEIJER_STORES])).toBeGreaterThanOrEqual(4);
  });

  it("after the fix, each reader runs it at most once per call, for every kind of token", async () => {
    for (const t of [MEIJER_STORES, MEIJER_CORP, MADEWELL, JCREW, NO_SNAPS, MADE_UP_WD, MADE_UP_PLAIN, "everlane", "board1", "other3~wd1~Site"]) {
      const i = await callsDuring(countAfter, "SELECT public.get_company_intel($1)", [t]);
      const s = await callsDuring(countAfter, "SELECT public.get_similar_companies($1, 20)", [t]);
      expect(i, `get_company_intel(${t})`).toBeLessThanOrEqual(1);
      expect(s, `get_similar_companies(${t})`).toBeLessThanOrEqual(1);
    }
    expect(await callsDuring(countAfter, "SELECT public.get_company_intel($1)", [MEIJER_STORES])).toBe(1);
    expect(await callsDuring(countAfter, "SELECT public.get_company_intel($1)", [MADE_UP_WD])).toBe(1);
  });

  it("the generic plan reads the flag through an InitPlan over the one-row CTE and filters no row through the helper", async () => {
    const helperInFilter = (plan: string[]) => plan.filter((l) => /Filter:.*workday_site_is_own_employer/.test(l));
    const oldIntel = await genericPlan(before, READERS[0], "text", `'${MEIJER_STORES}'`);
    expect(helperInFilter(oldIntel).length, `positive control, the old plan:\n${oldIntel.join("\n")}`).toBeGreaterThanOrEqual(2);
    const oldSimilar = await genericPlan(before, READERS[1], "text, int", `'${MEIJER_STORES}', 20`);
    expect(helperInFilter(oldSimilar).length, "positive control, the old similar plan").toBeGreaterThanOrEqual(1);

    for (const [fn, args, call] of [[READERS[0], "text", `'${MEIJER_STORES}'`], [READERS[1], "text, int", `'${MEIJER_STORES}', 20`]]) {
      const plan = await genericPlan(after, fn, args, call);
      const text = plan.join("\n");
      expect(helperInFilter(plan), `${fn}:\n${text}`).toEqual([]);
      expect(text, `${fn}: no per-row helper call anywhere in the plan`).not.toMatch(/workday_site_is_own_employer/);
      expect(text, fn).toMatch(/CTE own_site/);
      expect(text, fn).toMatch(/InitPlan/);
      expect(text, fn).toMatch(/CTE Scan on own_site/);
      expect(text, `${fn}: no correlated SubPlan reads the flag`).not.toMatch(/SubPlan[^\n]*\n\s*->\s+CTE Scan on own_site/);
    }
  });

  it("measured: the read gets cheaper, and the JSON does not change", async () => {
    const sql = "SELECT public.get_company_intel($1)";
    const rows: string[] = [];
    for (const t of [MEIJER_STORES, MADE_UP_WD, "everlane"]) {
      const b = await median(before, sql, [t]);
      const a = await median(after, sql, [t]);
      rows.push(`${t}: ${b.toFixed(1)} ms -> ${a.toFixed(1)} ms`);
      if (t !== "everlane") expect(a, `${t}: ${b} ms before, ${a} ms after`).toBeLessThan(b);
    }
    console.info(`[pd-hotfix intel] pglite, ${BULK_ROWS + 10} snapshot rows, ${OVERRIDES} overrides, median of 3 warm runs:\n  ${rows.join("\n  ")}`);
  });
});

describe("(b) the replies are identical before and after", () => {
  const TOKENS: Array<[string, string]> = [
    ["a Workday site whose tenant hosts another employer (read as its own employer)", MADEWELL],
    ["the hosting tenant's own site", JCREW],
    ["a Workday site whose tenant pools its sites", MEIJER_STORES],
    ["the pooled tenant's other site", MEIJER_CORP],
    ["a non-Workday token", "everlane"],
    ["a made-up Workday token", MADE_UP_WD],
    ["a made-up plain token", MADE_UP_PLAIN],
    ["a Workday token with zero snapshot rows", NO_SNAPS],
    ["a bulk Workday site", "other3~wd1~Site"],
    ["a bulk plain board", "board1"],
  ];

  it("positive control: the tokens tell the cases apart (the comparison is not of empty replies)", async () => {
    const m = JSON.parse(await intelJson(after, MADEWELL));
    const s = JSON.parse(await intelJson(after, MEIJER_STORES));
    const z = JSON.parse(await intelJson(after, NO_SNAPS));
    expect(m.usd_n, "Madewell reads its own three postings").toBe(3);
    expect(s.usd_n, "Meijer pools both sites").toBe(10);
    expect(s.net_7d, "Meijer's week pools both sites").toBe(6);
    expect(z.usd_n).toBe(4);
    expect(z.net_7d, "no snapshot row, no week").toBeNull();
    expect(JSON.parse(await similarJson(after, MEIJER_STORES)).length).toBeGreaterThan(0);
  });

  for (const [label, t] of TOKENS) {
    it(`get_company_intel and get_similar_companies: ${label} (${t})`, async () => {
      expect(await intelJson(after, t)).toBe(await intelJson(before, t));
      expect(await similarJson(after, t)).toBe(await similarJson(before, t));
    });
  }
});

describe("(c) everything but the body is unchanged", () => {
  it("signature, result, security, volatility, settings, owner and grants of both readers and the helper", async () => {
    for (const fn of ALL_THREE) expect(await attrs(after, fn), fn).toEqual(await attrs(before, fn));
    for (const fn of READERS) {
      const a = await attrs(after, fn);
      expect(a.definer, fn).toBe(true);
      expect(a.volatile, fn).toBe("s");
      expect(a.config, fn).toBe("search_path=public,statement_timeout=15s");
      for (const role of ["anon", "authenticated", "service_role"]) expect(await can(after, role, fn), `${role} on ${fn}`).toBe(true);
      expect(await can(after, "public", fn), `PUBLIC on ${fn}`).toBe(false);
    }
    const h = "public.workday_site_is_own_employer(text)";
    expect(await can(after, "anon", h)).toBe(false);
    expect(await can(after, "authenticated", h)).toBe(false);
    expect(await can(after, "service_role", h)).toBe(true);
  });

  it("creates no function and drops none", async () => {
    const q = "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public'";
    expect((await after.query<{ n: number }>(q)).rows[0].n).toBe((await before.query<{ n: number }>(q)).rows[0].n);
  });

  it("the body differs from the live one only by the once-per-call read", async () => {
    const src = async (db: PGlite, fn: string) => (await db.query<{ s: string }>("SELECT prosrc AS s FROM pg_proc WHERE oid = $1::regprocedure", [fn])).rows[0].s;
    for (const fn of READERS) {
      const undo = (await src(after, fn))
        .replace("WITH own_site AS MATERIALIZED (\n    SELECT public.workday_site_is_own_employer(p_token) AS own\n  ),\n  own_sources", "WITH own_sources")
        .split("NOT (SELECT own_site.own FROM own_site)").join("NOT public.workday_site_is_own_employer(p_token)");
      expect(undo, fn).toBe(await src(before, fn));
    }
  });
});

describe("(d) the file is safe to run twice", () => {
  it("a second run leaves both bodies, the grants and every reply as the first left them", async () => {
    const db = await boot({ fix: true });
    const defs = async () => Promise.all(READERS.map(async (fn) =>
      (await db.query<{ d: string }>("SELECT pg_get_functiondef($1::regprocedure) AS d", [fn])).rows[0].d));
    const first = await defs();
    const firstAttrs = await Promise.all(ALL_THREE.map((fn) => attrs(db, fn)));
    const firstReplies = await Promise.all([MADEWELL, MEIJER_STORES, MADE_UP_WD].map((t) => intelJson(db, t)));
    await db.exec(FIX);
    expect(await defs()).toEqual(first);
    expect(await Promise.all(ALL_THREE.map((fn) => attrs(db, fn)))).toEqual(firstAttrs);
    expect(await Promise.all([MADEWELL, MEIJER_STORES, MADE_UP_WD].map((t) => intelJson(db, t)))).toEqual(firstReplies);
    expect(first[0].split("workday_site_is_own_employer(").length - 1, "no double wrap").toBe(1);
  });
});

describe("(e) the self-check and the rewrite refuse what they must", () => {
  it("the self-check block was found in the file", () => {
    expect(VERIFY).toMatch(/^DO \$verify\$/);
    expect(VERIFY.length).toBeGreaterThan(500);
  });

  it("passes on the fixed database", async () => {
    await expect(after.exec(VERIFY)).resolves.toBeDefined();
  });

  it("refuses the per-row shape main carries (the database without the fix)", async () => {
    await expect(before.exec(VERIFY)).rejects.toThrow(/self-check 20261012137000: public\.get_company_intel\(text\) calls the hosting-tenant helper 2 time/);
  });

  it("refuses a reader that gained a per-row call beside the CTE", async () => {
    const db = await boot({ fix: true });
    const def = (await db.query<{ d: string }>("SELECT pg_get_functiondef('public.get_similar_companies(text,integer)'::regprocedure) AS d")).rows[0].d;
    await db.exec(def.replace("NOT (SELECT own_site.own FROM own_site)", "NOT public.workday_site_is_own_employer(p_token)"));
    await expect(db.exec(VERIFY)).rejects.toThrow(/public\.get_similar_companies\(text,integer\) calls the hosting-tenant helper 2 time/);
  });

  it("refuses drifted grants: PUBLIC holding EXECUTE, or anon losing it", async () => {
    const db = await boot({ fix: true });
    await db.exec("GRANT EXECUTE ON FUNCTION public.get_company_intel(text) TO PUBLIC");
    await expect(db.exec(VERIFY)).rejects.toThrow(/PUBLIC holds a privilege on public\.get_company_intel/);
    await db.exec("REVOKE EXECUTE ON FUNCTION public.get_company_intel(text) FROM PUBLIC");
    await expect(db.exec(VERIFY)).resolves.toBeDefined();
    await db.exec("REVOKE EXECUTE ON FUNCTION public.get_similar_companies(text, integer) FROM anon");
    await expect(db.exec(VERIFY)).rejects.toThrow(/get_similar_companies\(text,integer\) lost a grant/);
    await db.exec("GRANT EXECUTE ON FUNCTION public.get_similar_companies(text, integer) TO anon");
    await db.exec("GRANT EXECUTE ON FUNCTION public.workday_site_is_own_employer(text) TO anon");
    await expect(db.exec(VERIFY)).rejects.toThrow(/workday_site_is_own_employer is not service-role only/);
  });

  it("the rewrite refuses a live body it does not know rather than overwrite it", async () => {
    const db = await boot();
    // 20261012101000 re-run puts back its own body, which has no hosting-tenant test.
    await db.exec(mig("20261012101000_"));
    await expect(db.exec(FIX)).rejects.toThrow(/get_company_intel\(text\): expected the 20261012135000 body .* it drifted/);
  });
});
