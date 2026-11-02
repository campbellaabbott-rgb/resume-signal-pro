// @vitest-environment node
/**
 * A PERK IS SHOWN ONLY FROM THE EXTRACTOR OUTPUT ITS AUDIT JUDGED (S13-121).
 *
 * 20261012110000 published a perk key on a 60-row audit and kept no record of
 * which extractor's output those rows were; and its record took any counts it
 * was handed. Reproduced in pglite against that file alone (2026-11-01): a key
 * launched on v2 rows went on serving the rows the rollup rebuilt from v3
 * output, and a re-audit with no draw behind it restarted the 45 days.
 *
 * 20261102164000, executed here in a real Postgres under Supabase's default
 * grants (ALL on new tables, EXECUTE on new functions, for anon and
 * authenticated), after 20261012110000, and then again (it re-runs):
 *   - a claim row carries the extractor version all of its n postings were
 *     read by, and none when they were read by more than one;
 *   - a draw names a version, draws only rows of it, and is recorded with its
 *     id and time; a judgement names its draw, which must be of that key, at
 *     most 14 days old, unrecorded, of the version the sweep reads with now,
 *     and hold the rows judged; the audit is dated from the draw;
 *   - the reader shows a key's rows only of the version its audit judged, so a
 *     bump takes the rebuilt rows off every page until a launch audit of them;
 *     a re-audit of another version unpublishes, never extends;
 *   - the draws table and both audit functions are closed to anon and
 *     authenticated, the old signatures are gone, and the self-check RAISEs
 *     when one is opened;
 *   - the rollup, the status and the reader are restated from 20261012110000
 *     with only the version edits, so the copy carries every other rule;
 *   - a key the old rule shows when it applies is carried on the one version
 *     the stored postings hold, read before the key's audit, or it RAISEs and
 *     the key serves as before: never switched off.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith(prefix))!), "utf8");
const ENGINE = file("20261012110000_");
const MINE = file("20261102164000_");

const SUPABASE_DEFAULTS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;
const BOARD = `
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text NOT NULL, company_token text NOT NULL, company text NOT NULL DEFAULT '',
    title text NOT NULL, description text, country text, agency boolean NOT NULL DEFAULT false,
    apply_url text NOT NULL DEFAULT '', missing_since timestamptz, effective_posted timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_company_snapshots (
    company_token text NOT NULL, snapshot_date date NOT NULL, company text NOT NULL DEFAULT '',
    open_roles integer NOT NULL DEFAULT 0, open_roles_served integer, PRIMARY KEY (company_token, snapshot_date));
`;
// 61 boards of 5 English US postings, each stating health (bit 0) on one quoted line, read by extractor v2.
const SEED = `
  INSERT INTO public.employer_perk_lines (line_hash, line) VALUES ('00000000000000aa', 'Comprehensive medical insurance for you and your family');
  INSERT INTO public.job_board_postings (id, source, company_token, company, title, country, apply_url)
    SELECT 'greenhouse:b' || lpad(b::text, 3, '0') || ':' || i, 'greenhouse', 'b' || lpad(b::text, 3, '0'), 'Board ' || b, 'Engineer', 'US',
           'https://jobs.example.com/b' || b || '/' || i
      FROM generate_series(1, 61) b, generate_series(1, 5) i;
  INSERT INTO public.employer_perk_postings (posting_id, source, company_token, country, readable, english, perks_y, quote_line_hash, extractor_version)
    SELECT id, source, company_token, 'US', true, true, 1, ARRAY['00000000000000aa'], 2 FROM public.job_board_postings;
`;

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

async function boot(): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SUPABASE_DEFAULTS + BOARD);
  await db.exec(ENGINE);
  await db.exec(MINE);
  await db.exec(MINE);
  await db.exec(SEED);
  return db;
}

type Json = Record<string, unknown>;
const one = async <T = Json>(db: PGlite, sql: string, args: unknown[] = []): Promise<T> => (await db.query<{ r: T }>(sql, args)).rows[0].r;
/** A fresh lap of the nightly rollup. */
const tick = async (db: PGlite) => {
  await db.exec("UPDATE public.employer_perk_rollup_state SET lap_cursor = NULL, lap_finished_at = NULL");
  return one(db, "SELECT public.employer_perk_rollup_tick(90000) AS r");
};
const draw = (db: PGlite, perk: string, version: number, rows = 60) =>
  one<{ drawn: number; draw_id: number; drawn_at: string; extractor_version: number; rows: Json[] }>(
    db, "SELECT public.employer_perk_audit_draw($1, $2::smallint, $3) AS r", [perk, version, rows]);
