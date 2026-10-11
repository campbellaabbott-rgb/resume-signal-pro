// @vitest-environment node
/**
 * A PERK IS SHOWN ONLY WHILE ITS AUDIT IS FRESH.
 *
 * 20261012110000 (the perk engine's tables, rollup and reader) and
 * 20261012111000 (the sweep and rollup crons) executed in a real Postgres
 * (pglite), under Supabase's default grants (ALL on every new table and
 * EXECUTE on every new function for anon and authenticated), with a stand-in
 * board, the shipped extractor reading the postings, and the shipped sweep
 * helpers (supabase/functions/employer-profiles/sweep.ts) encoding them. It
 * holds, each run, not read:
 *
 *   - every table is closed to anon and authenticated, every writer too, and
 *     only the reader answers them; the file re-runs without resetting a flag;
 *   - nothing shows before an audit: every key starts unpublished, a withheld
 *     key cannot be published (CHECK, and the audit refuses it), a launch
 *     audit needs 57 of 60, a re-audit with two wrong unpublishes, a flag
 *     audited 46 days ago reads as unpublished, the publish pause hides all;
 *   - the thresholds: n >= 5 readable postings per country, k >= 2, k/n >= 10%;
 *   - franchise and agency postings count in neither k nor n, and a board at
 *     30% franchise wording shows nothing but the reason;
 *   - a token two vendors share, and a vendor whose benefits text is not
 *     stored, show nothing but the reason; the statutory note rides UK rows,
 *     names where its statute applies with the Northern Ireland law beside
 *     it, and never rides a leave line that states more than the minimum;
 *   - only postings written in English are counted, and with no key live
 *     the reader answers no withheld reason and no collision flag;
 *   - a flag past its 45 days is expired in the status too, and a five-row
 *     re-audit cannot bring it back;
 *   - the rollup prunes postings that left the serving set, and the reader
 *     names a quoted posting only while it still serves;
 *   - the lease admits one holder at a time and frees itself on expiry;
 *   - the store refuses a malformed row without failing its batch;
 *   - the owner's draw returns quoted rows with a link and a 3-posting spot
 *     check, for candidate keys only;
 *   - the crons: both scheduled, each command opening with its own
 *     statement_timeout, the sweep carrying its vault key, the key generated
 *     once, and a database without pg_cron or the vault applies the file as
 *     a no-op.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { boardsOf, encodeBoard, type TakenRow } from "../../supabase/functions/employer-profiles/sweep";
import { EXTRACTOR_VERSION } from "../../supabase/functions/_shared/perks-extract";
import { sqlCodeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith(prefix))!), "utf8");
const ENGINE = file("20261012110000_");
const CRONS = file("20261012111000_");

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

// ── the postings ────────────────────────────────────────────────────────────
const ABOUT = "About us\nWe build software for logistics companies across the country, and we care about craft, kindness and shipping work that matters to the people who rely on it every single day.";
const ROLE = "Responsibilities\nWrite code, review designs and pair with the team on hard problems.\nRequirements\nFive years of experience with TypeScript and Postgres.";
const US_BENEFITS = "What we offer\nComprehensive medical, dental and vision insurance for you and your family\n401(k) retirement plan with a company match";
const UK_BENEFITS = "Benefits\n25 days annual leave plus bank holidays\nWorkplace pension with employer contributions";
const NO_VISA = "Please note this role is not eligible for visa sponsorship.";
// A German posting, read in full by the extractor's German headings and patterns.
const DE_TEXT = [
  "Über uns\nWir sind ein Softwarehaus in Berlin und entwickeln mit unseren Kunden seit vielen Jahren Lösungen für die Logistik, und wir freuen uns auf dich.",
  "Deine Aufgaben\nDu entwickelst neue Funktionen und arbeitest eng mit dem Team zusammen.",
  "Was wir dir bieten\nKrankenzusatzversicherung für dich\n30 Tage Urlaub im Jahr\nBetriebliche Altersvorsorge mit Arbeitgeberzuschuss",
].join("\n");
const DE_EN_30 = "What we offer\n30 days of paid annual leave every year\nPrivate health insurance for you";
const DE_EN_20 = "What we offer\n20 days of paid annual leave every year\nPrivate health insurance for you";
const UK_28 = "Benefits\n28 days holiday including bank holidays\nWorkplace pension with employer contributions";
const FRANCHISE = "This location is independently owned and operated by a franchisee, who sets its own pay and benefits.";

type P = { id: string; source?: string; token: string; country: string | null; text: string; agency?: boolean; company?: string };
const posts: P[] = [];
const add = (n: number, mk: (i: number) => Omit<P, "id">) => { for (let i = 0; i < n; i++) { const p = mk(i); posts.push({ id: `${p.source ?? "greenhouse"}:${p.token}:${posts.length}`, ...p }); } };
const body = (...parts: string[]) => [ABOUT, ROLE, ...parts].join("\n");

add(6, () => ({ token: "acme", country: "US", text: body(US_BENEFITS), company: "Acme" }));
add(5, (i) => ({ token: "acme", country: "GB", text: i < 2 ? body(UK_BENEFITS) : body(), company: "Acme" }));
add(1, () => ({ token: "acme", country: "US", text: "Too short to read.", company: "Acme" }));
add(4, () => ({ token: "tiny", country: "US", text: body(US_BENEFITS) }));
add(21, (i) => ({ token: "rare", country: "US", text: i < 2 ? body(US_BENEFITS) : body() }));
add(20, (i) => ({ token: "tenth", country: "US", text: i < 2 ? body(US_BENEFITS) : body() }));
add(6, (i) => ({ token: "franch", country: "US", text: i < 2 ? body(US_BENEFITS, FRANCHISE) : body(US_BENEFITS) }));
add(10, (i) => ({ token: "mostly", country: "US", text: i < 1 ? body(US_BENEFITS, FRANCHISE) : body(US_BENEFITS) }));
add(6, () => ({ token: "staffco", country: "US", text: body(US_BENEFITS), agency: true }));
add(6, () => ({ token: "shared", country: "US", text: body(US_BENEFITS) }));
add(6, () => ({ token: "shared", source: "lever", country: "US", text: body(US_BENEFITS) }));
add(6, () => ({ token: "leverco", source: "lever", country: "US", text: body(US_BENEFITS) }));
add(6, (i) => ({ token: "visaco", country: "US", text: i < 3 ? body(NO_VISA) : body() }));
add(6, () => ({ token: "nowhere", country: null, text: body(US_BENEFITS) }));
add(3, () => ({ token: "fed", source: "usajobs", country: "US", text: body(US_BENEFITS) }));
add(6, () => ({ token: "dewerk", country: "DE", text: DE_TEXT }));
add(6, () => ({ token: "de30", country: "DE", text: body(DE_EN_30) }));
add(6, () => ({ token: "de20", country: "DE", text: body(DE_EN_20) }));
add(5, () => ({ token: "ukmin", country: "GB", text: body(UK_28) }));

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

async function boot(withBoard = true): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SUPABASE_DEFAULTS + (withBoard ? BOARD : ""));
  if (withBoard) {
    for (const p of posts) {
      await db.query(
        "INSERT INTO public.job_board_postings (id, source, company_token, company, title, description, country, agency, apply_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [p.id, p.source ?? "greenhouse", p.token, p.company ?? p.token, `Engineer ${p.id}`, p.text, p.country, p.agency ?? false, `https://jobs.example.com/${encodeURIComponent(p.id)}`],
      );
    }
    await db.exec(`INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, company, open_roles, open_roles_served)
                   SELECT company_token, current_date, max(company), count(*), count(*) FROM public.job_board_postings GROUP BY company_token`);
  }
  return db;
}

/** The sweep's loop, against the real take and store: what the function does each minute. */
async function sweepAll(db: PGlite): Promise<{ calls: number; stored: number; refused: number }> {
  let calls = 0, stored = 0, refused = 0;
  for (; calls < 50; calls++) {
    const asked = 40;
    const { rows } = await db.query<TakenRow>("SELECT * FROM public.employer_perk_sweep_take($1, $2::smallint, 3000)", [asked, EXTRACTOR_VERSION]);
    if (!rows.length) break;
    for (const b of boardsOf(rows, asked)) {
      const enc = await encodeBoard(b);
      const r = await db.query<{ r: { stored: number; refused: number } }>(
        "SELECT public.employer_perk_store($1, $2::jsonb, $3::jsonb, $4, $5, $6::smallint) AS r",
        [b.token, JSON.stringify(enc.rows), JSON.stringify(enc.lines), b.rows[b.rows.length - 1].posting_id, b.done, EXTRACTOR_VERSION],
      );
      stored += r.rows[0].r.stored;
      refused += r.rows[0].r.refused;
    }
  }
  return { calls, stored, refused };
}

