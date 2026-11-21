// @vitest-environment node
/**
 * W4-1 (board .103): A DEPLOY SEEDS THE BOOTSTRAP LANE WITH WHAT IS NEW, NOT
 * WITH EVERY EMPTY BOARD.
 *
 * Through .102 a version change appended every board holding no rows, and an
 * empty queue at an unchanged version seeded the same list again: 11,776 at
 * the .102 deploy, 4,576 still pending at 2026-11-17 21:21Z (status probe),
 * 27-32 lap-minutes (model F) or 87-113 (model R) of boards the rotation
 * reads anyway. Now a version change REPLACES the queue with (a) the tokens
 * this build repointed, first, (b) the empties no read has ever stamped and
 * (c) the empties of a vendor whose READER_VERSION changed; a failed read
 * seeds nothing and leaves the version unstamped; an empty queue at an
 * unchanged version stays empty.
 *
 * The lane's block and bootstrapSeedFor are lifted from the raw source and run
 * against a recording client (helpers/lift-index.ts), so a reverted fix fails
 * here on behaviour, not on spelling. The pure module is imported inside each
 * test, so on a tree without it those tests fail one by one.
 */
import { describe, expect, it } from "vitest";
import { compile, eqOf, FN, fnSource, op, stubClient, type Call } from "./helpers/lift-index";

const MOD = "../../supabase/functions/job-board/bootstrap-seed";
const seedMod = () => import(MOD);

type Src = { source: string; token: string };
const SOURCES: Src[] = [
  { source: "ashby", token: "toogoodtogo" }, { source: "greenhouse", token: "everstand" },
  { source: "greenhouse", token: "stay" }, { source: "workable", token: "w1" }, { source: "lever", token: "l1" },
  { source: "lever", token: "shared" }, { source: "ashby", token: "shared" },
];

describe("the pure seed (bootstrap-seed.ts)", () => {
  it("(a) names a twin key's token once the key left the catalogue and another vendor carries it, and only twins the last seed had not seen", async () => {
    const { repointedTokens } = await seedMod();
    const twins = ["greenhouse:toogoodtogo", "bamboohr:everstand", "greenhouse:stay", "lever:gone"];
    // greenhouse:stay is still catalogued under its own key; lever:gone's token is carried nowhere.
    expect(repointedTokens(twins, null, SOURCES)).toEqual(["toogoodtogo", "everstand"]);
    expect(repointedTokens(twins, ["greenhouse:toogoodtogo"], SOURCES)).toEqual(["everstand"]);
    expect(repointedTokens(twins, twins, SOURCES)).toEqual([]);
  });

  it("orders (a) repointed, (b) never read, (c) reader changed, each token once, and counts each", async () => {
    const { bootstrapSeed } = await seedMod();
    const r = bootstrapSeed({
      repointed: ["toogoodtogo"],
      empty: ["w1", "toogoodtogo", "l1", "stamped-w", "stamped-l"],
      verified: new Set(["toogoodtogo", "stamped-w", "stamped-l"]),
      vendorsOf: (t: string) => (t.endsWith("w") || t === "w1" ? ["workable"] : ["lever"]),
      changedReaders: new Set(["workable"]),
    });
    expect(r).toEqual({ queue: ["toogoodtogo", "w1", "l1", "stamped-w"], repointed: 1, unread: 2, readerChanged: 1 });
  });

  it("never seeds an empty board a read has stamped when no reader changed", async () => {
    const { bootstrapSeed } = await seedMod();
    const r = bootstrapSeed({ repointed: [], empty: ["a", "b"], verified: new Set(["a", "b"]), vendorsOf: () => ["lever"], changedReaders: new Set() });
    expect(r.queue).toEqual([]);
  });

  it("a reader changed when its entry differs, an absent entry counting as 0", async () => {
    const { readersChanged } = await seedMod();
    expect([...readersChanged({ workable: 1 }, { workable: 2, lever: 1 })].sort()).toEqual(["lever", "workable"]);
    expect([...readersChanged(undefined, {})]).toEqual([]);
    expect([...readersChanged({ lever: 1 }, { lever: 1 })]).toEqual([]);
    expect([...readersChanged({ lever: 1 }, {})]).toEqual(["lever"]);
  });

  it("a repointed token's failure entries go, under the bare token and every source:token key; others stay; nothing to clear is null", async () => {
    const { clearRepointedFailures } = await seedMod();
    const v = {
      streaks: { toogoodtogo: 5, keep: 2, "ashby:toogoodtogo": 1 },
      dormant: { toogoodtogo: "2026-11-01T00:00:00Z" },
      failedAt: { keep: "x" },
      deferredAt: { toogoodtogo: "y" },
      lastRetryLane: { at: "z" },
    };
    expect(clearRepointedFailures(v, ["toogoodtogo"], () => ["ashby"])).toEqual({
      streaks: { keep: 2 }, dormant: {}, failedAt: { keep: "x" }, deferredAt: {}, lastRetryLane: { at: "z" },
    });
    expect(clearRepointedFailures(v, ["nothing"], () => ["lever"])).toBeNull();
  });
});

