// THE LEADERBOARD THE PAGE WAITED TWENTY SECONDS FOR WAS COMPUTABLE AN HOUR AGO
// -- the page half. The migration half (20260909228000, executed in pglite) is
// the-leaderboard-joins-the-hourly-cache.test.ts.
//
// Measured live 2026-09-14: get_actively_hiring_companies(20) answered in
// 13.8-25.7s across five runs; get_stats_cache in 0.24s. The Ghost Job Index
// read six parts off the cache and the leaderboard LIVE, every visit, so the
// section that names the page painted last or -- when the RPC's own 25s header
// fired -- not at all.
//
// THE PROPERTIES, each rendered rather than read where a render can show it:
//   1. the page reads cache.actively_hiring FIRST, and calls the live RPC only
//      when the cache carries no usable leaderboard;
//   2. the date it prints is the leaderboard's OWN computed_at -- never the
//      row's, never the tiles' -- and a live read prints no date at all;
//   3. a carried part (stale_parts names it) says "carried" beside its date and
//      stops calling its counts "now";
//   4. the fallback is off the critical path: the tiles paint while it is
//      pending, and it is no longer inside the Promise.all;
//   5. a failed fallback renders the section's unavailable state, not nothing;
//      an EMPTY live answer still renders nothing, because that is an answer.
// Source assertions run against comment-stripped code: the page's comments
// quote every spelling below, and a guard satisfied by prose is the trap this
// repo has fallen into seven times. Teeth: the same assertions are run against
// a copy with the cache-first read cut out, and must fail there.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    functions: { invoke: async () => ({ data: {} }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import GhostJobIndex, { readCachedLeaderboard } from "../pages/GhostJobIndex";

const body = () => document.body.textContent ?? "";
const NEVER = new Promise<never>(() => {});
const ROWS = [
  { company: "Acme Corp", company_token: "acme", closed_90d: 30, open_roles: 120, tracking_days: 40, fill_incidence_14d: 0.42, filled_roles_ceiling: 30, dated_share: 0.9 },
  { company: "Globex", company_token: "globex", closed_90d: 20, open_roles: 300, tracking_days: 35, fill_incidence_14d: 0.31, filled_roles_ceiling: 20, dated_share: 0.8 },
];
const GHOST = {
  total_open: 794317, total_companies: 32967, total_company_names: 32086, closed_90d: 1000,
  observed_days: 58, median_days_open: 13.8, median_days_to_close: 11, posted_coverage_pct: 99.4,
};
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 3_600_000;

/** A cache row as the refresh writes it. `board` is the seventh part, or
 *  absent; `stale` is stale_parts. */
const cacheRow = (opts: { rowAt: string; board?: unknown; stale?: string[] }) => ({
  computed_at: opts.rowAt,
  ghost_stats: { ...GHOST, computed_at: opts.rowAt },
  stale_parts: opts.stale ?? [],
  ...(opts.board === undefined ? {} : { actively_hiring: opts.board }),
});

const boardCalls = () => rpc.mock.calls.filter((c) => c[0] === "get_actively_hiring_companies").length;

function mount(cache: unknown, board: () => unknown) {
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_stats_cache") return Promise.resolve({ data: cache });
    if (fn === "get_actively_hiring_companies") return board();
    return Promise.resolve({ data: null });
  });
  return render(<MemoryRouter><GhostJobIndex /></MemoryRouter>);
}

beforeEach(() => { rpc.mockReset(); });

