// @vitest-environment node
/**
 * A BOARD NAMED BY ITS LOGO OR A SITE LABEL TAKES THE NAME ITS EMPLOYER USES.
 *
 * Three of the six pages the SEO round's name gate listed under owner decision
 * D7 (docs/company-profiles/name-gate-dry-run.md, table 1) were refused for
 * their name: a UKG board stored as "Axia Logo Horizontal" (its logo's alt
 * text), and two Oracle boards stored as "Aerospace" and "All" (career-site
 * labels). The owner's decision of 2026-10-25 is to make them trusted by
 * fixing the name, never by loosening the gate. The census tools that wrote
 * those names wrote many more: 78 UKG boards print a brand or logo label the
 * gate lets through ("Westminster Brand 051816", "US - LLC Recruiting"),
 * Oracle sites print audience labels ("Student", "Staff and Faculty"), and ADP
 * boards print logo file names ("BTB2.png").
 *
 * Migration 20261025100000 writes one company_name_overrides row for each
 * board whose employer's own words were read on 2026-10-25 (the board's
 * embedded name or footer, a posting's text, or the employer's own careers
 * page linking the board), and keeps those words and their links in
 * company_name_evidence, a service-role table, because the mirror test's
 * replay reads company_name_overrides as exactly (slug, display_name). The
 * stored rows are renamed by job-board's name-sync lane, whose version this
 * fix moves to 5; the bake and the app read the mirror at once.
 *
 * Checked here: the three D7 names; every override the file writes has its
 * evidence, with links on the vendor's or the employer's own host; no name is
 * a label, a logo or a guess the evidence does not carry; the two Oracle
 * boards that are not one employer get no row; the migration runs on a real
 * Postgres and checks itself; and the lane will run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { employerDisplayName, employerNameOverride } from "../lib/employer-names";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const FILE = "20261025100000_a_board_named_by_its_logo_or_a_site_label_takes_the_name_its_employer_uses.sql";
const SQL = existsSync(resolve(ROOT, "supabase/migrations", FILE)) ? readFileSync(resolve(ROOT, "supabase/migrations", FILE), "utf8") : "";
const lit = (s: string) => s.slice(1, -1).replace(/''/g, "'");
const STR = "'(?:[^']|'')*'";

/** The (slug, name) pairs the file's override INSERT writes. */
const OVERRIDES = (() => {
  const m = new RegExp(`INSERT INTO public\\.company_name_overrides \\(slug, display_name\\) VALUES([\\s\\S]*?)ON CONFLICT`).exec(SQL);
  if (!m) return [] as Array<[string, string]>;
  return [...m[1].matchAll(new RegExp(`\\((${STR}),\\s*(${STR})\\)`, "g"))].map((x) => [lit(x[1]), lit(x[2])] as [string, string]);
})();
/** The evidence rows: slug, name, links, the employer's words. */
const EVIDENCE = (() => {
  const m = new RegExp(`INSERT INTO public\\.company_name_evidence \\(slug, display_name, evidence, quote, read_on\\) VALUES([\\s\\S]*?)ON CONFLICT`).exec(SQL);
  if (!m) return new Map<string, { name: string; links: string[]; quote: string }>();
  const rows = [...m[1].matchAll(new RegExp(`\\((${STR}),\\s*(${STR}),\\s*ARRAY\\[((?:\\s*${STR}\\s*,?)+)\\],\\s*(${STR}),\\s*DATE '2026-10-25'\\)`, "g"))];
  return new Map(rows.map((x) => [lit(x[1]), { name: lit(x[2]), links: [...x[3].matchAll(new RegExp(STR, "g"))].map((l) => lit(l[0])), quote: lit(x[4]) }]));
})();
const catalogue = new Map(JOB_SOURCES.map((s) => [s.token, s]));

const AXIA = "recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522";
const HONEYWELL = "icfcjb~ocs~CX_1";
const LCS = "eexs~us2~CX_3001";

