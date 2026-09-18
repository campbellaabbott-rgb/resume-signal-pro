/**
 * AN ACCEPTED ALIAS NAMES A BOARD THE CATALOGUE CARRIES.
 *
 * The alias table is the only door by which a single-token, ambiguous or
 * CIK-keyed filer reaches a board (SPEC section 5, rule 1). An accepted row
 * whose company_token is not in the catalogue is a door to nowhere -- the
 * matcher would write a layoff_matches row for a token no card ever asks
 * about, the candidate queue would consider the filer handled, and the
 * employer the owner meant would stay unmatched. The mirror table
 * (layoff_board_names) does not catch this: it is pruned to the catalogue,
 * but the alias table is kept forever and is not.
 *
 * So every accepted alias in every seed migration is checked against
 * JOB_SOURCES, IMPORTED through tsx -- never grepped from the compact
 * encoding (the rule since the five "missing tokens" that were prose). A
 * rejected row may name any token: a refusal of a pair that no longer exists
 * is harmless and still documents what was read.
 *
 * Teeth: the parser is run on a doctored copy with one token misspelled and
 * must name it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";

const DIR = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const stripSql = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

type AliasRow = { alias_norm: string | null; cik: number | null; company_token: string; decision: string; file: string };

/**
 * Every VALUES row of an INSERT INTO public.layoff_employer_aliases whose
 * column list is the spec's (alias_norm, cik, company_token, relation,
 * state_scope, decision, evidence, decided_by). Read off comment-stripped
 * code; a row quoted in a comment is not a row.
 */
