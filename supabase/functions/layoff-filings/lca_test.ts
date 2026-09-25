// THE QUARTER THE BUNDLE CARRIES, AND THE ONE WAY IT MAY BE WRITTEN.
//
// WHAT THESE GUARD. The certified H-1B wage cells ship inside this function's
// bundle because their writer is service_role only and no service-role key
// exists outside the platform. That makes four things worth holding:
//
//   1. the payload is the quarter the build says it is -- the right number of
//      cells over the right number of employers, every row in the shape the
//      table would take, no null where a value is required;
//   2. the provenance constants equal the recorded loader run, because they are
//      what every surface printing one of these figures has to print beside it,
//      and a constant edited by hand is a figure with a label from nowhere;
//   3. one run carries ONE stamp and prunes on the LAST chunk only, which is
//      the contract migration 20260923114719 exists to state: the writer's
//      sweep deletes every row loaded before the stamp it is handed, so a
//      per-chunk stamp would have the pruning chunk delete the run's own
//      earlier chunks and leave a quarter of thousands of cells holding the
//      last few hundred, every employer figure read off it silently wrong
//      rather than absent;
//   4. a chunk that fails stops the run BEFORE the swap, and -- with the
//      staged writer of migration 20260925150412 behind it -- leaves the
//      resident period untouched rather than half replaced. What this file can
//      prove is the client half: the run stops, and no call carrying the swap
//      flag is ever sent after a failure. The SQL half, that the rows already
//      posted cannot be served, is proved against a real Postgres by
//      src/test/a-half-written-period-is-never-the-one-the-reader-serves.test.ts,
//      because it is a property of the writer and not of this module;
//   5. a run that dies half way still REPORTS how far it got. The tally is the
//      caller's and is mutated as the chunks land, so the read-log row -- the
//      only durable record of what state the period is in -- says chunks=2/6
//      and not chunks=0/6 with nothing written.
//
// WHY THEY ARE BEHAVIOURAL. The cells are decoded for real, the plan is the
// array of calls that will actually be posted, and the posting loop runs
// against a recording client that can be told to fail on a chosen chunk. A
// regex over index.ts would pass on a loop rewritten the day after. Only the
// wiring that cannot be imported -- the entry point serves on import -- is read
// from the source, with comments stripped, the way index_test.ts and
// mirror_test.ts read it.
//
// NOTHING HERE TOUCHES THE DEPARTMENT'S FILE. It is 250 MB and a test that
// downloads it is a test that fails on an aeroplane; the digest and byte count
// are facts recorded once, in scripts/data/oflc/lca-FY2026Q3-run.txt, and
// checked against the shipped constants.
//
// Run: deno test --config supabase/functions/deno.json --allow-read supabase/functions/layoff-filings/lca_test.ts

import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decodeLcaCells, LCA_CHUNK_ROWS, LCA_EXPECTED, LCA_WAGE_PLAUSIBLE_MAX, LCA_WAGE_PLAUSIBLE_MIN,
  newLcaTally, planLcaChunks, postLcaChunks,
} from "./lca-cells.ts";
import type { LcaCell, LcaChunkCall, LcaRpcClient } from "./lca-cells.ts";
import {
  LCA_CELL_COUNT, LCA_CELL_WRITES, LCA_CERTIFIED_BY_EQUALITY, LCA_CERTIFIED_PREFIX_REFUSED,
  LCA_COVERAGE_FROM, LCA_COVERAGE_TO, LCA_DATA_ROWS, LCA_FISCAL_QUARTER, LCA_HELD_NOT_YEARLY,
  LCA_HELD_OUT_OF_BAND, LCA_MATCHED_ROWS, LCA_PUBLISHED_ON, LCA_SOURCE_BYTES, LCA_SOURCE_FILE,
  LCA_SOURCE_SHA256, LCA_SOURCE_URL, LCA_TOKEN_COUNT,
} from "./lca-payload.ts";

/**
 * The US federal fiscal label for a span, written HERE as the check and never imported.
 *
 * The loader computes the label the cells carry from the decision dates it measured. Re-deriving it
 * in the guard is the whole point: it is the only way to catch a label that was typed, or taken
 * from a file name, rather than measured. The Department's "quarterly" file is cumulative year to
 * date, which is how "FY2026 Q3" came to be printed over nine months of certifications.
 */