type Perks = {
  token: string; collision: boolean; expiry_days: number; published_keys: string[];
  perks: Array<{ source: string; country: string; perk: string; k: number; n: number; quote: string; quote_posting_id: string | null; qualified_share: number; standard_text: boolean; baseline: null | { statute: string; note: string; source_url: string } }>;
  withheld: Array<{ source: string; reason: string; share: number | null }>;
};
const perksAs = async (db: PGlite, token: string, role = "anon"): Promise<Perks> => {
  await db.exec(`SET ROLE ${role}`);
  try {
    return (await db.query<{ r: Perks }>("SELECT public.get_employer_perks($1) AS r", [token])).rows[0].r;
  } finally {
    await db.exec("RESET ROLE");
  }
};
const rollups = async (db: PGlite, token: string) =>
  (await db.query<{ source: string; country: string; perk: string; k: number; n: number }>(
    "SELECT source, country, perk, k, n FROM public.employer_perk_rollups WHERE company_token = $1 ORDER BY source, country, perk", [token])).rows;
const record = (db: PGlite, perk: string, mode: string, judged: number, correct: number) =>
  db.query<{ r: { published: boolean; last_audited_at: string | null } }>("SELECT public.employer_perk_audit_record($1, $2, $3, $4, 'test') AS r", [perk, mode, judged, correct]);