describe("bootstrapSeedFor, run against a recording client", () => {
  async function run(o: { empty: string[]; stamped: string[]; seen?: unknown; verErr?: boolean; failures?: Record<string, unknown>; readers?: Record<string, number> }) {
    const mod = await seedMod();
    const calls: Call[] = [];
    const logs: string[] = [];
    const client = stubClient((c) => {
      if (c.rpc === "get_empty_boards") return { data: o.empty, error: null };
      if (c.table === "job_board_verifications") {
        if (o.verErr) return { data: null, error: { message: "read failed" } };
        const asked = op(c, "in")![1][1] as string[];
        return { data: asked.filter((t) => o.stamped.includes(t)).map((company_token) => ({ company_token })), error: null };
      }
      if (c.table === "job_board_meta" && op(c, "select")) {
        if (eqOf(c, "k") === "bootstrap_seen") return { data: o.seen === undefined ? null : { v: o.seen }, error: null };
        if (eqOf(c, "k") === "board_failures") return { data: { v: o.failures ?? {} }, error: null };
      }
      return { data: null, error: null };
    }, calls);
    const scope = {
      client, RETIRED_TWIN_KEYS: ["greenhouse:toogoodtogo", "bamboohr:everstand"], JOB_SOURCES: SOURCES, READER_VERSION: o.readers ?? {},
      BUILD_VERSION: "B2", repointedTokens: mod.repointedTokens, bootstrapSeed: mod.bootstrapSeed, readersChanged: mod.readersChanged,
      clearRepointedFailures: mod.clearRepointedFailures, console: { log: (m: string) => logs.push(m) },
    };
    const out = await compile(fnSource("bootstrapSeedFor"), "return bootstrapSeedFor(client);")(scope) as { queue: string[]; commit: () => Promise<unknown> };
    return { out, calls, logs };
  }

  it("seeds the repointed first, then the never-read empties, and reads the stamps in chunks of at most 200", async () => {
    const empty = [...Array.from({ length: 450 }, (_, i) => `e${i}`), "toogoodtogo"];
    const stamped = [...Array.from({ length: 449 }, (_, i) => `e${i}`), "toogoodtogo"];
    const { out, calls } = await run({ empty, stamped });
    expect(out.queue).toEqual(["toogoodtogo", "everstand", "e449"]);
    const reads = calls.filter((c) => c.table === "job_board_verifications").map((c) => (op(c, "in")![1][1] as string[]).length);
    expect(reads).toEqual([200, 200, 51]);
  });

  it("a stamp read that fails throws, so nothing is seeded", async () => {
    await expect(run({ empty: ["a"], stamped: [], verErr: true })).rejects.toMatchObject({ message: "read failed" });
  });

  it("clears the repointed tokens' failure state before the queue is written, and commits what it saw only when asked", async () => {
    const { out, calls } = await run({ empty: [], stamped: [], failures: { dormant: { toogoodtogo: "t", other: "t" }, streaks: { everstand: 9 } } });
    const bf = calls.find((c) => c.table === "job_board_meta" && op(c, "upsert") && (op(c, "upsert")![1][0] as { k: string }).k === "board_failures");
    expect((op(bf!, "upsert")![1][0] as { v: unknown }).v).toEqual({ dormant: { other: "t" }, streaks: {} });
    expect(calls.some((c) => c.table === "job_board_meta" && (op(c, "upsert")?.[1][0] as { k?: string } | undefined)?.k === "bootstrap_seen")).toBe(false);
    await out.commit();
    const seen = calls.find((c) => (op(c, "upsert")?.[1][0] as { k?: string } | undefined)?.k === "bootstrap_seen");
    expect((op(seen!, "upsert")![1][0] as { v: Record<string, unknown> }).v).toMatchObject({ twins: ["greenhouse:toogoodtogo", "bamboohr:everstand"], readers: {}, build: "B2", repointed: 2 });
  });

  it("twins the last seed saw are not seeded again and their failure state is left alone", async () => {
    const { out, calls } = await run({ empty: [], stamped: [], seen: { twins: ["greenhouse:toogoodtogo", "bamboohr:everstand"], readers: {} } });
    expect(out.queue).toEqual([]);
    expect(calls.some((c) => eqOf(c, "k") === "board_failures")).toBe(false);
  });

  it("a vendor whose READER_VERSION moved has its empties seeded even when they were read", async () => {
    const { out } = await run({ empty: ["w1", "l1"], stamped: ["w1", "l1"], seen: { twins: ["greenhouse:toogoodtogo", "bamboohr:everstand"], readers: { workable: 1 } }, readers: { workable: 2 } });
    expect(out.queue).toEqual(["w1"]);
  });
});

