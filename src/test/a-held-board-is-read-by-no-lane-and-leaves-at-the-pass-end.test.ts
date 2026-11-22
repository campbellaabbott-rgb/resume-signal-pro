// @vitest-environment node
/**
 * H8 (board .103): A HELD BOARD IS READ BY NO LANE, WHATEVER ITS SIZE, AND
 * ITS ROWS LEAVE AT THE PASS END.
 *
 * WORKABLE_OVERSIZE_HELD was consulted only on the oversize retry, so a held
 * board whose feed fit was read like any other: weekday-1 served 153 rows on
 * 2026-11-17. The hold now covers five boards (nogigiddy, weekday-1,
 * hire-resolve-the-top-recruitment-agency, mercier-consultancy and
 * mercier-consultancy-group; the mill screen marks two EXCLUDE and three for
 * review, all waiting on OD1). Every slice, hot or cold, puts a held board in
 * its skip set before any read, and the pass-end prune removes what a held
 * board still serves by its own vendor, logged as untracked, in the same
 * branch as the retired twins (only while the orphan prune is not blocked).
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { compile, constSource, FN } from "./helpers/lift-index";
import { classifyDormancy } from "../../supabase/functions/job-board/dormancy";

const HELD = ["hire-resolve-the-top-recruitment-agency", "mercier-consultancy", "mercier-consultancy-group", "nogigiddy", "weekday-1"];
const held = async () => await compile(constSource("WORKABLE_OVERSIZE_HELD"), "return WORKABLE_OVERSIZE_HELD;")({}) as Set<string>;

describe("the hold", () => {
  it("names the five boards waiting on OD1", async () => {
    expect([...(await held())].sort()).toEqual(HELD);
  });
});

describe("no lane reads a held board", () => {
  const SPAN = (() => {
    const a = FN().indexOf("  let skipTokens = new Set<string>();");
    const z = FN().indexOf("  // Rationale: docs/job-board-index-notes.md#n073-the-cursor-rule");
    if (a < 0 || z < a) throw new Error("the skip set moved; re-point this test");
    return FN().slice(a, z);
  })();
  type B = { source: string; token: string };
  const skip = async (o: { inHotPhase: boolean; slice: B[]; baseSlice?: B[]; demandBoards?: B[] }) =>
    [...(await compile(SPAN, "return skipTokens;")({
      inHotPhase: o.inHotPhase, slice: o.slice, baseSlice: o.baseSlice ?? [], demandBoards: o.demandBoards ?? [],
      boardFailures: { dormant: {} }, classifyDormancy, DORMANT_RECHECK_MS: 3_600_000, boardKeyOf: (s: B) => s.token,
      WORKABLE_OVERSIZE_HELD: await held(),
    }) as Set<string>)].sort();

  it("a hot slice skips a held board", async () => {
    expect(await skip({ inHotPhase: true, slice: [{ source: "workable", token: "weekday-1" }, { source: "workable", token: "acme" }] })).toEqual(["weekday-1"]);
  });

  it("a cold slice skips a held board in any lane, demand included, beside the dormant ones", async () => {
    const demand = [{ source: "workable", token: "mercier-consultancy" }];
    const base = [{ source: "workable", token: "nogigiddy" }, { source: "lever", token: "weekday-1" }];
    expect(await skip({ inHotPhase: false, slice: [...demand, ...base], baseSlice: base, demandBoards: demand })).toEqual(["mercier-consultancy", "nogigiddy"]);
  });
});

describe("a held board's rows leave at the pass end", () => {
  const a = FN().indexOf("  const validTokens = new Set(JOB_SOURCES.map((s) => s.token));");
  const z = FN().indexOf('await breadcrumb(client, "pass-end-pruned"', a);
  const SPAN = FN().slice(a, FN().indexOf("\n  }\n", z) + "\n  }\n".length);

  async function pass(o: { highwater: number; sources: Array<{ source: string; token: string }> }) {
    const pruned: Array<[string, string, string | null]> = [];
    const crumbs: Array<Record<string, unknown>> = [];
    const client = {
      from: () => {
        const q: Record<string, unknown> = {};
        for (const m of ["select", "eq"]) q[m] = () => q;
        q.maybeSingle = async () => ({ data: { v: { size: o.highwater } } });
        q.upsert = async () => ({ error: null });
        return q;
      },
    };
    const js = ts.transpileModule(`return (async () => {\n${SPAN}\nreturn companies; })();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    await new Function("client", "JOB_SOURCES", "RETIRED_TWIN_KEYS", "WORKABLE_OVERSIZE_HELD", "facetsOk", "companies", "pruneWholeBoard", "breadcrumb", "sliceWallStart", "console", js)(
      client, o.sources, [], await held(), true, [],
      async (_c: unknown, token: string, reason: string, source: string | null) => { pruned.push([token, reason, source]); return { logged: 2, complete: true }; },
      async (_c: unknown, _m: string, v: Record<string, unknown>) => { crumbs.push(v); }, Date.now(), { log: () => {}, warn: () => {} },
    );
    return { pruned, crumbs };
  }

  it("each held board is pruned by its own vendor and token, as untracked, and the count is recorded", async () => {
    const sources = HELD.map((token) => ({ source: "workable", token }));
    const { pruned, crumbs } = await pass({ highwater: sources.length, sources });
    expect(pruned.sort()).toEqual(HELD.map((t) => [t, "untracked", "workable"]));
    expect(crumbs[0]?.heldLogged).toBe(2 * HELD.length);
  });

  it("nothing is pruned while the high-water blocks the orphan prune", async () => {
    const sources = HELD.map((token) => ({ source: "workable", token }));
    expect((await pass({ highwater: sources.length + 1, sources })).pruned).toEqual([]);
  });
});