const rollupFresh = async (db: PGlite) => {
  await db.exec("UPDATE public.employer_perk_rollup_state SET lap_finished_at = now() - interval '2 days', lap_cursor = NULL");
  return (await db.query<{ r: { state: string } }>("SELECT public.employer_perk_rollup_tick(90000) AS r")).rows[0].r;
};

describe("20261012110000 under Supabase's default grants", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await boot();
    await db.exec(ENGINE);
    await sweepAll(db);
    const tick = (await db.query<{ r: { state: string } }>("SELECT public.employer_perk_rollup_tick(90000) AS r")).rows[0].r;
    expect(tick.state).toBe("lap_finished");
  });

  it("closes every table to anon and authenticated, and every writer; only the reader answers them", async () => {
    const tables = ["employer_perk_postings", "employer_perk_lines", "employer_perk_rollups", "employer_perk_board_flags",
      "employer_profile_perk_publish", "perk_legal_baselines", "employer_profile_runs", "employer_profile_config",
      "employer_profile_leases", "employer_perk_sweep_boards", "employer_perk_rollup_state"];
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        for (const t of tables) await expect(db.query(`SELECT 1 FROM public.${t} LIMIT 1`), `${role} read ${t}`).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.employer_perk_store('acme', '[]'::jsonb, '[]'::jsonb, NULL, true, 1::smallint)")).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.employer_perk_audit_record('health', 'launch', 60, 60)")).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.employer_profile_set_pause(false, false)")).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT * FROM public.employer_perk_sweep_take(10, 1::smallint, 500)")).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.employer_perk_audit_draw('health', 5)")).rejects.toThrow(/permission denied/);
        await expect(db.query("SELECT public.employer_profile_lease_take('sweep', 'stranger-0001', 90)")).rejects.toThrow(/permission denied/);
        expect((await db.query<{ r: Perks }>("SELECT public.get_employer_perks('acme') AS r")).rows[0].r.token).toBe("acme");
      } finally {
        await db.exec("RESET ROLE");
      }
    }
    const svc = await db.query<{ ok: boolean }>("SELECT has_function_privilege('service_role', 'public.employer_perk_store(text,jsonb,jsonb,text,boolean,smallint)', 'EXECUTE') AS ok");
    expect(svc.rows[0].ok).toBe(true);
  });

  it("read every serving posting once, USAJOBS aside, and knew which it could not read", async () => {
    const { rows } = await db.query<{ n: number; unread: number; fr: number; ag: number }>(
      "SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT readable)::int AS unread, count(*) FILTER (WHERE franchise)::int AS fr, count(*) FILTER (WHERE agency)::int AS ag FROM public.employer_perk_postings");
    expect(rows[0]).toEqual({ n: posts.length - 3, unread: 1, fr: 3, ag: 6 });
    const again = await sweepAll(db);
    expect(again.stored, "a second sweep re-reads nothing").toBe(0);
  });

  it("starts with every key unpublished, so the reader shows nothing", async () => {
    const pub = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.employer_profile_perk_publish WHERE published");
    expect(pub.rows[0].n).toBe(0);
    expect((await perksAs(db, "acme")).perks).toEqual([]);
    expect((await rollups(db, "acme")).length, "the rows exist; only the publish flag holds them back").toBeGreaterThan(0);
  });

  it("a withheld key can never publish: the CHECK refuses the flag and the audit refuses the key", async () => {
    await expect(db.query("UPDATE public.employer_profile_perk_publish SET published = true, last_audited_at = now() WHERE perk = 'flex'"))
      .rejects.toThrow(/employer_profile_perk_publish_only_candidates/);
    await expect(db.query("UPDATE public.employer_profile_perk_publish SET published = true WHERE perk = 'health'"))
      .rejects.toThrow(/employer_profile_perk_publish_audited/);
    for (const w of ["flex", "mental", "childcare", "discount", "commute", "meals", "bonus", "learning", "generic", "visa", "wellness"]) {
      await expect(record(db, w, "launch", 60, 60), w).rejects.toThrow(/can never publish/);
    }
    await expect(db.query("SELECT public.employer_perk_audit_draw('flex', 5)")).rejects.toThrow(/not a candidate key/);
  });

  it("a launch audit publishes at 57 of 60, refuses fewer than 60 rows, and 56 of 60 unpublishes", async () => {
    await expect(record(db, "health", "launch", 59, 59)).rejects.toThrow(/at least 60/);
    expect((await record(db, "health", "launch", 60, 57)).rows[0].r.published).toBe(true);
    const acme = await perksAs(db, "acme");
    const health = acme.perks.filter((p) => p.perk === "health");
    expect(health.map((p) => [p.source, p.country, p.k, p.n])).toEqual([["greenhouse", "US", 6, 6]]);
    expect(health[0].quote).toMatch(/medical, dental and vision insurance/);
    expect(health[0].quote_posting_id).toMatch(/^greenhouse:acme:/);
    expect(health[0].standard_text).toBe(true);
    expect(health[0].baseline).toBeNull();
    expect(acme.collision).toBe(false);
    expect(acme.expiry_days).toBe(45);
    expect((await record(db, "health", "launch", 60, 56)).rows[0].r.published).toBe(false);
    expect((await perksAs(db, "acme")).perks).toEqual([]);
  });

  it("a re-audit restarts the 45 days on one wrong, unpublishes on two, and never publishes a key on its own", async () => {
    await record(db, "health", "launch", 60, 60);
    await db.exec("UPDATE public.employer_profile_perk_publish SET last_audited_at = now() - interval '40 days' WHERE perk = 'health'");
    const one = (await record(db, "health", "reaudit", 6, 5)).rows[0].r;
    expect(one.published).toBe(true);
    expect(Date.now() - Date.parse(one.last_audited_at!)).toBeLessThan(60_000);
    expect((await record(db, "health", "reaudit", 6, 4)).rows[0].r.published).toBe(false);
    expect((await record(db, "dental", "reaudit", 6, 6)).rows[0].r.published, "a re-audit never publishes").toBe(false);
    await expect(record(db, "dental", "reaudit", 4, 4)).rejects.toThrow(/at least 5/);
  });

  it("a flag audited 46 days ago reads as unpublished; 44 days still shows; the publish pause hides everything", async () => {
    await record(db, "health", "launch", 60, 60);
    await db.exec("UPDATE public.employer_profile_perk_publish SET last_audited_at = now() - interval '46 days' WHERE perk = 'health'");
    expect((await perksAs(db, "acme")).perks).toEqual([]);
    await db.exec("UPDATE public.employer_profile_perk_publish SET last_audited_at = now() - interval '44 days' WHERE perk = 'health'");
    expect((await perksAs(db, "acme")).perks.map((p) => p.perk)).toEqual(["health"]);
    await db.query("SELECT public.employer_profile_set_pause(NULL, true, 'pooled re-audit 55 of 60')");
    expect((await perksAs(db, "acme")).perks).toEqual([]);
    await db.query("SELECT public.employer_profile_set_pause(NULL, false, NULL)");
    expect((await perksAs(db, "acme", "authenticated")).perks.map((p) => p.perk)).toEqual(["health"]);
  });

  it("the thresholds: 4 readable postings is no group, 2 of 21 is under 10%, 2 of 20 is a row", async () => {
    expect(await rollups(db, "tiny")).toEqual([]);
    expect((await rollups(db, "rare")).filter((r) => r.perk === "health")).toEqual([]);
    expect((await rollups(db, "tenth")).filter((r) => r.perk === "health")).toEqual([{ source: "greenhouse", country: "US", perk: "health", k: 2, n: 20 }]);
    // A posting too short to read counts in neither k nor n: acme US is 6 of 6, not 6 of 7.
    expect((await rollups(db, "acme")).find((r) => r.country === "US" && r.perk === "health")).toMatchObject({ k: 6, n: 6 });
    // No country, no claim: a perk row always names the country it describes.
    expect(await rollups(db, "nowhere")).toEqual([]);
    await expect(db.query("INSERT INTO public.employer_perk_rollups (source, company_token, country, perk, k, n) VALUES ('greenhouse', 'x', 'US', 'health', 1, 5)"))
      .rejects.toThrow(/employer_perk_rollups_thresholds/);
  });

  it("franchise postings count in neither k nor n, and a board at 30% franchise wording shows only the reason", async () => {
    expect(await rollups(db, "franch")).toEqual([]);
    const fr = await perksAs(db, "franch");
    expect(fr.perks).toEqual([]);
    expect(fr.withheld).toEqual([{ source: "greenhouse", reason: "franchise", share: 0.333 }]);
    expect((await rollups(db, "mostly")).find((r) => r.perk === "health")).toMatchObject({ k: 9, n: 9 });
    expect((await perksAs(db, "mostly")).withheld).toEqual([]);
  });

  it("an agency board's perks are the agency's: no rows, the reason printed", async () => {
    expect(await rollups(db, "staffco")).toEqual([]);
    expect((await perksAs(db, "staffco")).withheld).toEqual([{ source: "greenhouse", reason: "agency", share: 1 }]);
  });

  it("a token two vendors share shows nothing, and a vendor whose benefits text is dropped shows only why", async () => {
    const shared = await perksAs(db, "shared");
    expect(shared.collision).toBe(true);
    expect(shared.perks).toEqual([]);
    expect((await rollups(db, "leverco")).some((r) => r.perk === "health"), "counted, so lifting the suppression is instant").toBe(true);
    const lever = await perksAs(db, "leverco");
    expect(lever.perks).toEqual([]);
    expect(lever.withheld).toEqual([{ source: "lever", reason: "vendor_text_not_stored", share: null }]);
    expect(await rollups(db, "fed"), "USAJOBS stores no description and is never read").toEqual([]);
  });

  it("the stated visa limit publishes like a perk; a UK pension carries its statutory note, a leave line above the minimum none", async () => {
    expect((await record(db, "visa_not_offered", "launch", 60, 58)).rows[0].r.published).toBe(true);
    const v = (await perksAs(db, "visaco")).perks;
    expect(v.map((p) => [p.perk, p.k, p.n])).toEqual([["visa_not_offered", 3, 6]]);
    expect(v[0].quote).toMatch(/not eligible for visa sponsorship/);
    await record(db, "pto", "launch", 60, 60);
    await record(db, "retire", "launch", 60, 60);
    const gb = (await perksAs(db, "acme")).perks.filter((p) => p.country === "GB");
    expect(gb.map((p) => [p.perk, p.k, p.n])).toEqual([["pto", 2, 5], ["retire", 2, 5]]);
    const pension = gb.find((p) => p.perk === "retire")!;
    expect(pension.baseline?.note).toBe("This line may describe that minimum.");
    expect(pension.baseline?.source_url).toMatch(/^https:\/\/www\.legislation\.gov\.uk\//);
    // "25 days annual leave plus bank holidays" is more than 5.6 weeks: no note on it.
    expect(gb.find((p) => p.perk === "pto")!.baseline).toBeNull();
    const us = (await perksAs(db, "acme")).perks.find((p) => p.country === "US" && p.perk === "retire");
    expect(us?.baseline, "no US statute is cited").toBeNull();
  });

  it("names the quoted posting only while it serves, and the next rollup drops postings that left", async () => {
    const before = (await perksAs(db, "acme")).perks.find((p) => p.country === "US" && p.perk === "health")!;
    await db.query("UPDATE public.job_board_postings SET missing_since = now() WHERE id = $1", [before.quote_posting_id]);
    const after = (await perksAs(db, "acme")).perks.find((p) => p.country === "US" && p.perk === "health")!;
    expect(after.quote_posting_id).toBeNull();
    expect(after.quote).toBe(before.quote);
    expect((await rollupFresh(db)).state).toBe("lap_finished");
    const gone = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.employer_perk_postings WHERE posting_id = $1", [before.quote_posting_id]);
    expect(gone.rows[0].n).toBe(0);
    const now = (await perksAs(db, "acme")).perks.find((p) => p.country === "US" && p.perk === "health")!;
    expect([now.k, now.n]).toEqual([5, 5]);
    expect(now.quote_posting_id).not.toBeNull();
  });

  it("a lap that finished today waits for tomorrow", async () => {
    const r = (await db.query<{ r: { state: string } }>("SELECT public.employer_perk_rollup_tick(90000) AS r")).rows[0].r;
    expect(r.state).toBe("lap_done_today");
  });

  it("the owner's draw: quoted rows with a link, the employer and a spot check of at most 3, candidates only", async () => {
    const d = (await db.query<{ r: { perk: string; drawn: number; rows: Array<Record<string, unknown> & { spot_check: unknown[] }> } }>(
      "SELECT public.employer_perk_audit_draw('health', 60) AS r")).rows[0].r;
    // acme US, tenth, mostly, de30 and de20 (English postings in Germany). leverco is suppressed and "shared" is two
    // vendors: neither can publish, so neither is drawn. dewerk's German postings count for nothing.
    expect(d.drawn).toBe(5);
    expect(d.rows.map((r) => r.company_token)).not.toContain("dewerk");
    for (const row of d.rows) {
      expect(row.quote).toBeTruthy();
      expect(String(row.quote_link)).toMatch(/^https:\/\/jobs\.example\.com\//);
      expect(row.employer).toBeTruthy();
      expect(row.spot_check.length).toBeGreaterThan(0);
      expect(row.spot_check.length).toBeLessThanOrEqual(3);
      expect(row.source).not.toBe("lever");
      expect(row.company_token).not.toBe("shared");
    }
  });

  it("the store refuses a malformed row and keeps the rest of its batch", async () => {
    const good = { posting_id: "greenhouse:acme:extra", company_token: "acme", source: "greenhouse", country: "US", readable: true, franchise: false, agency: false, y: 1, q: 0, n: 0, quote_line_hash: [null], extractor_version: EXTRACTOR_VERSION };
    const bad = [
      { ...good, posting_id: "x1", company_token: "someone-else" },
      { ...good, posting_id: "x2", extractor_version: EXTRACTOR_VERSION + 7 },
      { ...good, posting_id: "x3", y: 1, q: 1 },
      { ...good, posting_id: "x4", y: "lots" },
      { ...good, posting_id: "x5", readable: false, y: 4 },
      { ...good, posting_id: "x6", readable: "yes" },
    ];
    const r = (await db.query<{ r: { stored: number; refused: number } }>(
      "SELECT public.employer_perk_store('acme', $1::jsonb, '[{\"h\":\"nothex\",\"line\":\"x\"}]'::jsonb, NULL, false, $2::smallint) AS r",
      [JSON.stringify([good, ...bad]), EXTRACTOR_VERSION])).rows[0].r;
    expect(r).toMatchObject({ stored: 1, refused: 6 });
    const lines = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.employer_perk_lines WHERE line = 'x'");
    expect(lines.rows[0].n).toBe(0);
  });

  it("re-runs without resetting a publish flag", async () => {
    await record(db, "dental", "launch", 60, 60);
    await db.exec(ENGINE);
    const r = await db.query<{ published: boolean }>("SELECT published FROM public.employer_profile_perk_publish WHERE perk = 'dental'");
    expect(r.rows[0].published).toBe(true);
    const n = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.employer_profile_perk_publish");
    expect(n.rows[0].n).toBe(23);
  });
});

