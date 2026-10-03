/**
 * THE BOARD PASS RIDES EVERY BOARD CALL, AND IS NOTHING AT ALL UNTIL IT IS ON.
 *
 * job-board .87 can ask a browser for a Cloudflare Turnstile pass
 * (docs/job-board-deploy-notes.md, 2026-09-09.87): a rotating proxy pool walks
 * past every per-address cap, a solved challenge per browser it cannot share.
 * The page half is src/lib/board-pass.ts (the widget, the exchange, the cache)
 * behind src/lib/invoke-job-board.ts, the one door every board call uses.
 *
 * Held here:
 *   - WITH VITE_TURNSTILE_SITE_KEY UNSET the door IS supabase.functions.invoke
 *     ("job-board", options): the same arguments object, no header, no script,
 *     no widget, no exchange, nothing stored;
 *   - with it set: a counted read waits for one pass and carries it as
 *     x-rb-pass; concurrent reads share one exchange; an uncounted call never
 *     waits but starts the check; the pass is reused until a minute before it
 *     lapses; a refusal with code "pass" gets a fresh pass and exactly ONE
 *     retry, any other refusal none; a failed check reads the board without a
 *     header and is not repeated for five minutes; a call that carried a pass
 *     and got no answer forgets it; the script is the explicit-render API,
 *     added once;
 *   - the review of 2026-10-03, each with the scenario that broke it: a pass
 *     is kept by this browser's clock (a clock 40 minutes fast once sent no
 *     pass and solved again before every read); one deadline covers the
 *     script load (a stalled challenges.cloudflare.com once held every read
 *     with no limit); a challenge that asks for interaction keeps its widget
 *     and gets two minutes; board_pass_unconfigured turns the check off for
 *     the tab until a pass refusal proves it is on; refusals that land one
 *     after another share one new pass; a refusal's failed attempt is not
 *     re-run for every refused call;
 *   - every browser call to job-board in src/ goes through the door (the walk
 *     carries a positive control), and the door's counted set mirrors the
 *     edge's BUDGETED_ACTIONS;
 *   - the page reads the two new refusal codes and says the right thing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { BUDGETED_ACTIONS } from "../../supabase/functions/job-board/anon-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { BOARD_COUNTED_ACTIONS, invokeJobBoard } from "@/lib/invoke-job-board";
import {
  BOARD_PASS_DEADLINE_MS, BOARD_PASS_FAIL_COOLDOWN_MS, BOARD_PASS_HEADER, BOARD_PASS_INTERACTIVE_DEADLINE_MS,
  boardPassHeader, ensureBoardPass, resetBoardPassForTests,
} from "@/lib/board-pass";
import { readBoardBudgetRefusal } from "@/lib/board-budget";
import { BoardBudgetNotice } from "@/components/jobs/BoardBudgetNotice";

const SITE_KEY = "0x4AAAAAAA-site-key";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
type Opts = { body?: Record<string, unknown>; headers?: Record<string, string> };
type Rendered = { el: HTMLElement; opts: Record<string, unknown> };
const w = window as unknown as { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void } };

let rendered: Rendered[] = [];
let solve: (r: Rendered) => void = (r) => setTimeout(() => (r.opts.callback as (t: string) => void)(`tok-${rendered.length}`), 5);
function installTurnstile() {
  w.turnstile = {
    render: (el, opts) => { const r = { el, opts }; rendered.push(r); solve(r); return `w${rendered.length}`; },
    remove: () => undefined,
  };
}
let passes = 0;
const future = () => new Date(Date.now() + 30 * 60_000).toISOString();
const ok = (data: unknown) => ({ data, error: null });
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});
const passRefusal = () => httpError(429, { error: "board_budget", code: "pass", message: "x", limit: 0, used: 0, resetAt: null });
/** Board calls (not the exchange), with the header each carried. */
const boardCalls = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as Opts | undefined)?.body?.action !== "board-pass")
  .map(([, o]) => ({ action: String((o as Opts | undefined)?.body?.action ?? "list"), pass: (o as Opts | undefined)?.headers?.[BOARD_PASS_HEADER] ?? null }));
const exchanges = () => invoke.mock.calls.filter(([fn, o]) => fn === "job-board" && (o as Opts | undefined)?.body?.action === "board-pass");