const record = (db: PGlite, perk: string, mode: string, judged: number, correct: number, drawId: number | null, version: number | null) =>
  one<{ published: boolean; last_audited_at: string; audited_version: number | null; audit_draw_id: number | null }>(
    db, "SELECT public.employer_perk_audit_record($1, $2, $3, $4, $5, $6::smallint, 'test') AS r", [perk, mode, judged, correct, drawId, version]);
const perksOf = (db: PGlite, token: string) => one<{ published_keys: string[]; perks: Json[] }>(db, "SELECT public.get_employer_perks($1) AS r", [token]);
const versions = async (db: PGlite) =>
  (await db.query<{ company_token: string; extractor_version: number | null }>(
    "SELECT company_token, extractor_version FROM public.employer_perk_rollups WHERE perk = 'health' ORDER BY company_token")).rows;

/**
 * A key live under 20261012110000 the moment this migration applies (none was
 * on 2026-11-01: the reader answered published_keys []) must not be switched
 * off by it: the owner rule is no pause without a current yes. It is carried
 * on the one version the postings hold, when that version was already in use
 * before the key's audit; otherwise the migration refuses and the key goes on
 * serving under the old rule until the owner records which output it judged.
 */
async function bootLive(o: { extractedDaysAgo?: number; mixed?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SUPABASE_DEFAULTS + BOARD);
  await db.exec(ENGINE);
  await db.exec(SEED);
  await db.exec(`UPDATE public.employer_perk_postings SET extracted_at = now() - interval '${o.extractedDaysAgo ?? 20} days'`);
  if (o.mixed) await db.exec("UPDATE public.employer_perk_postings SET extractor_version = 3 WHERE posting_id = 'greenhouse:b061:1'");
  await db.exec("UPDATE public.employer_perk_rollup_state SET lap_cursor = NULL, lap_finished_at = NULL");
  await db.query("SELECT public.employer_perk_rollup_tick(90000)");
  await db.exec(`UPDATE public.employer_profile_config SET publish_paused = false;
    UPDATE public.employer_profile_perk_publish SET published = true, last_audited_at = now() - interval '10 days',
           audit_mode = 'launch', audit_judged = 60, audit_correct = 60 WHERE perk = 'health'`);
  return db;
}

describe("a key live under the old rule when this applies is carried or refused, never switched off", () => {
  it("one version, in use before the audit: the key is carried on it and every page that showed it still does, on a re-run too", async () => {
    const db = await bootLive();
    expect((await perksOf(db, "b001")).published_keys, "the old reader shows the key before the migration").toEqual(["health"]);
    await db.exec(MINE);
    const row = (await db.query<Json>("SELECT audited_version, audit_draw_id, audit_drawn_at = last_audited_at AS dated FROM public.employer_profile_perk_publish WHERE perk = 'health'")).rows[0];
    expect(row).toEqual({ audited_version: 2, audit_draw_id: null, dated: true });
    for (const t of ["b001", "b061"]) {
      const r = await perksOf(db, t);
      expect(r.published_keys, t).toEqual(["health"]);
      expect(r.perks.length, `${t}: the carried key's rows went off the page`).toBeGreaterThan(0);
    }
    await db.exec(MINE);
    expect((await perksOf(db, "b001")).perks.length).toBeGreaterThan(0);
    await tick(db);
    expect((await perksOf(db, "b001")).perks.length, "the next lap restates the rows and the key still shows").toBeGreaterThan(0);
  });

  it("postings read by two versions: no version to carry on, so the migration refuses and the key serves as before", async () => {
    const db = await bootLive({ mixed: true });
    await expect(db.exec(MINE)).rejects.toThrow(/live under 20261012110000[\s\S]*no single extractor version/);
    expect((await perksOf(db, "b001")).published_keys).toEqual(["health"]);
  });

  it("a version first read after the audit is not the one the audit judged: refused, never carried", async () => {
    const db = await bootLive({ extractedDaysAgo: 1 });
    await expect(db.exec(MINE)).rejects.toThrow(/live under 20261012110000[\s\S]*first read after/);
    expect((await perksOf(db, "b001")).published_keys).toEqual(["health"]);
  });

  it("a key the old rule did not show (paused, expired or unpublished) is left for a launch audit", async () => {
    for (const set of ["UPDATE public.employer_profile_config SET publish_paused = true",
                       "UPDATE public.employer_profile_perk_publish SET last_audited_at = now() - interval '50 days' WHERE perk = 'health'",
                       "UPDATE public.employer_profile_perk_publish SET published = false WHERE perk = 'health'"]) {
      const db = await bootLive({ mixed: true });
      await db.exec(set);
      await db.exec(MINE);
      expect((await db.query<Json>("SELECT audited_version FROM public.employer_profile_perk_publish WHERE perk = 'health'")).rows[0], set).toEqual({ audited_version: null });
    }
  });
});