function fiscalLabelForSpan(from: string, to: string): string {
  const at = (d: string) => {
    const [y, m] = d.split("-").map(Number);
    return { fy: m >= 10 ? y + 1 : y, q: Math.floor(((m + 2) % 12) / 3) + 1 };
  };
  const a = at(from), b = at(to);
  if (a.fy !== b.fy) return `FY${a.fy} Q${a.q}-FY${b.fy} Q${b.q}`;
  return a.q === b.q ? `FY${a.fy} Q${a.q}` : `FY${a.fy} Q${a.q}-Q${b.q}`;
}

const REPO = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const RAW = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/^\s*\/\/.*$/gm, "");

/** The one loader run these cells came from. */
const RUN_RECORD = Deno.readTextFileSync(`${REPO}/scripts/data/oflc/lca-FY2026Q3-run.txt`);

/**
 * `key=value` out of the run record, quotes stripped, comment lines ignored.
 *
 * THE LAST STATEMENT OF A KEY WINS, which is the emitter's rule too (scripts/
 * emit-lca-payload.mjs overwrites as it reads). The record holds the run's
 * stderr in full, and the loader prints a progress line every fifty thousand
 * rows before the summary -- so a first-match reader would hold the constants
 * against a figure from the middle of the run.
 */
function recorded(key: string): string {
  const body = RUN_RECORD.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  const all = [...body.matchAll(new RegExp(`(?:^|\\s)${key}=("[^"]*"|\\S+)`, "g"))];
  if (all.length === 0) throw new Error(`the run record does not state ${key}`);
  const v = all[all.length - 1][1];
  return v.startsWith('"') ? v.slice(1, -1) : v;
}

/** A payload of our own making, in the shape the shipped one has, so the row rules can be broken on purpose. */
async function payloadOf(rows: LcaCell[]): Promise<{ b64: string; gzipBytes: number }> {
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  const gz = new Uint8Array(
    await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
  );
  let bin = "";
  for (const b of gz) bin += String.fromCharCode(b);
  return { b64: btoa(bin), gzipBytes: gz.length };
}

/** Decode a payload built here, with its own size and coverage rather than the shipped build's. */
async function decodeOwn(rows: LcaCell[]): Promise<LcaCell[]> {
  const { b64, gzipBytes } = await payloadOf(rows);
  return await decodeLcaCells(b64, {
    gzipBytes, cells: rows.length, tokens: new Set(rows.map((r) => r.company_token)).size, cellWrites: null,
  });
}

const CELLS: LcaCell[] = await decodeLcaCells();

/** A deep copy, so a mutation in one test cannot reach another. */
const copy = (rows: LcaCell[]): LcaCell[] => JSON.parse(JSON.stringify(rows));

/** A client that records every call, and can be told to answer a chosen call with an error. */
function recorder(failOn: number | null = null): LcaRpcClient & { calls: Array<{ fn: string; args: LcaChunkCall }> } {
  const calls: Array<{ fn: string; args: LcaChunkCall }> = [];
  let total = 0;
  return {
    calls,
    // deno-lint-ignore require-await
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args: args as unknown as LcaChunkCall });
      if (failOn !== null && calls.length === failOn) return { data: null, error: { message: "canceling statement due to statement timeout" } };
      const n = (args.p_rows as LcaCell[]).length;
      total += n;
      return { data: [{ lo_upserted: n, lo_pruned: args.p_prune ? 3 : 0, lo_total: total, lo_tokens: 7 }], error: null };
    },
  };
}

