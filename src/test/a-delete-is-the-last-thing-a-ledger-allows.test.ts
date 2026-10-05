import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { boardKey, dropBareSharedKeys, keySource, keyToken, rearmIncompletePrunes, updateBoardFailures } from "../../supabase/functions/job-board/dormancy";
import { tokensOf } from "../../supabase/functions/job-board/stale-lane";
import { cursorAfterFailure } from "../../supabase/functions/job-board/read-window";
import { detectWorkMode, isPlacelessLocation, listMayRewriteMode, normalizeCloseTitle } from "../../supabase/functions/job-board/normalize";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { codeOf } from "./helpers/strip-comments";

/**
 * THE LEDGER BEFORE THE DELETE, ONE BOARD PER KEY, AND ONE READER PER FIELD (.89).
 *
 *  - L13-71 (old 2.29): the refresh's closure prune deleted a 200-row chunk
 *    even when its closure read or insert had failed, and the dormant/orphan
 *    prunes deleted a whole token when the exit log broke on page 1.
 *  - L13-49 (old 2.13): failure state was keyed by token although 139 tokens
 *    carry two or three vendors, so a reading twin cleared a dead twin's
 *    streak forever, and a prune deleted both vendors' rows.
 *  - L13-17 (old 1.33): the refresh wrote the Workday LIST payload's weaker
 *    readings (no work mode, "8 Locations") back over what the detail sweeps
 *    had filled, every rotation, logging each undo as an employer edit.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);

/** The source of one top-level function in index.ts, as JavaScript. */
function lifted(name: string, kind: "async function" | "function" = "async function"): string {
  const at = FN.indexOf(`\n${kind} ${name}(`);
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
function build<T>(names: string[], deps: Record<string, unknown>, ret: string): T {
  const keys = Object.keys(deps);
  return new Function(...keys, `${names.join("\n")}\nreturn ${ret};`)(...keys.map((k) => deps[k])) as T;
}

type Q = { table: string; op: string; cols?: string; rows?: unknown; filters: Array<[string, string, unknown]>; range?: [number, number] };
type Answer = { data?: unknown; error?: { message: string } | null } | undefined;
/** A supabase-js stand-in: every awaited query is recorded and answered by `handle`. */
function fakeClient(handle: (q: Q) => Answer) {
  const calls: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, op: "", filters: [] };
    const b: Record<string, unknown> = {
      select(cols: string) { if (!q.op) q.op = "select"; q.cols = cols; return b; },
      insert(rows: unknown) { q.op = "insert"; q.rows = rows; return b; },
      update(patch: unknown) { q.op = "update"; q.rows = patch; return b; },
      upsert(rows: unknown) { q.op = "upsert"; q.rows = rows; return b; },
      delete() { q.op = "delete"; return b; },
      in(c: string, v: unknown) { q.filters.push(["in", c, v]); return b; },
      eq(c: string, v: unknown) { q.filters.push(["eq", c, v]); return b; },
      is(c: string, v: unknown) { q.filters.push(["is", c, v]); return b; },
      gt(c: string, v: unknown) { q.filters.push(["gt", c, v]); return b; },
      match(o: Record<string, unknown>) { for (const [k, v] of Object.entries(o)) q.filters.push(["eq", k, v]); return b; },
      order() { return b; },
      limit() { return b; },
      range(a: number, z: number) { q.range = [a, z]; return b; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        calls.push(q);
        return Promise.resolve().then(() => handle(q)).then((r) => ({ data: r?.data ?? null, error: r?.error ?? null })).then(res, rej);
      },
    };
    return b;
  };
  const deleted = () => calls.filter((c) => c.op === "delete");
  return { client: { from }, calls, deleted };
}
const idsOf = (q: Q) => (q.filters.find((f) => f[0] === "in" && f[1] === "id")?.[2] ?? []) as string[];