describe("a claim row says which extractor read it", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot(); await tick(db); });

  it("every row of a board read by one version carries it", async () => {
    const v = await versions(db);
    expect(v).toHaveLength(61);
    expect(v.every((r) => r.extractor_version === 2)).toBe(true);
  });

  it("a board read by two versions (a lap that met a bump) carries none", async () => {
    await db.exec("UPDATE public.employer_perk_postings SET extractor_version = 3 WHERE posting_id = 'greenhouse:b061:1'");
    await tick(db);
    const v = await versions(db);
    expect(v.find((r) => r.company_token === "b061")!.extractor_version).toBeNull();
    expect(v.filter((r) => r.extractor_version === 2)).toHaveLength(60);
  });
});

describe("an audit is of one recent draw of one version", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot(); await tick(db); });

  it("a draw names its version, takes only rows of it, and is recorded", async () => {
    const d = await draw(db, "health", 2);
    expect(d).toMatchObject({ drawn: 60, extractor_version: 2 });
    expect(d.draw_id).toBeGreaterThan(0);
    expect((await draw(db, "health", 3)).drawn).toBe(0);
    const stored = (await db.query<Json>("SELECT perk, extractor_version, drawn_rows, recorded_at FROM public.employer_perk_audit_draws WHERE id = $1", [d.draw_id])).rows[0];
    expect(stored).toEqual({ perk: "health", extractor_version: 2, drawn_rows: 60, recorded_at: null });
    await expect(db.query("SELECT public.employer_perk_audit_draw('health', NULL::smallint, 60)")).rejects.toThrow(/names the extractor version/);
  });

  it("a judgement with no draw, another key's draw, too many rows, another version or an old draw is refused", async () => {
    const d = await draw(db, "health", 2);
    const dental = await draw(db, "dental", 2);
    await expect(record(db, "health", "launch", 60, 60, null, 2)).rejects.toThrow(/names the draw it judged/);
    await expect(record(db, "health", "reaudit", 5, 5, 999_999, 2)).rejects.toThrow(/names the draw it judged/);
    await expect(record(db, "health", "launch", 60, 60, dental.draw_id, 2)).rejects.toThrow(/is of dental, not health/);
    await expect(record(db, "health", "launch", 61, 61, d.draw_id, 2)).rejects.toThrow(/holds 60 rows, not 61 judged/);
    await expect(record(db, "health", "launch", 60, 60, d.draw_id, 3)).rejects.toThrow(/judged extractor v2, and the sweep reads with v3/);
    await db.query("UPDATE public.employer_perk_audit_draws SET drawn_at = now() - interval '15 days' WHERE id = $1", [d.draw_id]);
    await expect(record(db, "health", "launch", 60, 60, d.draw_id, 2)).rejects.toThrow(/more than 14 days ago/);
    const pp = (await db.query<Json>("SELECT published, last_audited_at FROM public.employer_profile_perk_publish WHERE perk = 'health'")).rows[0];
    expect(pp).toEqual({ published: false, last_audited_at: null });
  });

  it("a launch publishes on the draw's version, dated from the draw, and the same draw cannot be recorded twice", async () => {
    const d = await draw(db, "health", 2);
    await db.query("UPDATE public.employer_perk_audit_draws SET drawn_at = now() - interval '3 days' WHERE id = $1", [d.draw_id]);
    const r = await record(db, "health", "launch", 60, 58, d.draw_id, 2);
    expect(r).toMatchObject({ published: true, audited_version: 2, audit_draw_id: d.draw_id });
    const drawnAt = (await db.query<{ drawn_at: Date }>("SELECT drawn_at FROM public.employer_perk_audit_draws WHERE id = $1", [d.draw_id])).rows[0].drawn_at;
    expect(Date.parse(r.last_audited_at)).toBe(drawnAt.getTime());
    await expect(record(db, "health", "reaudit", 5, 5, d.draw_id, 2)).rejects.toThrow(/was recorded at/);
    expect((await perksOf(db, "b001")).perks).toHaveLength(1);
  });

  it("withdraw needs no draw", async () => {
    expect(await record(db, "dental", "withdraw", 0, 0, null, null)).toMatchObject({ published: false });
  });
});