describe("1. the cache first, the RPC only when the cache has no leaderboard", () => {
  it("renders the cached rows and never calls the live RPC", async () => {
    mount(cacheRow({ rowAt: iso(0), board: { computed_at: iso(30 * 60_000), rows: ROWS } }), () => NEVER);
    await waitFor(() => expect(body()).toContain("Acme Corp"));
    expect(body()).toContain("Globex");
    expect(boardCalls(), "the live leaderboard RPC was called although the cache carried the list").toBe(0);
  });

  it.each([
    ["key absent", undefined],
    ["part null (first run failed with nothing to carry)", null],
    ["part unstamped", { rows: ROWS }],
    ["part with an empty list", { computed_at: iso(0), rows: [] }],
    ["part with rows that are not an array", { computed_at: iso(0), rows: "Acme" }],
  ])("falls back to the live RPC when the cache part is unusable: %s", async (_label, board) => {
    mount(cacheRow({ rowAt: iso(0), board }), () => Promise.resolve({ data: ROWS }));
    await waitFor(() => expect(body()).toContain("Acme Corp"));
    expect(boardCalls()).toBe(1);
    expect(rpc.mock.calls.find((c) => c[0] === "get_actively_hiring_companies")?.[1]).toEqual({ p_limit: 20 });
  });

  it("the reader itself refuses every unusable shape and accepts the written one", () => {
    const at = iso(0);
    expect(readCachedLeaderboard(null)).toBeNull();
    expect(readCachedLeaderboard({})).toBeNull();
    expect(readCachedLeaderboard({ actively_hiring: null })).toBeNull();
    expect(readCachedLeaderboard({ actively_hiring: ROWS })).toBeNull();
    expect(readCachedLeaderboard({ actively_hiring: { rows: ROWS } })).toBeNull();
    expect(readCachedLeaderboard({ actively_hiring: { computed_at: "not a date", rows: ROWS } })).toBeNull();
    expect(readCachedLeaderboard({ actively_hiring: { computed_at: at, rows: [] } })).toBeNull();
    expect(readCachedLeaderboard({ actively_hiring: { computed_at: at, rows: ROWS } }))
      .toEqual({ rows: ROWS, computedAt: at, carried: false });
    expect(readCachedLeaderboard({ actively_hiring: { computed_at: at, rows: ROWS }, stale_parts: ["ghost_stats", "actively_hiring"] })?.carried).toBe(true);
    expect(readCachedLeaderboard({ actively_hiring: { computed_at: at, rows: ROWS }, stale_parts: ["ghost_stats"] })?.carried).toBe(false);
  });
});

describe("2. the date printed is the leaderboard's own", () => {
  it("prints the part's computed_at, not the row's and not the tiles'", async () => {
    // Distinct on purpose: the part is thirty minutes older than the row it
    // arrived in (a healthy hour, the part computed near the end of the
    // previous run's window), and both are under the tiles' 3h bar, so the
    // tiles say "right now" while the leaderboard still dates itself.
    const rowAt = iso(0);
    const boardAt = iso(30 * 60_000);
    mount(cacheRow({ rowAt, board: { computed_at: boardAt, rows: ROWS } }), () => NEVER);
    await waitFor(() => expect(body()).toContain("Acme Corp"));
    expect(body()).toContain(`Ranking as of ${new Date(boardAt).toLocaleString()}`);
    expect(body(), "the leaderboard borrowed the row's stamp").not.toContain(`Ranking as of ${new Date(rowAt).toLocaleString()}`);
    expect(body()).toContain("verified open roles right now");
    expect(body()).toContain("recomputed hourly");
    expect(body()).not.toContain("carried forward");
    expect(body()).toContain("120 open now");
  });

  it("a live read prints no date at all -- there is none to print, and none is borrowed", async () => {
    mount(cacheRow({ rowAt: iso(0) }), () => Promise.resolve({ data: ROWS }));
    await waitFor(() => expect(body()).toContain("Acme Corp"));
    expect(body()).not.toContain("Ranking as of");
    expect(body()).toContain("120 open now");
  });
});