let board: (o: Opts) => unknown = () => ok({ jobs: [] });
beforeEach(() => {
  invoke.mockReset();
  rendered = []; passes = 0;
  solve = (r) => setTimeout(() => (r.opts.callback as (t: string) => void)(`tok-${rendered.length}`), 5);
  board = () => ok({ jobs: [] });
  invoke.mockImplementation(async (fn: string, o?: Opts) => {
    if (fn !== "job-board") return ok(null);
    if (o?.body?.action === "board-pass") { passes++; return ok({ pass: `v1.pass-${passes}`, expiresAt: future() }); }
    return board(o ?? {});
  });
  resetBoardPassForTests();
  try { sessionStorage.clear(); } catch { /* jsdom always has it */ }
  delete w.turnstile;
  document.head.querySelectorAll(`script[src="${SCRIPT}"]`).forEach((s) => s.remove());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); resetBoardPassForTests(); delete w.turnstile; });

describe("with VITE_TURNSTILE_SITE_KEY unset, the door is supabase.functions.invoke and nothing else", () => {
  it("the same arguments object, no header, no script, no widget, no exchange, nothing stored", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    installTurnstile();
    const opts = { body: { action: "detail", id: "greenhouse:acme:1" } };
    await invokeJobBoard(opts);
    await invokeJobBoard({ body: { action: "status" } });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).toBe("job-board");
    expect(invoke.mock.calls[0][1], "the caller's own object, untouched").toBe(opts);
    expect(invoke.mock.calls[1]).toEqual(["job-board", { body: { action: "status" } }]);
    expect(rendered, "no widget").toEqual([]);
    expect(document.querySelector(`script[src="${SCRIPT}"]`), "no script").toBeNull();
    expect(document.getElementById("rb-board-pass")).toBeNull();
    expect(boardPassHeader()).toEqual({});
    expect(await ensureBoardPass()).toBeNull();
    expect(exchanges()).toEqual([]);
    expect(sessionStorage.getItem("rb_board_pass")).toBeNull();
  });

  it("a whitespace key is no key", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "   ");
    installTurnstile();
    await invokeJobBoard({ body: { action: "list" } });
    expect(rendered).toEqual([]);
    expect(boardCalls()).toEqual([{ action: "list", pass: null }]);
  });
});