describe("the closure prune deletes only rows whose ledger row landed (L13-71)", () => {
  const OPTIONAL = (name: string) => {
    const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(CODE);
    expect(m, `${name} not found`).toBeTruthy();
    return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
  };
  const NOW = Date.parse("2026-10-05T12:00:00Z");
  const fresh = new Date(NOW - 3 * 86_400_000).toISOString();
  const old = new Date(NOW - 40 * 86_400_000).toISOString();
  /** Two closable rows and one the freshness cap aged out, on a board read whole. */
  const ROWS = [
    { id: "greenhouse:acme:1", source: "greenhouse", company_token: "acme", title: "Welder", category: "other", posted_at: fresh, first_seen: fresh },
    { id: "greenhouse:acme:2", source: "greenhouse", company_token: "acme", title: "Nurse", category: "other", posted_at: fresh, first_seen: fresh },
    { id: "greenhouse:acme:3", source: "greenhouse", company_token: "acme", title: "Driver", category: "other", posted_at: old, first_seen: old },
  ];
  const CHUNK = ROWS.map((r) => r.id);
  const closeVanishedChunk = (fail: { read?: boolean; closure?: boolean; exits?: boolean; throws?: boolean }) => {
    const fake = fakeClient((q) => {
      if (fail.throws && q.op === "select") throw new Error("socket hang up");
      if (q.table === "job_board_postings" && q.op === "select") return fail.read ? { error: { message: "canceling statement due to statement timeout" } } : { data: ROWS };
      if (q.table === "job_board_closures" && q.op === "insert") return fail.closure ? { error: { message: "timeout" } } : {};
      if (q.table === "job_board_exits" && q.op === "insert") return fail.exits ? { error: { message: "timeout" } } : {};
      return {};
    });
    const background: Promise<unknown>[] = [];
    const fn = build<(c: unknown, s: unknown, chunk: string[], ctx: unknown) => Promise<string[]>>(
      [lifted("settleInsertError"), lifted("insertExits"), lifted("closeVanishedChunk")],
      {
        LIFECYCLE_SELECT: "*",
        EXIT_OPTIONAL_COLS: OPTIONAL("EXIT_OPTIONAL_COLS"),
        CLOSURE_OPTIONAL_COLS: OPTIONAL("CLOSURE_OPTIONAL_COLS"),
        tenureDays: () => ({ days: 3, basis: "stated" }),
        exitReasonFor: () => "aged_out",
        lifecycleFacets: () => ({}),
        normalizeCloseTitle,
        waitUntil: (p: Promise<unknown>) => { background.push(p); },
        console: { warn: () => {}, log: () => {} },
      },
      "closeVanishedChunk",
    );
    const run = () => fn(fake.client, { source: "greenhouse", token: "acme" }, CHUNK, {
      closedAt: new Date(NOW).toISOString(), agedOutIds: new Set<string>(), freshCutoffMs: NOW - 30 * 86_400_000,
      liveTitles: new Set<string>(), recentSuperseded: new Set<string>(), batchSuspect: false,
      absentInPass: 3, removableBefore: 40, lapMode: false, lapBackfillUntil: "", missingSinceById: new Map(), startIso: new Date(NOW).toISOString(),
    });
    return { run, fake, background };
  };

  it("with every ledger write landing, all three go: two closures, one aged exit", async () => {
    const { run, fake, background } = closeVanishedChunk({});
    expect((await run()).sort()).toEqual(CHUNK);
    await Promise.all(background);
    const closures = fake.calls.find((c) => c.table === "job_board_closures" && c.op === "insert")!.rows as Array<{ posting_id: string; absence_basis: string }>;
    expect(closures.map((r) => r.posting_id).sort()).toEqual(["greenhouse:acme:1", "greenhouse:acme:2"]);
    expect(closures.every((r) => r.absence_basis === "full_read")).toBe(true);
    expect(fake.deleted().flatMap(idsOf).sort()).toEqual(CHUNK);
  });

  it("a failed read keeps the whole chunk, and so does a read that throws", async () => {
    for (const fail of [{ read: true }, { throws: true }]) {
      const { run, fake } = closeVanishedChunk(fail);
      expect(await run()).toEqual([]);
      expect(fake.deleted(), "a chunk whose rows were never read was deleted unrecorded").toEqual([]);
    }
  });

  it("a failed closure insert keeps the rows it was writing; the aged row whose exit landed goes", async () => {
    const { run, fake } = closeVanishedChunk({ closure: true });
    expect(await run()).toEqual(["greenhouse:acme:3"]);
    expect(fake.deleted().flatMap(idsOf)).toEqual(["greenhouse:acme:3"]);
    expect(fake.calls.filter((c) => c.table === "job_board_exits").every((c) => (c.rows as Array<{ exit_reason: string }>).every((r) => r.exit_reason !== "removed")),
      "a removed-exit was written beside a closure that did not land").toBe(true);
  });

  it("a failed aged-exit insert keeps the aged row: nothing leaves without its ledger row", async () => {
    const { run, fake, background } = closeVanishedChunk({ exits: true });
    const gone = await run();
    await Promise.allSettled(background);
    expect(gone.sort(), "the aged row was deleted while its exit insert failed").toEqual(["greenhouse:acme:1", "greenhouse:acme:2"]);
    expect(fake.deleted().flatMap(idsOf)).not.toContain("greenhouse:acme:3");
  });

  it("the refresh hands every confirmed-vanished chunk to it", () => {
    expect(CODE).toMatch(/await closeVanishedChunk\(client, s, vanished\.slice\(i, i \+ 200\), \{/);
  });
});

describe("a whole-board prune deletes only what the exit log holds (L13-71)", () => {
  const prune = (pages: number, failPage: number | null, insertFails = false) => {
    const fake = fakeClient((q) => {
      if (q.table === "job_board_postings" && q.op === "select") {
        const [a] = q.range ?? [0, 0];
        const page = a / 500;
        if (page === failPage) return { error: { message: "canceling statement due to statement timeout" } };
        const n = page < pages - 1 ? 500 : page === pages - 1 ? 120 : 0;
        return { data: Array.from({ length: n }, (_, k) => ({ id: `workday:t~wd1~S:R${a + k}`, source: "workday", company_token: "t~wd1~S" })) };
      }
      if (q.table === "job_board_exits" && q.op === "insert") return insertFails ? { error: { message: "timeout" } } : {};
      return {};
    });
    const fn = build<(c: unknown, token: string, reason: string, source: string | null) => Promise<{ logged: number; complete: boolean }>>(
      [lifted("settleInsertError"), lifted("insertExits"), lifted("logWholeBoardExit"), lifted("pruneWholeBoard")],
      {
        LIFECYCLE_SELECT: "*", EXIT_OPTIONAL_COLS: [], tenureDays: () => ({ days: 1, basis: "stated" }), lifecycleFacets: () => ({}),
        console: { warn: () => {}, log: () => {} },
      },
      "pruneWholeBoard",
    );
    return { run: () => fn(fake.client, "t~wd1~S", "board_dormant", "workday"), fake };
  };

  it("every page logged: the board is deleted whole, scoped to its own vendor", async () => {
    const { run, fake } = prune(3, null);
    expect(await run()).toEqual({ logged: 1_120, complete: true });
    const del = fake.deleted();
    expect(del).toHaveLength(1);
    expect(del[0].filters).toEqual([["eq", "company_token", "t~wd1~S"], ["eq", "source", "workday"]]);
  });

  it("page 2's read fails: only page 1's logged ids are deleted, the rest of the board stays", async () => {
    const { run, fake } = prune(3, 1);
    expect(await run()).toEqual({ logged: 500, complete: false });
    const ids = fake.deleted().flatMap(idsOf);
    expect(ids).toHaveLength(500);
    expect(ids.every((id) => Number(id.split(":R")[1]) < 500)).toBe(true);
    expect(fake.deleted().some((d) => d.filters.some((f) => f[1] === "company_token")), "a token-wide delete after a broken exit log").toBe(false);
  });

  it("page 1's read fails: nothing is deleted", async () => {
    const { run, fake } = prune(3, 0);
    expect(await run()).toEqual({ logged: 0, complete: false });
    expect(fake.deleted()).toEqual([]);
  });

  it("the exit insert fails: nothing is deleted", async () => {
    const { run, fake } = prune(3, null, true);
    expect((await run()).complete).toBe(false);
    expect(fake.deleted()).toEqual([]);
  });

  it("a dormant prune the exit log broke is retried on the board's next failing visit, not left dormant", () => {
    const t0 = Date.parse("2026-10-01T00:00:00Z");
    const before = { streaks: { dead: 5 }, dormant: {}, failedAt: { dead: t0 + 39 * 3_600_000 }, firstFailedAt: { dead: t0 } };
    const now = t0 + 41 * 3_600_000;
    const out = updateBoardFailures({ okTokens: [], failedTokens: ["dead"], recheckTokens: new Set(), ...before, deadThreshold: 6, minFailureAgeMs: 40 * 3_600_000, dormantCap: 500, now });
    expect(out.toPrune).toEqual(["dead"]);
    // pruneWholeBoard came back incomplete:
    const rearmed = rearmIncompletePrunes(out, ["dead"], before, 6, now);
    expect(Object.prototype.hasOwnProperty.call(rearmed.dormant, "dead"), "left dormant, the unlogged rows would never be retried").toBe(false);
    expect(rearmed.streaks.dead).toBe(5);
    expect(rearmed.firstFailedAt.dead, "the streak keeps its original start, so the 40h floor is already met").toBe(t0);
    const next = updateBoardFailures({ okTokens: [], failedTokens: ["dead"], recheckTokens: new Set(), ...rearmed, deadThreshold: 6, minFailureAgeMs: 40 * 3_600_000, dormantCap: 500, now: now + 3_600_000 });
    expect(next.toPrune, "the next failing visit prunes again").toEqual(["dead"]);
    const healed = updateBoardFailures({ okTokens: ["dead"], failedTokens: [], recheckTokens: new Set(), ...rearmed, deadThreshold: 6, minFailureAgeMs: 40 * 3_600_000, dormantCap: 500, now: now + 3_600_000 });
    expect(healed.toPrune).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(healed.streaks, "dead"), "a board that reads again is simply healthy").toBe(false);
    // A complete prune changes nothing.
    expect(rearmIncompletePrunes(out, [], before, 6, now)).toBe(out);
    expect(CODE).toMatch(/if \(!complete\) pruneUnfinished\.push\(key\);/);
    expect(CODE).toMatch(/rearmIncompletePrunes\(folded, pruneUnfinished, boardFailures, DEAD_BOARD_THRESHOLD, Date\.now\(\)\)/);
  });
});

describe("verify only stamps, and an uncatalogued board is undecidable (L13-70)", () => {
  /** The shipped verify action from its result map to its answer, run against a stub catalogue and probe. */
  const verify = (stored: Array<{ id: string; missing_since: string | null }>, live: Record<string, boolean | null>) => {
    const a = FN.indexOf("const liveMap: Record<string, boolean | null> = {};");
    const z = FN.indexOf("return json({ live: liveMap, flagged: deadIds.length });", a);
    expect(a, "verify's result map not found").toBeGreaterThan(-1);
    expect(z, "verify's answer not found").toBeGreaterThan(a);
    const src = `async function verifyCore(ids, client) {\n${FN.slice(a, z)}return json({ live: liveMap, flagged: deadIds.length });\n}`;
    const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const fake = fakeClient((q) => {
      if (q.table === "job_board_postings" && q.op === "select") {
        const want = new Set(idsOf(q));
        return { data: stored.filter((r) => want.has(r.id)).map((r) => ({ ...r, apply_url: null })) };
      }
      return {};
    });
    const fn = new Function("JOB_SOURCES", "checkLive", "liveBoardMemo", "readDemand", "admitDemand", "DEMAND_QUEUE_KEY", "json", `${js}\nreturn verifyCore;`)(
      [{ source: "greenhouse", token: "acme", name: "Acme" }],
      async (_src: unknown, externalId: string) => live[externalId] ?? null,
      new Map(),
      async () => ({ queue: [], served: {} }),
      () => null,
      "demand_queue",
      (v: unknown) => v,
    ) as (ids: string[], client: unknown) => Promise<{ live: Record<string, boolean | null>; flagged: number }>;
    return { run: (ids: string[]) => fn(ids, fake.client), fake };
  };

  it("a confirmed-gone posting is stamped missing, never deleted, and a second miss does not delete either", async () => {
    const stamped = "2026-10-04T00:00:00.000Z";
    const { run, fake } = verify(
      [{ id: "greenhouse:acme:1", missing_since: null }, { id: "greenhouse:acme:2", missing_since: stamped }],
      { "1": false, "2": false },
    );
    const out = await run(["greenhouse:acme:1", "greenhouse:acme:2"]);
    expect(out.live).toEqual({ "greenhouse:acme:1": false, "greenhouse:acme:2": false });
    expect(fake.deleted(), "verify deleted a row; only the refresh, which writes the ledger, may").toEqual([]);
    const updates = fake.calls.filter((c) => c.op === "update");
    expect(updates.flatMap(idsOf), "only the first miss is stamped").toEqual(["greenhouse:acme:1"]);
    expect(Object.keys(updates[0].rows as object)).toEqual(["missing_since"]);
  });

  it("an id on a board we no longer catalogue is null (undecidable), never dead, and nothing is written for it", async () => {
    const { run, fake } = verify([{ id: "lever:gone:9", missing_since: null }], {});
    const out = await run(["lever:gone:9"]);
    expect(out.live).toEqual({ "lever:gone:9": null });
    expect(out.flagged).toBe(0);
    expect(fake.calls.filter((c) => c.op !== "select")).toEqual([]);
  });
});

describe("a deep visit that failed twice running starts the next one from the top (n420)", () => {
  it("the first failure keeps the cursor; the second resets it; a board with no cursor is untouched", () => {
    expect(cursorAfterFailure(5_200, 0)).toBe(5_200);
    expect(cursorAfterFailure(5_200, 1)).toBe(0);
    expect(cursorAfterFailure(0, 4)).toBe(0);
    expect(CODE).toMatch(/if \(cursorAfterFailure\(cur, streak\) !== cur\) \{ deepCursors\.delete\(s\.token\); deepCursorsDirty = true; \}/);
  });
});

describe("failure state is kept per board on a shared token (L13-49)", () => {
  const shared = new Set(["lush"]);

  it("a shared token's boards get their own keys; every other board keeps its bare token", () => {
    expect(boardKey("greenhouse", "lush", shared)).toBe("greenhouse:lush");
    expect(boardKey("personio", "lush", shared)).toBe("personio:lush");
    expect(boardKey("greenhouse", "stripe", shared)).toBe("stripe");
    expect(keyToken("greenhouse:lush")).toBe("lush");
    expect(keySource("greenhouse:lush")).toBe("greenhouse");
    expect(keySource("stripe")).toBe(null);
    expect(JOB_SOURCES.some((s) => s.token.includes(":")), "a catalog token with a colon would make board keys ambiguous").toBe(false);
  });

  it("a dead twin is pruned while its sibling keeps reading", () => {
    const gh = boardKey("greenhouse", "lush", shared);
    const pe = boardKey("personio", "lush", shared);
    let state = { streaks: {} as Record<string, number>, dormant: {} as Record<string, number>, failedAt: {} as Record<string, number>, firstFailedAt: {} as Record<string, number> };
    let pruned: string[] = [];
    const t0 = Date.parse("2026-10-01T00:00:00Z");
    for (let i = 0; i < 8; i++) {
      const out = updateBoardFailures({
        okTokens: [gh], failedTokens: [pe], recheckTokens: new Set(),
        ...state, deadThreshold: 6, minFailureAgeMs: 41 * 3_600_000, dormantCap: 500, now: t0 + i * 12 * 3_600_000,
      });
      state = { streaks: out.streaks, dormant: out.dormant, failedAt: out.failedAt, firstFailedAt: out.firstFailedAt };
      pruned = pruned.concat(out.toPrune);
    }
    expect(pruned, "the personio board is dead and must reach the prune even though greenhouse:lush reads").toEqual([pe]);
    expect(Object.prototype.hasOwnProperty.call(state.dormant, gh)).toBe(false);
  });

  it("state an older build wrote under a bare shared token is dropped, never left for the retry lane to chase", () => {
    const { state, dropped } = dropBareSharedKeys({ streaks: { lush: 3, stripe: 2 }, dormant: { lush: 1 }, failedAt: { lush: 5, stripe: 6 }, firstFailedAt: { lush: 4 } }, shared);
    expect(dropped).toBe(4);
    expect(state).toEqual({ streaks: { stripe: 2 }, dormant: {}, failedAt: { stripe: 6 }, firstFailedAt: {} });
  });

  it("the stale lane, whose rows name tokens, still sees a keyed board's token", () => {
    expect([...tokensOf({ "greenhouse:lush": 1, stripe: 2 })].sort()).toEqual(["lush", "stripe"]);
  });

  it("index.ts folds, skips and prunes by board key, and prunes a board's own vendor only", () => {
    expect(CODE).toMatch(/okTokens: okKeys,/);
    expect(CODE).toMatch(/if \(skipTokens\.has\(boardKeyOf\(s\)\)\) continue;/);
    expect(CODE).toMatch(/retryBoards = dueKeys\s*\.map\(boardByKey\)/);
    expect(CODE).toMatch(/await pruneWholeBoard\(client, tk, "board_dormant", board\?\.source \?\? keySource\(key\)\)/);
    expect(CODE).toMatch(/\}, SHARED_TOKENS\)\.state;/);
  });
});

