// THE CELLS, PACKED INTO THE BUNDLE THAT WILL WRITE THEM.
//
// (No shebang, for the reason scripts/load-oflc-lca.mjs gives: vite hoists an
// import helper above line 1 of a module that uses import(), and a shebang
// there breaks a vitest that imports this file.)
//
// WHY THIS EXISTS. scripts/load-oflc-lca.mjs reads the Department's quarterly
// disclosure file and emits the folded wage cells as JSON. Nothing on this
// machine can then POST them: public.oflc_lca_wages_load is service_role only
// and no service-role key is held here. The mirror lane hit the same wall in
// September and answered it by moving the writer into the deployed function --
// the bundle carries the data, the platform's own service client posts it. The
// same answer, the same contract: chunks under ONE run stamp, the prune on the
// last chunk only.
//
// So this script turns the loader's JSON into a TypeScript module the function
// bundle can import: the rows gzipped and base64'd (2.13 MB of JSON becomes
// about 190 KB of source), plus the provenance constants any surface printing
// one of these figures has to print with it.
//
// WHAT IT REFUSES. Everything the table would refuse, before the bytes are
// ever packed -- the SOC and state spellings, the ordered range, the positive
// floor, the median inside the range, the positive count, the https link --
// and then three agreements the table cannot check: that every row names the
// SAME file, url, quarter and publication date; that the row count and the
// distinct-token count equal the ones the run record holds; and that the
// quarter and publication date equal the run record's. A payload that
// disagrees with its own record is a payload whose label came from somewhere
// other than its data, which is the whole defect class this repository keeps
// writing down (project_stat_provenance).
//
// It writes one file and nothing else. No database, no network, no key.
//
// USAGE
//   node scripts/emit-lca-payload.mjs \
//     --rows /path/to/lca-rows.json \
//     --run  scripts/data/oflc/lca-FY2026Q3-run.txt \
//     --out  supabase/functions/layoff-filings/lca-payload.ts

import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fiscalLabelForSpan, WAGE_PLAUSIBLE_MAX, WAGE_PLAUSIBLE_MIN } from "./load-oflc-lca.mjs";

/** The run record is `key=value` lines plus the loader's own `[load-oflc-lca] k=v ...` summary lines. */
export function parseRunRecord(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("[load-oflc-lca]") ? line.slice("[load-oflc-lca]".length) : line;
    for (const m of body.matchAll(/([a-z0-9_]+)=("[^"]*"|\S+)/gi)) {
      out[m[1]] = m[2].startsWith('"') ? m[2].slice(1, -1) : m[2];
    }
  }
  return out;
}

const SOC = /^[0-9]{2}-[0-9]{4}$/;
const STATE = /^[A-Z]{2}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * Every row the table would take, and the four fields every row must AGREE on.
 * Returns the agreed provenance; throws naming the first row that breaks a rule.
 */