describe("what the reader may say, and when", () => {
  let db: PGlite;
  type Baseline = { statute: string; source_url: string; applies_in: string | null; also: null | { statute: string; applies_in: string; source_url: string } };
  const baselineOf = async (token: string, country: string, perk: string) =>
    ((await perksAs(db, token)).perks.find((p) => p.country === country && p.perk === perk)?.baseline ?? null) as unknown as Baseline | null;
  const status = async () => (await db.query<{ r: { keys: Array<{ perk: string; published: boolean; flag: boolean; expired: boolean; live: boolean }> } }>(
    "SELECT public.employer_perk_audit_status() AS r")).rows[0].r.keys;

  beforeAll(async () => {
    db = await boot();
    await db.exec(ENGINE);
    await sweepAll(db);
    await db.query("SELECT public.employer_perk_rollup_tick(90000)");
  });

  it("before any key is live the reader answers nothing at all: no withheld reason, no collision flag", async () => {
    for (const t of ["franch", "staffco", "leverco", "shared", "acme"]) {
      const a = await perksAs(db, t);
      expect(a.perks, t).toEqual([]);
      expect(a.withheld, `${t}: an unaudited reason left the database`).toEqual([]);
      expect(a.collision, `${t}: an unaudited collision flag left the database`).toBe(false);
    }
  });

  it("a German posting is counted in neither k nor n, whatever key passes; an English posting in Germany is", async () => {
    for (const key of ["health", "pto", "retire"]) await record(db, key, "launch", 60, 60);
    expect((await perksAs(db, "dewerk")).perks, "German lines published under an English audit").toEqual([]);
    expect(await rollups(db, "dewerk")).toEqual([]);
    const rows = await db.query<{ english: boolean; n: number }>(
      "SELECT english, count(*)::int AS n FROM public.employer_perk_postings WHERE company_token = 'dewerk' GROUP BY english");
    expect(rows.rows).toEqual([{ english: false, n: 6 }]);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.employer_perk_postings WHERE company_token = 'acme' AND readable AND NOT english")).rows[0].n, "a readable English posting was marked foreign").toBe(0);
    expect((await rollups(db, "de30")).map((r) => [r.country, r.perk, r.k, r.n])).toContainEqual(["DE", "pto", 6, 6]);
    // Once a key is live, a withheld board's reason prints (the positive control for the first case).
    expect((await perksAs(db, "franch")).withheld).toEqual([{ source: "greenhouse", reason: "franchise", share: 0.333 }]);
    expect((await perksAs(db, "shared")).collision).toBe(true);
  });

  it("a leave line that states more than the statutory minimum carries no legal-minimum note; one at the minimum does", async () => {
    await record(db, "pto", "launch", 60, 60);
    expect((await perksAs(db, "de30")).perks.some((p) => p.country === "DE" && p.perk === "pto"), "the row is shown; only its note is judged").toBe(true);
    expect(await baselineOf("de30", "DE", "pto"), "30 days is not the German 20-day minimum").toBeNull();
    expect((await baselineOf("de20", "DE", "pto"))?.statute).toBe("Bundesurlaubsgesetz (BUrlG) § 3");
    const uk = await baselineOf("ukmin", "GB", "pto");
    expect(uk?.statute, "28 days including bank holidays is the UK minimum").toBe("Working Time Regulations 1998, regulations 13 and 13A");
    expect(await baselineOf("acme", "GB", "pto"), "25 days plus bank holidays is more than 28").toBeNull();
    const line = await db.query<{ pto_days: string; pto_plus_holidays: boolean }>(
      "SELECT l.pto_days, l.pto_plus_holidays FROM public.employer_perk_rollups r JOIN public.employer_perk_lines l ON l.line_hash = r.quote_hash WHERE r.company_token = 'acme' AND r.country = 'GB' AND r.perk = 'pto'");
    expect(line.rows[0]).toEqual({ pto_days: "25.0", pto_plus_holidays: true });
  });

  it("a GB statute says where it applies and cites the Northern Ireland law that sets the same minimum", async () => {
    for (const key of ["pto", "retire"]) await record(db, key, "launch", 60, 60);
    const leave = await baselineOf("ukmin", "GB", "pto");
    expect(leave?.applies_in).toBe("Great Britain");
    expect(leave?.also).toEqual({ statute: "Working Time Regulations (Northern Ireland) 2016, regulations 15 and 16", applies_in: "Northern Ireland",
      source_url: "https://www.legislation.gov.uk/nisr/2016/49/regulation/16" });
    const pension = await baselineOf("ukmin", "GB", "retire");
    expect(pension?.applies_in).toBe("England, Wales and Scotland");
    expect(pension?.also?.statute).toBe("Pensions (No. 2) Act (Northern Ireland) 2008, Part 1, Chapter 1 (automatic enrolment)");
    expect(pension?.also?.source_url).toBe("https://www.legislation.gov.uk/nia/2008/13/part/1/chapter/1");
    const de = await baselineOf("de20", "DE", "pto");
    expect(de?.applies_in ?? null).toBeNull();
    expect(de?.also ?? null).toBeNull();
  });

  it("a flag past its 45 days is expired everywhere: the status says so, and a five-row re-audit cannot revive it", async () => {
    await record(db, "dental", "launch", 60, 60);
    await db.exec("UPDATE public.employer_profile_perk_publish SET last_audited_at = now() - interval '120 days' WHERE perk = 'dental'");
    const before = (await status()).find((k) => k.perk === "dental")!;
    expect(before).toMatchObject({ published: false, flag: true, expired: true, live: false });
    const r = (await record(db, "dental", "reaudit", 5, 4)).rows[0].r;
    expect(r.published, "an expired key came back on a five-row re-audit").toBe(false);
    expect(Date.now() - Date.parse(r.last_audited_at!), "an expired key's clock was restarted").toBeGreaterThan(100 * 86_400_000);
    expect((await perksAs(db, "acme")).published_keys).not.toContain("dental");
    // Positive controls: a fresh key's re-audit restarts it, and a launch audit brings the expired one back.
    expect((await status()).find((k) => k.perk === "health")).toMatchObject({ published: true, flag: true, expired: false, live: true });
    expect((await record(db, "health", "reaudit", 5, 4)).rows[0].r.published).toBe(true);
    expect((await record(db, "dental", "launch", 60, 60)).rows[0].r.published).toBe(true);
  });
});

