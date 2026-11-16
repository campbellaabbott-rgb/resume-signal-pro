// @vitest-environment node
/**
 * S14X-063 part (b) (board .102): a feed that answered 200 with items, every
 * one of which our normaliser dropped (a renamed field, a vendor schema
 * change), read as an EMPTY board. The visit stamped every stored row missing
 * on that first read, which hides it at once, and closed them after the grace.
 * A vendor-wide drift hid and then deleted whole boards before any breaker
 * could see it.
 *
 * Now raw items with no normalised row are drift, not emptiness: the board is
 * skipped for this visit the way a deferral is (no failure streak, no stamp,
 * no closure, its lap marked unproven) and the slice record names it in
 * rawNoRows. The vendor breaker still counts it as a zero read. Ashby and ADP
 * drop unlisted and internal postings by design, so an all-unlisted board
 * there is a real empty board and keeps today's path. A Workday board emptied
 * by the cross-site dedupe is not drift either: the test is taken before it.
 *
 * Runs the shipped span, lifted from index.ts, with the real rawItemCount.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { rawItemCount } from "../../supabase/functions/job-board/vendor-canary";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const a = FN.indexOf("        // S14X-063(b): items that all failed to normalise");
const tail = "        if (unread) {\n";
const b = FN.indexOf(tail, a);
if (a < 0 || b < 0) throw new Error("the S14X-063(b) span moved; re-point this test");
const SPAN = FN.slice(a, FN.indexOf("\n        }\n", b) + "\n        }\n".length);

type Job = { id: string };
type Board = { source: string; token: string };
function visit(s: Board, r: { jobs: Job[]; raw: unknown }, o: { quarantined?: boolean; held?: string[] } = {}) {
  const sliceReads = { rawNoRows: [] as string[] };
  const budgetSkipped: string[] = [];
  const vendorStats = new Map<string, { a: number; z: number }>();
  const quarantineSkipped = new Set<string>();
  let lapFailed = 0;
  let reachedIngest = false;
  const calls: string[] = [];
  const client = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "like", "or", "limit", "in"]) q[m] = (...x: unknown[]) => { calls.push(m); if (m === "in") (q as { _in?: unknown })._in = x; return q; };
      (q as { then: unknown }).then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: (q as { _in?: unknown })._in ? [] : (o.held ?? []).map((id) => ({ id })) }).then(res);
      return q;
    },
  };
  const js = ts.transpileModule(`return (async () => { for (const s of boards) {\n${SPAN}\nreachIngest(); } })();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return (new Function("boards", "r", "client", "rawItemCount", "sliceReads", "budgetSkipped", "vendorStats", "quarantinedVendors", "quarantineSkipped", "failLap", "boardKeyOf", "reachIngest", "console", js) as (...x: unknown[]) => Promise<void>)(
    [s], r, client, rawItemCount, sliceReads, budgetSkipped, vendorStats, new Set(o.quarantined ? [s.source] : []), quarantineSkipped,
    () => { lapFailed++; }, (b: Board) => `${b.source}:${b.token}`, () => { reachedIngest = true; }, { log: () => {}, warn: () => {} },
  ).then(() => ({ rawNoRows: sliceReads.rawNoRows, budgetSkipped, lapFailed, reachedIngest, zero: vendorStats.get(s.source), quarantineSkipped, calls }));
}

const GH = { source: "greenhouse", token: "acme" };

describe("a board whose items did not normalise is not empty", () => {
  it("raw items with no normalised row: skipped this visit, named in rawNoRows, its lap unproven, nothing stamped", async () => {
    const x = await visit(GH, { jobs: [], raw: { jobs: [{ id: 1, title: "A" }, { id: 2, title: "B" }] } });
    expect(x.reachedIngest, "the visit must not reach the stamp-and-close path").toBe(false);
    expect(x.rawNoRows).toEqual(["greenhouse:acme"]);
    expect(x.budgetSkipped, "a skip, not a failure: no streak toward dormancy").toEqual(["acme"]);
    expect(x.lapFailed).toBe(1);
    expect(x.zero, "the vendor breaker still counts the zero read").toEqual({ a: 1, z: 1 });
  });

  it("a feed with no items at all is still a real empty board and reaches the ingest as before", async () => {
    for (const raw of [{ jobs: [] }, null, {}]) {
      const x = await visit(GH, { jobs: [], raw });
      expect(x.reachedIngest, JSON.stringify(raw)).toBe(true);
      expect(x.rawNoRows).toEqual([]);
    }
  });

  it("a board that normalised rows reaches the ingest", async () => {
    const x = await visit(GH, { jobs: [{ id: "greenhouse:acme:1" }], raw: { jobs: [{ id: 1 }, { id: 2 }] } });
    expect(x.reachedIngest).toBe(true);
    expect(x.rawNoRows).toEqual([]);
  });

  it("Ashby and ADP drop unlisted and internal postings by design, so an all-unlisted board keeps today's path", async () => {
    expect((await visit({ source: "ashby", token: "acme" }, { jobs: [], raw: { jobs: [{ id: "x", isListed: false }] } })).reachedIngest).toBe(true);
    expect((await visit({ source: "adp", token: "acme" }, { jobs: [], raw: { jobRequisitions: [{ itemID: "x" }] } })).reachedIngest).toBe(true);
  });

  it("a quarantined vendor's zero read keeps its own skip, and is not named twice", async () => {
    const x = await visit(GH, { jobs: [], raw: { jobs: [{ id: 1 }] } }, { quarantined: true });
    expect([...x.quarantineSkipped]).toEqual(["acme"]);
    expect(x.rawNoRows).toEqual([]);
  });

  it("a Workday page the cross-site dedupe emptied is not drift: the test is taken before the dedupe", async () => {
    const wd = { source: "workday", token: "acme~wd5~Ext" };
    const jobs = [{ id: "workday:acme~wd5~Ext:R123-1" }, { id: "workday:acme~wd5~Ext:R456-2" }];
    const x = await visit(wd, { jobs, raw: { jobPostings: [{}, {}] } }, { held: ["workday:acme~wd5~Other:R123", "workday:acme~wd5~Other:R456"] });
    expect(x.calls, "the dedupe ran").toContain("or");
    expect(x.reachedIngest).toBe(true);
    expect(x.rawNoRows).toEqual([]);
  });
});