Deno.test("the embedded payload decompresses to exactly the quarter the build recorded, every row in the shape the table takes", async () => {
  assertEquals(CELLS.length, LCA_CELL_COUNT);
  assertEquals(CELLS.length, 5534);
  assertEquals(new Set(CELLS.map((r) => r.company_token)).size, LCA_TOKEN_COUNT);
  assertEquals(new Set(CELLS.map((r) => r.company_token)).size, 1442);
  // Required fields: present, typed, and never null. soc_title is the one
  // column the table lets be null, so it is checked for type and not presence.
  for (const r of CELLS) {
    for (const k of ["company_token", "soc_code", "worksite_state", "source_file", "source_url", "fiscal_quarter", "published_on"] as const) {
      assert(typeof r[k] === "string" && r[k].trim() !== "", `${k} is empty on ${JSON.stringify(r).slice(0, 120)}`);
    }
    for (const k of ["wage_low_annual", "wage_high_annual", "wage_median_annual", "filings_n"] as const) {
      assert(typeof r[k] === "number" && Number.isFinite(r[k]), `${k} is not a number on ${r.company_token}`);
    }
    assert(r.soc_title === null || typeof r.soc_title === "string");
    assert(/^[0-9]{2}-[0-9]{4}$/.test(r.soc_code), r.soc_code);
    assert(/^[A-Z]{2}$/.test(r.worksite_state), r.worksite_state);
    assert(r.wage_low_annual > 0 && r.wage_high_annual >= r.wage_low_annual, r.company_token);
    assert(r.wage_median_annual >= r.wage_low_annual && r.wage_median_annual <= r.wage_high_annual, r.company_token);
    assert(Number.isInteger(r.filings_n) && r.filings_n > 0, r.company_token);
    assert(r.source_url.startsWith("https://"), r.source_url);
  }
  // The primary key the writer upserts on: one cell per (token, SOC, state).
  const keys = new Set(CELLS.map((r) => `${r.company_token}\u0001${r.soc_code}\u0001${r.worksite_state}`));
  assertEquals(keys.size, CELLS.length);
  // One payload is one quarter of one file.
  assertEquals(new Set(CELLS.map((r) => r.fiscal_quarter)).size, 1);
  assertEquals(CELLS[0].fiscal_quarter, LCA_FISCAL_QUARTER);
  assertEquals(CELLS[0].source_file, LCA_SOURCE_FILE);
  assertEquals(CELLS[0].published_on, LCA_PUBLISHED_ON);
  // One payload is one measured span, and every row carries it.
  assertEquals(new Set(CELLS.map((r) => r.coverage_from)).size, 1);
  assertEquals(new Set(CELLS.map((r) => r.coverage_to)).size, 1);
  assertEquals(CELLS[0].coverage_from, LCA_COVERAGE_FROM);
  assertEquals(CELLS[0].coverage_to, LCA_COVERAGE_TO);
  // THE LABEL IS THE SPAN'S. Re-derived here rather than compared to itself:
  // this is the check that a label taken from a file name cannot pass.
  assert(LCA_COVERAGE_FROM <= LCA_COVERAGE_TO, `${LCA_COVERAGE_FROM} is after ${LCA_COVERAGE_TO}`);
  assertEquals(LCA_FISCAL_QUARTER, fiscalLabelForSpan(LCA_COVERAGE_FROM, LCA_COVERAGE_TO));
  // The cells hold as many filings as the run recorded writing. matched_rows is
  // a different quantity -- an employer with two board tokens contributes its
  // application to both -- so the two are held to their own figures.
  assertEquals(CELLS.reduce((n, r) => n + r.filings_n, 0), LCA_CELL_WRITES);
  assert(LCA_CELL_WRITES >= LCA_MATCHED_ROWS, "more applications than writes is not a shape this loader can produce");
  // Every printed figure is inside the band the loader and this module agree on.
  for (const r of CELLS) {
    assert(r.wage_low_annual >= LCA_WAGE_PLAUSIBLE_MIN, `${r.company_token} floor ${r.wage_low_annual}`);
    assert(r.wage_high_annual <= LCA_WAGE_PLAUSIBLE_MAX, `${r.company_token} ceiling ${r.wage_high_annual}`);
  }
});

