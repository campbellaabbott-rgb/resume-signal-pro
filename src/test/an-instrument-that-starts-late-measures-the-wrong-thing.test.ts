import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A median ~958ms of every list request was outside every number the function
 * published about itself.
 *
 * `reqStart` was assigned AFTER the 1.3-1.6MB facet-row read, so tookMs and
 * phaseMs reported roughly a quarter of real server time — and two previous
 * latency fixes were aimed with that instrument.
 *
 * The obvious repair is a trap. reqStart fed TWO things: the reporting numbers
 * AND the request budget, which sizes six downstream deadlines (embed, semantic
 * ANN, semantic re-filter, simple_config, head ring, fuzzy augment gate). Moving
 * it earlier would silently shorten all six by that same ~958ms, and the 7s
 * simple_config deadline is explicitly sized against a measured 7.9s cold spike.
 * Fixing an instrument must not move the thing it measures — so there are two
 * clocks.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

describe("an instrument that starts late measures the wrong thing", () => {
  it("starts the reporting clock before the meta read, not after it", () => {
    // Scoped to the list action. Both of these strings occur elsewhere in an
    // 11,000-line file, and a bare indexOf would compare the wrong pair — which
    // it did on the first run of this test.
    const listBlock = FN.slice(FN.indexOf('if (action === "list") {'));
    const entry = listBlock.indexOf("const t_entry = Date.now();");
    const metaRead = listBlock.indexOf('client.from("job_board_meta").select("v, updated_at")');
    expect(entry, "no entry timestamp in the list action").toBeGreaterThan(-1);
    expect(metaRead, "meta read not found in the list action").toBeGreaterThan(-1);
    expect(entry, "the clock must start BEFORE the facet read it was hiding").toBeLessThan(metaRead);
    // And it must actually reach serveList — computing it and dropping it is
    // the sibling failure this codebase has shipped before.
    expect(FN).toMatch(/serveList\(client, body, meta, t_entry\)/);
    expect(FN).toMatch(/serveList\(client, body, undefined, t_entry\)/);
  });

  it("keeps the budget clock where the work starts", () => {
    expect(FN).toMatch(/const reqStart = entryAt \?\? Date\.now\(\);/);
    expect(FN).toMatch(/const budgetStart = Date\.now\(\);/);
    // The six deadlines must be sized from the BUDGET clock. If budgetLeft ever
    // reads reqStart again, every downstream deadline silently shrinks by the
    // duration of the meta read.
    expect(FN).toMatch(
      /const budgetLeft = \(\) => Math\.max\(300, REQUEST_BUDGET_MS - \(Date\.now\(\) - budgetStart\)\);/);
    expect(FN, "budgetLeft must not be re-anchored to the reporting clock")
      .not.toMatch(/REQUEST_BUDGET_MS - \(Date\.now\(\) - reqStart\)/);
  });

  it("times the offset-ceiling exit — the one that isolates the meta read", () => {
    // That exit runs no query of its own, so its tookMs is almost purely the
    // facet fetch. It was the single exit reporting nothing at all.
    const i = FN.indexOf("const OFFSET_CEILING");
    const block = FN.slice(i, i + 2400);
    expect(block).toMatch(/tookMs: Date\.now\(\) - reqStart,/);
    expect(block).toMatch(/phaseMs: \{ \.\.\.phase \},/);
    // honesty() must NOT be spread there: it fires a 2% filter-integrity meta
    // upsert, which has no business running on an empty page.
    expect(block, "no honesty() spread on the empty page").not.toMatch(/\.\.\.honesty\(/);
  });

  it("runs the head ring concurrently with the ranked query, but never as Promise.all", () => {
    const created = FN.indexOf("const headRingP");
    const awaited = FN.indexOf("await headRingP");
    expect(created, "the ring promise is not created").toBeGreaterThan(-1);
    expect(awaited, "the ring promise is never awaited").toBeGreaterThan(created);
    // The property that matters: the ranked call happens BETWEEN issuing the
    // ring and awaiting it, so the two round trips overlap. Asserted as a
    // window rather than by absolute position — search_jobs is called from more
    // than one place in this file.
    const window = FN.slice(created, awaited);
    expect(window, "search_jobs must run while the ring is in flight")
      .toMatch(/await client\.rpc\("search_jobs"/);

    // Promise.all would let a ring rejection take the ranked call down with it
    // and demote the request to the recency path — trading 473ms for a strictly
    // worse page.
    expect(FN).not.toMatch(/Promise\.all\(\[[^\]]*headRingP/);

    // An unawaited promise that rejects before anyone looks at it is an
    // unhandled rejection in this runtime, so the failure must be neutralised
    // at CREATION, not at the await site.
    const decl = FN.slice(created, created + 2000);
    expect(decl, "the ring promise must catch at creation").toMatch(/\.catch\(\(\) => \(\{ data: null \}\)\)/);

    // Gated exactly as the await site is gated, so nothing new fires.
    expect(decl).toMatch(/\(scoreRanked && headTermRing && \(!deepPage \|\| ringMerged\)\)/);
  });

  it("still measures the ring from when it was ISSUED", () => {
    // Awaiting an already-resolved promise takes ~0ms. Measuring from the await
    // site would report a real round trip as free — an instrument lying in the
    // other direction, which is the bug this whole file is about.
    expect(FN).toMatch(/markFrom\("head_ring", t_head_ring_started\)/);
    expect(FN).toMatch(/const t_head_ring_started = Date\.now\(\);/);
  });
});