describe("the sweep lease", () => {
  it("admits one holder at a time, frees itself on expiry, and only the holder releases it", async () => {
    const db = await boot(false);
    await db.exec(BOARD);
    await db.exec(ENGINE);
    const take = async (h: string) => (await db.query<{ ok: boolean }>("SELECT public.employer_profile_lease_take('sweep', $1, 90) AS ok", [h])).rows[0].ok;
    const release = async (h: string) => (await db.query<{ ok: boolean }>("SELECT public.employer_profile_lease_release('sweep', $1) AS ok", [h])).rows[0].ok;
    expect(await take("holder-aaaa")).toBe(true);
    expect(await take("holder-bbbb"), "an overlapping minute skips").toBe(false);
    expect(await take("holder-aaaa"), "the holder may renew").toBe(true);
    expect(await take("short")).toBe(false);
    await db.exec("UPDATE public.employer_profile_leases SET expires_at = now() - interval '1 second'");
    expect(await take("holder-bbbb"), "an expired lease is anyone's").toBe(true);
    expect(await release("holder-aaaa"), "a former holder cannot free it").toBe(false);
    expect(await release("holder-bbbb")).toBe(true);
    const expiry = await db.query<{ s: number }>("SELECT 1 AS s");
    expect(expiry.rows.length).toBe(1);
  });

  it("the sweep's own lease is 90 seconds", async () => {
    const { LEASE_SECONDS } = await import("../../supabase/functions/employer-profiles/sweep");
    expect(LEASE_SECONDS).toBe(90);
  });
});

