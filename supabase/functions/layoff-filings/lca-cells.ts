// THE WAGE CELLS THE BUNDLE CARRIES, AND THE ONLY SHAPE IN WHICH THEY MAY BE POSTED.
//
// WHY THE DATA IS IN THE DEPLOY. public.oflc_lca_wages_load is granted to
// service_role and to nothing else -- deliberately, because a caller who could
// write these cells could put any figure under any employer's name -- and no
// service-role key exists outside the platform. The operator loader
// (scripts/load-oflc-lca.mjs) can therefore produce the rows and post none of
// them. The mirror lane met exactly this wall in September and answered it by
// moving the writer into the deployed function: the bundle carries the data,
// the platform's own service client posts it, through the same definer, in
// chunks, with a prune of what the run did not see. This is that answer again,
// for one file of the Department's certified LCA disclosures.
//
// WHAT A CELL IS. One (board token, SOC occupation, worksite state) with the
// range of wages the employer FILED for the applications the Department
// CERTIFIED between two measured dates -- never what the employer pays, never
// a salary for a posting on this board. The period is MEASURED, from the
// decision dates of the applications folded in, because the Department's
// "quarterly" file is cumulative year to date and its name names about half of
// what is inside it. That is why every row carries the file it was read from,
// that file's publication date and the span it covers, and why lca-payload.ts
// pins the digest, the label, the coverage dates and the counts as constants
// rather than leaving them to whoever writes the copy later.
//
// THE CONTRACT THIS MODULE EXISTS TO MAKE UNBREAKABLE, spelled out in
// migration 20260925150412: every chunk of one run carries ONE run stamp, only
// the LAST chunk asks for the swap, and no chunk before it touches the live
// table at all -- the rows are staged under the run stamp and the live period
// is replaced from the stage in one statement on the last call. That is what
// makes an interrupted run safe. The version this replaced upserted every
// chunk straight into the live table, so a failure at chunk four of six left
// 3,000 cells of the new period beside 2,500 of the old one, and the reader --
// which scopes to the newest publication date resident -- served the mixture
// as a complete period with every straddling employer's total understated. The
// stamp still has no default for the same reason as before: the swap keeps
// only the rows carrying the stamp it is handed, so a per-chunk clock would
// swap in the last chunk alone. planLcaChunks() is a pure function that builds
// the whole call sequence up front, postLcaChunks() posts exactly that
// sequence and stops at the first chunk that fails, and both are exercised by
// lca_test.ts against a recording client rather than by reading the source for
// a spelling -- while the SQL half of the property is exercised against a real
// Postgres by
// src/test/a-half-written-period-is-never-the-one-the-reader-serves.test.ts.
//
// A RUN WITH NO ROWS IS REFUSED, not posted. An empty array with p_prune would
// be a well-formed request to swap an empty stage over the live period.

import {
  LCA_CELLS_GZIP_B64, LCA_CELL_COUNT, LCA_CELL_WRITES, LCA_COVERAGE_FROM, LCA_COVERAGE_TO,
  LCA_FISCAL_QUARTER, LCA_GZIP_BYTES, LCA_PUBLISHED_ON, LCA_SOURCE_FILE, LCA_SOURCE_URL,
  LCA_TOKEN_COUNT,
} from "./lca-payload.ts";

/**
 * The band a filed annual figure has to land in, restated here because this is the last gate before
 * the rows are posted.
 *
 * The loader already refuses a figure outside it, but the loader runs on an operator's machine and
 * this module runs in the deploy: a hand-edited payload, or a payload built by a loader whose band
 * was widened, must not be able to smuggle a transcription error into a public sentence. Measured
 * on the FY2026 file: three certified, matched, yearly applications state figures with an extra
 * digit (one of 10,798,445 dollars, one of 17,448,664), and one bad row sets a cell's ceiling.
 */
export const LCA_WAGE_PLAUSIBLE_MIN = 15_000;
export const LCA_WAGE_PLAUSIBLE_MAX = 1_500_000;

/** One row of public.oflc_lca_wages, exactly as the writer's jsonb reader names its keys. */
export interface LcaCell {
  company_token: string;
  soc_code: string;
  worksite_state: string;
  soc_title: string | null;
  wage_low_annual: number;
  wage_high_annual: number;
  wage_median_annual: number;
  filings_n: number;
  source_file: string;
  source_url: string;
  fiscal_quarter: string;
  published_on: string;
  coverage_from: string;
  coverage_to: string;
}

/** One call to public.oflc_lca_wages_load, named as PostgREST takes it. */
export interface LcaChunkCall {
  p_rows: LcaCell[];
  p_run_started_at: string;
  p_prune: boolean;
}

export interface LcaLoadTally {
  chunks: number;
  chunksDone: number;
  upserted: number;
  pruned: number;
  total: number;
  tokens: number;
}

