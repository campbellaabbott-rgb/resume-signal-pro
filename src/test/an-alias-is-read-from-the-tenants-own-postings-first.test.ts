import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { CATALOG, MIN_EXPECTED_BOARDS } from "./helpers/catalog";
import { employerOf, parseAliasRows, warnPrePass } from "../../scripts/layoff-alias-candidates.mjs";
import { mirrorRows } from "../../scripts/layoff-board-names-mirror.mjs";
import { EMPLOYER_ALIASES } from "../../supabase/functions/job-board/employer-aliases";
import { warnPrePass as pollerWarnPrePass } from "../../supabase/functions/layoff-filings/normalize";

/**
 * AN ALIAS IS READ FROM THE TENANT'S OWN POSTINGS FIRST.
 *
 * layoff_employer_aliases is the only door by which a single-token, ambiguous
 * or CIK-keyed filer reaches a board (SPEC 2026-09-18 section 5). Every row is
 * a decision a person made after reading something, and a rejected row is a
 * refusal the matcher honours forever. So the seed rows are held to three
 * properties, on the code view of every migration that inserts them:
 *
 *   1. every ACCEPTED token is in the board catalogue, read through the one
 *      catalogue reader (never a grep) -- an alias to a token the board no
 *      longer carries is claim drift: the filing line would name a tenant
 *      that has left (SPEC 9.3);
 *   2. every accepted row names what was read: three posting titles, the
 *      tenant path, or the migration that already curated the pair -- and a
 *      single-token alias_norm (the dictionary-word class: Emerson, Wise,
 *      Mosaic, Block) never rides on a blank one;
 *   3. the rejected set holds the verified wrong pairs, and no accepted row
 *      contradicts one on the same key -- the negative test.
 *
 * The board-name mirror the matcher compares against is checked here too:
 * its rows come from the same catalogue reader, carry no duplicate key, and
 * every second-name row names a token the catalogue holds.
 *
 * Each property is proven to bite: the same assertions run over a mutated
 * copy of the rows and must fail.
 */

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const SEED = "20260918200000_an_alias_is_read_from_the_tenants_own_postings_first.sql";

type Row = ReturnType<typeof parseAliasRows>[number];

const aliasMigrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, rows: parseAliasRows(readFileSync(resolve(MIGRATIONS, f), "utf8"), f) }))
  .filter((m) => m.rows.length > 0);
const ROWS: Row[] = aliasMigrations.flatMap((m) => m.rows);
const SEED_ROWS: Row[] = aliasMigrations.find((m) => m.file === SEED)?.rows ?? [];

const CATALOGUED = new Set(CATALOG.map((e) => e.token));
const EVIDENCE = /^(titles:|tenant path:|read:|lane \d|SPEC \d|migration \d{14}|company_financials 20260722234500)/;

/** The guard, as a function, so the mutation steps can run it on altered rows. */
function violations(rows: Row[]): string[] {
  const out: string[] = [];
  const accepted = rows.filter((r) => r.decision === "accepted");
  for (const r of accepted) {
    if (!CATALOGUED.has(r.token)) out.push(`accepted alias to a token the catalogue does not carry: ${r.token} (${r.file})`);
    if (!EVIDENCE.test(r.evidence)) out.push(`accepted alias with no recorded read: ${r.norm ?? r.cik} -> ${r.token} evidence=${JSON.stringify(r.evidence)} (${r.file})`);
    if (r.norm !== null && !r.norm.includes(" ") && !EVIDENCE.test(r.evidence)) out.push(`single-token alias without evidence: ${r.norm} -> ${r.token}`);
    if (r.norm === null && r.cik === null) out.push(`accepted alias with neither a name nor a cik: -> ${r.token}`);
    if (!r.decided_by.trim()) out.push(`accepted alias nobody signed: -> ${r.token}`);
  }
  const rejected = rows.filter((r) => r.decision === "rejected");
  for (const r of rejected) {
    if (r.evidence.trim().length < 20) out.push(`rejected pair without a reason: ${r.norm ?? r.cik} -> ${r.token}`);
  }
  // no accepted row on the same key as a rejected one
  const rejKeys = new Set(rejected.flatMap((r) => [r.norm !== null ? `n:${r.norm}|${r.token}` : "", r.cik !== null ? `c:${r.cik}|${r.token}` : ""].filter(Boolean)));
  for (const r of accepted) {
    for (const k of [r.norm !== null ? `n:${r.norm}|${r.token}` : "", r.cik !== null ? `c:${r.cik}|${r.token}` : ""]) {
      if (k && rejKeys.has(k)) out.push(`accepted and rejected on the same key: ${k}`);
    }
  }
  return out;
}