export function aliasRowsOf(sql: string, file = "?"): AliasRow[] {
  const code = stripSql(sql);
  const out: AliasRow[] = [];
  // The block ends at ON CONFLICT or at a `);` that closes a line -- a `;`
  // inside an evidence string ("...tenant is); shares the slug...") must not.
  const re = /INSERT INTO public\.layoff_employer_aliases\s*\(alias_norm, cik, company_token, relation, state_scope, decision, evidence, decided_by\)\s*VALUES([\s\S]*?)(?:\n\s*ON CONFLICT[\s\S]*?;|\)\s*;\s*$)/gm;
  for (const block of code.matchAll(re)) {
    const rowRe = /\(\s*(NULL|'(?:[^']|'')*')\s*,\s*(NULL|\d+)\s*,\s*'((?:[^']|'')*)'\s*,\s*'(\w+)'\s*,\s*(NULL|ARRAY\[[^\]]*\](?:::[\w()\[\]]+)?|'\{[^}]*\}'(?:::[\w()\[\]]+)?)\s*,\s*'(accepted|rejected)'/g;
    for (const r of block[1].matchAll(rowRe)) {
      out.push({
        alias_norm: r[1] === "NULL" ? null : r[1].slice(1, -1).replace(/''/g, "'"),
        cik: r[2] === "NULL" ? null : Number(r[2]),
        company_token: r[3].replace(/''/g, "'"),
        decision: r[6],
        file,
      });
    }
  }
  return out;
}

const CATALOGUE = new Set(JOB_SOURCES.map((s) => s.token));
const SEEDS = files.filter((f) => /INSERT INTO public\.layoff_employer_aliases/.test(stripSql(read(f))));
const ROWS = SEEDS.flatMap((f) => aliasRowsOf(read(f), f));

describe("an accepted alias names a board the catalogue carries", () => {
  it("found the catalogue and at least one seed migration with rows (guards the guard)", () => {
    expect(CATALOGUE.size).toBeGreaterThan(40_000);
    expect(SEEDS.length, "no migration seeds layoff_employer_aliases -- lane C's batch has not landed or the column list changed").toBeGreaterThanOrEqual(1);
    expect(ROWS.length, `the seed migration(s) ${SEEDS.join(", ")} yielded no parseable rows -- RE-ANCHOR the row regex`).toBeGreaterThan(0);
    expect(ROWS.filter((r) => r.decision === "accepted").length).toBeGreaterThan(0);
    // Every decision literal in the seed code is a row the parser read: a row
    // shape the regex misses would otherwise be a silent exemption.
    const rowLines = SEEDS.reduce((n, f) => n + (stripSql(read(f)).match(/^\s*\(.*'(?:accepted|rejected)'/gm)?.length ?? 0), 0);
    expect(ROWS.length, "rows parsed vs row lines carrying a decision").toBe(rowLines);
  });

  it("every accepted alias token is in JOB_SOURCES (imported, never grepped)", () => {
    const strays = ROWS.filter((r) => r.decision === "accepted" && !CATALOGUE.has(r.company_token));
    expect(strays.map((r) => `${r.file}: ${r.company_token}`), "accepted aliases pointing at tokens the catalogue does not carry").toEqual([]);
  });

  it("every row carries exactly one key and the seven verified wrong pairs are REJECTED rows, never accepted", () => {
    for (const r of ROWS) expect(r.alias_norm !== null || r.cik !== null, `${r.file}: a row with neither alias_norm nor cik`).toBe(true);
    const accepted = ROWS.filter((r) => r.decision === "accepted");
    const wrongTokens = ["emerson~wd5~Emerson_College_Staff", "wise", "mosaic", "benchmark~wd1~PGH_Careers", "block-llp", "the-block", "eu~frontier", "fmc~wd12~FMC"];
    for (const t of wrongTokens) {
      expect(accepted.some((r) => r.company_token === t), `${t} is an ACCEPTED alias -- lane 3 verified this pair wrong`).toBe(false);
    }
    // No accepted alias is keyed on a bare single-token WARN name that the
    // matcher would otherwise refuse, unless a person ticked it: every such
    // row must carry evidence beyond the company_financials batch.
    const bare = accepted.filter((r) => r.alias_norm !== null && !r.alias_norm.includes(" "));
    for (const r of bare) expect(r.cik === null, `${r.file}: ${r.alias_norm} -> ${r.company_token} is single-token and cik-keyed at once`).toBe(true);
  });

  it("a rejected pair is a row, not a comment (batch 5's rejections lived in a comment and could not be read)", () => {
    expect(ROWS.filter((r) => r.decision === "rejected").length).toBeGreaterThan(0);
  });
});

describe("the check has teeth", () => {
  /** A real catalogue token for the name-keyed row, so only the misspelling is a stray. */
  const REAL = JOB_SOURCES.find((s) => s.token.includes("~"))?.token ?? JOB_SOURCES[0].token;
  const FIXTURE = `
    INSERT INTO public.layoff_employer_aliases (alias_norm, cik, company_token, relation, state_scope, decision, evidence, decided_by)
    VALUES
      (NULL, 1551152, 'AbbVie', 'filer', NULL, 'accepted', 'company_financials 20260722234500 slug AbbVie (AbbVie Inc.)', 'seed'),
      ('wells fargo', NULL, '${REAL}', 'filer', ARRAY['IA','CA']::char(2)[], 'accepted', 'three titles read: Teller, Branch Manager, Financial Advisor', 'owner'),
      ('emerson', NULL, 'emerson~wd5~Emerson_College_Staff', 'filer', NULL, 'rejected', 'a college', 'lane3');
  `;

  it("parses accepted and rejected rows, both key shapes, and a state_scope array", () => {
    const rows = aliasRowsOf(FIXTURE, "fixture");
    expect(rows.map((r) => [r.company_token, r.decision, r.cik, r.alias_norm])).toEqual([
      ["AbbVie", "accepted", 1551152, null],
      [REAL, "accepted", null, "wells fargo"],
      ["emerson~wd5~Emerson_College_Staff", "rejected", null, "emerson"],
    ]);
  });

  it("names a misspelled accepted token; ignores the same token on a rejected row; ignores a row quoted in a comment", () => {
    const rows = aliasRowsOf(FIXTURE.replace("'AbbVie'", "'AbbVie-typo'"), "fixture");
    const strays = rows.filter((r) => r.decision === "accepted" && !CATALOGUE.has(r.company_token)).map((r) => r.company_token);
    expect(strays).toEqual(["AbbVie-typo"]);
    expect(rows.filter((r) => r.decision === "rejected" && !CATALOGUE.has(r.company_token)).length).toBeGreaterThanOrEqual(0);
    const commented = FIXTURE.replace("(NULL, 1551152, 'AbbVie',", "-- (NULL, 1551152, 'AbbVie-typo', 'filer', NULL, 'accepted', 'x', 'y'),\n      (NULL, 1551152, 'AbbVie',");
    expect(aliasRowsOf(commented).map((r) => r.company_token)).not.toContain("AbbVie-typo");
  });

  it("the real catalogue carries the fixture's accepted tokens, so the fixture is not vacuous", () => {
    expect(CATALOGUE.has("AbbVie")).toBe(true);
  });
});