describe("the three D7 pages refused for their name print the employer's", () => {
  it("Axia Women's Health, Honeywell Aerospace and LCS, where the catalogue says logo text, 'Aerospace' and 'All'", () => {
    expect(catalogue.get(AXIA)?.name).toBe("Axia Logo Horizontal");
    expect(catalogue.get(HONEYWELL)?.name).toBe("Aerospace");
    expect(catalogue.get(LCS)?.name).toBe("All");
    expect(employerDisplayName(AXIA, "Axia Logo Horizontal")).toBe("Axia Women's Health");
    expect(employerDisplayName(HONEYWELL, "Aerospace")).toBe("Honeywell Aerospace");
    expect(employerDisplayName(LCS, "All")).toBe("LCS");
  });

  it("Honeywell Aerospace is not The Aerospace Corporation, and Honeywell's other tenant keeps its own name", () => {
    expect(EVIDENCE.get(HONEYWELL)?.quote).toMatch(/Honeywell Aerospace/);
    expect(employerDisplayName("ibqbjb~ocs~CX_1", catalogue.get("ibqbjb~ocs~CX_1")?.name)).toBe("Honeywell");
  });

  it("LCS states its uncertainty: most of that site's postings are at communities LCS manages", () => {
    expect(EVIDENCE.get(LCS)?.quote).toMatch(/communities LCS manages, and the feed states no legal employer/);
  });
});

describe("every override this file writes carries its evidence", () => {
  it("writes a real batch, each to a catalogued board whose token carries a '~' (a bare token cannot take an override)", () => {
    expect(OVERRIDES.length).toBe(88);
    for (const [slug] of OVERRIDES) {
      expect(slug, slug).toContain("~");
      expect(catalogue.has(slug), `${slug} is not in the catalogue`).toBe(true);
      expect(employerNameOverride(slug), `${slug}: the mirror (employer-names.ts) must carry the row`).not.toBeNull();
    }
    expect(new Set(OVERRIDES.map(([s]) => s)).size).toBe(OVERRIDES.length);
  });

  it("each has an evidence row naming the same employer, with links on the vendor's or the employer's own host and the words read", () => {
    const VENDOR = /^https:\/\/(?:recruiting2?\.ultipro\.com|[a-z0-9-]+\.fa\.(?:[a-z0-9]+\.)?oraclecloud\.com|workforcenow\.adp\.com)\//;
    for (const [slug, name] of OVERRIDES) {
      const e = EVIDENCE.get(slug);
      expect(e, `${slug} has no evidence row`).toBeTruthy();
      expect(e!.name, slug).toBe(name);
      expect(e!.links.length, slug).toBeGreaterThan(0);
      for (const l of e!.links) expect(l, slug).toMatch(/^https?:\/\/[^\s]+$/);
      expect(e!.links.some((l) => VENDOR.test(l)) || /employer site/.test(e!.quote), `${slug}: no link to the vendor's board or feed, and no employer page quoted`).toBe(true);
      expect(e!.quote.length, slug).toBeGreaterThan(10);
    }
    expect([...EVIDENCE.keys()].sort()).toEqual(OVERRIDES.map(([s]) => s).sort());
  });

  it("the employer's name is in the words read, letter for letter (accents and case aside), or the quote names the employer page that links the board", () => {
    const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const sameTenant = new Set(["recruiting2~AUS1003AUIN~76c6c58c-a4d3-4a7c-b7a4-8640fc76a703"]);
    for (const [slug, name] of OVERRIDES) {
      const q = EVIDENCE.get(slug)!.quote;
      if (sameTenant.has(slug)) { expect(q, slug).toMatch(/same UKG tenant/); continue; }
      const words = fold(name).replace(/\.$/, "");
      // A domain spells the name without its spaces: "EOSHospitality.com".
      const bare = (x: string) => x.replace(/[^a-z0-9]/g, "");
      expect(fold(q).includes(words) || bare(fold(q)).includes(bare(words)) || /^employer site /.test(q), `${slug}: "${name}" is not in "${q}"`).toBe(true);
    }
  });

  it("no new name is a logo, a file name, a career-site label, a year or a template", () => {
    const BAD = /\b(?:logo|png|jpe?g|cmyk|brand(?:ing)?|default|template|external|careers?|jobs?|opportunities|recruiting|refresh|new|student|staff|faculty|all|global|corporate|career site|job board)\b|\b(?:19|20)\d\d\b/i;
    for (const [slug, name] of OVERRIDES) expect(name, slug).not.toMatch(BAD);
  });

  it("the two Oracle boards that are not one employer get no row: erhk's 'Default' pools R+L Carriers and Golden Ocala, fa-enmi is a council's schools portal", () => {
    for (const t of ["erhk~us2~CX_1001", "fa-enmi-saasfaprod1~ocs~CX_1"]) {
      expect(OVERRIDES.some(([s]) => s === t), t).toBe(false);
      expect(employerNameOverride(t), t).toBeNull();
    }
  });
});

