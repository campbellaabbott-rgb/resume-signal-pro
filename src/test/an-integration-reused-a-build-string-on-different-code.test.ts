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
 *
 * REVIEW OF THE INTEGRATION (2026-10-10) found the rule laxer than §2 says,
 * three ways, each pinned below with the real policy file:
 *   - every reservation (.91 on main, .92, .93) was shared with ANY ref main
 *     did not contain, so two branches could carry one job-board string on
 *     different code; now only the ref's own workstream's version, with HEAD
 *     in that workstream, while main does not carry it;
 *   - a line that held the marker AND other code counted as a relabel;
 *   - "fn.2026-10-09.04" passed as later than ".4".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    const policy = { reservations: { wave3: { branches: ["wave3/"], jobBoard: "2026-09-09.92" }, next: { jobBoard: "2026-09-09.94+" } } };
    const allowEqual = L.sharedReservation(policy, { ref: "wave3/job-board", head: "wave3/integration", mainJobBoard: "job-board.2026-09-09.91" });
    expect([...allowEqual]).toEqual(["job-board.2026-09-09.92"]);
    const jb = [{ fn: "job-board", ref: "job-board.2026-09-09.92", head: "job-board.2026-09-09.92", changed: true }];
    expect(L.againstViolations(jb, { allowEqual })).toEqual([]);
    // without the allowance (the ref is on main, so it may have been deployed) it is a collision
    expect(L.againstViolations(jb)).toHaveLength(1);
    // the allowance names a string, not a function: any other shared string still fails
    expect(L.againstViolations([{ fn: "job-board", ref: "job-board.2026-09-09.91", head: "job-board.2026-09-09.91", changed: true }], { allowEqual })).toHaveLength(1);
  });

  describe("with the real policy (docs/deploy-ledger.json)", () => {
    const policy = JSON.parse(readFileSync(resolve(__dirname, "../../docs/deploy-ledger.json"), "utf8"));
    const MAIN = "job-board.2026-09-09.91"; // what main carries once wave 2 merged
    const shared = (ref: string, head = "wave3/integration", mainJobBoard: string | null = MAIN) =>
      L.sharedReservation(policy, { ref, head, mainJobBoard });
    const same = (v: string) => [{ fn: "job-board", ref: `job-board.${v}`, head: `job-board.${v}`, changed: true }];

    it("a wave-3 branch shares wave 3's .92 with the wave-3 integration, and nothing else", () => {
      expect([...shared("wave3/job-board")]).toEqual(["job-board.2026-09-09.92"]);
      expect([...shared("origin/wave3/job-board")]).toEqual(["job-board.2026-09-09.92"]);
      expect(L.againstViolations(same("2026-09-09.92"), { allowEqual: shared("wave3/job-board") })).toEqual([]);
    });

    it(".91 is on main: no branch may share it, so two wave-3 tips carrying it on different code collide", () => {
      // wave3/tests-ci and wave3/board-data-ingest both carried main's .91 on different job-board code.
      const allowEqual = shared("wave3/tests-ci", "wave3/board-data-ingest");
      expect(allowEqual.has("job-board.2026-09-09.91")).toBe(false);
      expect(L.againstViolations(same("2026-09-09.91"), { allowEqual }).map((v) => v.reason)).toEqual(["same build string on different code"]);
      // a wave-2 branch shares nothing: its version is the one main carries
      expect([...shared("wave2-integration", "wave2-integration")]).toEqual([]);
    });

    it("another workstream's reservation is never shared: .93 against a wave-3 ref collides", () => {
      expect(shared("wave3/job-board").has("job-board.2026-09-09.93")).toBe(false);
      expect(L.againstViolations(same("2026-09-09.93"), { allowEqual: shared("wave3/job-board") })).toHaveLength(1);
      // and connect-apply's own .93 is not shared with a wave-3 HEAD either
      expect([...shared("connect-apply/board", "wave3/integration")]).toEqual([]);
      expect([...shared("connect-apply/board", "connect-apply/integration")]).toEqual(["job-board.2026-09-09.93"]);
    });

    it("a ref or HEAD no reservation names shares nothing, and neither does a version main already carries", () => {
      expect([...shared("1829501943d674985d95e45828b7095f6b93d145")]).toEqual([]);
      expect([...shared("wave3/job-board", "")]).toEqual([]);
      expect([...shared("wave3/job-board", "some-other-branch")]).toEqual([]);
      expect([...shared("wave3/", "wave3/integration")], "the bare prefix is not a branch").toEqual([]);
      // once main carries .92 (wave 3 merged), the reservation is spent
      expect([...shared("wave3/job-board", "wave3/integration", "job-board.2026-09-09.92")]).toEqual([]);
    });
  });

  it("the comparison is the ledger's own buildAtLeast", () => {
    expect(L.buildAtLeast("x.2026-10-10.1", "x.2026-10-09.9")).toBe(true);
    expect(L.buildAtLeast("x.2026-10-09.10", "x.2026-10-09.9")).toBe(true);
    expect(L.buildAtLeast("x.2026-10-09.1", "x.2026-10-09.2")).toBe(false);
    expect(L.buildAtLeast("x.2026-10-09.1", "y.2026-10-09.1")).toBe(false);
  });

  it("a sequence with a leading zero is unreadable, never a later build", () => {
    // ".04" is the same position as ".4": as a new build on moved code it would pass, and live it would read as ahead.
    expect(L.againstViolations([{ fn: "f", ref: "f.2026-10-09.4", head: "f.2026-10-09.04", changed: true }]).map((v) => v.reason))
      .toEqual(["its code changed and it carries no build the ledger can read"]);
    expect(L.buildAtLeast("f.2026-10-09.04", "f.2026-10-09.4")).toBe(false);
    expect(L.buildAtLeast("f.2026-10-09.4", "f.2026-10-09.04")).toBe(false);
    expect(L.buildOf("f", 'const FN_BUILD = "f.2026-10-09.04";')).toBeNull();
    expect(L.buildOf("f", 'const FN_BUILD = "f.2026-10-09.4";')).toBe("f.2026-10-09.4");
    expect(L.buildOf("job-board", 'const BUILD_VERSION = "2026-09-09.092";')).toBeNull();
    expect(L.readableBuild("f.2026-10-09.0")).toBe(true);
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

  it("a line that holds the marker and changes anything else is code", () => {
    // behaviour on the declaration's own line
    expect(L.onlyMarkerLines(fn, [
      '-const FN_BUILD = "create-pass-checkout.2026-10-09.1"; const MAX_PASSES = 1;',
      '+const FN_BUILD = "create-pass-checkout.2026-09-27.4"; const MAX_PASSES = 100;',
    ])).toBe(false);
    expect(L.onlyMarkerLines("job-board", [
      '-const BUILD_VERSION = "2026-09-09.91";',
      '+const BUILD_VERSION = "2026-09-09.91"; const DEEP_LANE_CAP = 80;',
    ])).toBe(false);
    // a comment that names the marker, swapped for code that names it too
    expect(L.onlyMarkerLines("agent-mcp", [
      "-// was agent-mcp.2026-10-05.1",
      "+if (!authed) return ok(); // agent-mcp.2026-10-05.1",
    ])).toBe(false);
    // a marker line added with none removed is a new line, not a relabel
    expect(L.onlyMarkerLines(fn, ['+const FN_BUILD = "create-pass-checkout.2026-09-27.4";'])).toBe(false);
    // a name that merely ends in this function's name is not its marker
    expect(L.onlyMarkerLines("checkout", ['-x("create-checkout.2026-10-09.1")', '+x("create-checkout.2026-10-09.2")'])).toBe(false);
  });

  it("every marker shape in the repo still relabels when only the build moves", () => {
    expect(L.onlyMarkerLines("scan-heartbeat", ["-  'x-fn-build': 'scan-heartbeat.2026-10-09.1',", "+  'x-fn-build': 'scan-heartbeat.2026-10-09.2',"])).toBe(true);
    expect(L.onlyMarkerLines("agent-pass-status", ["-const FN_BUILD = `${FN_NAME}.2026-10-08.1`;", "+const FN_BUILD = `${FN_NAME}.2026-10-09.2`;"])).toBe(true);
    expect(L.onlyMarkerLines("apply-agent", ['-const BUILD_VERSION = "2026-10-09.2";', '+const BUILD_VERSION = "2026-10-09.3";'])).toBe(true);
    // a trailing comment that stays the same is still a relabel
    expect(L.onlyMarkerLines(fn, ['-const FN_BUILD = "create-pass-checkout.2026-09-27.3"; // see the pass guard', '+const FN_BUILD = "create-pass-checkout.2026-09-27.4"; // see the pass guard'])).toBe(true);
  });
});