describe("a bump takes the rebuilt rows off every page until they are audited", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await boot();
    await tick(db);
    const d = await draw(db, "health", 2);
    await record(db, "health", "launch", 60, 60, d.draw_id, 2);
  });

  it("before the bump the audited rows show", async () => {
    expect(await perksOf(db, "b001")).toMatchObject({ published_keys: ["health"], perks: [expect.objectContaining({ perk: "health" })] });
  });

  it("rows rebuilt from v3 output never show under a v2 audit; rows still of v2 do; a mixed board does not", async () => {
    await db.exec("UPDATE public.employer_perk_postings SET extractor_version = 3 WHERE company_token <= 'b030'");
    await db.exec("UPDATE public.employer_perk_postings SET extractor_version = 3 WHERE posting_id = 'greenhouse:b040:2'");
    await tick(db);
    expect((await perksOf(db, "b001")).perks).toEqual([]);
    expect((await perksOf(db, "b031")).perks).toHaveLength(1);
    expect((await perksOf(db, "b040")).perks).toEqual([]);
    const k = (await one<{ keys: Json[]; rollup_versions: Json }>(db, "SELECT public.employer_perk_audit_status() AS r"));
    expect(k.keys.find((x) => x.perk === "health")).toMatchObject({ audited_version: 2, rows: 61, rows_audited_version: 30 });
    expect(k.rollup_versions).toEqual({ 2: 30, 3: 30, mixed: 1 });
  });

  it("a re-audit of v3 rows cannot extend a key published on v2: it unpublishes, and a launch of v3 brings it back", async () => {
    const d3 = await draw(db, "health", 3, 10);
    expect(d3.drawn).toBe(10);
    expect(await record(db, "health", "reaudit", 10, 10, d3.draw_id, 3)).toMatchObject({ published: false, audited_version: 2 });
    expect((await perksOf(db, "b031")).published_keys).toEqual([]);
    await db.exec("UPDATE public.employer_perk_postings SET extractor_version = 3");
    await tick(db);
    const l3 = await draw(db, "health", 3);
    expect(await record(db, "health", "launch", 60, 60, l3.draw_id, 3)).toMatchObject({ published: true, audited_version: 3 });
    expect((await perksOf(db, "b001")).perks).toHaveLength(1);
  });

  it("a re-audit of the version a key was published on keeps it", async () => {
    const d = await draw(db, "health", 3, 5);
    expect(await record(db, "health", "reaudit", 5, 4, d.draw_id, 3)).toMatchObject({ published: true, audited_version: 3, audit_draw_id: d.draw_id });
  });
});