/** A tally at the start of a run: every field zero except the number of chunks the plan holds. */
export function newLcaTally(chunks: number): LcaLoadTally {
  return { chunks, chunksDone: 0, upserted: 0, pruned: 0, total: 0, tokens: 0 };
}

/**
 * Rows per call. The payload is about 460 bytes of JSON per cell, so a thousand
 * rows is a ~460 KB request -- well inside what PostgREST takes, and six calls
 * rather than one long one, which is the point: an interrupted run must be able
 * to stop between chunks without having touched the live table. The cell count
 * itself is a constant of the payload and is not restated here.
 */
export const LCA_CHUNK_ROWS = 1000;

const SOC = /^[0-9]{2}-[0-9]{4}$/;
const STATE = /^[A-Z]{2}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * The bytes behind a base64 string, without pulling in a codec.
 *
 * The buffer is allocated explicitly rather than by `new Uint8Array(n)` and the
 * return type is left to inference: a plain `Uint8Array` is `ArrayBufferLike`
 * to this TypeScript, which a Blob will not take.
 */
function bytesOfBase64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The size and coverage the build recorded for the payload, against which a decode is checked.
 *  cellWrites is the sum of filings_n the run recorded writing -- null in a test that builds its
 *  own rows and has no such figure to hold them to. */
export interface LcaExpectation {
  gzipBytes: number;
  cells: number;
  tokens: number;
  cellWrites: number | null;
}

/** What the shipped payload must be. The default for every real call; a test supplies its own for a mutated blob. */
export const LCA_EXPECTED: LcaExpectation = {
  gzipBytes: LCA_GZIP_BYTES, cells: LCA_CELL_COUNT, tokens: LCA_TOKEN_COUNT, cellWrites: LCA_CELL_WRITES,
};

/**
 * The embedded cells, decompressed and checked.
 *
 * Every rule the table would enforce is checked HERE, before a single row is
 * posted, so a defective payload fails as one sentence naming the row rather
 * than as a constraint violation half way through a chunked load. On top of those: the row count, the
 * distinct-token count and the four provenance fields must equal the constants
 * the payload pins, which are the ones a surface citing this data prints.
 *
 * The two parameters are a test seam and are never passed in the deploy: the
 * per-row rules have to be exercisable against a deliberately broken blob, and
 * a broken blob is a different number of bytes. Every shipped call takes the
 * pinned payload and the pinned expectation.
 */
export async function decodeLcaCells(
  b64: string = LCA_CELLS_GZIP_B64,
  expected: LcaExpectation = LCA_EXPECTED,
): Promise<LcaCell[]> {
  const gz = bytesOfBase64(b64);
  if (gz.length !== expected.gzipBytes) {
    throw new Error(`the embedded payload is ${gz.length} bytes of gzip; the build recorded ${expected.gzipBytes}`);
  }
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  const rows = JSON.parse(text) as LcaCell[];
  if (!Array.isArray(rows)) throw new Error("the embedded payload did not decode to an array of cells");

  const keys = new Set<string>();
  const tokens = new Set<string>();
  rows.forEach((r, i) => {
    const at = (why: string) => new Error(`embedded cell ${i}: ${why}`);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    if (typeof r?.company_token !== "string" || r.company_token.trim() === "") throw at("no company_token");
    if (typeof r.soc_code !== "string" || !SOC.test(r.soc_code)) throw at(`soc_code ${JSON.stringify(r.soc_code)} is not two digits, a dash and four`);
    if (typeof r.worksite_state !== "string" || !STATE.test(r.worksite_state)) throw at(`worksite_state ${JSON.stringify(r.worksite_state)} is not a two-letter upper-case code`);
    if (r.soc_title !== null && typeof r.soc_title !== "string") throw at("soc_title is neither a string nor null");
    const low = num(r.wage_low_annual), high = num(r.wage_high_annual), med = num(r.wage_median_annual);
    if (low === null || low <= 0) throw at("wage_low_annual is not a number above zero");
    if (high === null || high < low) throw at("wage_high_annual is below wage_low_annual");
    if (med === null || med < low || med > high) throw at("wage_median_annual is outside the range");
    if (low < LCA_WAGE_PLAUSIBLE_MIN || high > LCA_WAGE_PLAUSIBLE_MAX) {
      throw at(`the filed range ${low}-${high} is outside the plausible band ${LCA_WAGE_PLAUSIBLE_MIN}-${LCA_WAGE_PLAUSIBLE_MAX}`);
    }
    if (!Number.isInteger(r.filings_n) || r.filings_n < 1) throw at("filings_n is not a count above zero");
    if (r.source_file !== LCA_SOURCE_FILE) throw at(`source_file ${JSON.stringify(r.source_file)} is not the file this build pins`);
    if (r.source_url !== LCA_SOURCE_URL) throw at(`source_url ${JSON.stringify(r.source_url)} is not the url this build pins`);
    if (r.fiscal_quarter !== LCA_FISCAL_QUARTER) throw at(`fiscal_quarter ${JSON.stringify(r.fiscal_quarter)} is not the label this build pins`);
    if (typeof r.published_on !== "string" || !DATE.test(r.published_on)) throw at("published_on is not a YYYY-MM-DD date");
    if (r.published_on !== LCA_PUBLISHED_ON) throw at(`published_on ${JSON.stringify(r.published_on)} is not the date this build pins`);
    if (typeof r.coverage_from !== "string" || !DATE.test(r.coverage_from)) throw at("coverage_from is not a YYYY-MM-DD date");
    if (typeof r.coverage_to !== "string" || !DATE.test(r.coverage_to)) throw at("coverage_to is not a YYYY-MM-DD date");
    if (r.coverage_from !== LCA_COVERAGE_FROM) throw at(`coverage_from ${JSON.stringify(r.coverage_from)} is not the date this build pins`);
    if (r.coverage_to !== LCA_COVERAGE_TO) throw at(`coverage_to ${JSON.stringify(r.coverage_to)} is not the date this build pins`);
    const key = `${r.company_token}\u0001${r.soc_code}\u0001${r.worksite_state}`;
    if (keys.has(key)) throw at(`repeats the cell key ${r.company_token} / ${r.soc_code} / ${r.worksite_state}`);
    keys.add(key);
    tokens.add(r.company_token);
  });
  if (rows.length !== expected.cells) throw new Error(`the embedded payload holds ${rows.length} cells; the build recorded ${expected.cells}`);
  if (tokens.size !== expected.tokens) throw new Error(`the embedded payload covers ${tokens.size} tokens; the build recorded ${expected.tokens}`);
  if (expected.cellWrites !== null) {
    const writes = rows.reduce((n, r) => n + r.filings_n, 0);
    if (writes !== expected.cellWrites) {
      throw new Error(`the embedded payload holds ${writes} filings across its cells; the build recorded ${expected.cellWrites} writes`);
    }
  }
  return rows;
}

