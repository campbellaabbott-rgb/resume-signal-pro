import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import * as dormancy from "../../supabase/functions/job-board/dormancy";
import { DB_FAIL_ALARM_VISITS as HEARTBEAT_DB_FAIL_ALARM_VISITS, dbFailureCheck } from "../../supabase/functions/scan-heartbeat/board-tail";

/**
 * S11-023: a board whose vendor feed reads fine but whose existing-rows read or
 * new-row upsert fails was counted as a VENDOR failure. A write error that
 * repeats on every visit (the day-rate salary_period CHECK, 2026-08-25 to
 * 09-06) pruned the live board's whole corpus as 'board_dormant' at visit 17,
 * 41.7 hours in, wrote false "board went dark" exits into the closure ledger,
 * and every 12-hour recheck, failing on insert again, re-armed the dormancy.
 *
 * The slice's failure fold is lifted out of job-board/index.ts with the
 * TypeScript parser and RUN, visit after visit, for a board whose rows our
 * database will not store, with the real dormancy module and a recording
 * client. A name the fold reads that the harness does not bind throws.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const SF = ts.createSourceFile("index.ts", FN, ts.ScriptTarget.ES2022, true);
const constNum = (name: string) => Number(new RegExp(`^const ${name} = ([0-9_* ]+);`, "m").exec(FN)?.[1].replace(/_/g, "").split("*").reduce((a, b) => a * Number(b.trim()), 1) ?? NaN);

function foldBlock(): string {
  let out = "";
  const visit = (n: ts.Node) => {
    if (out) return;
    if (ts.isBlock(n) && n.statements.some((s) => s.getText(SF).startsWith("const budgetSkippedSet = new Set(budgetSkipped);"))) {
      out = n.statements.map((s) => s.getFullText(SF)).join("");
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(SF);
  expect(out, "the slice's failure fold was not found in job-board/index.ts").not.toBe("");
  return out;
}

function runner(statements: string) {
  const js = ts.transpileModule(`async function __fold() {\n${statements}\n}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const make = new Function("__scope", `with (__scope) { ${js}\n return __fold(); }`);
  return (deps: Record<string, unknown>) => make(new Proxy(deps, {
    has: (_t, k) => typeof k === "string" && (k in deps || !(k in globalThis)),
    get: (_t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (typeof k === "string" && k in deps) return deps[k];
      throw new Error(`the fold reads \`${String(k)}\`, which this harness does not bind`);
    },
    set: (_t, k, v) => { (deps as Record<string | symbol, unknown>)[k] = v; return true; },
  })) as Promise<unknown>;
}

const HOUR = 3_600_000;
const BOARD = { source: "workday", token: "acme~wd1~Careers", name: "Acme" };

/** Visits every 2.5 h (the measured cold cadence with the retry lane) of a board whose feed reads and whose rows never store. */
async function visits(n: number) {
  const fold = runner(foldBlock());
  let state: Record<string, unknown> = { streaks: {}, dormant: {}, failedAt: {}, firstFailedAt: {} };
  const pruned: number[] = [];
  const t0 = Date.parse("2026-08-25T00:00:00Z");
  const dbAlarmAt: number[] = [];
  for (let i = 1; i <= n; i++) {
    const now = t0 + (i - 1) * 2.5 * HOUR;
    class FakeDate extends Date {
      constructor(...a: unknown[]) { super(...((a.length ? a : [now]) as [number])); }
      static now() { return now; }
    }
    const dormantSince = (state.dormant as Record<string, number>)[BOARD.token];
    const dormantNow = typeof dormantSince === "number";
    const due = dormantNow && now - dormantSince >= 12 * HOUR;
    if (dormantNow && !due) continue; // a dormant board is not fetched until its recheck
    const upserts: Array<{ k: string; v: Record<string, unknown> }> = [];
    const deps: Record<string, unknown> = {
      Date: FakeDate,
      console: { log: () => {}, warn: () => {}, error: () => {} },
      slice: [BOARD],
      skipTokens: new Set<string>(),
      quarantineSkipped: new Set<string>(),
      budgetSkipped: [],
      okKeys: [],
      dbFailedKeys: [BOARD.token],
      recheckTokens: new Set(due ? [BOARD.token] : []),
      boardFailures: state,
      bfV: state,
      boardKeyOf: (s: { token: string }) => s.token,
      boardByKey: () => BOARD,
      keyToken: dormancy.keyToken,
      keySource: dormancy.keySource,
      updateBoardFailures: dormancy.updateBoardFailures,
      rearmIncompletePrunes: dormancy.rearmIncompletePrunes,
      foldDbFailures: dormancy.foldDbFailures,
      dbFailingBoards: dormancy.dbFailingBoards,
      DB_FAIL_ALARM_VISITS: dormancy.DB_FAIL_ALARM_VISITS,
      DEAD_BOARD_THRESHOLD: constNum("DEAD_BOARD_THRESHOLD"),
      DEAD_BOARD_MIN_FAILING_MS: constNum("DEAD_BOARD_MIN_FAILING_MS"),
      DORMANT_CAP: constNum("DORMANT_CAP"),
      pruneWholeBoard: async () => { pruned.push(i); return { logged: 300, complete: true }; },
      client: { from: () => ({ upsert: (row: { k: string; v: Record<string, unknown> }) => { upserts.push(row); return Promise.resolve({ error: null }); } }) },
      retryLane: null,
      deepCursorsDirty: false,
      deepLane: null,
      staleLane: null,
      lastUpsertError: "acme~wd1~Careers: new row for relation \"job_board_postings\" violates check constraint \"job_board_postings_salary_period_check\"",
      sliceDbFailNote: null,
    };
    await fold(deps);
    const bf = upserts.find((u) => u.k === "board_failures");
    if (bf) state = bf.v;
    const note = deps.sliceDbFailNote as { alarm?: number } | null;
    if (note?.alarm) dbAlarmAt.push(i);
  }
  return { pruned, state, dbAlarmAt };
}

