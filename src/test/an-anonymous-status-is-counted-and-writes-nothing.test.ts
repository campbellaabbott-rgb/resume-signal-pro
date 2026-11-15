// @vitest-environment node
/**
 * AN ANONYMOUS STATUS IS COUNTED AND WRITES NOTHING, AND THE SCHEDULER HAS ITS
 * OWN DOOR FOR THE TWO JOBS STATUS DID ON THE SIDE (audit-rest S13-114;
 * job-board .101).
 *
 * WHAT WAS WRONG. status answered anyone, uncounted. Each computed answer ran
 * about forty reads, wrote date_coverage_cache unconditionally, and could stamp
 * and kick the refresh chain. The thirty-second memo lives in one isolate, so a
 * caller reaching fresh isolates drove the reads and the writes as fast as it
 * could send them.
 *
 * WHAT HOLDS NOW. An anonymous status answered from the memo costs no database.
 * One that must compute is counted by the same meter as a list, refused like
 * one, and only reports: the watchdog's verdict is published with readOnly
 * true, and nothing is written or sent. The upkeep action that once did both
 * jobs is gone (board .102): nothing ever posted it. A credentialed
 * status keeps its fresh answer, because the deploy checks read it.
 *
 * WHAT RESTARTS A DEAD CHAIN NOW (the upkeep hotfix, 2026-11-07). The
 * watchdog's only act is the keyless {"action":"refresh"} the :x4/:x9 refresh
 * crons already send, and a chain that dies between hops reads chain_alive to
 * it. Measured 2026-11-07: of four deaths in 47 minutes, a five-minute upkeep
 * job would have restarted none sooner than the crons. No schedule calls
 * upkeep; 20261107100000 sends the same refresh from SQL every minute once
 * every pulse is stale (a-dead-chain-is-kicked-on-the-databases-clock-and-
 * reads-no-key.test.ts).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ANON, bootBoardHandler, SVC, type BoardHandler } from "./helpers/board-handler";
import { eqs, type Answer, type Query } from "./helpers/proxy-db";
import { anonBudgetGate, BUDGETED_ACTIONS, METERED_ACTIONS } from "../../supabase/functions/job-board/anon-budget";
import { isScheduledCaller } from "../../supabase/functions/_shared/email-cron";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const browser = { authorization: `Bearer ${ANON}`, apikey: ANON, "cf-connecting-ip": "203.0.113.9", "cf-ipcountry": "US" };
const service = { authorization: `Bearer ${SVC}` };
const CRON_KEY = "k".repeat(40);
const cron = { "x-email-cron": CRON_KEY };

let board: BoardHandler;
let fetched: Array<{ url: string; body: string }>;
let realNow: () => number;
let offset = 0;
beforeAll(async () => { board = await bootBoardHandler(); });
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  board.reset();
  fetched = [];
  globalThis.fetch = (async (u: unknown, init?: { body?: string }) => {
    fetched.push({ url: String(u), body: String(init?.body ?? "") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  // Past the memo: each test starts as a fresh isolate would.
  realNow = Date.now;
  offset += 40_000;
  const at = offset;
  Date.now = () => realNow() + at;
});
afterEach(() => { Date.now = realNow; vi.restoreAllMocks(); });

const isWrite = (q: Query) => q.calls.some(([m]) => m === "insert" || m === "upsert" || m === "update" || m === "delete");
const writes = () => board.db.queries.filter(isWrite);
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const hasWatchdogRead = (q: Query) => q.table === "job_board_meta" && q.calls.some(([m, a]) => m === "in" && a[0] === "k" && (a[1] as string[]).includes("chain_watchdog"));

/** A chain that has been dead an hour, with no recent kick: decideRekick's "rekick". */
const deadChain = () => board.answer((q): Answer | undefined => {
  if (!hasWatchdogRead(q)) return undefined;
  return {
    data: [
      { k: "slice_stats", v: { workAt: iso(60), at: iso(60), coldEmaMs: 60_000 }, updated_at: iso(60) },
      { k: "chain_kick", v: { outcome: "failed" }, updated_at: iso(60) },
      { k: "slice_trace", v: {}, updated_at: iso(60) },
      { k: "refresh_progress", v: {}, updated_at: iso(60) },
    ],
    error: null,
  };
});
const schedulerKey = (ok: boolean) => board.answer((q): Answer | undefined => (q.rpc === "email_cron_key_matches" ? { data: ok, error: null } : undefined));
const refreshKicks = () => fetched.filter((f) => f.url.endsWith("/functions/v1/job-board") && JSON.parse(f.body).action === "refresh");

