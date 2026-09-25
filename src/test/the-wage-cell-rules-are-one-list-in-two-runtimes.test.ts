// @vitest-environment node
/**
 * THE WAGE-CELL RULES ARE ONE LIST IN TWO RUNTIMES.
 *
 * WHAT THIS GUARDS. Between the Department's file and public.oflc_lca_wages
 * there are exactly two gates, and they are hand-written copies of one rule
 * set in different runtimes: scripts/emit-lca-payload.mjs checks the rows in
 * node before packing them, and lca-cells.ts decodeLcaCells() checks them
 * again in the deploy before a single one is posted. Neither had a test. A
 * regeneration that relaxed one side would leave the other believing it was
 * still enforced -- the defect class this repository already names in
 * the-employer-name-normaliser-is-one-rule-in-two-runtimes.
 *
 * So every mutation below is driven through BOTH gates and must be refused by
 * both. A rule dropped from either copy fails here by name.
 *
 * AND THE PROOF THAT RUNS AFTER THE DEPLOY. scripts/verify-deploy.sh is the
 * only evidence that the cells reached the table. It used to restate the
 * label, the publication date and the source file as shell literals -- figures
 * that go false the day the next file ships, over a load that is correct. The
 * last case here reads that script with its comments stripped and requires it
 * to DERIVE those figures from the payload rather than spell them again.
 *
 * WHY IT IS BEHAVIOURAL. Both gates are imported and run over real rows; the
 * payload is packed with the same gzip the emitter uses. No assertion here
 * reads either file for a spelling.
 */
import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkAgainstRecord, checkRows, parseRunRecord } from "../../scripts/emit-lca-payload.mjs";
import { decodeLcaCells } from "../../supabase/functions/layoff-filings/lca-cells";
import type { LcaCell } from "../../supabase/functions/layoff-filings/lca-cells";
import {
  LCA_CELL_WRITES, LCA_COVERAGE_FROM, LCA_COVERAGE_TO, LCA_FISCAL_QUARTER, LCA_PUBLISHED_ON,
  LCA_SOURCE_FILE, LCA_SOURCE_URL,
} from "../../supabase/functions/layoff-filings/lca-payload";

const ROOT = resolve(__dirname, "../..");

/** A small, valid payload in the shipped one's shape: the deploy gate pins the provenance against
 *  the build's own constants, so rows that are not the build's cannot be used to exercise it. */
function rows(): LcaCell[] {
  const one = (token: string, soc: string, state: string, low: number, n: number): LcaCell => ({
    company_token: token, soc_code: soc, worksite_state: state, soc_title: "Software Developers",
    wage_low_annual: low, wage_high_annual: low + 20000, wage_median_annual: low + 5000, filings_n: n,
    source_file: LCA_SOURCE_FILE, source_url: LCA_SOURCE_URL,
    fiscal_quarter: LCA_FISCAL_QUARTER, published_on: LCA_PUBLISHED_ON,
    coverage_from: LCA_COVERAGE_FROM, coverage_to: LCA_COVERAGE_TO,
  });
  return [
    one("aaa-widgets", "15-1252", "CA", 120000, 12),
    one("bbb-widgets", "15-2051", "NY", 150000, 7),
    one("bbb-widgets", "15-1252", "TX", 110000, 3),
  ];
}

/** The run record those rows agree with, in the shape the loader prints. */
function record(rs: LcaCell[]): string {
  const writes = rs.reduce((n, r) => n + r.filings_n, 0);
  return [
    "# a comment line, ignored",
    `source_file=${LCA_SOURCE_FILE}`,
    `source_url=${LCA_SOURCE_URL}`,
    "bytes=251850891",
    "sha256=f8ca8448a528671f784d3692923775a13741c99caec2816b2fe30c8885bd28b3",
    "[load-oflc-lca] sheet_rows=1032736 data_rows=437496",
    "[load-oflc-lca] certified_by_equality=401412",
    "[load-oflc-lca] held: wage_outside_plausible_band=3",
    `[load-oflc-lca] matched_rows=12851 cell_writes=${writes} tokens=${new Set(rs.map((r) => r.company_token)).size} cells=${rs.length}`,
    `[load-oflc-lca] quarter="${LCA_FISCAL_QUARTER}" coverage_from=${LCA_COVERAGE_FROM} coverage_to=${LCA_COVERAGE_TO} published=${LCA_PUBLISHED_ON}`,
  ].join("\n");
}

