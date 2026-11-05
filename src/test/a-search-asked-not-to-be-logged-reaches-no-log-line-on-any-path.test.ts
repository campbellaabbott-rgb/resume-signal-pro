// @vitest-environment node
/**
 * A SEARCH ASKED NOT TO BE LOGGED REACHES NO LOG LINE, ON ANY PATH (audit-rest
 * S13-104; job-board .101, agent-mcp 2026-11-03.1).
 *
 * WHAT WAS WRONG. agent-mcp marks a ChatGPT-surface call noLog and the board
 * then wrote no search event, which is what the Privacy page promises. But
 * every deadline and failure path on the board's list printed q= with the
 * text, and agent-mcp printed each person's keyed hash on every call. Function
 * logs are kept, so the words and the identifier were stored after all.
 *
 * WHAT HOLDS NOW. Console output, captured whole through the shipped handlers
 * on real deadline paths (a statement that never answers), failure paths and a
 * thrown client, carries no query text and no per-person identifier when the
 * call asked for none. The same path with no flag still names the query: an
 * operator reading a timeout needs it, and it is what shows these paths fired.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { bootBoardHandler, type BoardHandler } from "./helpers/board-handler";
import { bootKeylessMcp, CHATGPT_ADDRESS, type KeylessMcp } from "./helpers/keyless-mcp";
import type { Answer, Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 15_000, hookTimeout: 180_000 });

const SECRET = "zzsecretword hospice cartographer";
const WORD = "zzsecretword";

let lines: string[];
beforeEach(() => {
  lines = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      lines.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}\n${x.stack ?? ""}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    });
  }
});
afterEach(() => { vi.restoreAllMocks(); });
const logged = () => lines.join("\n");

describe("job-board's list, with the reader proof and noLog", () => {
  let board: BoardHandler;
  beforeAll(async () => { board = await bootBoardHandler(); });

  /** Every deadline fires at once: the handler waits on the same timers, only sooner. */
  const shortClocks = () => {
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => real(fn, Math.min(ms ?? 0, 5))) as never);
  };
  /** The statements the search itself runs never answer, and only those: each is raced against a clock in the handler. */
  const carriesTheSearch = (q: Query) => !!q.rpc && /search|count|fuzzy|ranked|embed|match/i.test(q.rpc);
  const ordersBy = (q: Query, column: string) => q.table === "job_board_postings" && q.calls.some(([m, a]) => m === "order" && a[0] === column);
  const NEVER = (q: Query): Promise<Answer | undefined> | undefined => (
    carriesTheSearch(q) || ordersBy(q, "salary_rank_usd") ? new Promise(() => {}) : undefined
  );
  /** Only the first newest-sorted read hangs: it is the one raced against a clock, and the fallback after it answers. */
  const newestNever = () => {
    let raced = false;
    return (q: Query): Promise<Answer | undefined> | undefined => {
      if (carriesTheSearch(q)) return new Promise(() => {});
      if (raced || !ordersBy(q, "posted_at")) return undefined;
      raced = true;
      return new Promise(() => {});
    };
  };

  const PATHS: Array<[string, Record<string, unknown>, RegExp]> = [
    ["the ranked search", {}, /ranked search missed both clocks/],
    ["the newest sort", { sort: "newest" }, /newest-sorted search hit its deadline/],
    ["the salary sort", { sort: "salary" }, /salary-sorted search failed or hit its deadline/],
  ];

  for (const [name, extra, line] of PATHS) {
    it(`${name} past its deadline logs that it did, and no query`, async () => {
      board.reset();
      shortClocks();
      board.answer(extra.sort === "newest" ? newestNever() : NEVER);
      await board.post({ action: "list", q: SECRET, caller: "mcp", noLog: true, ...extra }, await board.readerHeaders());
      expect(logged(), "the deadline path never fired, so this proves nothing").toMatch(line);
      expect(logged()).toContain("q=(not logged)");
      expect(logged()).not.toContain(WORD);
    });

    it(`${name} past its deadline still names the query when nobody asked it not to`, async () => {
      board.reset();
      shortClocks();
      board.answer(extra.sort === "newest" ? newestNever() : NEVER);
      await board.post({ action: "list", q: SECRET, caller: "mcp", ...extra }, await board.readerHeaders());
      expect(logged()).toMatch(line);
      expect(logged()).toContain(WORD);
    });
  }

  it("the same flag from a browser changes nothing: the proof is what buys it", async () => {
    board.reset();
    shortClocks();
    board.answer(NEVER);
    await board.post({ action: "list", q: SECRET, noLog: true }, { authorization: "Bearer anon-key-for-tests", origin: "https://resumebooster.work" });
    expect(logged()).toContain(WORD);
  });

  it("a failed search logs no error text, which can quote the query", async () => {
    const failing = (q: Query): Answer | undefined => (q.rpc === "search_jobs" ? { data: null, error: { code: "XX000", message: `could not read "${SECRET}"` } } : undefined);
    board.reset();
    board.answer(failing);
    await board.post({ action: "list", q: SECRET, caller: "mcp", noLog: true }, await board.readerHeaders());
    expect(logged()).toMatch(/ranked search failed/);
    expect(logged()).not.toContain(WORD);

    lines.length = 0;
    board.reset();
    board.answer(failing);
    await board.post({ action: "list", q: SECRET, caller: "mcp" }, await board.readerHeaders());
    expect(logged(), "the control: the same failure, no flag, prints the text").toContain(WORD);
  });

  it("a client that throws reaches no log line through the catches above the list", async () => {
    const throwing = (q: Query): undefined => {
      if (carriesTheSearch(q)) throw new Error(`socket closed during "${SECRET}"`);
      return undefined;
    };
    board.reset();
    board.answer(throwing);
    await board.post({ action: "list", q: SECRET, caller: "mcp", noLog: true }, await board.readerHeaders()).catch(() => null);
    expect(logged()).toMatch(/\[JOB-BOARD\]/);
    expect(logged()).not.toContain(WORD);
  });

  /** Each failure path below, driven for real: the line must fire, carry no words, and name them when nobody asked it not to. */
  const bothWays = async (body: Record<string, unknown>, answer: (q: Query) => Answer | undefined, line: RegExp) => {
    board.reset();
    board.answer(answer);
    await board.post({ action: "list", q: SECRET, caller: "mcp", noLog: true, ...body }, await board.readerHeaders()).catch(() => null);
    expect(logged(), "the path never fired, so this proves nothing").toMatch(line);
    expect(logged()).not.toContain(WORD);

    lines.length = 0;
    board.reset();
    board.answer(answer);
    await board.post({ action: "list", q: SECRET, caller: "mcp", ...body }, await board.readerHeaders()).catch(() => null);
    const named = lines.filter((l) => line.test(l)).join("\n");
    expect(named, "the control: the same line, no flag, keeps what an operator reads").toContain(WORD);
  };

  /** Every read the list makes throws, its head row aside: nothing inside the list is left to catch it. */
  const everyReadThrows = (q: Query): undefined => {
    if (q.table !== "job_board_meta") throw new Error(`socket closed during "${SECRET}"`);
    return undefined;
  };

  it("a throw that reaches the handler's outer catch logs its kind, and no text", async () => {
    await bothWays({}, everyReadThrows, /\[JOB-BOARD\] error:/);
  });

  it("the outer catch asks for the proof too: the flag from a browser trims no error", async () => {
    board.reset();
    board.answer(() => { throw new Error(`socket closed during "${SECRET}"`); });
    // Not the list: its dispatch dropped the flag on its own. Any other action read it raw.
    await board.post({ action: "facets", noLog: true }, { authorization: "Bearer anon-key-for-tests", origin: "https://resumebooster.work" }).catch(() => null);
    expect(logged()).toMatch(/\[JOB-BOARD\] error:/);
    expect(lines.filter((l) => /\[JOB-BOARD\] error:/.test(l)).join("\n"), "a browser's own flag took the operator's error text away").toContain(WORD);
  });

  it("a throw inside the ranked path logs no error text", async () => {
    await bothWays({}, (q) => {
      if (q.rpc !== "search_jobs") return undefined;
      const row: Record<string, unknown> = {};
      Object.defineProperty(row, "total_rows", { enumerable: true, get() { throw new Error(`bad row for "${SECRET}"`); } });
      return { data: [row], error: null };
    }, /ranked path failed, serving recency instead/);
  });

  it("a semantic search that errors logs no error text", async () => {
    const g = globalThis as Record<string, unknown>;
    g.Supabase = { ai: { Session: class { async run() { return new Array(384).fill(0.01); } } } };
    try {
      await bothWays({}, (q) => (
        q.rpc === "search_jobs_semantic" ? { data: null, error: { code: "XX000", message: `could not read "${SECRET}"` } } : undefined
      ), /semantic ANN failed/);
    } finally {
      delete g.Supabase;
    }
  });

  it("a row that breaks a filter logs which field did, and not the values", async () => {
    const row = { id: "p1", total_rows: 1, title: "Nurse", company: "Acme", company_token: "acme", source: "greenhouse", country: WORD, location: "Leeds", apply_url: "https://acme.example/1", rank: 1 };
    await bothWays({ country: "US" }, (q) => (q.rpc === "search_jobs" ? { data: [row], error: null } : undefined), /filter integrity/);
    expect(logged()).toContain(WORD);
  });

  it("every line in the handler that names a query names it through the flag", () => {
    const code = codeOf(readFileSync(resolve(process.cwd(), "supabase/functions/job-board/index.ts"), "utf8"));
    const named = code.split("\n").filter((l) => /console\.(log|info|warn|error|debug)\(/.test(l) && /\bq=/.test(l));
    expect(named.length, "the handler no longer logs a query at all, so this guard has gone stale").toBeGreaterThanOrEqual(10);
    for (const l of named) expect(l.trim()).toMatch(/q=\$\{qLog\}/);
  });
});

