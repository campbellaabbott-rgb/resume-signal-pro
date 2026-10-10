// @vitest-environment node
/**
 * AN INTEGRATION REUSED A BUILD STRING ON DIFFERENT CODE (wave 3, 2026-10-10).
 *
 * Eight wave-3 branches were built in parallel, and they stamped the same
 * strings on different code. send-search-digest.2026-10-09.1 was on three
 * branches. Eleven more functions were .2026-10-09.1 on two branches each,
 * generate-application-answers was .2026-10-10.2 on two, and the rest had
 * agent-mcp .1 vs .3 and stripe-webhook .1 vs .3. Merged as they were, the
 * integration would have carried a string that one branch's bundle could
 * already answer. The ledger compares strings, so a deploy of either branch
 * would read as the merged build being live. The October collision class.
 *
 * `node scripts/deploy-ledger.mjs --against <ref>` now fails (exit 3) when a
 * function's code differs between the ref and HEAD and HEAD's build is not a
 * later, different string. This test runs the pure rule on a fixture. It
 * reads no repo history, calls no git and makes no network call. Importing
 * the ledger runs nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fetchSpy = vi.fn(async () => { throw new Error("the ledger reached the network on import"); });
let L: typeof import("../../scripts/deploy-ledger.mjs");

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  L = await import("../../scripts/deploy-ledger.mjs");
});
afterAll(() => { vi.unstubAllGlobals(); });

describe("importing the ledger runs nothing", () => {
  it("makes no request and exports the pure rules", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(typeof L.againstViolations).toBe("function");
    expect(typeof L.onlyMarkerLines).toBe("function");
  });
});

describe("--against: a function whose code moved needs a later, different build", () => {
  const entries = [
    // three branches' send-search-digest .1, merged and left at .1: the collision itself
    { fn: "send-search-digest", ref: "send-search-digest.2026-10-09.1", head: "send-search-digest.2026-10-09.1", changed: true },
    // the integration's own later string: fine
    { fn: "agent-mcp", ref: "agent-mcp.2026-10-09.3", head: "agent-mcp.2026-10-09.4", changed: true },
    // a later DAY beats any sequence on an earlier one
    { fn: "generate-summary", ref: "generate-summary.2026-10-09.7", head: "generate-summary.2026-10-10.2", changed: true },
    // an earlier string on moved code (a 2026-10-09 stamp under main's 2026-10-10.1)
    { fn: "shortlist-evaluate", ref: "shortlist-evaluate.2026-10-10.1", head: "shortlist-evaluate.2026-10-09.4", changed: true },
    // the sequence is numeric, never text: .10 is after .9
    { fn: "free-keyword-scan", ref: "free-keyword-scan.2026-10-09.9", head: "free-keyword-scan.2026-10-09.10", changed: true },
    // code unchanged: the same string is right
    { fn: "warm-up", ref: "warm-up.2026-10-09.1", head: "warm-up.2026-10-09.1", changed: false },
    // a new function, or a marker added where the ref had none
    { fn: "withdraw-subscription", ref: null, head: "withdraw-subscription.2026-10-09.4", changed: true },
    // moved code with no marker at all cannot be verified after a deploy
    { fn: "a-bare-function", ref: "a-bare-function.2026-10-01.1", head: null, changed: true },
  ];

  it("reports exactly the collision, the earlier string and the missing marker", () => {
    const v = L.againstViolations(entries);
    expect(v.map((x) => [x.fn, x.reason])).toEqual([
      ["send-search-digest", "same build string on different code"],
      ["shortlist-evaluate", "HEAD's build sorts before the ref's"],
      ["a-bare-function", "its code changed and it carries no build the ledger can read"],
    ]);
  });

  it("a reserved job-board version may be shared with its own branch, and only that string", () => {
    const policy = { reservations: { wave3: { jobBoard: "2026-09-09.92" }, next: { jobBoard: "2026-09-09.94+" } } };
    const allowEqual = L.reservedJobBoardBuilds(policy);
    expect([...allowEqual]).toEqual(["job-board.2026-09-09.92"]);
    const jb = [{ fn: "job-board", ref: "job-board.2026-09-09.92", head: "job-board.2026-09-09.92", changed: true }];
    expect(L.againstViolations(jb, { allowEqual })).toEqual([]);
    // without the allowance (the ref is on main, so it may have been deployed) it is a collision
    expect(L.againstViolations(jb)).toHaveLength(1);
    // the allowance names a string, not a function: any other shared string still fails
    expect(L.againstViolations([{ fn: "job-board", ref: "job-board.2026-09-09.91", head: "job-board.2026-09-09.91", changed: true }], { allowEqual })).toHaveLength(1);
  });

  it("the comparison is the ledger's own buildAtLeast", () => {
    expect(L.buildAtLeast("x.2026-10-10.1", "x.2026-10-09.9")).toBe(true);
    expect(L.buildAtLeast("x.2026-10-09.10", "x.2026-10-09.9")).toBe(true);
    expect(L.buildAtLeast("x.2026-10-09.1", "x.2026-10-09.2")).toBe(false);
    expect(L.buildAtLeast("x.2026-10-09.1", "y.2026-10-09.1")).toBe(false);
  });
});

describe("a difference in the marker line alone is not moved code", () => {
  const fn = "create-pass-checkout";
  it("a diff that only relabels the build is a relabel", () => {
    expect(L.onlyMarkerLines(fn, [
      "diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -51 +51 @@",
      '-const FN_BUILD = "create-pass-checkout.2026-10-09.1";',
      '+const FN_BUILD = "create-pass-checkout.2026-09-27.4";',
    ])).toBe(true);
    expect(L.onlyMarkerLines("layoff-filings", ['-export const BUILD_VERSION = "2026-10-09.1";', '+export const BUILD_VERSION = "2026-10-09.3";'])).toBe(true);
  });

  it("any other changed line is code, and an empty diff is no relabel", () => {
    expect(L.onlyMarkerLines(fn, [
      '-const FN_BUILD = "create-pass-checkout.2026-10-09.1";',
      '+const FN_BUILD = "create-pass-checkout.2026-09-27.4";',
      "+const extra = 1;",
    ])).toBe(false);
    // another function's string on the line is not this function's marker
    expect(L.onlyMarkerLines(fn, ['+const OTHER = "create-checkout.2026-10-09.2";'])).toBe(false);
    expect(L.onlyMarkerLines(fn, ["--- a/x", "+++ b/x"])).toBe(false);
  });
});