describe("with the key set", () => {
  beforeEach(() => { vi.stubEnv("VITE_TURNSTILE_SITE_KEY", SITE_KEY); installTurnstile(); });

  it("a counted read waits for one pass and carries it; the widget is invisible-first and the token goes to board-pass", async () => {
    await invokeJobBoard({ body: { action: "detail", id: "greenhouse:acme:1" } });
    expect(rendered).toHaveLength(1);
    expect(rendered[0].opts).toMatchObject({ sitekey: SITE_KEY, appearance: "interaction-only" });
    expect(rendered[0].el.id).toBe("rb-board-pass");
    expect(exchanges().map(([, o]) => (o as Opts).body)).toEqual([{ action: "board-pass", token: "tok-1" }]);
    expect(boardCalls()).toEqual([{ action: "detail", pass: "v1.pass-1" }]);
    await invokeJobBoard({ body: { action: "list", q: "nurse" } });
    expect(exchanges(), "reused, not re-solved").toHaveLength(1);
    expect(boardCalls()[1]).toEqual({ action: "list", pass: "v1.pass-1" });
    expect(JSON.parse(sessionStorage.getItem("rb_board_pass") ?? "{}").pass).toBe("v1.pass-1");
  });

  it("concurrent counted reads share one exchange", async () => {
    await Promise.all([invokeJobBoard({ body: { action: "list" } }), invokeJobBoard({ body: { action: "facets" } }), invokeJobBoard({})]);
    expect(rendered).toHaveLength(1);
    expect(exchanges()).toHaveLength(1);
    expect(boardCalls().map((c) => c.pass)).toEqual(["v1.pass-1", "v1.pass-1", "v1.pass-1"]);
  });

  it("an uncounted call never waits for the pass, but starts the check for the read behind it", async () => {
    solve = () => undefined; // the check is still running when status goes out
    await invokeJobBoard({ body: { action: "status" } });
    expect(boardCalls()).toEqual([{ action: "status", pass: null }]);
    expect(rendered, "the check started").toHaveLength(1);
  });

  it("a pass held in sessionStorage is reused across a reload; one about to lapse is not", async () => {
    sessionStorage.setItem("rb_board_pass", JSON.stringify({ pass: "v1.stored", expiresAt: Date.now() + 10 * 60_000 }));
    await invokeJobBoard({ body: { action: "list" } });
    expect(boardCalls()[0].pass).toBe("v1.stored");
    expect(exchanges()).toHaveLength(0);
    resetBoardPassForTests();
    sessionStorage.setItem("rb_board_pass", JSON.stringify({ pass: "v1.lapsing", expiresAt: Date.now() + 30_000 }));
    await invokeJobBoard({ body: { action: "list" } });
    expect(boardCalls()[1].pass, "within a minute of expiry it is replaced").toBe("v1.pass-1");
  });

  it("a refusal with code 'pass' gets a fresh pass and exactly ONE retry", async () => {
    let n = 0;
    board = (o) => (o.body?.action === "list" && n++ === 0 ? passRefusal() : ok({ jobs: [1] }));
    const res = await invokeJobBoard({ body: { action: "list" } });
    expect(res).toEqual(ok({ jobs: [1] }));
    expect(boardCalls()).toEqual([{ action: "list", pass: "v1.pass-1" }, { action: "list", pass: "v1.pass-2" }]);
    expect(exchanges()).toHaveLength(2);

    invoke.mockClear();
    board = () => passRefusal();
    const again = await invokeJobBoard({ body: { action: "detail", id: "x" } });
    expect(boardCalls(), "refused twice: the second refusal is the answer, never a third call").toHaveLength(2);
    expect((await readBoardBudgetRefusal(again.error))?.code).toBe("pass");
  });

  it("any other refusal is never retried by the door", async () => {
    for (const code of ["address", "country", "network"]) {
      invoke.mockClear();
      board = () => httpError(429, { error: "board_budget", code, limit: 0, used: 0, resetAt: future() });
      await invokeJobBoard({ body: { action: "list" } });
      expect(boardCalls(), code).toHaveLength(1);
    }
    invoke.mockClear();
    board = () => httpError(503, { error: "busy" });
    await invokeJobBoard({ body: { action: "list" } });
    expect(boardCalls(), "nor an ordinary failure: the callers own that retry").toHaveLength(1);
  });

  it("a failed check reads the board without a header, and is not repeated for five minutes unless a refusal asks", async () => {
    solve = (r) => setTimeout(() => (r.opts["error-callback"] as (c: string) => void)("110200"), 5);
    await invokeJobBoard({ body: { action: "list" } });
    expect(boardCalls()).toEqual([{ action: "list", pass: null }]);
    await invokeJobBoard({ body: { action: "facets" } });
    expect(rendered, "the cooldown holds").toHaveLength(1);
    expect(exchanges()).toHaveLength(0);
    board = (o) => (o.headers?.[BOARD_PASS_HEADER] ? ok({ jobs: [] }) : passRefusal());
    solve = (r) => setTimeout(() => (r.opts.callback as (t: string) => void)("tok-late"), 5);
    await invokeJobBoard({ body: { action: "list" } });
    expect(rendered, "a pass refusal asks for a fresh check past the cooldown").toHaveLength(2);
    expect(boardCalls().at(-1)).toEqual({ action: "list", pass: "v1.pass-1" });
  });

  it("an exchange the server refuses is no pass", async () => {
    invoke.mockImplementation(async (fn: string, o?: Opts) =>
      (o?.body?.action === "board-pass" ? httpError(503, { error: "board_pass_unconfigured" }) : ok({ jobs: [] })));
    await invokeJobBoard({ body: { action: "list" } });
    expect(boardCalls()).toEqual([{ action: "list", pass: null }]);
    expect(boardPassHeader()).toEqual({});
  });

  it("a call that carried a pass and got no answer at all forgets the pass", async () => {
    await invokeJobBoard({ body: { action: "list" } });
    expect(boardPassHeader()).toEqual({ [BOARD_PASS_HEADER]: "v1.pass-1" });
    board = () => ({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" } });
    await invokeJobBoard({ body: { action: "list" } });
    expect(boardPassHeader(), "a job-board that does not allow the header (a rollback) is read without it").toEqual({});
    expect(sessionStorage.getItem("rb_board_pass")).toBeNull();
  });

  it("without window.turnstile, the explicit-render script is added once and the pass follows its load", async () => {
    delete w.turnstile;
    const first = ensureBoardPass();
    const second = ensureBoardPass();
    await Promise.resolve();
    const scripts = document.head.querySelectorAll(`script[src="${SCRIPT}"]`);
    expect(scripts).toHaveLength(1);
    installTurnstile();
    scripts[0].dispatchEvent(new Event("load"));
    expect(await first).toBe("v1.pass-1");
    expect(await second).toBe("v1.pass-1");
  });
});

// ── the review of 2026-10-03 ────────────────────────────────────────────────

describe("with the key set: the scenarios the review found", () => {
  beforeEach(() => { vi.stubEnv("VITE_TURNSTILE_SITE_KEY", SITE_KEY); installTurnstile(); });
  const MIN = 60_000;

  it("a visitor whose clock runs 40 minutes fast keeps and sends the pass: it is kept by ttlSeconds, not our absolute time", async () => {
    // The server's clock is 40 minutes behind this browser's: its expiresAt reads as already past here.
    invoke.mockImplementation(async (fn: string, o?: Opts) => {
      if (o?.body?.action === "board-pass") {
        passes++;
        return ok({ pass: `v1.pass-${passes}`, expiresAt: new Date(Date.now() - 40 * MIN + 30 * MIN).toISOString(), ttlSeconds: 1800 });
      }
      return ok({ jobs: [] });
    });
    for (const action of ["list", "detail", "facets"]) await invokeJobBoard({ body: { action } });
    expect(boardCalls().map((c) => c.pass)).toEqual(["v1.pass-1", "v1.pass-1", "v1.pass-1"]);
    expect(rendered, "one check, not one per read").toHaveLength(1);
    expect(exchanges()).toHaveLength(1);
    const kept = JSON.parse(sessionStorage.getItem("rb_board_pass") ?? "{}").expiresAt;
    expect(kept - Date.now(), "kept on this browser's clock").toBeGreaterThan(29 * MIN);
  });

  it("an answer without ttlSeconds whose expiry this clock reads as past is one failed attempt, never a solve per read", async () => {
    invoke.mockImplementation(async (fn: string, o?: Opts) => {
      if (o?.body?.action === "board-pass") { passes++; return ok({ pass: `v1.pass-${passes}`, expiresAt: new Date(Date.now() - 10 * MIN).toISOString() }); }
      return ok({ jobs: [] });
    });
    for (const action of ["list", "detail", "facets"]) await invokeJobBoard({ body: { action } });
    expect(boardCalls().map((c) => c.pass)).toEqual([null, null, null]);
    expect(rendered, "the cooldown holds").toHaveLength(1);
    expect(exchanges()).toHaveLength(1);
  });

  it("a script that never loads holds a counted read for one deadline, then the board is read without a pass, and the next read does not wait", async () => {
    vi.useFakeTimers();
    delete w.turnstile; // challenges.cloudflare.com accepts the connection and never answers
    let settled = false;
    const first = invokeJobBoard({ body: { action: "list" } }).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(BOARD_PASS_DEADLINE_MS - 100);
    expect(settled, "still inside the deadline").toBe(false);
    expect(boardCalls()).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(settled, "past the deadline the read goes out").toBe(true);
    expect((await first).error).toBeNull();
    expect(boardCalls()).toEqual([{ action: "list", pass: null }]);
    let second = false;
    void invokeJobBoard({ body: { action: "facets" } }).then(() => { second = true; });
    await vi.advanceTimersByTimeAsync(1);
    expect(second, "the next counted read does not wait again").toBe(true);
    expect(document.head.querySelectorAll(`script[src="${SCRIPT}"]`), "the script was added once").toHaveLength(1);
  });

  it("a check that never answers is abandoned at the deadline and its widget removed", async () => {
    vi.useFakeTimers();
    const removed: string[] = [];
    w.turnstile = {
      render: (el, opts) => { rendered.push({ el, opts }); return `w${rendered.length}`; },
      remove: (id) => { removed.push(id); },
    };
    const read = invokeJobBoard({ body: { action: "list" } });
    await vi.advanceTimersByTimeAsync(BOARD_PASS_DEADLINE_MS + 10);
    await read;
    expect(boardCalls()).toEqual([{ action: "list", pass: null }]);
    expect(removed).toEqual(["w1"]);
  });

  it("when Cloudflare asks a person to interact, the widget stays up and the deadline becomes two minutes", async () => {
    vi.useFakeTimers();
    const removed: string[] = [];
    let opts: Record<string, unknown> = {};
    w.turnstile = {
      render: (el, o) => { rendered.push({ el, opts: o }); opts = o; return "w1"; },
      remove: (id) => { removed.push(id); },
    };
    let settled = false;
    const read = invokeJobBoard({ body: { action: "detail", id: "x" } }).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(1);
    expect(typeof opts["before-interactive-callback"]).toBe("function");
    (opts["before-interactive-callback"] as () => void)();
    await vi.advanceTimersByTimeAsync(BOARD_PASS_DEADLINE_MS + 30_000); // the person takes 40 seconds to notice and click
    expect(settled).toBe(false);
    expect(removed, "the widget is still there to be clicked").toEqual([]);
    (opts.callback as (t: string) => void)("tok-clicked");
    await vi.advanceTimersByTimeAsync(10);
    await read;
    expect(exchanges().map(([, o]) => (o as Opts).body?.token)).toEqual(["tok-clicked"]);
    expect(boardCalls()).toEqual([{ action: "detail", pass: "v1.pass-1" }]);
    expect(removed).toEqual(["w1"]);
    expect(BOARD_PASS_INTERACTIVE_DEADLINE_MS).toBe(120_000);
  });

  it("board_pass_unconfigured turns the check off for the tab -- past the cooldown and across a reload -- until a pass refusal proves it is on", async () => {
    vi.useFakeTimers();
    let configured = false;
    invoke.mockImplementation(async (fn: string, o?: Opts) => {
      if (o?.body?.action === "board-pass") {
        if (!configured) return httpError(503, { error: "board_pass_unconfigured" });
        passes++;
        return ok({ pass: `v1.pass-${passes}`, expiresAt: future(), ttlSeconds: 1800 });
      }
      return board(o ?? {});
    });
    const run = async (o: Opts) => { const p = invokeJobBoard(o); await vi.advanceTimersByTimeAsync(50); return p; };
    await run({ body: { action: "list" } });
    expect(rendered).toHaveLength(1);
    expect(exchanges()).toHaveLength(1);
    vi.setSystemTime(Date.now() + BOARD_PASS_FAIL_COOLDOWN_MS + MIN);
    await run({ body: { action: "facets" } });
    resetBoardPassForTests(); // a reload: memory gone, the tab's sessionStorage kept
    await run({ body: { action: "detail", id: "x" } });
    expect(rendered, "no check runs while the secret is missing").toHaveLength(1);
    expect(exchanges()).toHaveLength(1);
    expect(boardCalls().map((c) => c.pass)).toEqual([null, null, null]);
    configured = true;
    board = (o) => (o.headers?.[BOARD_PASS_HEADER] ? ok({ jobs: [1] }) : passRefusal());
    const res = await run({ body: { action: "list" } });
    expect(res).toEqual(ok({ jobs: [1] }));
    expect(boardCalls().slice(-2)).toEqual([{ action: "list", pass: null }, { action: "list", pass: "v1.pass-1" }]);
    expect(sessionStorage.getItem("rb_board_pass_off")).toBeNull();
  });

  it("refusals of an old pass that land one after another share ONE new pass", async () => {
    let order = 0;
    board = (o) => new Promise((resolve) => {
      const wait = 40 * ++order;
      setTimeout(() => resolve(o.headers?.[BOARD_PASS_HEADER] === "v1.pass-1" ? passRefusal() : ok({ jobs: [1] })), wait);
    });
    const res = await Promise.all([invokeJobBoard({ body: { action: "list" } }), invokeJobBoard({ body: { action: "facets" } }), invokeJobBoard({})]);
    expect(res.every((r) => !r.error)).toBe(true);
    expect(exchanges(), "pass-1, then one replacement for all three").toHaveLength(2);
    expect(rendered).toHaveLength(2);
    expect(boardCalls().filter((c) => c.pass === "v1.pass-2")).toHaveLength(3);
  });

  it("once a refusal's own attempt has failed, further pass refusals do not re-run the check until the cooldown passes", async () => {
    solve = (r) => setTimeout(() => (r.opts["error-callback"] as (c: string) => void)("600010"), 5);
    board = (o) => (o.headers?.[BOARD_PASS_HEADER] ? ok({ jobs: [] }) : passRefusal());
    const a = await invokeJobBoard({ body: { action: "list" } });
    expect((await readBoardBudgetRefusal(a.error))?.code).toBe("pass");
    expect(rendered, "the read's attempt and the refusal's one fresh attempt").toHaveLength(2);
    for (const action of ["facets", "detail", "list"]) await invokeJobBoard({ body: { action } });
    expect(rendered, "a broken check is not re-run for every refused call").toHaveLength(2);
    expect(boardCalls(), "one call each: no retry without a new pass").toHaveLength(4);
  });
});

// ── the codebase ────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "../..");
function walk(dir: string): string[] {
  const out: string[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "test") go(p); } else if (/\.(ts|tsx)$/.test(e.name)) out.push(relative(ROOT, p));
    }
  };
  go(resolve(ROOT, dir));
  return out;
}