/** The lane's block, from its declaration to the deep cursor read, lifted whole. */
const LANE = (() => {
  const a = FN().indexOf("  let bootstrapBoards: JobSource[] = [];");
  const z = FN().indexOf("// Rationale: docs/job-board-index-notes.md#n065-deepcursorrow");
  if (a < 0 || z < a) throw new Error("the bootstrap lane moved; re-point this test");
  return FN().slice(a, z);
})();

async function lane(o: { stored: string; queueAfterTake?: { taken: string[]; drained: number; remaining: number }; seedThrows?: boolean; resetErr?: boolean; appendAbsent?: boolean; legacy?: { queue: string[]; version: string } }) {
  const calls: Call[] = [];
  const client = stubClient((c) => {
    if (c.table === "job_board_meta" && op(c, "select")?.[1][0] === "v->>version") return { data: { version: o.stored }, error: null };
    if (c.table === "job_board_meta" && op(c, "select")?.[1][0] === "v") return { data: { v: o.legacy ?? {} }, error: null };
    if (c.table === "job_board_meta" && op(c, "upsert")) return { error: o.resetErr && (op(c, "upsert")![1][0] as { v: { queue?: unknown[] } }).v.queue?.length === 0 ? { message: "write failed" } : null };
    if (c.rpc === "bootstrap_queue_append") return o.appendAbsent ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } } : { data: 2, error: null };
    if (c.rpc === "bootstrap_queue_take") return { data: o.queueAfterTake ?? { taken: [], drained: 0, remaining: 0 }, error: null };
    if (c.rpc === "get_empty_boards") return { data: ["w1", "l1"], error: null };
    return { data: null, error: null };
  }, calls);
  const scope: Record<string, unknown> = {
    inHotPhase: false, client, baseSlice: [], demandBoards: [], BUILD_VERSION: "B2", bootstrapTake: 3, JOB_SOURCES: SOURCES,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    bootstrapSeedFor: async () => {
      calls.push({ rpc: "SEED", ops: [] });
      if (o.seedThrows) throw new Error("stamps unreadable");
      return { queue: ["toogoodtogo", "w1"], commit: async () => { calls.push({ rpc: "COMMIT", ops: [] }); } };
    },
  };
  const boards = await compile(LANE, "return bootstrapBoards;")(scope) as Src[];
  const seq = calls.map((c) => c.rpc ?? `${c.table}.${op(c, "upsert") ? `upsert:${(op(c, "upsert")![1][0] as { k: string }).k}` : "select"}`);
  return { boards, calls, seq };
}
const takeArgs = (calls: Call[]) => calls.filter((c) => c.rpc === "bootstrap_queue_take").map((c) => c.ops[0][1][0] as { p_stamp_version: boolean });