describe("an anonymous status", () => {
  it("that must compute is counted once by the board's meter", async () => {
    await board.post({ action: "status" }, browser);
    const checks = board.db.rpcArgs("job_board_anon_check");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ p_kind: "address", p_country: "US" });
  });

  it("writes nothing, with the chain dead and the coverage cache empty", async () => {
    deadChain();
    board.answer((q): Answer | undefined => (q.rpc === "get_date_coverage" ? { data: [{ computed_at: iso(1) }], error: null } : undefined));
    const r = await board.post({ action: "status" }, browser);
    expect(writes().map((q) => `${q.table}:${q.calls.map(([m]) => m).join(",")}`)).toEqual([]);
    expect(refreshKicks(), "an anonymous caller kicked the refresh chain").toEqual([]);
    const wd = r.chainWatchdog as Record<string, unknown>;
    expect(wd, "the verdict is still published, for whoever reads the status").toMatchObject({ decision: "rekick", kicked: false, readOnly: true });
  });

  it("past its allowance is refused before any other read", async () => {
    board.answer((q): Answer | undefined => (q.rpc === "job_board_anon_check"
      ? { data: [{ is_allowed: false, used_today: 10_000, over_today: 1, cap_today: 10_000, country_rule: false, enforcing: true }], error: null }
      : undefined));
    const r = await board.post({ action: "status" }, browser);
    expect(String(r.error ?? "")).not.toBe("");
    expect(board.db.queries.map((q) => q.rpc ?? q.table)).toEqual(["job_board_anon_check"]);
  });

  it("answered from the memo costs no database at all, and is not counted", async () => {
    const first = await board.post({ action: "status" }, browser);
    board.db.queries = [];
    const again = await board.post({ action: "status" }, browser);
    expect(board.db.queries.map((q) => q.rpc ?? q.table)).toEqual([]);
    expect(again.catalogSize).toEqual(first.catalogSize);
  });

  it("is served when the meter itself is down: the meter never takes status away", async () => {
    board.answer((q): Answer | undefined => (q.rpc === "job_board_anon_check" ? { data: null, error: { code: "57014", message: "timeout" } } : undefined));
    const r = await board.post({ action: "status" }, browser);
    expect(r.chainWatchdog).toBeDefined();
  });
});

describe("our own credentialed status", () => {
  it("the service key is not counted, reads past the memo, and can still kick a dead chain", async () => {
    await board.post({ action: "status" }, browser);
    board.db.queries = [];
    deadChain();
    const r = await board.post({ action: "status" }, service);
    expect(board.db.rpcArgs("job_board_anon_check")).toEqual([]);
    expect(board.db.queries.length, "the memo answered a deploy check").toBeGreaterThan(10);
    expect(r.chainWatchdog).toMatchObject({ decision: "rekick", kicked: true });
    expect(r.chainWatchdog).not.toHaveProperty("readOnly");
    expect(refreshKicks()).toHaveLength(1);
  });

  it("a fresh answer is not handed to the next anonymous reader as a licence to skip the meter past its age", async () => {
    await board.post({ action: "status" }, service);
    board.db.queries = [];
    await board.post({ action: "status" }, browser);
    expect(board.db.rpcArgs("job_board_anon_check"), "the memo is younger than its age: nothing is read").toEqual([]);
    Date.now = () => realNow() + offset + 40_000;
    await board.post({ action: "status" }, browser);
    expect(board.db.rpcArgs("job_board_anon_check")).toHaveLength(1);
  });
});

