// @vitest-environment node
/**
 * BOARD .103 REVIEW (correctness lens): W4-1 COMMITTED WHAT IT SEEDED BEFORE
 * THE TAKE STAMPED THE VERSION.
 *
 * bootstrap_seen (the retired twin keys and the reader versions) was written
 * before bootstrap_queue_take stamped the build's version. A take that failed
 * (a statement timeout) was swallowed and left the version unstamped, so the
 * next slice re-seeded and REPLACED the queue, but the committed twins told
 * that re-seed nothing was repointed: the repointed boards left the lane and
 * waited for their cold lap. The seed is now committed only after the take.
 *
 * Runs the real bootstrap lane and the real bootstrapSeedFor, lifted from
 * job-board/index.ts, against a stateful stub.
 */
import { describe, expect, it } from "vitest";
import { compile, eqOf, FN, fnSource, op, stubClient, type Call } from "./helpers/lift-index";

const LANE = (() => {
  const a = FN().indexOf("  let bootstrapBoards: JobSource[] = [];");
  const z = FN().indexOf("// Rationale: docs/job-board-index-notes.md#n065-deepcursorrow");
  if (a < 0 || z < a) throw new Error("the bootstrap lane moved; re-point this test");
  return FN().slice(a, z);
})();
type Src = { source: string; token: string };
const SOURCES: Src[] = [
  { source: "ashby", token: "toogoodtogo" }, { source: "greenhouse", token: "everstand" }, { source: "workable", token: "w1" },
];

describe("W4-1: a take that fails after the seed was appended", () => {
  it("leaves bootstrap_seen unwritten, so the next slice's re-seed still queues the repointed tokens first", async () => {
    const mod = await import("../../supabase/functions/job-board/bootstrap-seed");
    const meta: Record<string, unknown> = { bootstrap: { queue: ["old1", "old2"], version: "B1" } };
    let takeFails = true;
    const taken: string[][] = [];
    const client = stubClient((c: Call) => {
      if (c.table === "job_board_meta" && op(c, "upsert")) { const r = op(c, "upsert")![1][0] as { k: string; v: unknown }; meta[r.k] = r.v; return { error: null }; }
      if (c.table === "job_board_meta" && op(c, "select")) {
        const col = op(c, "select")![1][0];
        const row = meta[eqOf(c, "k") as string] as Record<string, unknown> | undefined;
        if (col === "v->>version") return { data: row ? { version: row.version } : null, error: null };
        return { data: row ? { v: row } : null, error: null };
      }
      if (c.table === "job_board_verifications") return { data: [], error: null };
      const args = c.ops?.[0]?.[1]?.[0] as Record<string, unknown> | undefined;
      if (c.rpc === "get_empty_boards") return { data: ["w1"], error: null };
      if (c.rpc === "bootstrap_queue_append") { const b = meta.bootstrap as { queue: string[] }; b.queue.push(...(args!.p_tokens as string[])); return { data: b.queue.length, error: null }; }
      if (c.rpc === "bootstrap_queue_take") {
        if (takeFails) return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
        const b = meta.bootstrap as { queue: string[]; version: string };
        const t = b.queue.splice(0, args!.p_n as number);
        if (args!.p_stamp_version) b.version = args!.p_version as string;
        taken.push(t);
        return { data: { taken: t, drained: t.length, remaining: b.queue.length }, error: null };
      }
      return { data: null, error: null };
    });
    const seedScope = {
      client, RETIRED_TWIN_KEYS: ["greenhouse:toogoodtogo", "bamboohr:everstand"], JOB_SOURCES: SOURCES, READER_VERSION: {},
      BUILD_VERSION: "B2", repointedTokens: mod.repointedTokens, bootstrapSeed: mod.bootstrapSeed, readersChanged: mod.readersChanged,
      clearRepointedFailures: mod.clearRepointedFailures, console: { log: () => {} },
    };
    const bootstrapSeedFor = await compile(fnSource("bootstrapSeedFor"), "return bootstrapSeedFor;")(seedScope);
    const slice = () => compile(LANE, "return bootstrapBoards;")({
      inHotPhase: false, client, baseSlice: [], demandBoards: [], BUILD_VERSION: "B2", bootstrapTake: 10, JOB_SOURCES: SOURCES,
      console: { log: () => {}, error: () => {}, warn: () => {} }, bootstrapSeedFor,
    });

    await slice(); // the version change: seed, append, take -> statement timeout
    expect((meta.bootstrap as { version: string }).version).toBe("B1");
    expect(meta.bootstrap_seen, "the seed was committed though the take never stamped the version").toBeUndefined();
    takeFails = false;
    const boards = await slice() as Src[]; // the version is still B1: re-seed, replace, take
    expect(taken[0], "the repointed boards left the lane").toEqual(expect.arrayContaining(["toogoodtogo", "everstand"]));
    expect(boards.map((b) => b.token).slice(0, 2)).toEqual(["toogoodtogo", "everstand"]);
    expect((meta.bootstrap as { version: string }).version).toBe("B2");
    expect((meta.bootstrap_seen as { twins: string[] }).twins, "committed once the take stamped the version").toEqual(["greenhouse:toogoodtogo", "bamboohr:everstand"]);
  });
});