Deno.test("TEETH: a payload with a null in a required field, a broken range or a repeated cell key is refused by the row that breaks it", async () => {
  const nulled = copy(CELLS).slice(0, 50);
  // deno-lint-ignore no-explicit-any
  (nulled[7] as any).company_token = null;
  await assertRejects(() => decodeOwn(nulled), Error, "no company_token");

  const unordered = copy(CELLS).slice(0, 50);
  unordered[3].wage_high_annual = unordered[3].wage_low_annual - 1;
  await assertRejects(() => decodeOwn(unordered), Error, "wage_high_annual is below wage_low_annual");

  const outside = copy(CELLS).slice(0, 50);
  outside[11].wage_median_annual = outside[11].wage_high_annual + 1000;
  await assertRejects(() => decodeOwn(outside), Error, "wage_median_annual is outside the range");

  const uncounted = copy(CELLS).slice(0, 50);
  uncounted[2].filings_n = 0;
  await assertRejects(() => decodeOwn(uncounted), Error, "filings_n is not a count above zero");

  const badSoc = copy(CELLS).slice(0, 50);
  badSoc[5].soc_code = "15-124";
  await assertRejects(() => decodeOwn(badSoc), Error, "is not two digits, a dash and four");

  const badState = copy(CELLS).slice(0, 50);
  badState[9].worksite_state = "California";
  await assertRejects(() => decodeOwn(badState), Error, "is not a two-letter upper-case code");

  const repeated = copy(CELLS).slice(0, 50);
  repeated[20] = { ...repeated[19] };
  await assertRejects(() => decodeOwn(repeated), Error, "repeats the cell key");

  // A row from another quarter, or another file, cannot ride along: the load
  // replaces one quarter, and a mixed payload would make the label a lie.
  const mixed = copy(CELLS).slice(0, 50);
  mixed[30].fiscal_quarter = "FY2026 Q2";
  await assertRejects(() => decodeOwn(mixed), Error, "is not the label this build pins");
  const otherFile = copy(CELLS).slice(0, 50);
  otherFile[31].source_file = "LCA_Disclosure_Data_FY2026_Q2.xlsx";
  await assertRejects(() => decodeOwn(otherFile), Error, "is not the file this build pins");

  // A row whose span is not the build's is a row from another load: the span
  // is what the surface prints, so it is pinned exactly like the file is.
  const otherSpan = copy(CELLS).slice(0, 50);
  otherSpan[12].coverage_to = "2026-03-31";
  await assertRejects(() => decodeOwn(otherSpan), Error, "coverage_to \"2026-03-31\" is not the date this build pins");
  const noSpan = copy(CELLS).slice(0, 50);
  // deno-lint-ignore no-explicit-any
  (noSpan[13] as any).coverage_from = null;
  await assertRejects(() => decodeOwn(noSpan), Error, "coverage_from is not a YYYY-MM-DD date");

  // THE PLAUSIBILITY BAND, RE-CHECKED IN THE DEPLOY. The loader refuses these
  // on an operator's machine; a hand-edited payload must not get past here.
  const tooHigh = copy(CELLS).slice(0, 50);
  tooHigh[18].wage_high_annual = LCA_WAGE_PLAUSIBLE_MAX + 1;
  await assertRejects(() => decodeOwn(tooHigh), Error, "outside the plausible band");
  const tooLow = copy(CELLS).slice(0, 50);
  tooLow[19].wage_low_annual = 1;
  tooLow[19].wage_median_annual = tooLow[19].wage_low_annual;
  await assertRejects(() => decodeOwn(tooLow), Error, "outside the plausible band");

  // And the clean 50 still decode, so the rejections above are the mutations and not the harness.
  assertEquals((await decodeOwn(copy(CELLS).slice(0, 50))).length, 50);
});

Deno.test("TEETH: a payload holding a different number of filings than the run recorded writing is refused", async () => {
  // THE DEFECT THIS CATCHES. The cells and the run record used to be compared
  // on the cell count and the token count alone, and the record did not state
  // the write count at all -- so the payload's own filings could drift from the
  // run that produced them and every check still passed.
  const more = copy(CELLS);
  more[0].filings_n += 1;
  const { b64, gzipBytes } = await payloadOf(more);
  await assertRejects(
    () => decodeLcaCells(b64, { gzipBytes, cells: LCA_CELL_COUNT, tokens: LCA_TOKEN_COUNT, cellWrites: LCA_CELL_WRITES }),
    Error,
    "filings across its cells; the build recorded",
  );
  // The unmutated payload passes the same check, so the rejection is the mutation.
  assertEquals((await decodeLcaCells()).length, LCA_CELL_COUNT);
});

