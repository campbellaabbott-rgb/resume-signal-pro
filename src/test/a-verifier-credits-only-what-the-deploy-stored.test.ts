// @vitest-environment node
/**
 * A VERIFIER CREDITS ONLY WHAT THE DEPLOY STORED.
 *
 * Section 89 of verify-deploy credited novartis's 220 served rows to .89
 * against a "was 0" baseline, when every one of them predated the deploy, and
 * said the deep lane "takes two a slice" when it visited nothing (the .90
 * diagnosis, 2026-10-06). Section 90 judges the .90 claims. Both judging
 * blocks are run here against fixture files, the way section 7j is in
 * every-caller-that-reads-the-board-names-its-budget.test.ts: the block's
 * /tmp/vd_89_ or /tmp/vd_90_ prefix is pointed at a temp dir and the lines it
 * prints are the behaviour under test.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const blocks = (sh: string) => [...sh.matchAll(/node -e '([^']*)'/g)].map((m) => m[1]);
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const H = 3_600_000;

function runBlock(js: string, prefix: string, files: Record<string, string>, env: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-stored-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const code = js.split(`/tmp/${prefix}`).join(join(dir, prefix));
  return execFileSync(process.execPath, ["-e", code], { encoding: "utf8", env: { ...process.env, ...env } }).split("\n").filter(Boolean);
}

// ── section 89: Workday is judged by rows inserted after the floor ──────────
const S89 = read("scripts/verify-deploy.d/89-job-board-ingest.sh");
const judge89 = blocks(S89).find((b) => b.includes("/tmp/vd_89_served.tsv") && b.includes("/tmp/vd_89_status.json")) ?? "";
const NOV = "novartis~wd3~Novartis_Careers";
// 819 postings newest first: positions 0-519 in the window, 520-818 "30+ days".
const novFeed = { total: 819, at: iso(0), pos: Array.from({ length: 819 }, (_, i) => ({ id: `workday:${NOV}:R${i}`, at: i, d: i < 520 ? 5 : 31 })) };
const run89 = (rows: Array<{ id: string; lastSeen: string }>, floorAgoH: number) =>
  runBlock(judge89, "vd_89_", {
    "vd_89_status.json": JSON.stringify({ version: "2026-09-09.90", deepCursor: { laps: {}, top: [] }, oversizeBoards: [] }),
    "vd_89_preflight.txt": "x-fn-build: job-board.2026-09-09.90\r\n",
    "vd_89_served.tsv": "",
    "vd_89_workday.json": JSON.stringify({ [NOV]: { feed: novFeed, served: { total: rows.length, rows } } }),
  }, { VD89_AT: iso(floorAgoH * H) }).filter((l) => l.includes(`workday:${NOV}`));
const rowsAt = (from: number, to: number, lastSeen: string) =>
  Array.from({ length: to - from }, (_, k) => ({ id: `workday:${NOV}:R${from + k}`, lastSeen }));

describe("section 89 credits a Workday board with the rows .89 stored, and nothing older", () => {
  it("finds its judging block", () => {
    expect(judge89, "no node block reading vd_89_served.tsv and vd_89_status.json").not.toBe("");
  });

  it("rows inserted after the floor in two windows are credited, and both windows are named as read", () => {
    const out = run89([...rowsAt(0, 260, iso(20 * H)), ...rowsAt(260, 400, iso(10 * H))], 30);
    expect(out, out.join("\n")).toHaveLength(1);
    expect(out[0]).toMatch(/^PASS .* credits \.89 with 400 of 520 in-window ids left for it to store \(want at least 260; 520 in-window on its own feed, 0 served from before the floor/);
    expect(out[0]).toContain("[0,260) [260,520)");
  });

  it("rows served from before the floor credit nothing, however many there are (the novartis 220)", () => {
    const out = run89(rowsAt(0, 450, iso(48 * H)), 30);
    expect(out, out.join("\n")).toHaveLength(1);
    expect(out[0]).toMatch(/^FAIL .* credits \.89 with 0 of 70 in-window ids left for it to store/);
    expect(out[0]).toContain("450 served from before the floor and not credited");
    expect(out[0]).toMatch(/: none, of 4 in its lap/);
  });

  it("one .89 insert does not credit the older rows around it: a window it proves was read lends them nothing", () => {
    // One row inserted after the floor at the head of the feed, 259 older rows behind it in the same
    // window, and windows [260,520) never read: under window credit this passed with 260 of 520.
    const out = run89([...rowsAt(0, 1, iso(20 * H)), ...rowsAt(1, 260, iso(48 * H))], 30);
    expect(out, out.join("\n")).toHaveLength(1);
    expect(out[0]).toMatch(/^FAIL .* credits \.89 with 1 of 261 in-window ids left for it to store \(want at least 131/);
    expect(out[0]).toContain("259 served from before the floor and not credited");
    expect(out[0]).toContain(": [0,260), of 4 in its lap");
  });

  it("older rows leave the denominator too: a board .89 stored everything it could on passes, its old rows uncredited", () => {
    const out = run89([...rowsAt(0, 260, iso(20 * H)), ...rowsAt(260, 520, iso(48 * H))], 30);
    expect(out[0]).toMatch(/^PASS .* credits \.89 with 260 of 260 in-window ids left for it to store/);
    expect(out[0]).toContain("260 served from before the floor and not credited");
    expect(out[0]).not.toContain("[260,520)");
    const all = run89(rowsAt(0, 520, iso(48 * H)), 30);
    expect(all[0], "nothing left to store is not a pass").toMatch(/^INFO .* credits \.89 with 0 of 0 .*nothing to credit \.89 with or against/);
  });

  it("before a whole lap has passed since the floor, a short credit is INFO, not FAIL", () => {
    const out = run89(rowsAt(0, 450, iso(48 * H)), 10);
    expect(out[0]).toMatch(/^INFO .* credits \.89 with 0 of 70/);
    expect(out[0]).toMatch(/a lap is ~26h after the floor; 10h so far/);
  });
});

// ── section 90: the .90 claims ──────────────────────────────────────────────
const S90 = read("scripts/verify-deploy.d/90-job-board-light-and-deep.sh");
const judge90 = blocks(S90).find((b) => b.includes("/tmp/vd_90_data.json") && b.includes("VD90_LAST")) ?? "";
const PG = "pg~wd5~1000";
const ghFeed = (t: string, inWin: number, old: number) => ({
  n: inWin + old,
  ids: Array.from({ length: inWin + old }, (_, i) => `greenhouse:${t}:${i}`),
  inWin: Array.from({ length: inWin }, (_, i) => `greenhouse:${t}:${i}`),
});
const ghServed = (t: string, n: number, lastSeen: string) => ({ total: n, rows: Array.from({ length: n }, (_, i) => ({ id: `greenhouse:${t}:${i}`, lastSeen })) });
const pgFeed = { total: 816, at: iso(0), pos: Array.from({ length: 816 }, (_, i) => ({ id: `workday:${PG}:R${i}`, at: i, d: i < 471 ? 3 : 31 })) };
const pgServed = (n: number, lastSeen: string) => ({ total: n, rows: Array.from({ length: n }, (_, i) => ({ id: `workday:${PG}:R${i}`, lastSeen })) });

function healthy(deployAgoH: number) {
  const since = iso(deployAgoH * H);
  const lane = (agoMin: number) => ({ at: iso(agoMin * 60_000), candidates: 650, selected: 1, visited: 1, start: 3 });
  const status = (laneAgoMin: number, cold: number) => ({
    version: "2026-09-09.90",
    sliceStats: { lightSet: 112, lightCap: 500, lightReread: { enrolled: 2, reread: 2, ok: 2, deferred: 0, since } },
    oversizeBoards: [{ token: "cxg", key: "cxg", source: "workable", mb: 4, at: iso(H) }, { token: "aaff", key: "aaff", source: "recruitee", mb: 4, at: iso(H) }],
    oversizeBoardCount: 2,
    deepCursor: { boards: 640, lane: lane(laneAgoMin), laps: { proven: 850, tracking: 1030 } },
    bootstrapQueue: { lastSlice: { at: iso(60_000), drained: 24, selected: 24 } },
    cursor: { hot: 120, cold, coldDone: 1 },
    coldBoards: 44399,
    lastRotationAgeMin: 120,
  });
  const data = {
    gh: {
      liquidpersonnel: { feed: ghFeed("liquidpersonnel", 210, 1600), served: ghServed("liquidpersonnel", 205, since) },
      pulse: { feed: ghFeed("pulse", 79, 2600), served: ghServed("pulse", 77, since) },
      lush: { feed: ghFeed("lush", 218, 100), served: ghServed("lush", 212, since) },
    },
    pg: { feed: pgFeed, served: pgServed(465, since) },
    vendors: { plural: { total: 215, ignored: ["vendors"] }, none: { total: 215, ignored: null }, singular: { total: 3, ignored: null } },
  };
  return { status0: status(3, 22000), status1: status(1, 22240), data, since };
}
type Fx = ReturnType<typeof healthy>;
const run90 = (fx: Fx, env: Record<string, string> = {}) =>
  runBlock(judge90, "vd_90_", {
    "vd_90_status_0.json": JSON.stringify(fx.status0), "vd_90_status_0.t": String(Math.floor(Date.now() / 1000) - 120),
    "vd_90_status_1.json": JSON.stringify(fx.status1), "vd_90_status_1.t": String(Math.floor(Date.now() / 1000)),
    "vd_90_data.json": JSON.stringify(fx.data),
  }, { VD90_LAST: "1", VD90_AT: "", ...env });
const line = (out: string[], re: RegExp) => out.find((l) => re.test(l)) ?? `(no line matching ${re})`;

describe("section 90 judges the .90 claims", () => {
  it("finds its judging block", () => {
    expect(judge90, "no node block reading vd_90_data.json with VD90_LAST").not.toBe("");
  });

  it("a healthy .90 a day and a half in is all PASS", () => {
    const out = run90(healthy(36));
    expect(fails(out), out.join("\n")).toEqual([]);
    for (const re of [/lightReread counters agree/, /lightReread\.ok = reread/, /lightReread\.deferred = 0/, /oversizeBoards rows carry key/,
      /greenhouse oversizeBoards entries: none registered before the deploy/, /greenhouse:pulse serves 77 of 79/, /names vendors in ignoredFilters/, /not an alias/,
      /deepCursor\.lane visited == selected in 2 of 2/, /bootstrapQueue\.lastSlice\.drained = 24/, /pg~wd5~1000 serves 465 of 471/])
      expect(line(out, re), out.join("\n")).toMatch(/^PASS/);
  });

  it("on .89 nothing the .90 claims is a FAIL: those lines are INFO", () => {
    const fx = healthy(36);
    for (const s of [fx.status0, fx.status1]) {
      Object.assign(s, { version: "2026-09-09.89" });
      delete (s.sliceStats as Record<string, unknown>).lightReread;
      s.oversizeBoards = s.oversizeBoards.map(({ key: _k, ...e }) => e) as typeof s.oversizeBoards;
      s.deepCursor.lane = { ...s.deepCursor.lane, visited: 0, selected: 2 };
    }
    fx.data.vendors.plural.ignored = null as unknown as string[];
    fx.data.gh.pulse.served = ghServed("pulse", 0, fx.since);
    const out = run90(fx);
    expect(fails(out), out.join("\n")).toEqual([]);
    expect(line(out, /sliceStats\.lightReread = null/)).toMatch(/^INFO/);
    expect(line(out, /greenhouse:pulse serves 0 of 79/)).toMatch(/^INFO .*not \.90 yet/);
  });

  it("a deep lane that visits nothing is the .89 signature and FAILs", () => {
    const fx = healthy(36);
    for (const s of [fx.status0, fx.status1]) s.deepCursor.lane = { ...s.deepCursor.lane, visited: 0, selected: 1 };
    expect(line(run90(fx), /deepCursor\.lane visited nothing/)).toMatch(/^FAIL/);
  });

  it("a board waits for its turn: pulse at 0 is INFO two hours in and FAIL after a rotation", () => {
    for (const [h, verdict] of [[2, "INFO"], [7, "FAIL"]] as const) {
      const fx = healthy(h);
      fx.data.gh.pulse.served = ghServed("pulse", 0, fx.since);
      const ent = { token: "pulse", key: "greenhouse:pulse", source: "greenhouse", mb: 4, at: iso((h + 5) * H) };
      for (const s of [fx.status0, fx.status1]) s.oversizeBoards = [...s.oversizeBoards, ent];
      const out = run90(fx);
      expect(line(out, /greenhouse:pulse serves 0 of 79/), out.join("\n")).toMatch(new RegExp(`^${verdict}`));
      expect(line(out, /greenhouse oversizeBoards entries: greenhouse:pulse/)).toMatch(new RegExp(`^${verdict}`));
    }
  });

  it("a greenhouse board registered on a .90 visit is a designed deferral until its next turn has passed, then FAILs", () => {
    const fx = healthy(2);
    const ent = { token: "liquidpersonnel", key: "liquidpersonnel", source: "greenhouse", mb: 4, at: iso(H) };
    for (const s of [fx.status0, fx.status1]) s.oversizeBoards = [...s.oversizeBoards, ent];
    const now = run90(fx);
    expect(fails(now), now.join("\n")).toEqual([]);
    expect(line(now, /deferred as oversize on a \.90 visit: liquidpersonnel/)).toMatch(/^INFO .*FAIL if still registered 393 min after/);
    const late = healthy(10);
    const stale = { ...ent, at: iso(7 * H) };
    for (const s of [late.status0, late.status1]) s.oversizeBoards = [...s.oversizeBoards, stale];
    expect(line(run90(late), /deferred as oversize on a \.90 visit: liquidpersonnel/)).toMatch(/^FAIL .*still registered 7\.0h later, past its next cold turn/);
  });

  it("a light re-read the start gate refused is not a FAIL, though the board it deferred registers on a .90 visit", () => {
    const fx = healthy(36);
    for (const s of [fx.status0, fx.status1]) {
      s.sliceStats.lightReread = { ...s.sliceStats.lightReread, enrolled: 3, reread: 2, ok: 2, deferred: 1 };
      s.oversizeBoards = [...s.oversizeBoards, { token: "acme", key: "acme", source: "greenhouse", mb: 4.2, at: iso(H) }];
    }
    const out = run90(fx);
    expect(fails(out), out.join("\n")).toEqual([]);
    expect(line(out, /lightReread\.deferred = 1/)).toMatch(/^INFO/);
    expect(line(out, /deferred as oversize on a \.90 visit: acme/)).toMatch(/^INFO .*lightReread\.deferred 1/);
  });

  it("on .89 with VD90_AT set, a greenhouse entry .89 re-stamps after that instant is INFO", () => {
    const fx = healthy(36);
    for (const s of [fx.status0, fx.status1]) {
      Object.assign(s, { version: "2026-09-09.89" });
      delete (s.sliceStats as Record<string, unknown>).lightReread;
      s.oversizeBoards = [...s.oversizeBoards, { token: "pulse", key: "pulse", source: "greenhouse", mb: 20.6, at: iso(H) }];
    }
    const out = run90(fx, { VD90_AT: iso(3 * H) });
    expect(fails(out), out.join("\n")).toEqual([]);
    expect(line(out, /deferred as oversize on a \.90 visit: pulse/)).toMatch(/^INFO .*not \.90 yet/);
  });

  it("counters that disagree and a row without its key FAIL; a light re-read that did not land is INFO, judged by the registry", () => {
    const fx = healthy(36);
    for (const s of [fx.status0, fx.status1]) {
      s.sliceStats.lightReread = { ...s.sliceStats.lightReread, enrolled: 4, reread: 2, ok: 1, deferred: 1 };
      s.oversizeBoards = [...s.oversizeBoards, { token: "pulse", source: "greenhouse", mb: 4, at: iso(40 * H) } as (typeof s.oversizeBoards)[number]];
    }
    const out = run90(fx);
    expect(line(out, /lightReread counters agree/)).toMatch(/^FAIL/);
    expect(line(out, /lightReread\.ok = reread/)).toMatch(/^INFO .*1 light re-read\(s\) did not land .*no greenhouse board is registered from a \.90 visit/);
    expect(line(out, /oversizeBoards rows carry key/)).toMatch(/^FAIL .*greenhouse:pulse key=undefined/);
  });

  it("a light list over the bound that the streamed read then landed leaves ok below reread, and that is not a FAIL", () => {
    const fx = healthy(36);
    for (const s of [fx.status0, fx.status1]) s.sliceStats.lightReread = { ...s.sliceStats.lightReread, enrolled: 3, reread: 3, ok: 2, deferred: 0 };
    const out = run90(fx);
    expect(fails(out), out.join("\n")).toEqual([]);
    expect(line(out, /lightReread\.ok = reread \(2 of 3\)/)).toMatch(/^INFO .*each left oversizeBoards/);
  });

  it("the plural vendors key not named, or acting as a filter, FAILs on .90", () => {
    const fx = healthy(36);
    fx.data.vendors.plural = { total: 3, ignored: null as unknown as string[] };
    const out = run90(fx);
    expect(line(out, /names vendors in ignoredFilters/)).toMatch(/^FAIL/);
    expect(line(out, /not an alias/)).toMatch(/^FAIL/);
  });

  it("a cold rotation on .90 past 393 minutes FAILs and names the rollback; one begun before the deploy is INFO", () => {
    const fx = healthy(8);
    for (const s of [fx.status0, fx.status1]) s.lastRotationAgeMin = 400;
    expect(line(run90(fx), /cold rotation running on \.90 is 400 min old/)).toMatch(/^FAIL .*DEEP_LANE_TAKE = 0/);
    const early = healthy(5);
    for (const s of [early.status0, early.status1]) s.lastRotationAgeMin = 400;
    expect(line(run90(early), /lastRotationAgeMin = 400/)).toMatch(/^INFO/);
  });

  it("pg below its feed is INFO for two rotations, FAIL after; the bootstrap take above 24 FAILs", () => {
    const young = healthy(10);
    young.data.pg.served = pgServed(200, young.since);
    expect(line(run90(young), /pg~wd5~1000 serves 200 of 471/)).toMatch(/^INFO/);
    const old = healthy(14);
    old.data.pg.served = pgServed(200, old.since);
    for (const s of [old.status0, old.status1]) s.bootstrapQueue.lastSlice.drained = 25;
    const out = run90(old);
    expect(line(out, /pg~wd5~1000 serves 200 of 471/)).toMatch(/^FAIL/);
    expect(line(out, /bootstrapQueue\.lastSlice\.drained = 25/)).toMatch(/^FAIL/);
  });
});
