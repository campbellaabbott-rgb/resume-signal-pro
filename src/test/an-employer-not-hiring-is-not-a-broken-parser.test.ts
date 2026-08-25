import { describe, expect, it } from "vitest";
import { extractRipplingJobPosts } from "../../supabase/functions/job-board/normalize";

/**
 * SIX BOARDS WERE REPORTED AS A BROKEN PARSER FOR THE CRIME OF NOT HIRING.
 *
 * The live failure list on 2026-08-25 carried 95 entries, of which 6 read
 * "vendor: rippling payload shape unrecognized". Probing 198 of the 1,051
 * rippling boards in the catalog reproduced it at the same rate — 2 boards,
 * 1% — and neither was broken:
 *
 *   whistler-platinum-jobs   157,286 bytes, dehydratedState PRESENT,
 *                            queries [], "job-posts" 0 occurrences,
 *                            rendered text contains "No open"
 *   elevationcapital         157,505 bytes, identical shape
 *   medcbo-inc  (control)    226,630 bytes, queries 3, "job-posts" 2 -> parses
 *
 * Rippling serves a healthy page for an employer with no open roles: there is
 * nothing to prefetch, so `queries` is an empty array. The extractor could not
 * tell that from shape drift, returned null for both, and the caller threw
 * "rippling payload shape unrecognized" — publishing an employer's quiet month
 * to the operator as a vendor outage.
 *
 * This is the same distinction the personio fix drew: an empty feed is a fact
 * about the employer, not a fault in the pipe. The drift signal is kept and
 * sharpened — queries PRESENT but carrying no job-posts key is still null,
 * because that is what a real shape change looks like.
 */
const wrap = (queries: unknown, withDehydrated = true) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: withDehydrated ? { dehydratedState: { queries } } : {} },
  })}</script></html>`;

const JOB_POSTS = (items: unknown[], totalPages: number) =>
  [{ queryKey: ["x", "y", "job-posts"], state: { data: { items, totalPages } } }];

describe("an employer not hiring is not a broken parser", () => {
  it("dehydratedState present with zero queries is an HONEST EMPTY board", () => {
    const out = extractRipplingJobPosts(wrap([]));
    expect(out, "an empty board must not read as drift").not.toBeNull();
    expect(out!.items).toEqual([]);
    expect(out!.totalPages).toBe(1);
  });

  it("queries present but carrying no job-posts key is STILL drift", () => {
    // The signal that must survive: if Rippling renames the key or restructures
    // the payload, every board starts returning this shape and we need to hear
    // about it — reading it as "nobody is hiring" would silently empty the
    // vendor.
    expect(extractRipplingJobPosts(wrap([{ queryKey: ["a", "b", "something-else"], state: { data: {} } }]))).toBeNull();
  });

  it("a working board still parses, with its page count", () => {
    const out = extractRipplingJobPosts(wrap(JOB_POSTS([{ id: 1, name: "Nurse" }], 64)));
    expect(out!.items.length).toBe(1);
    expect(out!.totalPages).toBe(64);
  });

  it("a job-posts key whose items are not an array is drift, not empty", () => {
    expect(extractRipplingJobPosts(wrap([{ queryKey: ["a", "b", "job-posts"], state: { data: { items: null } } }]))).toBeNull();
  });

  it("no __NEXT_DATA__ at all is still an error", () => {
    expect(extractRipplingJobPosts("<html>nothing here</html>")).toBeNull();
  });

  it("unparseable JSON is still an error", () => {
    expect(extractRipplingJobPosts('<script id="__NEXT_DATA__" type="application/json">{not json</script>')).toBeNull();
  });

  it("a page with NO dehydratedState is drift, not an empty board", () => {
    // The empty-board reading is earned by dehydratedState being present and
    // deliberately empty. Its ABSENCE means the page is not the shape we think.
    expect(extractRipplingJobPosts(wrap([], false))).toBeNull();
  });
});