/** The seven pairs the never-surface guard plants (SPEC 9.1), as (key, token). */
const VERIFIED_WRONG: Array<[{ norm?: string; cik?: number }, string]> = [
  [{ norm: "emerson" }, "emerson~wd5~Emerson_College_Staff"],
  [{ norm: "wise" }, "Wise"],
  [{ norm: "mosaic" }, "mosaic"],
  [{ cik: 863436 }, "benchmark~wd1~PGH_Careers"],
  [{ cik: 1512673 }, "block-llp"],
  [{ cik: 1512673 }, "the-block"],
  [{ cik: 1670076 }, "eu~frontier"],
  [{ cik: 37785 }, "fmc~wd12~FMC"],
  // and the near-misses lane 3 called NOT the same
  [{ norm: "owens and minor" }, "owens~wd1~OCC"],
  [{ norm: "blueprint medicines" }, "blueprint-health"],
  [{ norm: "compass group usa" }, "urbancompass"],
];
const isRejected = (rows: Row[], key: { norm?: string; cik?: number }, token: string) =>
  rows.some((r) => r.decision === "rejected" && r.token === token && (key.norm !== undefined ? r.norm === key.norm : r.cik === key.cik));

describe("the alias seed migration", () => {
  it("exists and parses to accepted and rejected rows", () => {
    expect(SEED_ROWS.length).toBeGreaterThan(200);
    expect(SEED_ROWS.filter((r) => r.decision === "accepted").length).toBeGreaterThan(150);
    expect(SEED_ROWS.filter((r) => r.decision === "rejected").length).toBeGreaterThan(20);
  });

  it("batch 1 is cik-keyed company_financials rows and nothing else", () => {
    const accepted = SEED_ROWS.filter((r) => r.decision === "accepted");
    for (const r of accepted) {
      expect(r.cik, `${r.token} has no cik`).not.toBeNull();
      expect(r.norm, `${r.token} carries an alias_norm in batch 1`).toBeNull();
      expect(r.evidence.startsWith("company_financials 20260722234500"), `${r.token}: ${r.evidence}`).toBe(true);
      expect(["filer", "subsidiary_site"]).toContain(r.relation);
    }
  });

  // A tenant path that names a brand other than the filer's is a subsidiary's
  // career site (Depop under Etsy, FedEx Express Canada under FedEx: SPEC
  // section 5, Relation). Such a row must say subsidiary_site, so the card
  // prints the parent sentence instead of naming the parent as the board's
  // own employer. The brands are read from the tenant paths in the seed; the
  // list is the test's, the evidence on the row is the migration's.
  const SUBSIDIARY_PATHS = [
    "accenture~wd103~AvanadeCareers", "astrazeneca~wd3~Alexion", "capri~wd1~Versace", "capri~wd1~Michael_Kors", "capri~wd1~JimmyChooCareers",
    "cat~wd5~SolarTurbines", "allegion~wd5~careers_SimonsVoss", "allegion~wd5~careers_SimonsVoss_English", "allegion~wd5~careers_SimonsVoss_French",
    "allegion~wd5~careers_SimonsVoss_Italian", "assurant~wd1~iSmash_External_Career_Site", "mckesson~wd3~CoverMyMeds_External_Careers",
    "resmed~wd3~Brightree_External_Careers", "resmed~wd3~MatrixCare_External_Careers", "salesforce~wd12~Slack", "salesforce~wd12~Mulesoft_Careersite",
    "relx~wd3~ElsevierJobs", "relx~wd3~LexisNexisLegal", "relx~wd3~ReedExhibitions", "relx~wd3~ReedTech", "humana~wd5~CenterWell_External_Career_Site",
    "flextronics~wd1~Anord_Mardix_Careers", "kyndryl~wd5~ISMCareers", "boeing~wd1~external_subsidiary", "morningstar~wd5~MorningstarDBRS",
    "fedex~wd1~fxe-eu_external", "fedex~wd1~FXE-Canada_External_Career_Site", "fedex~wd1~FXE-LAC_External_Career_Site", "fedex~wd1~FXE-MEISA-External",
    "fedex~wd1~FXE_APAC_External", "fedex~wd1~FTN_EMEIA_External", "fedex~wd1~FTN_APAC_External",
  ];
  const relationViolations = (rows: Row[]): string[] => {
    const out: string[] = [];
    for (const r of rows.filter((x) => x.decision === "accepted")) {
      const namesBrand = SUBSIDIARY_PATHS.includes(r.token);
      if (namesBrand && r.relation !== "subsidiary_site") out.push(`${r.token}: the tenant path names a subsidiary brand but the row says ${r.relation}`);
      if (r.relation === "subsidiary_site" && !/subsidiary_site: the tenant path names /.test(r.evidence)) out.push(`${r.token}: subsidiary_site without the brand named in its evidence`);
      if (r.relation === "subsidiary_site" && !namesBrand) out.push(`${r.token}: subsidiary_site on a path this test does not know as a subsidiary brand -- add it here after reading it`);
    }
    return out;
  };

  it("an accepted row whose tenant path names a subsidiary brand is subsidiary_site, and says which brand", () => {
    for (const tok of SUBSIDIARY_PATHS) expect(SEED_ROWS.some((r) => r.token === tok && r.decision === "accepted"), tok).toBe(true);
    expect(relationViolations(SEED_ROWS)).toEqual([]);
    expect(SEED_ROWS.filter((r) => r.relation === "subsidiary_site").length).toBe(SUBSIDIARY_PATHS.length);
  });

  it("the guard bites: a subsidiary site flipped back to filer, and a filer flipped to subsidiary_site without a read", () => {
    const back = SEED_ROWS.map((r) => (r.token === "salesforce~wd12~Slack" ? { ...r, relation: "filer" } : r));
    expect(relationViolations(back)).toEqual(["salesforce~wd12~Slack: the tenant path names a subsidiary brand but the row says filer"]);
    const unread = SEED_ROWS.map((r) => (r.token === "AbbVie" ? { ...r, relation: "subsidiary_site" } : r));
    expect(relationViolations(unread).length).toBe(2);
  });

  it("every accepted alias token, in every alias migration, is in the catalogue and names what was read", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(MIN_EXPECTED_BOARDS);
    expect(violations(ROWS)).toEqual([]);
  });

  it("the verified wrong pairs are rejected rows and none of them is also accepted", () => {
    for (const [key, token] of VERIFIED_WRONG) {
      expect(isRejected(SEED_ROWS, key, token), `${JSON.stringify(key)} -> ${token} is not a rejected row`).toBe(true);
      expect(
        SEED_ROWS.some((r) => r.decision === "accepted" && r.token === token && (key.norm !== undefined ? r.norm === key.norm : r.cik === key.cik)),
        `${token} is accepted on the same key`,
      ).toBe(false);
    }
  });

  it("a batch rejects something (a batch with no rejection is the sign the eyeball was skipped)", () => {
    for (const m of aliasMigrations) {
      const rej = m.rows.filter((r) => r.decision === "rejected").length;
      expect(rej, `${m.file} rejects nothing`).toBeGreaterThan(0);
    }
  });

  it("the guard bites: a token that left the catalogue", () => {
    const mutated = SEED_ROWS.map((r, i) => (i === 3 ? { ...r, token: "zscaler-gone-2026" } : r));
    expect(violations(mutated).some((v) => /does not carry: zscaler-gone-2026/.test(v))).toBe(true);
  });

  it("the guard bites: an accepted row with no read behind it", () => {
    const mutated = SEED_ROWS.map((r, i) => (i === 5 ? { ...r, evidence: "looks right" } : r));
    expect(violations(mutated).some((v) => /no recorded read/.test(v))).toBe(true);
  });

  it("the guard bites: a single-token alias without evidence", () => {
    const mutated = [...SEED_ROWS, { norm: "emerson", cik: null, token: "emerson~wd5~Emerson_College_Staff", relation: "filer", decision: "accepted", evidence: "", decided_by: "x", file: "mutant" } as Row];
    const v = violations(mutated);
    expect(v.some((x) => /single-token alias without evidence: emerson/.test(x))).toBe(true);
    expect(v.some((x) => /accepted and rejected on the same key: n:emerson\|emerson~wd5~Emerson_College_Staff/.test(x))).toBe(true);
  });

  it("the guard bites: a rejected pair flipped to accepted", () => {
    const mutated = SEED_ROWS.map((r) => (r.token === "the-block" ? { ...r, decision: "accepted", evidence: "company_financials 20260722234500 slug block" } : r));
    expect(isRejected(mutated, { cik: 1512673 }, "the-block")).toBe(false);
  });
});

