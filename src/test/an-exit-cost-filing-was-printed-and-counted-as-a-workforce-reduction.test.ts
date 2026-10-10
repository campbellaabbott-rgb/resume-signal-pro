// @vitest-environment node
/**
 * AN EXIT-COST FILING WAS PRINTED AND COUNTED AS A WORKFORCE REDUCTION
 * (sweep S8-026).
 *
 * Item 2.05 is "costs associated with exit or disposal activities": a
 * product-line exit, a lease, or a status update on a plan filed months
 * earlier. The parser stores is_workforce_event, and nothing read it: the
 * readers returned every active 2.05 row, the card and the detail line said
 * "reported a workforce reduction", and refresh_layoff_partition's filed arm
 * counted the employer. Vital Farms' butter-line exit (no employees) was
 * shown May to July and still fed the arm.
 *
 * Proven on a real Postgres (pglite): the layoff lane's migrations, then
 * 20261009160000, one exit-cost 8-K matched to "acme" and one workforce 8-K
 * matched to "beta", both inside the 90 days before a watched closure of each
 * board. The readers name the difference (lf_workforce / la_workforce), the
 * filed arm counts beta alone, and the page prints the exit-cost filing in
 * neutral words with a neutral chip.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { layoffLineText, readLayoffRow } from "../components/jobs/LayoffFilingLine";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const LANE = readdirSync(MIGRATIONS).filter((f) => /^202609181\d{5}_/.test(f) && f.endsWith(".sql")).sort();
const FIX = readdirSync(MIGRATIONS).find((f) => f.startsWith("20261009160000_"))!;
const IL_FIX = readdirSync(MIGRATIONS).find((f) => f.startsWith("20261009160100_"))!;

const STAND_INS = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz, country text, region_code text
  );
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer, absence_basis text
  );
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
  );
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date)
  );
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now()
  );
`;

const ago = (n: number) => `now() - interval '${n} days'`;
const secRow = (adsh: string, filer: string, workforce: boolean) => `
  INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis,
    source_read_at, source_url, source_name, status, cik, adsh, form, section_text, is_workforce_event, parse_confidence, parser_version)
  VALUES ('sec:${adsh}', 'sec_8k_205', '${filer}', lower('${filer}'), (${ago(50)})::date, 'sec_report_date', (${ago(49)})::date, 'sec_filed',
    now(), 'https://www.sec.gov/x/${adsh}.htm', 'SEC EDGAR', 'active', 1, '${adsh}', '8-K', 'Item 2.05 ...', ${workforce}, 0.5, 'parse205_v2_ts');`;

let db: PGlite;
async function seed(target: PGlite) {
  await target.exec(`
    ${secRow("0000000001-26-000001", "Acme Foods Inc", false)}
    ${secRow("0000000002-26-000002", "Beta Systems Inc", true)}
    INSERT INTO public.layoff_matches (filing_id, company_token, matched_via, matched_norm, relation) VALUES
      ('sec:0000000001-26-000001', 'acme', 'exact_multitoken', 'acme foods', 'filer'),
      ('sec:0000000002-26-000002', 'beta', 'exact_multitoken', 'beta systems', 'filer');
    INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('acme', 'full_read'), ('beta', 'full_read');
    INSERT INTO public.job_board_closures (posting_id, source, company_token, posted_at, closed_at) VALUES
      ('greenhouse:acme:1', 'greenhouse', 'acme', ${ago(40)}, ${ago(35)}),
      ('greenhouse:beta:1', 'greenhouse', 'beta', ${ago(40)}, ${ago(35)});
  `);
}
async function boot(withFix: boolean): Promise<PGlite> {
  const d = new PGlite();
  await d.exec(STAND_INS);
  for (const f of LANE) await d.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));
  if (withFix) await d.exec(readFileSync(resolve(MIGRATIONS, FIX), "utf8"));
  await seed(d);
  return d;
}
const filedEmployers = async (d: PGlite) => {
  const { rows } = await d.query<{ lw_arm: string; lw_employers_n: number }>("SELECT * FROM public.refresh_layoff_partition()");
  return rows.find((r) => r.lw_arm === "filed")?.lw_employers_n;
};

beforeAll(async () => { db = await boot(true); });

describe("an exit-cost filing was printed and counted as a workforce reduction", () => {
  it("positive control: before the fix the filed arm counts both employers", async () => {
    const before = await boot(false);
    expect(await filedEmployers(before)).toBe(2);
  });

  it("the filed arm counts only the employer whose filing is a workforce event", async () => {
    expect(await filedEmployers(db), "an exit-cost 8-K put its employer in the filed arm").toBe(1);
  });

  it("both readers say which filing is a workforce event", async () => {
    const { rows } = await db.query<Record<string, unknown>>("SELECT * FROM public.get_employer_layoff_filings(ARRAY['acme','beta'])");
    const by = Object.fromEntries(rows.map((r) => [r.lf_company_token as string, r]));
    expect(by.acme.lf_workforce).toBe(false);
    expect(by.beta.lf_workforce).toBe(true);
    const all = await db.query<Record<string, unknown>>("SELECT * FROM public.get_employer_layoff_filings_all('acme')");
    expect(all.rows[0].la_workforce).toBe(false);
  });

  it("the page prints an exit-cost filing in neutral words, and a workforce filing as before", async () => {
    // As PostgREST sends it: JSON, dates as YYYY-MM-DD.
    const { rows: js } = await db.query<{ j: Record<string, unknown> }>("SELECT to_jsonb(f) AS j FROM public.get_employer_layoff_filings(ARRAY['acme','beta']) f");
    const rows = js.map((r) => r.j);
    const t = ((_k: string, d: string, v?: Record<string, unknown>) => d.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(v?.[k] ?? ""))) as never;
    const asJson = (r: Record<string, unknown>) => ({ ...r });
    const acme = readLayoffRow(asJson(rows.find((r) => r.lf_company_token === "acme")!))!;
    const beta = readLayoffRow(asJson(rows.find((r) => r.lf_company_token === "beta")!))!;
    expect(acme, "the reader's row was refused by the page").not.toBeNull();
    const acmeLine = layoffLineText(acme, t).text;
    expect(acmeLine, "an exit-cost filing was printed as a workforce reduction").not.toMatch(/workforce reduction/);
    expect(acmeLine).toMatch(/filed an 8-K under Item 2\.05/);
    expect(layoffLineText(beta, t).text).toMatch(/reported a workforce reduction/);
    // A reader from before the column keeps the old sentence (no neutral flip in the deploy window).
    const legacy = { ...asJson(rows.find((r) => r.lf_company_token === "acme")!) };
    delete legacy.lf_workforce;
    expect(layoffLineText(readLayoffRow(legacy)!, t).text).toMatch(/reported a workforce reduction/);
  });
});

// S8-025, the stored half: an Illinois notice dated by its newest
// re-notification (after the state's own stamp) stayed active and fed a
// negative stamp lag into the published warn_lag_p50_days.
describe("an Illinois notice dated after its own stamp", () => {
  const warn = (id: string, event: number, pub: number) => `
    INSERT INTO public.layoff_filings (filing_id, source, filer_raw, filer_norm, event_date, event_basis, public_date, public_basis,
      source_read_at, source_url, source_name, status, state, feed, workers, event_type)
    VALUES ('${id}', 'state_warn', 'UnityPoint Health', 'unitypoint health', (${ago(event)})::date, 'warn_notice_date', (${ago(pub)})::date,
      'state_received', now(), 'https://dceo.illinois.gov/x', 'Illinois DCEO', 'active', 'IL', 'bln_raw', 120, 'layoff');`;
  const lag = async (d: PGlite) => {
    await d.query("SELECT * FROM public.refresh_layoff_partition()");
    const { rows } = await d.query<{ warn_lag_p50_days: string | null; warn_lag_n: number }>("SELECT warn_lag_p50_days, warn_lag_n FROM public.job_board_layoff_partition WHERE arm = 'filed'");
    return rows[0];
  };

  it("is superseded, and the published stamp lag counts only notices dated on or before their stamp", async () => {
    const d = await boot(true);
    // Misdated: notice 10 days ago, stamped 60 days ago (lag -50). Correct: notice 30, stamped 28 (lag 2).
    await d.exec(warn("warn:misdated", 10, 60) + warn("warn:correct", 30, 28));
    const before = await lag(d);
    expect(before.warn_lag_n, "positive control: both notices fed the lag before the fix").toBe(2);
    await d.exec(readFileSync(resolve(MIGRATIONS, IL_FIX), "utf8"));
    const { rows } = await d.query<{ filing_id: string; status: string }>("SELECT filing_id, status FROM public.layoff_filings WHERE state = 'IL' ORDER BY filing_id");
    expect(rows).toEqual([{ filing_id: "warn:correct", status: "active" }, { filing_id: "warn:misdated", status: "superseded" }]);
    const after = await lag(d);
    expect(after.warn_lag_n).toBe(1);
    expect(Number(after.warn_lag_p50_days), "a negative lag was published").toBe(2);
  });
});