Deno.test("TEETH: a truncated or re-packed blob is caught by the byte count the build recorded, before any row is read", async () => {
  await assertRejects(
    () => decodeLcaCells(undefined, { ...LCA_EXPECTED, gzipBytes: LCA_EXPECTED.gzipBytes - 1 }),
    Error,
    "bytes of gzip; the build recorded",
  );
  // A payload short of its recorded cell count is refused even though every row in it is valid.
  const short = copy(CELLS).slice(0, LCA_CELL_COUNT - 1);
  const { b64, gzipBytes } = await payloadOf(short);
  await assertRejects(
    () => decodeLcaCells(b64, { gzipBytes, cells: LCA_CELL_COUNT, tokens: LCA_TOKEN_COUNT, cellWrites: null }),
    Error,
    "cells; the build recorded",
  );
});

Deno.test("the provenance constants are the recorded loader run's, and they are what a surface printing these figures must print", () => {
  assertEquals(LCA_SOURCE_FILE, recorded("source_file"));
  assertEquals(LCA_SOURCE_URL, recorded("source_url"));
  assertEquals(LCA_SOURCE_SHA256, recorded("sha256"));
  assertEquals(String(LCA_SOURCE_BYTES), recorded("bytes"));
  assertEquals(LCA_FISCAL_QUARTER, recorded("quarter"));
  assertEquals(LCA_PUBLISHED_ON, recorded("published"));
  assertEquals(String(LCA_CERTIFIED_BY_EQUALITY), recorded("certified_by_equality"));
  assertEquals(String(LCA_CERTIFIED_PREFIX_REFUSED), recorded("of_which_certified_prefix_refused"));
  assertEquals(String(LCA_MATCHED_ROWS), recorded("matched_rows"));
  assertEquals(String(LCA_HELD_NOT_YEARLY), recorded("wage_not_filed_yearly"));
  assertEquals(String(LCA_DATA_ROWS), recorded("data_rows"));
  assertEquals(String(LCA_CELL_COUNT), recorded("cells"));
  assertEquals(String(LCA_TOKEN_COUNT), recorded("tokens"));
  assertEquals(String(LCA_CELL_WRITES), recorded("cell_writes"));
  assertEquals(LCA_COVERAGE_FROM, recorded("coverage_from"));
  assertEquals(LCA_COVERAGE_TO, recorded("coverage_to"));
  assertEquals(String(LCA_HELD_OUT_OF_BAND), recorded("wage_outside_plausible_band"));
  // The digest is a digest, not a phrase, and the certified count is an
  // EQUALITY count: the prefix rows are recorded separately and are not in it.
  assert(/^[0-9a-f]{64}$/.test(LCA_SOURCE_SHA256), LCA_SOURCE_SHA256);
  assert(LCA_CERTIFIED_PREFIX_REFUSED > 0 && LCA_CERTIFIED_PREFIX_REFUSED < LCA_CERTIFIED_BY_EQUALITY);
  assert(LCA_CERTIFIED_BY_EQUALITY < LCA_DATA_ROWS);
});

Deno.test("one run is one stamp, and the prune lands on the last chunk and on no other", () => {
  const stamp = "2026-09-25T14:11:27.000Z";
  const plan = planLcaChunks(CELLS, stamp, LCA_CHUNK_ROWS);
  assertEquals(plan.length, Math.ceil(CELLS.length / LCA_CHUNK_ROWS));
  assertEquals(new Set(plan.map((c) => c.p_run_started_at)).size, 1);
  assertEquals(plan[0].p_run_started_at, stamp);
  assertEquals(plan.filter((c) => c.p_prune).length, 1);
  assertEquals(plan[plan.length - 1].p_prune, true);
  // Every cell is posted exactly once, in order: a plan that dropped or
  // repeated rows would load a quarter that is not the one it decoded.
  const flat = plan.flatMap((c) => c.p_rows);
  assertEquals(flat.length, CELLS.length);
  assertEquals(flat.map((r) => `${r.company_token}|${r.soc_code}|${r.worksite_state}`), CELLS.map((r) => `${r.company_token}|${r.soc_code}|${r.worksite_state}`));
  // The shape holds at sizes that divide the row count exactly and at sizes that do not.
  for (const size of [1, 7, 1000, CELLS.length, CELLS.length + 1]) {
    const p = planLcaChunks(CELLS, stamp, size);
    assertEquals(p.filter((c) => c.p_prune).length, 1, `size ${size}`);
    assertEquals(p[p.length - 1].p_prune, true, `size ${size}`);
    assertEquals(p.reduce((n, c) => n + c.p_rows.length, 0), CELLS.length, `size ${size}`);
  }
});