describe("the board-name mirror", () => {
  // the catalogue and the facet map are passed in: vitest cannot host tsx's loader
  const { rows, catalogue, facet, facetSkipped } = mirrorRows({ catalog: CATALOG, employerAliases: EMPLOYER_ALIASES });

  it("emits one row per catalogue entry through the one catalogue reader, plus the second-name rows", () => {
    expect(catalogue).toBe(CATALOG.length);
    expect(rows.length).toBe(CATALOG.length + facet);
    expect(facet).toBeGreaterThan(50);
    expect(facetSkipped).toBeLessThan(10);
  });

  it("carries no duplicate (vendor, token) key -- the mirror's primary key", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const r of rows) {
      const k = `${r.vendor}|${r.company_token}`;
      if (seen.has(k)) dups.push(k);
      seen.add(k);
    }
    expect(dups).toEqual([]);
  });

  it("every second-name row names a catalogued token and a name the catalogue does not already show for it", () => {
    const namesByToken = new Map<string, Set<string>>();
    for (const e of CATALOG) {
      if (!namesByToken.has(e.token)) namesByToken.set(e.token, new Set());
      namesByToken.get(e.token)!.add(e.name);
    }
    for (const r of rows.filter((x) => x.vendor === "facet")) {
      expect(CATALOGUED.has(r.company_token), r.company_token).toBe(true);
      expect(namesByToken.get(r.company_token)!.has(r.display_name), `${r.company_token}: ${r.display_name}`).toBe(false);
    }
  });

  it("the names lane 3 matched exactly are among the second names (Tyson Foods, Wells Fargo, Stanley Black & Decker)", () => {
    const facetNames = new Set(rows.filter((r) => r.vendor === "facet").map((r) => r.display_name));
    for (const n of ["Tyson Foods", "Wells Fargo", "Stanley Black & Decker", "Baker Hughes", "CVS Health"]) {
      expect(facetNames.has(n), n).toBe(true);
    }
  });
});