/**
 * The whole call sequence for ONE run, built before any of it is sent.
 *
 * One stamp across every call and p_prune on the last call only. Building the
 * sequence up front rather than deciding per iteration is what makes the
 * property testable: the test reads the calls, not the loop.
 */
export function planLcaChunks(rows: LcaCell[], runStartedAt: string, chunkSize: number = LCA_CHUNK_ROWS): LcaChunkCall[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("a run with no cells is refused: an empty load that swapped would replace the live period with nothing");
  }
  if (typeof runStartedAt !== "string" || !runStartedAt.trim()) {
    throw new Error("a run needs one stamp every chunk shares; without it the pruning chunk would delete the run's own earlier chunks");
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error(`chunk size ${chunkSize} is not a positive whole number of rows`);
  const calls: LcaChunkCall[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    calls.push({ p_rows: rows.slice(i, i + chunkSize), p_run_started_at: runStartedAt, p_prune: false });
  }
  calls[calls.length - 1].p_prune = true;
  return calls;
}

/** The subset of the service client this module uses; kept narrow so a test can pass a recorder. */
export interface LcaRpcClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: any; error: { message: string } | null }>;
}

/**
 * Post the planned calls in order, stopping at the first that fails.
 *
 * WHAT STOPPING BUYS, EXACTLY. Every call but the last only STAGES its rows;
 * the last call stages its own and then replaces the live table from the stage
 * in one transaction. So a chunk that errors leaves the live period whole --
 * untouched, not merely unpruned -- and leaves this run's rows in the staging
 * table under a stamp the next run's swap clears. The caller reports ok=false
 * and the operator runs it again. This is the property migration
 * 20260925150412 exists to provide; before it, each chunk upserted into the
 * live table on arrival and a failure left half of one period and half of
 * another, served as though it were whole.
 *
 * THE TALLY IS THE CALLER'S, AND IT IS MUTATED IN PLACE. A tally built here and
 * returned is a tally thrown away on the failure path, which is the one path
 * where knowing how far the run got matters -- the read-log row is the only
 * durable record of what state the load is in. The mirror lane keeps its tally
 * in the caller for this reason, and this follows it.
 */
export async function postLcaChunks(client: LcaRpcClient, plan: LcaChunkCall[], tally?: LcaLoadTally): Promise<LcaLoadTally> {
  const t: LcaLoadTally = tally ?? newLcaTally(plan.length);
  t.chunks = plan.length;
  for (let i = 0; i < plan.length; i++) {
    const { data, error } = await client.rpc("oflc_lca_wages_load", plan[i] as unknown as Record<string, unknown>);
    if (error) throw new Error(`oflc_lca_wages_load chunk ${i + 1}/${plan.length}: ${error.message}`);
    const r = Array.isArray(data) ? data[0] : data;
    t.chunksDone += 1;
    t.upserted += Number(r?.lo_upserted ?? 0);
    t.pruned = Number(r?.lo_pruned ?? 0);
    t.total = Number(r?.lo_total ?? 0);
    t.tokens = Number(r?.lo_tokens ?? 0);
  }
  return t;
}
