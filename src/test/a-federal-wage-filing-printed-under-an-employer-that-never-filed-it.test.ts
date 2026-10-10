// @vitest-environment node
/**
 * A FEDERAL WAGE FILING PRINTED UNDER AN EMPLOYER THAT NEVER FILED IT
 * (sweep S8-024, S8-105).
 *
 * H-1B LCA wage cells joined a board by an exact match of the filer's
 * normalised name and nothing else:
 *   - "SOCIAL FINANCE LLC" (SoFi, 186 applications) printed on
 *     greenhouse:socialfinance, a Boston nonprofit, while SoFi's own board
 *     printed nothing;
 *   - "SIGMA SOFTWARE LLC" / "SIGMA SOFTWARE INC" (US consultancies) printed on
 *     smartrecruiters:sigmasoftware2, a Ukrainian and Polish firm with zero US
 *     postings;
 *   - a cell is keyed by token alone, so 'sunday' (ashby Sunday Robotics) also
 *     printed on breezy's Sunday, a Bangkok insurance broker (four such twin
 *     tokens carry cells: sunday, echo, roadrunner, lockwood).
 *
 * Three gates now, each run here:
 *   1. the reader answers only for a token with a live US posting (pglite:
 *      the LCA lane's migrations, then 20261009160300);
 *   2. the deploy posts no cell for the rejected-pair ledger or for a token
 *      the catalogue carries under two vendors (lca-cells.ts, over the real
 *      embedded payload and the real catalogue);
 *   3. the operator loader refuses a name two filers stand behind (two legal
 *      forms, or two FEINs), and still folds "Acme Widgets" with "Acme
 *      Widgets, Inc." (a real xlsx through scripts/load-oflc-lca.mjs).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import JSZip from "jszip";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeLcaCells, LCA_REFUSED_TOKENS, refuseLcaCells, twinVendorTokens } from "../../supabase/functions/layoff-filings/lca-cells";
import { JOB_SOURCES } from "../../supabase/functions/layoff-filings/board-sources";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const LCA_LANE = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && f < "20261009" && /oflc_lca_wages/.test(readFileSync(resolve(MIGRATIONS, f), "utf8")))
  .sort();
const FIX = readdirSync(MIGRATIONS).find((f) => f.startsWith("20261009160300_"))!;

// ── 1. the reader ───────────────────────────────────────────────────────────

const STAND_INS = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE IF NOT EXISTS public.job_board_postings (
    id text PRIMARY KEY, company_token text NOT NULL, country text, missing_since timestamptz
  );
  CREATE TABLE IF NOT EXISTS public.layoff_read_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, kind text, fetched int, kept int, new_rows int, ok boolean, ms int, note text,
    at timestamptz NOT NULL DEFAULT now()
  );
`;
const cell = (tok: string, soc: string, st: string, n: number) =>
  `('${tok}', '${soc}', 'Software Developers', '${st}', 100000, 130000, 115000, ${n}, 'FY2026 Q1-Q3', 'LCA_Disclosure_Data_FY2026_Q3.xlsx', 'https://www.dol.gov/x.xlsx', '2026-08-07', '2025-10-01', '2026-06-30')`;
async function boot(withFix: boolean): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(STAND_INS);
  for (const f of LCA_LANE) await db.exec(readFileSync(resolve(MIGRATIONS, f), "utf8"));
  if (withFix) await db.exec(readFileSync(resolve(MIGRATIONS, FIX), "utf8"));
  await db.exec(`
    INSERT INTO public.oflc_lca_wages (company_token, soc_code, soc_title, worksite_state, wage_low_annual, wage_high_annual,
      wage_median_annual, filings_n, fiscal_quarter, source_file, source_url, published_on, coverage_from, coverage_to)
    VALUES ${cell("acme", "15-1252", "CA", 12)}, ${cell("sigmasoftware2", "15-1252", "TX", 11)};
    INSERT INTO public.job_board_postings (id, company_token, country, missing_since) VALUES
      ('a1', 'acme', 'US', NULL), ('s1', 'sigmasoftware2', 'PL', NULL), ('s2', 'sigmasoftware2', 'US', now() - interval '3 days');
  `);
  return db;
}
const wages = async (db: PGlite, tok: string) =>
  (await db.query<{ ow_soc_code: string | null; ow_filings_n: number | null }>("SELECT * FROM public.get_employer_lca_wages(ARRAY[$1]::text[])", [tok])).rows[0];

describe("1. the reader answers only for an employer hiring in the US", () => {
  let before: PGlite, after: PGlite;
  beforeAll(async () => { before = await boot(false); after = await boot(true); });

  it("positive control: before the fix a board with no live US posting printed federal filings", async () => {
    expect((await wages(before, "sigmasoftware2")).ow_soc_code).toBe("15-1252");
  });

  it("a board whose only US posting has closed prints none, and a US employer's cell still prints", async () => {
    expect((await wages(after, "sigmasoftware2")).ow_soc_code, "filings printed under a board with no live US posting").toBeNull();
    const acme = await wages(after, "acme");
    expect(acme.ow_soc_code).toBe("15-1252");
    expect(acme.ow_filings_n).toBe(12);
  });
});

// ── 2. the deploy's refusals ─────────────────────────────────────────────────

describe("2. the deploy posts no cell the board cannot own", () => {
  it("the rejected-pair ledger and the twin-vendor tokens are refused from the real payload, and nothing else is", async () => {
    const rows = await decodeLcaCells();
    const twins = twinVendorTokens(JOB_SOURCES);
    expect(twins.has("sunday"), "the catalogue no longer carries 'sunday' twice -- re-measure the twin set").toBe(true);
    const r = refuseLcaCells(rows, twins);
    expect(r.tokens).toEqual(expect.arrayContaining(["socialfinance", "sigmasoftware2", "sunday", "echo", "roadrunner", "lockwood"]));
    for (const tok of Object.keys(LCA_REFUSED_TOKENS)) expect(r.kept.some((c) => c.company_token === tok), tok).toBe(false);
    expect(r.kept.some((c) => c.company_token === "sunday")).toBe(false);
    // Nothing outside the two refusals moved.
    const refused = new Set(r.tokens);
    expect(r.kept.length).toBe(rows.filter((c) => !refused.has(c.company_token)).length);
    expect(r.ledger + r.twin + r.kept.length).toBe(rows.length);
  });
});

// ── 3. the loader ────────────────────────────────────────────────────────────

const TMP = mkdtempSync(join(tmpdir(), "lca-two-filers-"));
afterAll(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });
const HEADER = ["CASE_NUMBER", "CASE_STATUS", "DECISION_DATE", "VISA_CLASS", "SOC_CODE", "SOC_TITLE", "EMPLOYER_NAME", "EMPLOYER_FEIN",
  "WAGE_RATE_OF_PAY_FROM", "WAGE_RATE_OF_PAY_TO", "WAGE_UNIT_OF_PAY", "WORKSITE_STATE"];
const D = "46150"; // 2026-05-07, an Excel serial inside FY2026 Q3
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const col = (i: number) => { let s = ""; let n = i + 1; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
async function xlsx(rows: string[][]): Promise<string> {
  const all = [HEADER, ...rows];
  const body = all.map((cells, i) => `<row r="${i + 1}">` + cells.map((c, j) => (c === "" ? "" : `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`)).join("") + `</row>`).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("xl/workbook.xml", "<workbook/>");
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="x"><sheetData>${body}</sheetData></worksheet>`);
  const path = join(TMP, `f${Math.random().toString(36).slice(2)}-LCA_Disclosure_Data_FY2026_Q3.xlsx`);
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return path;
}
const app = (id: string, name: string, fein: string, st = "TX") => [id, "Certified", D, "H-1B", "15-1252", "Software Developers", name, fein, "110000", "125000", "Year", st];

describe("3. the loader refuses a name two filers stand behind", () => {
  it("two legal forms behind one name are two filers; a bare spelling beside one form is one", async () => {
    const L = await import("../../scripts/load-oflc-lca.mjs");
    const index = L.indexMirror([
      { vendor: "smartrecruiters", company_token: "sigmasoftware2", display_name: "Sigma Software" },
      { vendor: "greenhouse", company_token: "acmewidgets", display_name: "Acme Widgets" },
    ]);
    const file = await xlsx([
      app("S-1", "SIGMA SOFTWARE LLC", ""), app("S-2", "SIGMA SOFTWARE INC", ""), app("S-3", "Sigma Software LLC", ""),
      app("A-1", "ACME WIDGETS, INC.", "", "CA"), app("A-2", "Acme Widgets", "", "CA"), app("A-3", "Acme Widgets Inc", "", "CA"),
    ]);
    const { rows, counts } = await L.loadDisclosureFile({ file, index, sourceUrl: "https://www.dol.gov/x.xlsx", publishedOn: "2026-08-07" });
    expect(rows.some((r: { company_token: string }) => r.company_token === "sigmasoftware2"), "LLC and INC filers were folded into one board's cell").toBe(false);
    expect(counts.refusedTwoFilers).toBe(3);
    const acme = rows.find((r: { company_token: string }) => r.company_token === "acmewidgets");
    expect(acme?.filings_n, "one employer's three spellings stopped folding").toBe(3);
  });

  it("two FEINs behind one name are two filers", async () => {
    const L = await import("../../scripts/load-oflc-lca.mjs");
    const index = L.indexMirror([
      { vendor: "greenhouse", company_token: "socialfinance", display_name: "Social Finance" },
      { vendor: "greenhouse", company_token: "acmewidgets", display_name: "Acme Widgets" },
    ]);
    const file = await xlsx([
      app("F-1", "SOCIAL FINANCE LLC", "45-2234567"), app("F-2", "Social Finance LLC", "04-9998888"), app("F-3", "SOCIAL FINANCE LLC", "45-2234567"),
      app("A-1", "Acme Widgets Inc", "11-1111111", "CA"), app("A-2", "ACME WIDGETS, INC.", "11-1111111", "CA"),
    ]);
    const { rows, counts } = await L.loadDisclosureFile({ file, index, sourceUrl: "https://www.dol.gov/x.xlsx", publishedOn: "2026-08-07" });
    expect(rows.some((r: { company_token: string }) => r.company_token === "socialfinance"), "two FEINs were folded into one board's cell").toBe(false);
    expect(counts.refusedTwoFilers).toBe(3);
    expect(rows.find((r: { company_token: string }) => r.company_token === "acmewidgets")?.filings_n, "one FEIN, two spellings, is one filer").toBe(2);
  });
});