export function checkRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("the rows file holds no array of cells");
  const at = (i, why) => new Error(`row ${i}: ${why}`);
  const keys = new Set();
  let provenance = null;
  rows.forEach((r, i) => {
    const num = (k) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? r[k] : null);
    if (typeof r.company_token !== "string" || r.company_token.trim() === "") throw at(i, "no company_token");
    if (typeof r.soc_code !== "string" || !SOC.test(r.soc_code)) throw at(i, `soc_code ${JSON.stringify(r.soc_code)} is not two digits, a dash and four`);
    if (typeof r.worksite_state !== "string" || !STATE.test(r.worksite_state)) throw at(i, `worksite_state ${JSON.stringify(r.worksite_state)} is not a two-letter upper-case code`);
    if (r.soc_title !== null && typeof r.soc_title !== "string") throw at(i, "soc_title is neither a string nor null");
    const low = num("wage_low_annual"), high = num("wage_high_annual"), med = num("wage_median_annual");
    if (low === null || low <= 0) throw at(i, "wage_low_annual is not a number above zero");
    if (high === null || high < low) throw at(i, "wage_high_annual is below wage_low_annual");
    if (med === null || med < low || med > high) throw at(i, "wage_median_annual is outside the range");
    if (!Number.isInteger(r.filings_n) || r.filings_n < 1) throw at(i, "filings_n is not a count above zero");
    if (typeof r.source_file !== "string" || r.source_file.trim() === "") throw at(i, "no source_file");
    if (typeof r.source_url !== "string" || !r.source_url.startsWith("https://")) throw at(i, "source_url is not https");
    if (low < WAGE_PLAUSIBLE_MIN || high > WAGE_PLAUSIBLE_MAX) {
      throw at(i, `the filed range ${low}-${high} is outside the plausible band ${WAGE_PLAUSIBLE_MIN}-${WAGE_PLAUSIBLE_MAX}`);
    }
    if (typeof r.fiscal_quarter !== "string" || r.fiscal_quarter.trim() === "") throw at(i, "no fiscal_quarter");
    if (typeof r.published_on !== "string" || !DATE.test(r.published_on)) throw at(i, "published_on is not a YYYY-MM-DD date");
    if (typeof r.coverage_from !== "string" || !DATE.test(r.coverage_from)) throw at(i, "coverage_from is not a YYYY-MM-DD date");
    if (typeof r.coverage_to !== "string" || !DATE.test(r.coverage_to)) throw at(i, "coverage_to is not a YYYY-MM-DD date");
    if (r.coverage_from > r.coverage_to) throw at(i, "coverage_from is after coverage_to");
    if (r.fiscal_quarter !== fiscalLabelForSpan(r.coverage_from, r.coverage_to)) {
      throw at(i, `the label ${JSON.stringify(r.fiscal_quarter)} is not the one ${r.coverage_from}..${r.coverage_to} earns (${fiscalLabelForSpan(r.coverage_from, r.coverage_to)})`);
    }
    // The primary key the writer upserts on. A repeated key would make the
    // loaded count depend on the order the chunks arrived in.
    const key = [r.company_token, r.soc_code, r.worksite_state].join("\u0001");
    if (keys.has(key)) throw at(i, `repeats the cell key ${key.replace(/\u0001/g, " / ")}`);
    keys.add(key);
    const p = {
      source_file: r.source_file, source_url: r.source_url, fiscal_quarter: r.fiscal_quarter,
      published_on: r.published_on, coverage_from: r.coverage_from, coverage_to: r.coverage_to,
    };
    if (provenance === null) provenance = p;
    else for (const k of Object.keys(p)) {
      if (p[k] !== provenance[k]) throw at(i, `${k} is ${JSON.stringify(p[k])}; row 0 says ${JSON.stringify(provenance[k])} -- one payload is one quarter of one file`);
    }
  });
  return provenance;
}

/**
 * The rows and the run record have to be talking about the same run.
 *
 * cell_writes is held EQUAL to the sum of filings_n, not merely present. The two counts the loader
 * prints are different quantities -- matched_rows counts applications, cell_writes counts
 * (application, token) pairs, and an employer with two board tokens contributes its application to
 * both -- so a payload whose rows hold more filings than the run recorded writes is a payload built
 * from a different run, and nothing else in this chain would notice.
 */
export function checkAgainstRecord(rows, provenance, record) {
  const tokens = new Set(rows.map((r) => r.company_token)).size;
  const want = {
    cells: rows.length,
    tokens,
    cell_writes: rows.reduce((n, r) => n + r.filings_n, 0),
    quarter: provenance.fiscal_quarter,
    published: provenance.published_on,
    coverage_from: provenance.coverage_from,
    coverage_to: provenance.coverage_to,
    source_file: provenance.source_file,
    source_url: provenance.source_url,
  };
  for (const [k, v] of Object.entries(want)) {
    if (record[k] === undefined) throw new Error(`the run record does not state ${k}`);
    if (String(record[k]) !== String(v)) throw new Error(`the run record says ${k}=${record[k]}; the rows say ${v}`);
  }
  for (const k of ["sha256", "bytes", "certified_by_equality", "matched_rows", "data_rows", "sheet_rows", "wage_outside_plausible_band"]) {
    if (record[k] === undefined) throw new Error(`the run record does not state ${k}`);
  }
  if (!/^[0-9a-f]{64}$/.test(String(record.sha256))) throw new Error(`the run record's sha256 is not 64 hex characters: ${record.sha256}`);
  return { tokens };
}