describe("20261012110100: the census, re-issued with the perk reader", () => {
  const CENSUS_FIRST = file("20261004110000_");
  const CENSUS_NOW = file("20261012110100_");
  const fnOf = (s: string) => {
    const at = s.indexOf("CREATE OR REPLACE FUNCTION public.client_callable_census()");
    return s.slice(at, s.indexOf("$census$;", at) + "$census$;".length);
  };

  it("is 20261004110000's census function byte for byte, plus one name on the anon list", () => {
    const first = fnOf(CENSUS_FIRST);
    const now = fnOf(CENSUS_NOW);
    expect(first.length).toBeGreaterThan(5000);
    expect(now).not.toBe(first);
    expect(now.replace("        'public.get_employer_perks(text)',\n", "")).toBe(first);
  });

  it("applied after the engine, the census answers anon with every listed function callable and none unlisted", async () => {
    const { CLIENT_CALLABLE, CLOSED_BY_CENSUS, CLOSED_TABLES, OWNED_ELSEWHERE } = await import("./helpers/client-callable-allowlist");
    const db = await boot();
    let ddl = "";
    const stub = (sig: string) => `CREATE FUNCTION ${sig} RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END $$;\n`;
    for (const c of CLOSED_BY_CENSUS) ddl += stub(c.sig) + `REVOKE ALL ON FUNCTION ${c.sig} FROM PUBLIC, anon, authenticated;\n`;
    for (const e of OWNED_ELSEWHERE) ddl += stub(e.sig);
    for (const a of CLIENT_CALLABLE) {
      if (a.sig === "public.get_employer_perks(text)") continue;
      ddl += stub(a.sig) + (a.roles === "anon" ? "" : `REVOKE ALL ON FUNCTION ${a.sig} FROM PUBLIC, anon;\n`);
    }
    for (const t of CLOSED_TABLES) ddl += `CREATE TABLE public.${t.table} (id int); REVOKE ALL ON public.${t.table} FROM PUBLIC, anon, authenticated;\n`;
    await db.exec(ddl);
    await db.exec(ENGINE);
    await db.exec(CENSUS_NOW);
    await db.exec("SET ROLE anon");
    try {
      const c = (await db.query<{ c: Record<string, unknown> }>("SELECT public.client_callable_census() AS c")).rows[0].c;
      expect(c.allowlisted).toBe(CLIENT_CALLABLE.length);
      expect(c.allowlisted_not_callable).toEqual([]);
      expect(c.closed_still_callable).toEqual([]);
      expect(c.unlisted_client_callable, "the perk reader is listed, and no writer of the engine is client-callable").toBe(0);
    } finally {
      await db.exec("RESET ROLE");
    }
    await db.exec(CENSUS_NOW);
  });
});

