import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 110 BOARDS REPORTED THE SAME WORD, WHATEVER HAD HAPPENED TO THEM.
 *
 * Every board fetch failure reached the operator as "(vendor)". fetchBoard
 * caught the error, logged it to a console nobody reads, and returned bare
 * null — so a deleted board, a throttled vendor and a slow response were
 * indistinguishable in failedSources.
 *
 * That cost an afternoon: diagnosing the 110 meant probing each one by hand
 * against its own API to recover information the function had already
 * computed and thrown away. The split, once recovered, was 76 HTTP 404 + 1
 * 410 (gone), 16 transient/vendor-side, 9 empty, and 8 serving live jobs — and
 * those four groups have four different remedies.
 *
 * The reason is now classified and carried, because the next diagnosis should
 * be a query, not an afternoon.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

describe("a failure must say what failed", () => {
  it("fetchBoard hands its reason to the caller", () => {
    expect(CODE).toMatch(/onFail\?: \(reason: string\) => void/);
    expect(CODE).toMatch(/onFail\?\.\(reason\);/);
  });

  it("the reason is classified into something an operator can act on", () => {
    // A status code, a timeout and a network error have different remedies:
    // a registry removal, a budget change, and a retry.
    expect(CODE).toMatch(/raw\.match\(\/HTTP \(\\d\{3\}\)\/\)/);
    expect(CODE).toMatch(/"timeout"/);
    expect(CODE).toMatch(/"network"/);
  });

  it("the refresh loop publishes the reason instead of the bare word", () => {
    expect(CODE).toMatch(/failed\.push\(`\$\{s\.name\} \(vendor\$\{failReason \? `: \$\{failReason\}` : ""\}\)`\)/);
    // The old unconditional label must be gone.
    expect(CODE).not.toMatch(/failed\.push\(`\$\{s\.name\} \(vendor\)`\)/);
  });
});

describe("an empty board is not an outage", () => {
  // The first day failure reasons were visible, one message was a third of
  // the whole list: 41 of 120 failures were "personio feed unavailable on
  // .de/.com". Probing all 41 found 32 answering HTTP 200 with a valid,
  // EMPTY feed — `<workzag-jobs></workzag-jobs>`, 72 bytes — because the
  // fetcher accepted a response only if it contained "<position". Employers
  // who simply weren't hiring were being reported as broken vendors.
  //
  // The consequence outranks the noise: a failed fetch skips the prune, so a
  // personio employer closing their last role would keep those postings on a
  // board advertising zero ghost jobs. Three were being served when found.
  it("a valid empty feed is accepted, not thrown away", () => {
    expect(CODE).toMatch(/xml\.includes\("<workzag-jobs"\) \|\| xml\.includes\("<position"\)/);
  });

  it("a genuinely unreachable feed still fails", () => {
    // Both hosts must be tried and the throw must remain for the real case —
    // 9 of the 41 were genuinely unreachable, some of them rate-limited.
    expect(CODE).toMatch(/for \(const host of \["jobs\.personio\.de", "jobs\.personio\.com"\]\)/);
    expect(CODE).toMatch(/throw new Error\("personio feed unavailable on \.de\/\.com"\)/);
  });
});