/** The module text. Generated: the guard that reads it re-derives every constant from the record. */
export function renderPayload({ record, provenance, rows, tokens, base64, gzipBytes, jsonBytes }) {
  const n = (k) => Number(record[k]);
  return `// GENERATED BY scripts/emit-lca-payload.mjs -- DO NOT EDIT BY HAND.
//
// The certified H-1B wage cells this bundle loads, and the provenance any
// surface printing one of their figures must print with it. Regenerate with
//
//   node scripts/emit-lca-payload.mjs --rows <lca-rows.json> \\
//        --run scripts/data/oflc/lca-FY2026Q3-run.txt \\
//        --out supabase/functions/layoff-filings/lca-payload.ts
//
// The rows are ${jsonBytes.toLocaleString("en-US")} bytes of compact JSON, carried here gzipped and
// base64'd (${base64.length.toLocaleString("en-US")} characters) because the raw file does not belong in a
// repository and a function bundle over about 4.5 MB silently serves the
// previous deploy. lca-cells.ts decodes it; nothing else reads this file.
//
// Every number below came from the single loader run recorded in
// scripts/data/oflc/lca-FY2026Q3-run.txt, and a guard holds the two equal.

/** The Department's file these cells were read out of. */
export const LCA_SOURCE_FILE = ${JSON.stringify(provenance.source_file)};
/** Where that file is published. Stored on every row; printed beside every figure. */
export const LCA_SOURCE_URL = ${JSON.stringify(provenance.source_url)};
/** The file's size in bytes, as downloaded. */
export const LCA_SOURCE_BYTES = ${n("bytes")};
/** sha256 of that file, measured over the same download the loader read. */
export const LCA_SOURCE_SHA256 = ${JSON.stringify(String(record.sha256))};
/** The label these cells earn, computed from the decision dates below and never from the file name.
 *  The Department's quarterly file is CUMULATIVE YEAR TO DATE, so its name names about half of it. */
export const LCA_FISCAL_QUARTER = ${JSON.stringify(provenance.fiscal_quarter)};
/** The earliest decision date behind any cell in this payload. */
export const LCA_COVERAGE_FROM = ${JSON.stringify(provenance.coverage_from)};
/** The latest. Every figure here is about applications certified between these two dates. */
export const LCA_COVERAGE_TO = ${JSON.stringify(provenance.coverage_to)};
/** The date the Department published the file. Not in the file; supplied by the operator. */
export const LCA_PUBLISHED_ON = ${JSON.stringify(provenance.published_on)};

/** Applications whose decision EQUALS the certified status. The prefix test would add the withdrawn-after-certification rows. */
export const LCA_CERTIFIED_BY_EQUALITY = ${n("certified_by_equality")};
/** Certified applications whose status merely BEGINS with that word, refused and counted rather than dropped. */
export const LCA_CERTIFIED_PREFIX_REFUSED = ${n("of_which_certified_prefix_refused")};
/** Certified, yearly-filed applications whose employer name resolved to exactly one EMPLOYER. An
 *  employer may own several board tokens, and such an application is written into each of them, so
 *  this is not the number of rows behind the cells -- LCA_CELL_WRITES is. */
export const LCA_MATCHED_ROWS = ${n("matched_rows")};
/** (application, board token) pairs written into the cells: the sum of filings_n across them. */
export const LCA_CELL_WRITES = ${n("cell_writes")};
/** Matched applications held because the wage was not filed by the year; never converted, never counted as missing.
 *  An employer total from these cells is therefore of the yearly-stated subset, and the surface says so. */
export const LCA_HELD_NOT_YEARLY = ${n("wage_not_filed_yearly")};
/** Matched, yearly applications held because a filed figure fell outside the plausible band; transcription errors, never clamped. */
export const LCA_HELD_OUT_OF_BAND = ${n("wage_outside_plausible_band")};
/** Rows of the sheet carrying data. */
export const LCA_DATA_ROWS = ${n("data_rows")};

/** Cells in this payload: one per (board token, SOC code, worksite state). */
export const LCA_CELL_COUNT = ${rows.length};
/** Distinct board tokens across those cells. */
export const LCA_TOKEN_COUNT = ${tokens};
/** Bytes of gzip before base64, so a truncated blob is caught by its length rather than by a parse error. */
export const LCA_GZIP_BYTES = ${gzipBytes};

/** The cells: gzip of the compact JSON array, base64. Decoded by decodeLcaCells() in lca-cells.ts. */
export const LCA_CELLS_GZIP_B64 =
  "${base64}";
`;
}

function arg(name, required = true) {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (required && !v) throw new Error(`--${name} is required`);
  return v;
}

function main() {
  const rowsPath = arg("rows");
  const runPath = arg("run");
  const outPath = arg("out");
  const rows = JSON.parse(readFileSync(rowsPath, "utf8"));
  const record = parseRunRecord(readFileSync(runPath, "utf8"));
  const provenance = checkRows(rows);
  const { tokens } = checkAgainstRecord(rows, provenance, record);
  const json = JSON.stringify(rows);
  const gz = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  const base64 = gz.toString("base64");
  writeFileSync(outPath, renderPayload({
    record, provenance, rows, tokens, base64, gzipBytes: gz.length, jsonBytes: Buffer.byteLength(json, "utf8"),
  }));
  console.error(
    `[emit-lca-payload] cells=${rows.length} tokens=${tokens} quarter="${provenance.fiscal_quarter}" published=${provenance.published_on}` +
    ` json=${Buffer.byteLength(json, "utf8")} gzip=${gz.length} base64=${base64.length} -> ${outPath}`,
  );
}

// Importable for its checks without running: the emitter's rules are the ones
// the Deno guard re-runs over the decoded payload.
if (process.argv[1] && process.argv[1].endsWith("emit-lca-payload.mjs")) main();