describe("our own database failing is not the employer going dark (S11-023)", () => {
  it("a board whose feed reads but whose rows never store is never pruned as board_dormant", async () => {
    const { pruned, state } = await visits(30);
    expect(pruned, "the live board's corpus was pruned and logged as board_dormant for our own write error").toEqual([]);
    expect((state.dormant as Record<string, number>)[BOARD.token], "and it was never put dormant").toBeUndefined();
    expect((state.streaks as Record<string, number>)[BOARD.token], "nor given a vendor failure streak").toBeUndefined();
  });

  it("its run of failed stores is counted, and alarms from the third visit", async () => {
    const { state, dbAlarmAt } = await visits(5);
    expect((state.dbStreaks as Record<string, number>)[BOARD.token]).toBe(5);
    expect(dbAlarmAt[0]).toBe(dormancy.DB_FAIL_ALARM_VISITS);
    expect(dormancy.dbFailingBoards(state.dbStreaks as Record<string, number>)).toEqual([{ key: BOARD.token, visits: 5 }]);
  });

  it("a visit that stores clears the count", () => {
    expect(dormancy.foldDbFailures({ a: 4, b: 1 }, [], ["a"], 100)).toEqual({ b: 1 });
    expect(dormancy.foldDbFailures({ a: 4 }, ["a", "a"], [], 100), "one visit counts once").toEqual({ a: 5 });
  });

  it("a dormant board's recheck whose fetch succeeded does not re-arm its dormancy", () => {
    const out = dormancy.updateBoardFailures({
      okTokens: [], answeredTokens: ["acme"], failedTokens: ["acme"], recheckTokens: new Set(["acme"]),
      streaks: {}, dormant: { acme: 1 }, failedAt: {}, firstFailedAt: {},
      deadThreshold: 6, minFailureAgeMs: 40 * HOUR, dormantCap: 100, now: 13 * HOUR,
    });
    expect(out.dormant.acme, "the recheck reset the dormant timer").toBeUndefined();
    expect(out.toPrune).toEqual([]);
  });

  it("scan-heartbeat names those boards at the same threshold", () => {
    expect(HEARTBEAT_DB_FAIL_ALARM_VISITS, "the heartbeat's mirror of DB_FAIL_ALARM_VISITS drifted").toBe(dormancy.DB_FAIL_ALARM_VISITS);
    expect(dbFailureCheck({ "acme~wd1~Careers": 3, other: 1 })).toMatchObject({ passed: false });
    expect(dbFailureCheck({ other: 2 })).toMatchObject({ passed: true });
    expect(dbFailureCheck(null)).toMatchObject({ passed: true });
  });
});