describe("the grants, the old signatures and the self-check", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot(); });

  it("the draws table and both audit functions refuse anon and authenticated; the reader answers them", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(db.query("SELECT * FROM public.employer_perk_audit_draws")).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.employer_perk_audit_draw('health', 2::smallint, 5)")).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.employer_perk_audit_record('health', 'launch', 60, 60, 1, 2::smallint, 'x')")).rejects.toThrow(/permission denied/);
        expect(await perksOf(db, "b001")).toMatchObject({ published_keys: [] });
      } finally {
        await db.exec("RESET ROLE");
      }
    }
  });

  it("the unversioned draw and record are gone", async () => {
    const left = (await db.query<{ sig: string }>(
      "SELECT p.oid::regprocedure::text AS sig FROM pg_proc p WHERE p.proname IN ('employer_perk_audit_draw', 'employer_perk_audit_record') ORDER BY 1")).rows.map((r) => r.sig);
    expect(left).toEqual([
      "employer_perk_audit_draw(text,smallint,integer)",
      "employer_perk_audit_record(text,text,integer,integer,bigint,smallint,text)",
    ]);
  });

  it("the self-check RAISEs when a client role is handed the draw", async () => {
    const check = /DO \$check\$[\s\S]*?\$check\$;/.exec(MINE)![0];
    await db.exec(check);
    await db.exec("GRANT EXECUTE ON FUNCTION public.employer_perk_audit_draw(text, smallint, integer) TO anon");
    await expect(db.exec(check)).rejects.toThrow(/perk audit version self-check failed: .*employer_perk_audit_draw.* is not service-role only/);
    await db.exec("REVOKE EXECUTE ON FUNCTION public.employer_perk_audit_draw(text, smallint, integer) FROM anon");
    await db.exec("GRANT SELECT ON public.employer_perk_audit_draws TO authenticated");
    await expect(db.exec(check)).rejects.toThrow(/authenticated holds SELECT on employer_perk_audit_draws/);
  });
});

describe("the rollup, the status and the reader are 20261012110000's, plus the version", () => {
  const fn = (src: string, name: string) => {
    const i = src.indexOf(`FUNCTION public.${name}(`);
    return src.slice(i, src.indexOf("\n$$;\n", i));
  };
  // The only edits 20261102164000 makes to each restated body.
  const EDITS: Record<string, Array<[string, string]>> = {
    employer_perk_rollup_tick: [
      ["e.quote_line_hash, e.extracted_at\n", "e.quote_line_hash, e.extracted_at,\n             e.extractor_version\n"],
      ["min(b.extracted_at) AS read_from\n", "min(b.extracted_at) AS read_from,\n             CASE WHEN min(b.extractor_version) = max(b.extractor_version) THEN min(b.extractor_version) END AS version\n"],
      ["quote_hash, quote_posting_id, as_of)\n", "quote_hash, quote_posting_id, as_of, extractor_version)\n"],
      ["m.qh, m.pid, g.read_from\n", "m.qh, m.pid, g.read_from, g.version\n"],
    ],
    get_employer_perks: [
      ["SELECT pp.perk\n", "SELECT pp.perk, pp.audited_version\n"],
      ["now() - interval '45 days'\n  ),", "now() - interval '45 days'\n       AND pp.audited_version IS NOT NULL\n  ),"],
      ["JOIN live ON live.perk = r.perk\n", "JOIN live ON live.perk = r.perk AND r.extractor_version = live.audited_version\n"],
    ],
  };
  for (const [name, edits] of Object.entries(EDITS)) {
    it(`${name} differs only by the version`, () => {
      let want = fn(ENGINE, name);
      for (const [a, b] of edits) {
        expect(want.split(a).length - 1, `${name}: "${a.trim()}" should occur once in 20261012110000`).toBe(1);
        want = want.replace(a, b);
      }
      expect(fn(MINE, name)).toBe(want);
    });
  }

  it("the status keeps every field it had", () => {
    const keysOf = (src: string) => [...fn(src, "employer_perk_audit_status").matchAll(/'([a-z_]+)',/g)].map((m) => m[1]);
    const before = keysOf(ENGINE);
    const after = keysOf(MINE);
    expect(before.filter((k) => !after.includes(k))).toEqual([]);
    expect(after).toEqual(expect.arrayContaining(["audited_version", "rows_audited_version", "rollup_versions"]));
  });
});