describe("the migration on a real Postgres", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      CREATE TABLE public.company_name_overrides (slug text PRIMARY KEY, display_name text NOT NULL, added_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE public.company_name_overrides ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON public.company_name_overrides FROM PUBLIC, anon, authenticated;
      INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('${HONEYWELL}', 'Aerospace (an older guess)'), ('ms', 'Morgan Stanley');
    `);
    await db.exec(SQL);
  });
  afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

  it("writes every row, replaces an older name for the same board, and leaves the rest", async () => {
    const rows = (await db.query<{ slug: string; display_name: string }>("SELECT slug, display_name FROM public.company_name_overrides")).rows;
    const m = new Map(rows.map((r) => [r.slug, r.display_name]));
    expect(m.get(HONEYWELL)).toBe("Honeywell Aerospace");
    expect(m.get(AXIA)).toBe("Axia Women's Health");
    expect(m.get("ms")).toBe("Morgan Stanley");
    expect(rows.length).toBe(OVERRIDES.length + 1);
  });

  it("keeps the evidence where no client can read it", async () => {
    const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.company_name_evidence")).rows[0].n;
    expect(n).toBe(OVERRIDES.length);
    for (const role of ["anon", "authenticated"]) {
      const r = (await db.query<{ p: boolean }>(`SELECT has_table_privilege('${role}', 'public.company_name_evidence', 'SELECT') AS p`)).rows[0];
      expect(r.p, role).toBe(false);
    }
    const s = (await db.query<{ p: boolean }>("SELECT has_table_privilege('service_role', 'public.company_name_evidence', 'SELECT') AS p")).rows[0];
    expect(s.p).toBe(true);
  });

  it("is safe to run again, and its self-check fails when a row it vouches for is missing", async () => {
    await db.exec(SQL);
    await db.exec(`DELETE FROM public.company_name_overrides WHERE slug = '${LCS}'`);
    const selfCheck = /DO \$\$[\s\S]*?\$\$;/g.exec(SQL.slice(SQL.lastIndexOf("-- SELF-CHECK")))?.[0] ?? "";
    expect(selfCheck).toMatch(/RAISE EXCEPTION/);
    await expect(db.exec(selfCheck)).rejects.toThrow(/20261025100000/);
    await db.exec(SQL);
    expect((await db.query<{ d: string }>(`SELECT display_name AS d FROM public.company_name_overrides WHERE slug = '${LCS}'`)).rows[0].d).toBe("LCS");
  });
});

describe("the stored rows are renamed by job-board's name-sync lane, once, at the deploy", () => {
  const IDX = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
  it("NAME_SYNC_VERSION is 5, so the lane walks every board an override names again", () => {
    expect(/const NAME_SYNC_VERSION = (\d+);/.exec(IDX)?.[1]).toBe("5");
  });
  it("the ledger applies the names before job-board deploys, so the lane reads them", () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
    expect(ledger.migrationOrder["20261025100000"]?.before).toEqual(["fn:job-board"]);
  });
});

describe("the bake's own gate passes every new name (runs once the branch carries scripts/prerender-names.mjs)", () => {
  const GATE = resolve(ROOT, "scripts/prerender-names.mjs");
  it.skipIf(!existsSync(GATE))("unpublishableNameReason is null for every new name, and was not for the three D7 names it replaces", async () => {
    const g = (await import(pathToFileURL(GATE).href)) as { repairEmployerName: (n: string) => { name: string }; unpublishableNameReason: (n: string) => string | null };
    for (const [slug, name] of OVERRIDES) expect(g.unpublishableNameReason(g.repairEmployerName(name).name), `${slug} "${name}"`).toBeNull();
    for (const old of ["Axia Logo Horizontal", "Aerospace", "All"]) expect(g.unpublishableNameReason(g.repairEmployerName(old).name), old).not.toBeNull();
  });
});