describe("the lane, run against a recording client", () => {
  it("an empty queue at an unchanged version stays empty: no empty-board read, no append, one take", async () => {
    const { seq } = await lane({ stored: "B2" });
    expect(seq.filter((s) => s === "get_empty_boards" || s === "bootstrap_queue_append" || s === "SEED")).toEqual([]);
    expect(seq.filter((s) => s === "bootstrap_queue_take")).toHaveLength(1);
  });

  it("a version change replaces the queue with the seed, takes with the version stamped, then commits it", async () => {
    const { seq, calls, boards } = await lane({ stored: "B1", queueAfterTake: { taken: ["toogoodtogo", "w1"], drained: 2, remaining: 0 } });
    // The commit waits for the take: a take that fails leaves the version unstamped, and the next slice's re-seed
    // must still read this build's repointed tokens as new (a-failed-take-keeps-the-repointed-boards-in-the-lane).
    expect(seq).toEqual(["job_board_meta.select", "SEED", "job_board_meta.upsert:bootstrap", "bootstrap_queue_append", "bootstrap_queue_take", "COMMIT", "bootstrap_queue_stamp"]);
    const reset = calls.find((c) => (op(c, "upsert")?.[1][0] as { k?: string } | undefined)?.k === "bootstrap");
    expect((op(reset!, "upsert")![1][0] as { v: unknown }).v).toEqual({ queue: [], version: "B1" });
    expect(calls.find((c) => c.rpc === "bootstrap_queue_append")!.ops[0][1][0]).toEqual({ p_tokens: ["toogoodtogo", "w1"] });
    expect(takeArgs(calls)).toEqual([expect.objectContaining({ p_stamp_version: true })]);
    expect(boards.map((b) => b.token)).toEqual(["toogoodtogo", "w1"]);
  });

  it("a seed that cannot read seeds nothing and leaves the version unstamped, so the next slice tries again", async () => {
    const { seq, calls } = await lane({ stored: "B1", seedThrows: true });
    expect(seq.filter((s) => s === "bootstrap_queue_append" || s === "COMMIT" || s.endsWith("upsert:bootstrap"))).toEqual([]);
    expect(takeArgs(calls)).toEqual([expect.objectContaining({ p_stamp_version: false })]);
  });

  it("a reset that does not land appends nothing and stamps nothing", async () => {
    const { seq, calls } = await lane({ stored: "B1", resetErr: true });
    expect(seq.filter((s) => s === "bootstrap_queue_append" || s === "COMMIT")).toEqual([]);
    expect(takeArgs(calls)).toEqual([expect.objectContaining({ p_stamp_version: false })]);
  });

  it("the legacy path (RPCs absent) seeds the same way: a version change writes the seed, an unchanged empty queue is never refilled", async () => {
    const changed = await lane({ stored: "B1", appendAbsent: true, legacy: { queue: ["old1", "old2"], version: "B1" } });
    const write = changed.calls.filter((c) => (op(c, "upsert")?.[1][0] as { k?: string } | undefined)?.k === "bootstrap").pop()!;
    expect((op(write, "upsert")![1][0] as { v: { queue: string[]; version: string } }).v).toMatchObject({ queue: [], version: "B2" });
    expect(changed.boards.map((b) => b.token)).toEqual(["toogoodtogo", "w1"]);
    expect(changed.seq.at(-1)).toBe("COMMIT");
    const same = await lane({ stored: "B1", appendAbsent: true, legacy: { queue: [], version: "B2" } });
    expect(same.seq.filter((s) => s === "get_empty_boards")).toEqual([]);
    expect(same.boards).toEqual([]);
  });
});