describe("3. a carried leaderboard says so beside its date", () => {
  it("names the carry-forward and stops calling its counts 'now'", async () => {
    const boardAt = iso(26 * HOUR);
    mount(cacheRow({ rowAt: iso(0), board: { computed_at: boardAt, rows: ROWS }, stale: ["actively_hiring"] }), () => NEVER);
    await waitFor(() => expect(body()).toContain("Acme Corp"));
    expect(body()).toContain(`Ranking as of ${new Date(boardAt).toLocaleString()} — carried forward`);
    expect(body()).toContain("did not finish");
    expect(body()).toContain("120 open then");
    expect(body()).not.toContain("120 open now");
    // ...and the tiles beside it keep their own, fresher, wording.
    expect(body()).toContain("verified open roles right now");
    expect(boardCalls(), "a carried list is still a list; the live RPC must not be paid for on top of it").toBe(0);
  });

  it("an uncarried list older than the tiles' 3h bar is dated the same way", async () => {
    const boardAt = iso(5 * HOUR);
    mount(cacheRow({ rowAt: iso(0), board: { computed_at: boardAt, rows: ROWS } }), () => NEVER);
    await waitFor(() => expect(body()).toContain("Acme Corp"));
    expect(body()).toContain("120 open then");
    expect(body()).not.toContain("carried forward");
  });
});

describe("4. the fallback is off the critical path", () => {
  it("the tiles paint while the live read is pending, and the list joins when it answers", async () => {
    let answer: (v: unknown) => void = () => {};
    const pending = new Promise((r) => { answer = r; });
    mount(cacheRow({ rowAt: iso(0) }), () => pending);
    await waitFor(() => expect(body()).toContain("794,317"), { timeout: 2000 });
    expect(body()).not.toContain("Acme Corp");
    expect(body()).not.toContain("unavailable at the moment");
    answer({ data: ROWS });
    await waitFor(() => expect(body()).toContain("Acme Corp"));
  });
});

describe("5. a failed fallback renders the unavailable state, not nothing", () => {
  it("when the RPC rejects", async () => {
    mount(cacheRow({ rowAt: iso(0) }), () => Promise.reject(new Error("57014")));
    await waitFor(() => expect(body()).toContain("This ranking is unavailable at the moment"));
    expect(body()).toContain("an unreadable list is not an empty one");
    expect(body()).not.toContain("Acme Corp");
  });

  it("when the RPC answers with no data (PostgREST's shape for an error)", async () => {
    mount(cacheRow({ rowAt: iso(0) }), () => Promise.resolve({ data: null }));
    await waitFor(() => expect(body()).toContain("This ranking is unavailable at the moment"));
  });

  it("but an EMPTY live answer is an answer: neither list nor unavailable state", async () => {
    mount(cacheRow({ rowAt: iso(0) }), () => Promise.resolve({ data: [] }));
    await waitFor(() => expect(body()).toContain("794,317"));
    await new Promise((r) => setTimeout(r, 50));
    expect(body()).not.toContain("unavailable at the moment");
    expect(body()).not.toContain("Ranking as of");
  });

  it("and a cached list is never displaced by the unavailable state", async () => {
    mount(cacheRow({ rowAt: iso(0), board: { computed_at: iso(0), rows: ROWS } }), () => Promise.reject(new Error("never called anyway")));
    await waitFor(() => expect(body()).toContain("Acme Corp"));
    expect(body()).not.toContain("unavailable at the moment");
  });
});

// ── the source, comment-stripped, and its teeth ───────────────────────────────
const RAW = readFileSync(resolve(__dirname, "../pages/GhostJobIndex.tsx"), "utf8");
/** Line comments first, then block comments -- a line comment containing `/*`
 *  would otherwise open a block that eats real code. JSX `{/* ... *\/}` blocks
 *  are block comments and fall to the second pass. */
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const CODE = strip(RAW);

/** The properties as a function of the code, so the same checks run on the
 *  shipped page and on the pre-fix copy. Returns the violations. */