/** The deploy's gate, over rows built here: pack them the way the emitter does and decode. */
async function throughDeployGate(rs: LcaCell[]): Promise<LcaCell[]> {
  const gz = gzipSync(Buffer.from(JSON.stringify(rs), "utf8"), { level: 9 });
  return await decodeLcaCells(gz.toString("base64"), {
    gzipBytes: gz.length, cells: rs.length, tokens: new Set(rs.map((r) => r.company_token)).size, cellWrites: null,
  });
}

/** The emitter's gate. */
const throughEmitterGate = (rs: LcaCell[]) => checkRows(rs);

/** One mutation, refused by BOTH gates. The message need only name the field; the two runtimes
 *  word their refusals separately and holding them to one spelling would be a spelling guard. */
async function bothRefuse(mutate: (rs: LcaCell[]) => void, naming: RegExp) {
  const a = rows(); mutate(a);
  expect(() => throughEmitterGate(a), "the emitter accepted it").toThrow(naming);
  const b = rows(); mutate(b);
  await expect(throughDeployGate(b), "the deploy accepted it").rejects.toThrow(naming);
}

describe("both gates refuse the same rows", () => {
  it("accepts the clean set, so every refusal below is the mutation", async () => {
    expect(throughEmitterGate(rows())).toMatchObject({ fiscal_quarter: LCA_FISCAL_QUARTER });
    expect(await throughDeployGate(rows())).toHaveLength(3);
  });

  const cases: Array<[string, (rs: LcaCell[]) => void, RegExp]> = [
    ["a SOC code that is not the six-digit form", (rs) => { rs[0].soc_code = "15-124"; }, /soc_code/],
    ["a worksite state that is not two upper-case letters", (rs) => { rs[1].worksite_state = "California"; }, /worksite_state/],
    ["a range out of order", (rs) => { rs[0].wage_high_annual = rs[0].wage_low_annual - 1; }, /wage_high_annual/],
    ["a median outside the range", (rs) => { rs[2].wage_median_annual = rs[2].wage_high_annual + 1; }, /wage_median_annual/],
    ["a count of no applications", (rs) => { rs[1].filings_n = 0; }, /filings_n/],
    ["a repeated cell key", (rs) => { rs[2] = { ...rs[1] }; }, /repeats the cell key/],
    ["a figure below the plausible band", (rs) => { rs[0].wage_low_annual = 9000; rs[0].wage_median_annual = 9000; }, /plausible band/],
    ["a figure above the plausible band", (rs) => { rs[1].wage_high_annual = 2_000_000; }, /plausible band/],
    ["a coverage date that is not a date", (rs) => { rs[0].coverage_from = "Q3"; }, /coverage_from/],
    ["a span that runs backwards", (rs) => { rs[0].coverage_from = LCA_COVERAGE_TO; rs[0].coverage_to = LCA_COVERAGE_FROM; }, /coverage/],
    ["a row from another file", (rs) => { rs[1].source_file = "LCA_Disclosure_Data_FY2026_Q2.xlsx"; }, /source_file/],
    ["a row from another period", (rs) => { rs[2].fiscal_quarter = "FY2026 Q2"; }, /(fiscal_quarter|label|earns)/],
    ["a publication date that is not a date", (rs) => { rs[0].published_on = "August"; }, /published_on/],
  ];
  for (const [what, mutate, naming] of cases) {
    it(`refuses ${what}`, async () => { await bothRefuse(mutate, naming); });
  }
});