describe("the upkeep action is gone (board .102, UPK-DROP): nothing posted it, and status keeps no copy", () => {
  it("an upkeep post, even with the scheduler's key, checks no key, writes nothing and kicks nothing", async () => {
    deadChain();
    schedulerKey(true);
    for (const headers of [cron, browser, service]) await board.post({ action: "upkeep" }, headers);
    expect(writes()).toEqual([]);
    expect(refreshKicks()).toEqual([]);
    expect(board.db.rpcArgs("email_cron_key_matches")).toEqual([]);
    expect(METERED_ACTIONS.has("upkeep")).toBe(false);
  });

  it("the scheduler's key check itself is unchanged for the functions that still use it", async () => {
    const LONG = "s".repeat(40);
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    expect(await isScheduledCaller(new Headers({ authorization: `Bearer ${LONG}` }), { rpc }, LONG)).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(await isScheduledCaller(new Headers({ "x-email-cron": CRON_KEY }), { rpc }, LONG)).toBe(false);
    expect(rpc).toHaveBeenCalledWith("email_cron_key_matches", { p_key: CRON_KEY });
  });

  it("status has no boardUpkeep key and never reads a coverage copy: the rollup's own computed_at, or unavailable", async () => {
    board.answer((q): Answer | undefined => (q.rpc === "get_date_coverage" ? { data: [{ source: "greenhouse", total: 10, dated: 9, computed_at: iso(12) }], error: null } : undefined));
    const r = await board.post({ action: "status" }, service);
    expect("boardUpkeep" in r).toBe(false);
    expect(r).toMatchObject({ dateCoverageSource: "rollup", dateCoverageAgeMin: 12 });
    expect(board.db.queries.filter((q) => q.table === "job_board_meta" && (eqs(q, "k", "date_coverage_cache") || eqs(q, "k", "board_upkeep")))).toEqual([]);
    board.reset();
    board.answer((q): Answer | undefined => (q.rpc === "get_date_coverage" ? { data: null, error: { message: "timeout" } } : undefined));
    expect(await board.post({ action: "status" }, service)).toMatchObject({ dateCoverageSource: "unavailable", dateCoverageAgeMin: null });
  });
});

describe("the meter's two lists", () => {
  it("status is metered and is not one of the actions that can be asked for a pass", () => {
    expect(METERED_ACTIONS.has("status")).toBe(true);
    expect(BUDGETED_ACTIONS.has("status")).toBe(false);
    for (const a of BUDGETED_ACTIONS) expect(METERED_ACTIONS.has(a), a).toBe(true);
  });

  const gate = async (action: string) => {
    const calls: Array<Record<string, unknown>> = [];
    const refused = await anonBudgetGate(new Request("https://h.supabase.co/functions/v1/job-board", { method: "POST", headers: browser }), action, {
      rpc: async (args) => { calls.push(args); return { data: [{ is_allowed: true }], error: null }; },
      serviceKey: SVC,
      cors: {},
      passSecret: "a-configured-turnstile-secret",
    });
    return { refused, calls };
  };

  it("with Turnstile configured a list without a pass says so, and our heartbeat's status can never be refused for lacking one", async () => {
    expect((await gate("list")).calls[0].p_pass).toBe("none");
    const status = await gate("status");
    expect(status.calls[0].p_pass, "the counter never refuses this state, whatever requirePass says").toBe("unconfigured");
    expect(status.refused).toBeNull();
  });
});

describe("the schedule", () => {
  it("no schedule calls upkeep: docs/deploy-ledger.json never applies 20261103221000, says why, and no order rule names it", () => {
    const ledger = JSON.parse(readFileSync(resolve(process.cwd(), "docs/deploy-ledger.json"), "utf8")) as {
      neverApply: string[]; neverApplyWhy: Record<string, string>; migrationOrder: Record<string, { afterMigrations?: string[]; repairedBy?: string }>;
    };
    expect(ledger.neverApply).toContain("20261103221000");
    expect(ledger.neverApplyWhy["20261103221000"]).toMatch(/^superseded by 20261107100000: /);
    expect(Object.keys(ledger.migrationOrder)).not.toContain("20261103221000");
    for (const [stamp, rule] of Object.entries(ledger.migrationOrder)) {
      if (stamp.startsWith("_")) continue;
      expect([...(rule.afterMigrations ?? []), rule.repairedBy ?? ""], stamp).not.toContain("20261103221000");
    }
  });
});
