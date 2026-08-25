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

describe("a login page is not a job feed", () => {
  // 11 failures reported `Unexpected token '<', "<!DOCTYPE "...`, which reads
  // like a parser bug. Every one was a BambooHR tenant answering 302 ->
  // /login.php: the employer turned public access off. We use public feeds
  // only and never authenticate, so this is terminal, not transient — and it
  // deserves to say so in one line instead of being diagnosed from a JSON
  // parser's complaint.
  it("a non-JSON body is named before it is parsed", () => {
    expect(CODE).toMatch(/const ct = res\.headers\.get\("content-type"\)/);
    expect(CODE).toMatch(/if \(!\/json\/i\.test\(ct\)\)/);
  });

  it("an auth redirect is called what it is", () => {
    expect(CODE).toMatch(/careers list is not public \(redirected to/);
    expect(CODE).toMatch(/\/login\|signin\|auth\/i\.test\(where\)/);
  });

  it("any other non-JSON body still reports its type and path", () => {
    expect(CODE).toMatch(/non-JSON response \(\$\{ct\.split\(";"\)\[0\] \|\| "unknown"\}\) at \$\{where\}/);
  });
});

describe("a cap is not a count", () => {
  // failedAcc keeps the LAST 120 entries, and every consumer read that
  // ceiling as the number of failing boards — the list response, status, and
  // a full day of my own analysis. A pass failing 120 boards and one failing
  // 3,000 were indistinguishable, and the class breakdown drawn from the
  // retained window samples the pass's TAIL, not its population.
  //
  // Caught because the number was 120 on four consecutive readings. The
  // runbook rule written this same morning says a suspiciously round number
  // that survives is the measurement being wrong, and I read past it three
  // times before applying it.
  it("the count is accumulated separately from the capped sample", () => {
    expect(CODE).toMatch(/const failedTotal = \(Number\(pv\.failedTotal\) \|\| 0\) \+ failed\.length;/);
    expect(CODE).toMatch(/\.slice\(-120\)/); // the sample stays bounded
  });

  it("the count resets with the sample at the start of a pass", () => {
    // A counter that never resets reports a lifetime total under a per-pass
    // label — the same species of defect one level up.
    const reset = CODE.slice(CODE.indexOf("pv.failedAcc = []"), CODE.indexOf("pv.failedAcc = []") + 90);
    expect(reset).toMatch(/pv\.failedTotal = 0;/);
  });

  it("both surfaces publish the count beside the sample", () => {
    expect(CODE).toMatch(/failedCount: failedTotal,/);
    expect(CODE).toMatch(/failedCount: Number\(pgV\.failedTotal\) \|\| 0,/);
  });
});

describe("advanceProgress must not drop the fields it is handed", () => {
  // failedTotal was added to RefreshProgress and passed in by the caller, but
  // advanceProgress builds `next` as an EXPLICIT object literal rather than a
  // spread of `prev` — so the field was dropped on every slice and the
  // counter read 0 forever. Shipped in .18, one build after it was introduced
  // to fix a DIFFERENT silently-dropped number, and caught only because the
  // verification watched it stay at zero while slices ran.
  //
  // Asserted behaviourally: the function must return what it was given.
  it("carries every progress field through both return paths", async () => {
    const { advanceProgress } = await import("../../supabase/functions/job-board/rotation");
    const prev = { hot: 0, cold: 5, coldDone: 2, failedAcc: ["a"], failedTotal: 41 };
    // Hot path.
    const hot = advanceProgress({ prev, inHotPhase: true, hotSlice: 10, baseSliceLen: 10, coldListLen: 100 });
    expect(hot.next.failedTotal, "hot path dropped failedTotal").toBe(41);
    expect(hot.next.failedAcc).toEqual(["a"]);
    // Cold path.
    const cold = advanceProgress({ prev, inHotPhase: false, hotSlice: 0, baseSliceLen: 10, coldListLen: 100 });
    expect(cold.next.failedTotal, "cold path dropped failedTotal").toBe(41);
    expect(cold.next.failedAcc).toEqual(["a"]);
  });
});