describe("every browser call to job-board goes through the door", () => {
  const files = walk("src").map((rel) => ({ rel, code: codeOf(readFileSync(resolve(ROOT, rel), "utf8")) }));

  it("positive control: the walk reads the app, and the door has its callers", () => {
    expect(files.length).toBeGreaterThan(200);
    const users = files.filter((f) => /\binvokeJobBoard\(/.test(f.code)).map((f) => f.rel);
    expect(users.length, users.join(", ")).toBeGreaterThanOrEqual(15);
    for (const must of ["src/pages/Jobs.tsx", "src/pages/JobPosting.tsx", "src/lib/board-facets.ts", "src/components/LiveMatches.tsx"]) expect(users).toContain(must);
  });

  it("no other file invokes job-board or fetches it directly", () => {
    const direct = files
      .filter((f) => /\.invoke(?:<[^>]*>)?\(\s*["'`]job-board["'`]/.test(f.code) || /functions\/v1\/job-board/.test(f.code))
      .map((f) => f.rel)
      .sort();
    expect(direct, "route these through invokeJobBoard (src/lib/invoke-job-board.ts)").toEqual(["src/lib/board-pass.ts", "src/lib/invoke-job-board.ts"]);
    const pass = files.find((f) => f.rel === "src/lib/board-pass.ts")!.code;
    expect((pass.match(/\.invoke\("job-board"/g) ?? []).length, "board-pass.ts calls job-board for the exchange and nothing else").toBe(1);
    expect(pass).toMatch(/invoke\("job-board", \{ body: \{ action: "board-pass", token \} \}\)/);
  });

  it("the door's counted actions mirror the edge's BUDGETED_ACTIONS", () => {
    expect([...BOARD_COUNTED_ACTIONS].sort()).toEqual([...BUDGETED_ACTIONS].sort());
  });

  it("the site serves no Content-Security-Policy that would block Cloudflare's script (re-check if one is added)", () => {
    const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
    expect(html).not.toMatch(/Content-Security-Policy/i);
    for (const f of ["public/_headers", "vercel.json", "netlify.toml"]) {
      let text = "";
      try { text = readFileSync(resolve(ROOT, f), "utf8"); } catch { continue; }
      expect(text, f).not.toMatch(/Content-Security-Policy/i);
    }
  });
});

describe("the page reads the new refusal codes and says the right thing", () => {
  it("network and pass are read as themselves; an unknown code is an address refusal", async () => {
    for (const code of ["network", "pass", "country", "address"]) {
      expect((await readBoardBudgetRefusal(httpError(429, { error: "board_budget", code, resetAt: null }).error))?.code).toBe(code);
    }
    expect((await readBoardBudgetRefusal(httpError(429, { error: "board_budget", code: "martian" }).error))?.code).toBe("address");
  });

  it("the network notice carries no number; the pass notice says to reload", () => {
    const { unmount } = render(<BoardBudgetNotice refusal={{ code: "network", limit: 0, resetAt: future() }} />);
    const net = document.querySelector("[data-board-budget-notice]");
    expect(net?.getAttribute("data-board-budget-notice")).toBe("network");
    expect(screen.getByText(/reads from this network are paused/)).toBeInTheDocument();
    expect(net?.textContent ?? "").not.toMatch(/\d/);
    unmount();
    render(<BoardBudgetNotice refusal={{ code: "pass", limit: 0, resetAt: null }} />);
    expect(document.querySelector("[data-board-budget-notice]")?.getAttribute("data-board-budget-notice")).toBe("pass");
    expect(screen.getByText(/finish a quick check before the job board can load\. Reload the page/)).toBeInTheDocument();
  });
});