describe("the rows and the run record are held to each other, not merely both present", () => {
  it("reads the loader's own lines, and the last statement of a key wins", () => {
    const r = parseRunRecord(`# ignored\n[load-oflc-lca] data_rows=50000 matched=7\n[load-oflc-lca] data_rows=437496\nquarter="FY2026 Q1-Q3"\n`);
    // The record holds the run's stderr in full, progress lines included: a
    // reader that took the FIRST statement of data_rows would pin a constant to
    // a figure from the middle of the run.
    expect(r.data_rows).toBe("437496");
    expect(r.quarter).toBe("FY2026 Q1-Q3");
  });

  it("passes when the rows and the record are the same run", () => {
    const rs = rows();
    expect(checkAgainstRecord(rs, checkRows(rs), parseRunRecord(record(rs)))).toMatchObject({ tokens: 2 });
  });

  it("TEETH: a record whose write count is not the rows' filings is refused", () => {
    // THE DEFECT. The payload used to carry 12,906 filings while the record
    // stated 12,854 applications, under one label, with nothing comparing them
    // -- because the loader printed the application count and never the write
    // count, and the emitter only checked that a figure was present.
    const rs = rows();
    const rec = parseRunRecord(record(rs).replace(`cell_writes=${LCA_CELL_WRITES}`, "cell_writes=1"));
    rec.cell_writes = String(rs.reduce((n, r) => n + r.filings_n, 0) + 1);
    expect(() => checkAgainstRecord(rs, checkRows(rs), rec)).toThrow(/cell_writes/);
  });

  it("TEETH: a record that does not state the write count, the span or the band at all is refused", () => {
    const rs = rows();
    for (const key of ["cell_writes", "coverage_from", "coverage_to", "wage_outside_plausible_band"]) {
      const rec = parseRunRecord(record(rs));
      delete rec[key];
      expect(() => checkAgainstRecord(rs, checkRows(rs), rec), `${key} is not required`).toThrow(new RegExp(key));
    }
  });

  it("TEETH: a record labelling a different period than the rows carry is refused", () => {
    const rs = rows();
    const rec = parseRunRecord(record(rs));
    rec.quarter = "FY2026 Q3";
    expect(() => checkAgainstRecord(rs, checkRows(rs), rec)).toThrow(/quarter/);
  });
});

describe("the post-deploy proof reads the payload it is proving", () => {
  /** Shell comments, cut the way the shared stripper cuts // and -- for the other two dialects:
   *  a literal written in a comment satisfies a guard while the code says something else. */
  const shellCodeOf = (src: string) => src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const SCRIPT = shellCodeOf(readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8"));

  it("derives the label, the file, the dates and the counts instead of restating them", () => {
    expect(SCRIPT, "the proof no longer reads the payload").toContain("supabase/functions/layoff-filings/lca-payload.ts");
    for (const name of [
      "LCA_FISCAL_QUARTER", "LCA_SOURCE_FILE", "LCA_PUBLISHED_ON",
      "LCA_COVERAGE_FROM", "LCA_COVERAGE_TO", "LCA_CELL_COUNT", "LCA_TOKEN_COUNT", "LCA_CELL_WRITES",
    ]) {
      expect(SCRIPT, `${name} is not read out of the payload`).toContain(name);
    }
  });

  it("spells none of those figures itself, so the next file cannot make it cry wolf", () => {
    // Each of these goes false the day the next quarterly file ships, over a
    // load that is correct -- and an operator who has seen the proof cry wolf
    // stops reading the one section that says whether the cells are there.
    for (const literal of [LCA_FISCAL_QUARTER, LCA_SOURCE_FILE, LCA_PUBLISHED_ON, LCA_COVERAGE_FROM, LCA_COVERAGE_TO]) {
      expect(SCRIPT, `the proof restates ${literal} rather than reading it`).not.toContain(literal);
    }
    expect(SCRIPT).not.toMatch(/\b5534\b|\b1442\b|\b12903\b/);
  });

  it("asserts the whole load, not one token", () => {
    expect(SCRIPT, "the load state is never asked for").toContain("get_lca_load_state");
    expect(SCRIPT, "the number of resident periods is never checked").toContain("ls_periods");
  });
});