/**
 * THE QUEUE SPEAKS THE MATCHER'S LANGUAGE.
 *
 * Two things the queue script computes must equal what the other runtime
 * computes, or a tick is a silent miss: the WARN pre-pass (the poller's, in
 * Deno) and the employer key (the matcher's, in SQL). A second copy of the
 * pre-pass once dropped parentheticals before the amendment affix and knew
 * fewer dba forms, so "HGS CX Technologies, Inc. f/k/a HGS USA" normalised two
 * different ways -- an alias_norm the matcher would never see. The employer
 * key once took every token's first '~' segment, which under UKG's shared
 * vendor path made two clients one employer.
 */
describe("the queue speaks the matcher's language", () => {
  const SCRIPT = readFileSync(resolve(__dirname, "../../scripts/layoff-alias-candidates.mjs"), "utf8")
    .replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const RAW_FILERS = [
    "HGS CX Technologies, Inc. f/k/a HGS USA",
    "UPDATE 2 Public Storage",
    "Public Storage Correction to 7/22/26 WARN",
    "Conduent Business Services, LLC (Rescission)",
    "Wise Company LLC dba Wise",
    "Albertson's/Safeway",
    "Trifecta JLS, Inc./Plank",
    "Emerson Electric Co. d/b/a Emerson (Building 4)",
    "Bungie, Inc/Sony Interactive Entertainment",
    "Amended - Owens Corning - Rescinded",
    "Tyson Foods, Inc. a/k/a Tyson",
    "Updated Living LLC",
  ];

  it("the WARN pre-pass is the poller's function, not a copy: identical output on every recorded filer shape, and no second implementation in the script", () => {
    for (const raw of RAW_FILERS) expect(warnPrePass(raw, pollerWarnPrePass), raw).toBe(pollerWarnPrePass(raw));
    expect(warnPrePass("HGS CX Technologies, Inc. f/k/a HGS USA", pollerWarnPrePass)).toBe("HGS CX Technologies, Inc.");
    expect(warnPrePass("Public Storage &amp; Co", pollerWarnPrePass)).toBe(pollerWarnPrePass("Public Storage & Co"));
    // The script's own code (comments stripped) holds no dba / affix regex of its own.
    expect(/\/[^\n/]*(?:dba|rescind|amended|correction)[^\n/]*\/[gimsuy]*/i.exec(SCRIPT)?.[0], "a pre-pass regex of the script's own").toBeUndefined();
    expect(SCRIPT).toMatch(/layoff-filings\/normalize\.ts/);
  });

  it("TEETH: the copy the script used to carry differs from the poller's on a recorded filer", () => {
    const oldCopy = (raw: string) => {
      let x = String(raw).replace(/\([^)]*\)/g, " ");
      x = x.split(/\b(?:dba|d\/b\/a|aka)\b/i)[0];
      x = x.replace(/^\s*(?:update\s*\d*|amended|amendment|correction to|revised)\s*[:\-\u2013]?\s*/i, "");
      x = x.replace(/\s*[-\u2013]\s*(?:rescinded|amended|updated?)\s*$/i, "");
      return x.replace(/\s+/g, " ").trim();
    };
    const differs = RAW_FILERS.filter((raw) => oldCopy(raw) !== pollerWarnPrePass(raw));
    expect(differs).toContain("HGS CX Technologies, Inc. f/k/a HGS USA");
  });

  const MATCHER = readFileSync(resolve(MIGRATIONS, "20260918100400_a_single_word_is_not_an_employer.sql"), "utf8").replace(/--[^\n]*/g, " ");
  const KEY_EXPR = /(CASE WHEN split_part\(b\.company_token[\s\S]*?END) AS employer/.exec(MATCHER)?.[1];

  it("the employer key is the matcher's CASE, run in SQL over the real catalogue's token shapes", async () => {
    expect(KEY_EXPR, "the matcher's employer key expression").toBeDefined();
    const perVendor = new Map<string, string[]>();
    for (const e of CATALOG) {
      const l = perVendor.get(e.source) ?? [];
      if (l.length < 4) { l.push(e.token); perVendor.set(e.source, l); }
    }
    const tokens = [
      ...[...perVendor.values()].flat(),
      "recruiting~SUR1004SRGY~aaaa", "recruiting2~MER1024MERCY~2b13054b", "eu~frontier", "eu~frontier-labs",
      "fedex~wd1~FXE_APAC_External", "eexs~us2~CX_3001", "blockhq", "a232a7a1-770b-48a0-b05a-65d403177066~9201585048116_2",
    ];
    const db = new PGlite();
    try {
      const r = await db.query<{ company_token: string; employer: string }>(
        `SELECT b.company_token, ${KEY_EXPR} AS employer FROM unnest($1::text[]) AS b(company_token)`, [tokens],
      );
      expect(r.rows.length).toBe(tokens.length);
      for (const row of r.rows) expect(employerOf(row.company_token), row.company_token).toBe(row.employer);
      const ukg = r.rows.filter((x) => /^recruiting2?~(SUR1004SRGY|MER1024MERCY)~/.test(x.company_token));
      expect(ukg.map((x) => x.employer)).toEqual(["recruiting~SUR1004SRGY", "recruiting2~MER1024MERCY"]);
      expect(r.rows.find((x) => x.company_token === "eu~frontier-labs")?.employer).toBe("eu~frontier-labs");
      expect(r.rows.find((x) => x.company_token === "fedex~wd1~FXE_APAC_External")?.employer).toBe("fedex");
    } finally {
      await db.close();
    }
  });

  it("TEETH: a first-segment-only key disagrees with the SQL on the UKG and EU tokens", async () => {
    const segmentOnly = (token: string) => token.split("~")[0];
    const db = new PGlite();
    try {
      const r = await db.query<{ company_token: string; employer: string }>(
        `SELECT b.company_token, ${KEY_EXPR} AS employer FROM unnest($1::text[]) AS b(company_token)`,
        [["recruiting2~MER1024MERCY~2b13054b", "eu~frontier", "fedex~wd1~X"]],
      );
      const wrong = r.rows.filter((x) => segmentOnly(x.company_token) !== x.employer).map((x) => x.company_token);
      expect(wrong).toEqual(["recruiting2~MER1024MERCY~2b13054b", "eu~frontier"]);
    } finally {
      await db.close();
    }
  });
});