describe("agent-mcp, on a ChatGPT call", () => {
  let mcp: KeylessMcp;
  const SUBJECT = "v1/user-who-must-not-be-logged";
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);
  beforeEach(() => {
    mcp.boardCalls.length = 0;
    mcp.board = () => new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 });
  });
  const chatgpt = { address: CHATGPT_ADDRESS, meta: { "openai/subject": SUBJECT } };

  it("no line carries the person's subject or any hash of it, and the board is still asked not to log", async () => {
    const r = await mcp.call({ query: SECRET }, chatgpt);
    expect(r.isError, r.text).toBe(false);
    expect(mcp.boardCalls[0]).toMatchObject({ noLog: true });
    const hashed = mcp.rpcs.filter((c) => c.name === "mcp_anon_check_v2").map((c) => String(c.args.p_bucket)).pop() ?? "";
    expect(hashed, "the bucket holds the day's keyed hash, which is what must not be logged").toMatch(/^u:chatgpt:[0-9a-f]{16}$/);
    expect(logged()).not.toContain(hashed.replace("u:chatgpt:", ""));
    expect(logged()).not.toContain(SUBJECT);
    expect(logged()).not.toContain(createHash("sha256").update(SUBJECT).digest("hex").slice(0, 16));
    expect(logged()).not.toContain(WORD);
    expect(logged()).not.toMatch(/keyless subject/);
  });

  it("a tool that fails logs its name and the error's kind, not the error's text", async () => {
    mcp.board = () => { throw new Error(`board said no to "${SECRET}"`); };
    await mcp.call({ query: SECRET }, chatgpt);
    expect(logged()).toMatch(/\[AGENT-MCP\] tool search_jobs failed:/);
    expect(logged()).not.toContain(WORD);
  });

  it("the same failure on a call with no ChatGPT marker still logs the text, for the operator", async () => {
    mcp.board = () => { throw new Error(`board said no to "${SECRET}"`); };
    await mcp.call({ query: SECRET }, { address: "203.0.113.7" });
    expect(logged()).toContain(WORD);
  });
});