Deno.test("a run with no cells, or with no stamp, is refused rather than posted as a prune of the quarter", () => {
  assertThrows(() => planLcaChunks([], "2026-09-25T14:11:27.000Z"), Error, "a run with no cells is refused");
  assertThrows(() => planLcaChunks(CELLS.slice(0, 2), ""), Error, "one stamp every chunk shares");
  assertThrows(() => planLcaChunks(CELLS.slice(0, 2), "2026-09-25T14:11:27.000Z", 0), Error, "is not a positive whole number");
});

Deno.test("the posting loop sends the plan and nothing else, and reports what the writer said", async () => {
  const stamp = "2026-09-25T14:11:27.000Z";
  const plan = planLcaChunks(CELLS, stamp, LCA_CHUNK_ROWS);
  const client = recorder();
  const tally = await postLcaChunks(client, plan);
  assertEquals(client.calls.length, plan.length);
  assertEquals(new Set(client.calls.map((c) => c.fn)), new Set(["oflc_lca_wages_load"]));
  assertEquals(client.calls.map((c) => c.args.p_prune), plan.map((c) => c.p_prune));
  assertEquals(new Set(client.calls.map((c) => c.args.p_run_started_at)), new Set([stamp]));
  assertEquals(tally.chunksDone, plan.length);
  assertEquals(tally.upserted, CELLS.length);
  assertEquals(tally.pruned, 3);
  assertEquals(tally.total, CELLS.length);
});

Deno.test("TEETH: a chunk that fails stops the run before the swap, and the run still reports how far it got", async () => {
  const plan = planLcaChunks(CELLS, "2026-09-25T14:11:27.000Z", LCA_CHUNK_ROWS);
  assert(plan.length >= 3, "this check needs a plan with a middle");
  const client = recorder(3);
  const tally = newLcaTally(plan.length);
  const err = await assertRejects(() => postLcaChunks(client, plan, tally), Error);
  assertStringIncludes(err.message, `oflc_lca_wages_load chunk 3/${plan.length}`);
  assertEquals(client.calls.length, 3, "the run carried on past the failed chunk");
  assertEquals(client.calls.filter((c) => c.args.p_prune).length, 0, "a swap was asked for after a failed chunk");

  // WHAT THE FAILED RUN REPORTS. The read-log row this tally becomes is the
  // only durable record of what state the period is in, and it used to say
  // chunks=0/6 upserted=0 after thousands of rows had been posted -- because
  // the tally lived in the callee and was dropped with the throw.
  assertEquals(tally.chunksDone, 2, "the reported tally lost the chunks that landed");
  assertEquals(tally.upserted, plan[0].p_rows.length + plan[1].p_rows.length);
  assertEquals(tally.chunks, plan.length);
  assertEquals(tally.pruned, 0);

  // And the mutant proves the property is the stopping, not the plan: a loop
  // that carried on would reach the swapping call and replace the period with
  // part of a run.
  const carriesOn = recorder(3);
  for (const call of plan) await carriesOn.rpc("oflc_lca_wages_load", call as unknown as Record<string, unknown>);
  assertEquals(carriesOn.calls.filter((c) => c.args.p_prune).length, 1);
});