describe("20261012111000: the crons", () => {
  const CRON = `
    CREATE SCHEMA cron;
    CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
    CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
      INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
      ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
    CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$
      WITH d AS (DELETE FROM cron.job WHERE jobname = p_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
  `;
  const VAULT = `
    CREATE SCHEMA vault;
    CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text NOT NULL);
    CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
    CREATE FUNCTION vault.create_secret(new_secret text, new_name text) RETURNS uuid LANGUAGE sql AS $$
      INSERT INTO vault.secrets (name, secret) VALUES (new_name, new_secret) RETURNING id $$;
  `;

  it("schedules both jobs, each command opening with its own statement_timeout, the sweep with its key", async () => {
    const db = await boot();
    await db.exec(ENGINE + CRON + VAULT);
    await db.exec(CRONS);
    const jobs = Object.fromEntries((await db.query<{ jobname: string; schedule: string; command: string }>(
      "SELECT jobname, schedule, command FROM cron.job")).rows.map((r) => [r.jobname, r]));
    expect(Object.keys(jobs).sort()).toEqual(["employer-perks-rollup", "employer-perks-sweep"]);
    expect(jobs["employer-perks-sweep"].schedule).toBe("* * * * *");
    expect(jobs["employer-perks-sweep"].command.startsWith("SET statement_timeout = '15s';")).toBe(true);
    expect(jobs["employer-perks-sweep"].command).toMatch(/x-employer-profiles-cron/);
    expect(jobs["employer-perks-sweep"].command).toMatch(/\/functions\/v1\/employer-profiles'/);
    expect(jobs["employer-perks-sweep"].command).toMatch(/"action":"sweep"/);
    expect(jobs["employer-perks-sweep"].command).toMatch(/timeout_milliseconds := 25000/);
    expect(jobs["employer-perks-rollup"].schedule).toBe("13,43 0,1 * * *");
    expect(jobs["employer-perks-rollup"].command).toBe("SET statement_timeout = '110s'; SELECT public.employer_perk_rollup_tick(90000);");
  });

  it("generates the key once, matches it and nothing else, for the service role only", async () => {
    const db = await boot();
    await db.exec(ENGINE + CRON + VAULT);
    await db.exec(CRONS);
    const key1 = (await db.query<{ s: string }>("SELECT decrypted_secret AS s FROM vault.decrypted_secrets WHERE name = 'employer_profiles_cron_key'")).rows[0].s;
    await db.exec(CRONS);
    const keys = (await db.query<{ s: string }>("SELECT decrypted_secret AS s FROM vault.decrypted_secrets WHERE name = 'employer_profiles_cron_key'")).rows;
    expect(keys.map((k) => k.s)).toEqual([key1]);
    expect(key1).toMatch(/^[0-9a-f]{64}$/);
    const m = async (k: string | null) => (await db.query<{ ok: boolean }>("SELECT public.employer_profiles_cron_key_matches($1) AS ok", [k])).rows[0].ok;
    expect(await m(key1)).toBe(true);
    expect(await m(key1.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toBe(false);
    expect(await m(key1.slice(0, 20))).toBe(false);
    expect(await m(null)).toBe(false);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(db.query("SELECT public.employer_profiles_cron_key_matches('x')")).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec("RESET ROLE");
      }
    }
  });

  it("a database without pg_cron or the vault applies it as a no-op", async () => {
    const db = await boot();
    await db.exec(ENGINE);
    await db.exec(CRONS);
    expect((await db.query<{ ok: boolean }>("SELECT public.employer_profiles_cron_key_matches(repeat('a', 64)) AS ok")).rows[0].ok).toBe(false);
  });

  it("every cron command in this lane opens with its own statement_timeout (read from the files)", () => {
    for (const sql of [ENGINE, CRONS]) {
      const code = sqlCodeOf(sql);
      for (const m of code.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'[^']+'\s*,\s*\$job\$([\s\S]*?)\$job\$/g)) {
        expect(m[2].trimStart().startsWith("SET statement_timeout = '"), `${m[1]} does not set its own statement_timeout first`).toBe(true);
      }
    }
    expect([...sqlCodeOf(CRONS).matchAll(/cron\.schedule\(/g)].length).toBe(2);
  });
});