describe("the list payload never overwrites what the detail sweep filled (L13-17)", () => {
  it("a placeholder is placeless and a place is not", () => {
    expect(isPlacelessLocation("8 Locations")).toBe(true);
    expect(isPlacelessLocation("Boston, MA")).toBe(false);
  });

  const wd = (work_mode: string | null, location: string, title = "Software Engineer") => ({ work_mode, location, title });

  it("a mode the detail sweep wrote survives the list's silence, rotation after rotation", () => {
    // Structured remoteType said hybrid; the list text says nothing.
    expect(detectWorkMode("Boston, MA", "Software Engineer")).toBe(null);
    expect(listMayRewriteMode("workday", wd("hybrid", "Boston, MA"), { location: "Boston, MA", title: "Software Engineer" })).toBe(false);
    // The list's placeholder over the place the detail filled says nothing new either.
    expect(listMayRewriteMode("workday", wd("remote", "Remote - US"), { location: "3 Locations", title: "Software Engineer" })).toBe(false);
    // And the employer moving the role elsewhere does not speak to a mode the text never stated.
    expect(listMayRewriteMode("jazzhr", wd("hybrid", "Boston, MA"), { location: "Chicago, IL", title: "Software Engineer" })).toBe(false);
  });

  it("a mode the list itself guessed is re-read when the employer changes the text it was guessed from", () => {
    // Inserted from list text "Remote - US"; the employer now says Austin.
    expect(listMayRewriteMode("workday", wd("remote", "Remote - US"), { location: "Austin, TX", title: "Software Engineer" }),
      "a remote guess from old list text kept the row under the remote filter for good").toBe(true);
    expect(listMayRewriteMode("workday", wd("hybrid", "Denver, CO", "Analyst (Hybrid)"), { location: "Denver, CO", title: "Analyst (Remote)" })).toBe(true);
    // A retitle under a placeholder is still the employer's edit.
    expect(listMayRewriteMode("workday", wd("hybrid", "Denver, CO", "Analyst (Hybrid)"), { location: "2 Locations", title: "Analyst (Remote)" })).toBe(true);
    // But a retitle does not unfreeze a mode the old text never stated.
    expect(listMayRewriteMode("workday", wd("hybrid", "Boston, MA", "Analyst"), { location: "3 Locations", title: "Senior Analyst" })).toBe(false);
  });

  it("an empty stored mode is the list's to fill, and a vendor whose list states the mode always writes", () => {
    expect(listMayRewriteMode("workday", wd(null, "Boston, MA"), { location: "Boston, MA", title: "Software Engineer" })).toBe(true);
    expect(listMayRewriteMode("greenhouse", wd("hybrid", "Boston, MA"), { location: "Boston, MA", title: "Software Engineer" })).toBe(true);
  });

  it("the diff loop asks the rule, and skips the placeholder over a real place", () => {
    expect(CODE).toMatch(/const keepStoredMode = !listMayRewriteMode\(s\.source, prev as/);
    expect(CODE).toMatch(/const listPlaceholder = isPlacelessLocation\(row\.location as string \| null\) && !isPlacelessLocation\(prev\.location as string \| null\);/);
    expect(CODE).toMatch(/if \(!listPlaceholder\) put\("location", row\.location, prev\.location, false\);/);
    expect(CODE).toMatch(/if \(!keepStoredMode\) put\("work_mode", row\.work_mode, prev\.work_mode, false\);/);
    expect(CODE).toMatch(/if \(typeof row\.remote === "boolean" && !keepStoredMode\) \{/);
  });
});