Deno.test("index.ts: the action decodes before it posts, runs the plan under one stamp, logs its kind and names the quarter", () => {
  assert(/case "lca_wages": return await runLcaWages\(client\);/.test(CODE));
  assertStringIncludes(CODE, "const runStartedAt = new Date().toISOString();");
  assertStringIncludes(CODE, "const rows = await decodeLcaCells();");
  assertStringIncludes(CODE, "const plan = planLcaChunks(rows, runStartedAt, LCA_CHUNK_ROWS);");
  assertStringIncludes(CODE, "await postLcaChunks(client, plan, posted);");
  // The decode is upstream of the first post: a payload that fails its checks must cost nothing.
  const body = CODE.slice(CODE.indexOf("async function runLcaWages"), CODE.indexOf("// ── the handler"));
  assert(body.indexOf("decodeLcaCells()") < body.indexOf("postLcaChunks("), "the payload is posted before it is checked");
  // THE TALLY IS COPIED OUT AFTER THE CATCH, not inside the try: a copy inside
  // the try is a copy that never runs on the one path where the record matters.
  const catchAt = body.indexOf("} catch (e) {");
  assert(catchAt > 0, "runLcaWages no longer catches");
  assert(body.indexOf("tally.chunksDone = posted.chunksDone;") > catchAt, "the posting tally is copied out only on the success path");
  assert(body.indexOf("const posted = newLcaTally(0);") < body.indexOf("try {"), "the posting tally is not the caller's");
  // One call site for the writer, and it is the module's: a second loop in the
  // entry point would be a second chunking rule with its own stamp.
  assertEquals([...CODE.matchAll(/oflc_lca_wages_load/g)].length, 0, "the entry point calls the writer directly instead of through the planned sequence");
  assert(/type LogKind = [^;]*"lca_wages"/.test(CODE), "the read-log kind union admits the wage load");
  assert(/readLog\(client, "lca_wages", \{\s*fetched: tally\.cells, kept: tally\.total, newRows: tally\.upserted, ok, ms,/.test(body));
  assertStringIncludes(CODE, "[layoff-filings] kind=lca_wages cells=${tally.cells} tokens=${tally.tokens}");
  assertStringIncludes(CODE, "chunks=${tally.chunksDone}/${tally.chunks} upserted=${tally.upserted} pruned=${tally.pruned}");
  // The response says which quarter it wrote; a load that named none would be a number with no basis.
  assertStringIncludes(CODE, "quarter: LCA_FISCAL_QUARTER, publishedOn: LCA_PUBLISHED_ON,");
  // The span the figures are about travels with them into the log and the answer.
  assertStringIncludes(CODE, "coverageFrom: LCA_COVERAGE_FROM, coverageTo: LCA_COVERAGE_TO,");
  assertStringIncludes(body, "`coverage=${LCA_COVERAGE_FROM}..${LCA_COVERAGE_TO}`");
  assert(/return json\(\{[\s\S]{0,400}ok \? 200 : 500\);/.test(body), "a failed load must not answer 200");
  // This lane never reaches the rate budget, like every other action here.
  assert(!/check_rate_limit|check_global_rate_limit/.test(body));
});

Deno.test("the migration that widens the read log admits every kind the function writes, and the newest widening is the whole list", () => {
  const dir = `${REPO}/supabase/migrations`;
  const files = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  const admits = files.filter((n) => {
    const sql = Deno.readTextFileSync(`${dir}/${n}`).replace(/^\s*--.*$/gm, "");
    return /ADD CONSTRAINT layoff_read_log_kind_check/.test(sql);
  });
  assert(admits.length >= 1, "no migration widens the read-log kind check");
  // A CHECK holds an expression, not a set, so each widening rewrites the whole
  // list; the one that runs last is the one the column ends up with.
  const newest = admits[admits.length - 1];
  const sql = Deno.readTextFileSync(`${dir}/${newest}`).replace(/^\s*--.*$/gm, "");
  const m = /CHECK \(kind IN \(([^)]*)\)\)/.exec(sql);
  assert(m, `${newest} does not name its kinds inline`);
  const kinds = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  const union = /type LogKind = ([^;]*);/.exec(CODE)![1];
  const written = [...union.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  for (const k of [...written, "matcher", "partition"]) assert(kinds.includes(k), `${newest} does not admit ${k}`);
  assertEquals(kinds, ["edgar_atom", "edgar_backfill", "edgar_fts_audit", "lca_wages", "matcher", "mirror", "partition", "warn"]);
});
