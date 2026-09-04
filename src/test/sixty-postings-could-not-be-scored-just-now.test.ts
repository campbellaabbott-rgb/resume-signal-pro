import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "60 POSTINGS COULD NOT BE SCORED JUST NOW."
 *
 * A reader dropped a résumé and got that notice. Reproduced 2026-09-03 with a
 * fetch hook in a real browser against production: parse-pdf 200, fit-terms
 * 200 with the right role, the search 200 with sixty engineer rows — and then
 * fit-batch 546 WORKER_RESOURCE_LIMIT. Re-run four times against the API at
 * the client's batch size of sixty: two of four died. At twenty: two of two
 * succeeded, in ~1.7s. The scorer runs inside the job-board function and
 * shares its worker pool with the ingest that had been exhausting it all week.
 *
 * The same hook showed a second waste: ranking was switched on BEFORE the
 * résumé's query was set, so the fit effect fired immediately on the page
 * already loaded — the newest sixty of the default browse, which have no
 * descriptions yet — scored sixty nulls, and only then did the real query
 * load and score again. A wasted call against a function that dies under load.
 *
 * Three bounds, each pinned here: twenty ids per call on both sides (the
 * server cap keeps an old bundle from asking for a batch that dies), each
 * description cut to a fixed length before the dictionary walk, and ranking
 * enabled only after retrieval has set the query.
 */
const ROOT = resolve(__dirname, "../..");
const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const J = strip(JOBS), F = strip(FN);

describe("sixty postings could not be scored just now", () => {
  it("the client scores twenty at a time, and no sixty is left in the fit effect", () => {
    expect(J).toMatch(/const FIT_BATCH = 20;/);
    expect(J).toMatch(/i \+= FIT_BATCH\)/);
    expect(J).toMatch(/ids: unscored\.slice\(i, i \+ FIT_BATCH\)/);
    expect(J).toMatch(/failed \+= Math\.min\(FIT_BATCH, unscored\.length - i\);/);
    const effect = J.slice(J.indexOf('action: "fit-batch"') - 800, J.indexOf('action: "fit-batch"') + 800);
    expect(effect, "a literal 60 in the batching loop would reintroduce the batch that dies").not.toMatch(/\b60\b/);
  });

  it("the server refuses to score more than twenty, and bounds each description", () => {
    expect(F).toMatch(/const FIT_BATCH_MAX = 20;/);
    expect(F).toMatch(/\.slice\(0, FIT_BATCH_MAX\)/);
    expect(F).toMatch(/const FIT_DESC_CHARS = 20_000;/);
    expect(F).toMatch(/computeFit\(r\.description\.slice\(0, FIT_DESC_CHARS\), resumeScan, 40\)/);
  });

  it("ranking is switched on AFTER the résumé's query is set — never before", () => {
    // Within retrieveForResume (extracted 2026-09-04 so "For you" shares it):
    // the fit-terms retrieval, then setQ, then
    // setFitRanking(true). Switching on first scores the wrong page.
    const start = J.indexOf("const retrieveForResume = async (text: string)");
    const end = J.indexOf("const resolveFitResume", start);
    const body = J.slice(start, end);
    expect(body, "handler not located").not.toBe("");
    const terms = body.indexOf('action: "fit-terms"');
    const setq = body.indexOf("setQ(terms[0]);"); // the helper sets it and returns the term
    const on = body.indexOf("setFitRanking(true);");
    expect(terms, "retrieval missing from the handler").toBeGreaterThan(0);
    expect(setq, "the query is never set from the résumé").toBeGreaterThan(terms);
    expect(on, "setFitRanking(true) missing from the handler").toBeGreaterThan(0);
    expect(on, "ranking must be enabled after the query is set, or the first batch scores the old page").toBeGreaterThan(setq);
    expect(body.indexOf("setFitRanking(true);"), "only one enable in the handler").toBe(body.lastIndexOf("setFitRanking(true);"));
  });

  it("the fit effect waits for the page the reader asked for", () => {
    // The ordering above was necessary but not sufficient: the effect keys on
    // `jobs`, still the old page when ranking flips on. Measured with a
    // request hook after .31 deployed — one batch scored the stale page (3 of
    // 20) before the résumé's list arrived. `refreshing` covers exactly the
    // window between the new fetch starting and landing.
    expect(J).toMatch(/if \(!fitRanking \|\| jobs\.length === 0 \|\| refreshing \|\| fitAwaitingPage\.current\) return;/);
    expect(J, "refreshing must be a dependency, or the effect reads a stale closure").toMatch(/\}, \[fitRanking, jobs, refreshing, fitRetry\]\);/);
  });

  it("covers the debounce gap: the pending flag is raised at setQ and lowered when the fetch settles", () => {
    // `refreshing` only turns true inside fetchJobs, 400ms after the query
    // changes. Measured after the refreshing gate deployed: fit-batch at 2.7s,
    // the q=founder list at 3.0s — one wasted batch through the gap. The ref
    // closes it: raised synchronously before setQ, cleared in fetchJobs'
    // finally for the offset-0 request only.
    const start = J.indexOf("const retrieveForResume = async (text: string)");
    const body = J.slice(start, J.indexOf("const resolveFitResume", start));
    const raise = body.indexOf("fitAwaitingPage.current = true;");
    const setq = body.indexOf("setQ(terms[0]);"); // the helper sets it and returns the term
    expect(raise, "the pending flag is never raised").toBeGreaterThan(0);
    expect(raise, "it must be raised BEFORE setQ — the gap opens the instant the query changes").toBeLessThan(setq);
    expect(J).toMatch(/if \(offset === 0\) fitAwaitingPage\.current = false;/);
    // And it is cleared in the finally, so a failed fetch cannot leave ranking stuck.
    const fin = J.indexOf("setRefreshing(false);");
    expect(J.indexOf("if (offset === 0) fitAwaitingPage.current = false;")).toBeGreaterThan(fin);
  });
});