function violations(code: string): string[] {
  const out: string[] = [];
  const readAt = code.indexOf("const cachedBoard = readCachedLeaderboard(cache);");
  const rpcAt = code.indexOf('rpc("get_actively_hiring_companies"');
  if (readAt === -1) out.push("the page never reads cache.actively_hiring through readCachedLeaderboard");
  if (rpcAt === -1) out.push("the live RPC fallback is gone");
  if (readAt !== -1 && rpcAt !== -1 && readAt > rpcAt) out.push("the live RPC is issued before the cache is read");
  if (!/if \(cachedBoard\) \{[\s\S]*?setLeaders\(cachedBoard\.rows\);[\s\S]*?setLeaderboardComputedAt\(cachedBoard\.computedAt\);[\s\S]*?setLeaderboardCarried\(cachedBoard\.carried\);[\s\S]*?\} else \{[\s\S]*?rpc\("get_actively_hiring_companies", \{ p_limit: 20 \}\)/.test(code)) {
    out.push("the live RPC is not gated on the cache having no usable leaderboard");
  }
  // Off the critical path: not inside the Promise.all the other reads share.
  const allAt = code.indexOf("await Promise.all([");
  const allEnd = code.indexOf("]);", allAt);
  if (allAt === -1) out.push("the Promise.all is gone");
  else if (code.slice(allAt, allEnd).includes("get_actively_hiring_companies")) out.push("the leaderboard read is back inside the Promise.all");
  // A failed fallback marks the section unavailable; an answered one fills it.
  if (!/\.then\(\(l\) => \{\s*if \(Array\.isArray\(l\.data\)\) setLeaders\(l\.data as Leader\[\]\);\s*else setLeadersUnavailable\(true\);/.test(code)) {
    out.push("a failed fallback does not mark the section unavailable");
  }
  // The printed date is the part's own stamp, and only that.
  const h2 = code.indexOf("Actively hiring");
  const section = code.slice(h2, code.indexOf("absent from this ranking by construction", h2));
  if (!section.includes("`Ranking as of ${new Date(leaderboardComputedAt).toLocaleString()}`")) out.push("the section does not print the leaderboard's own computed_at");
  if (/statsComputedAt|cachedAt|cache\??\.computed_at/.test(section)) out.push("the section borrows another stamp");
  if (!/leaderboardCarried\s*\?\s*" — carried forward/.test(section)) out.push("a carried part is not disclosed beside its date");
  if (!/\{shownLeaders\.length === 0 && leadersUnavailable && \(/.test(code)) out.push("no unavailable state");
  if (!/This ranking is unavailable at the moment/.test(code)) out.push("the unavailable state says nothing");
  return out;
}

describe("the source carries every property, comment-stripped", () => {
  it("no violations on the shipped page", () => {
    expect(violations(CODE)).toEqual([]);
  });

  it("the reader refuses an unstamped part in code, not in a comment", () => {
    expect(CODE).toMatch(/if \(typeof computed_at !== "string" \|\| Number\.isNaN\(new Date\(computed_at\)\.getTime\(\)\)\) return null;/);
    expect(CODE).toMatch(/if \(!Array\.isArray\(rows\) \|\| rows\.length === 0\) return null;/);
    expect(CODE).toMatch(/carried: stale\.includes\("actively_hiring"\)/);
  });

  it("teeth: a copy with the cache-first read cut out fails", () => {
    // The pre-fix shape: the leaderboard read live, unconditionally, inside the
    // Promise.all with the other reads. Rebuilt from the shipped text by
    // deleting the branch and re-inserting the bare read where it used to be.
    const start = CODE.indexOf("const cachedBoard = readCachedLeaderboard(cache);");
    const end = CODE.indexOf("const [a, f, b] = await Promise.all([", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const prefix = CODE.slice(0, start)
      + CODE.slice(end).replace(
        "const [a, f, b] = await Promise.all([",
        'const [l, a, f, b] = await Promise.all([\n Promise.resolve(rpc("get_actively_hiring_companies", { p_limit: 20 })).catch(() => ({ data: null })),',
      );
    const v = violations(prefix);
    expect(v).toContain("the page never reads cache.actively_hiring through readCachedLeaderboard");
    expect(v).toContain("the leaderboard read is back inside the Promise.all");
    expect(v).toContain("a failed fallback does not mark the section unavailable");
  });

  it("teeth: a copy that dates the list with the tiles' stamp fails", () => {
    const mutant = CODE.replace("`Ranking as of ${new Date(leaderboardComputedAt).toLocaleString()}`", "`Ranking as of ${new Date(statsComputedAt as string).toLocaleString()}`");
    expect(mutant).not.toBe(CODE);
    expect(violations(mutant)).toContain("the section borrows another stamp");
  });
});
