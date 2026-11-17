// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzzz-board-103 CAN FAIL WHAT IT CLAIMS, PRINTS NO FAIL
 * BEFORE .103 SERVES, AND WRITES NOTHING BUT ITS OWN STATE FILE.
 *
 * scripts/verify-deploy.d/99zzzzzzzz-board-103.sh judges job-board .103 from
 * outside. Run here against a fake curl that answers from a small model of
 * production and logs every call with its headers:
 *   - before the deploy (job-board .102) it prints INFO and no FAIL, and makes
 *     no read past the preflight;
 *   - .103 answering before any slice of it has run judges the search lines
 *     (code, not data) and leaves every slice line INFO;
 *   - a good .103, two days in, prints PASS for every claim and no FAIL;
 *   - each claim fails alone when only its own fix is missing: the search
 *     rewrite, ranked search, the pass-end chain, the tail clock, the host
 *     pacing, the held boards, the clamp, the catalogue lane's prune,
 *     retirement, repoints and agency flag, Greenhouse stated pay, the status
 *     fields, and the lap;
 *   - with no catalogue-lane fixture in the checkout, the catalogue lines are
 *     INFO and no catalogue key is read;
 *   - every job-board read declares the probe header and the maintenance
 *     caller, except the one nonce search, which sends the probe header alone
 *     (the backstop it proves); the key is never printed, and the only file
 *     written outside the run's directory is none (the state file is the
 *     run's own).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzzz-board-103.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_board_103";

// The fake curl answers from WORLD (a JSON file): the preflight's build, the
// status object, and list answers keyed by "<vendor>:<companies joined by ,>"
// (counts and rows) or by the search text.
const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const probe=hs.some((h)=>/^x-rb-budget: probe$/i.test(h)),caller=hs.some((h)=>/^x-rb-caller: maintenance$/i.test(h));
fs.appendFileSync(process.env.VD_CALLS,JSON.stringify({method,url,data,probe,caller})+"\\n");
const W=JSON.parse(fs.readFileSync(process.env.VD_WORLD,"utf8"));
let st=200,hdr={},body="";
if(method==="OPTIONS"&&/\\/functions\\/v1\\/job-board$/.test(url)){if(W.build)hdr["x-fn-build"]="job-board."+W.build}
else if(method==="POST"&&/\\/functions\\/v1\\/job-board$/.test(url)){const b=JSON.parse(data||"{}");
  if(b.action==="status")body=JSON.stringify(W.status);
  else if(b.action==="list"&&typeof b.q==="string"){body=JSON.stringify(/^vd103-probe-/.test(b.q)?{jobs:[],total:0}:(W.search[b.q]||{jobs:[],total:0,ranked:true}))}
  else if(b.action==="list"){const k=(b.vendor||[])[0]+":"+(b.companies||[]).join(",");
    body=JSON.stringify(b.countOnly?{total:W.counts[k]??0,jobs:[]}:{jobs:W.rows[k]||[]})}
  else{st=400;body="{}"}}
else{st=404}
const h="HTTP/2 "+st+"\\r\\n"+Object.entries(hdr).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=h;else if(D)fs.writeFileSync(D,h);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const NOW = Date.now();
const MIN = 60_000;
const H = 60 * MIN;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const SINCE = iso(50 * H);

type World = { build: string | null; status: Record<string, unknown>; search: Record<string, unknown>; counts: Record<string, number>; rows: Record<string, unknown[]> };
type Calls = Array<{ method: string; url: string; data: string | null; probe: boolean; caller: boolean }>;

const STATUS = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: "2026-09-09.103",
  sliceStats: { build: "2026-09-09.103", buildSince: SINCE, at: iso(MIN) },
  passEnd: { startedAt: iso(2 * H), hop0At: iso(2 * H - 30_000), doneAt: iso(2 * H - 6 * MIN) },
  pacing: { "api.lever.co": { reads: 512, minGapMs: 1_050, since: SINCE }, "careers.84lumber.com": { reads: 3, minGapMs: 5_050, since: SINCE } },
  inst: { lastStamps: [], countThisBuild: 0, lastHeartbeat: { hop: 3 } },
  chainKick: { outcome: "ok", at: iso(MIN) },
  audit: { startedAt: iso(5 * H), doneAt: iso(4 * H) },
  dbBand: null,
  catalogSize: 44_157, catalogHighwater: 44_157, orphanPruneBlocked: false,
  lastWrapMin: 430, lastWrapAt: iso(H),
  ...o,
});
const STATE = { build: "2026-09-09.103", passEnds: [{ startedAt: iso(12 * H), hop0At: iso(12 * H - 40_000), doneAt: iso(12 * H - 5 * MIN) }], unblockedAt: iso(30 * H) };
const FIXTURE = {
  pruned: [["greenhouse:deadone", "404"], ["ashby:deadtwo", "404"]],
  repointed: [{ from: "greenhouse:amplitude", to: "ashby:amplitude", inWindow: 29 }],
  retired: ["lever:usasurveyjob"],
  agency: { key: "lever:distro" },
};
const LAPS = { wraps: [{ endedAt: "2026-11-18T10:00:00Z", wrapMin: 575, build: "2026-09-09.102" }] };

const sr = (total: number | null, o: Record<string, unknown> = {}) => ({ jobs: [{ id: "x:1" }], total, ranked: true, searchRoute: null, ...o });
const SEARCH = (): Record<string, unknown> => ({
  "back end developer": sr(1_100), "backend developer": sr(1_100),
  "front end developer": sr(450), "frontend developer": sr(450),
  "full stack developer": sr(2_400), "full-stack developer": sr(2_400),
  "devops engineer": sr(1_190), "dev ops engineer": sr(1_190),
  "software engineer": sr(10_000), "ai engineer": sr(null, { totalAtLeast: 400, searchRoute: "SIMPLE" }),
  nurse: sr(10_000), "registered nurse": sr(10_000), "customer success": sr(2_341), privacy: sr(378),
  "product designer": sr(1_365), "data analyst": sr(1_948), pharmacist: sr(3_293),
});
const gh = (n: number, paid: number) => Array.from({ length: n }, (_, i) => ({ id: `g:${i}`, recheckedAt: iso(3 * H), ...(i < paid ? { salary: "USD 100,000.00 – 120,000.00 per year" } : { salary: null }) }));
const ROWS = (): Record<string, unknown[]> => ({
  "greenhouse:coinbase": gh(40, 37), "greenhouse:airbnb": gh(40, 32), "greenhouse:databricks": gh(40, 21),
  "greenhouse:robinhood": gh(40, 38), "greenhouse:figma": gh(40, 27),
  "lever:distro": [{ id: "d:1", agency: true }, { id: "d:2", agency: true }],
});
const WORLD = (o: Partial<World> = {}): World => ({ build: "2026-09-09.103", status: STATUS(), search: SEARCH(), counts: { "ashby:amplitude": 30 }, rows: ROWS(), ...o });

type Opts = { state?: unknown; fixture?: unknown | null; env?: Record<string, string> };

function run(world: World, opts: Opts = {}): { lines: string[]; calls: Calls; out: string; state: unknown; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd103-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "bin", "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "bin", "sleep"), 0o755);
  writeFileSync(join(dir, "world.json"), JSON.stringify(world));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "laps.json"), JSON.stringify(LAPS));
  const statePath = join(dir, "state", "board-103.json");
  const state = opts.state === undefined ? STATE : opts.state;
  if (state !== null) { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(state)); }
  const fixture = opts.fixture === undefined ? FIXTURE : opts.fixture;
  if (fixture !== null) writeFileSync(join(dir, "fixture.json"), JSON.stringify(fixture));
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_WORLD: join(dir, "world.json"), VD_CALLS: join(dir, "calls.log"),
    VD103_STATE: statePath, VD103_FIXTURE: join(dir, "fixture.json"), VD103_LAPS: join(dir, "laps.json"),
    VD103_TALLY: "4427516", VD103_READS: "1", VD103_CATALOG_SIZE: "44157",
    ...opts.env,
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 170_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) as Calls;
  let saved: unknown = null;
  try { saved = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* none */ }
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out, state: saved, dir };
}

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const failTags = (lines: string[]) => fails(lines).map((l) => l.slice(6, l.indexOf(":", 6)));
const verdict = (lines: string[], tag: string) => lines.filter((l) => l.slice(6).startsWith(tag + ":")).map((l) => l.slice(0, 4));

const SLICE_TAGS = ["P1", "T1", "PC1", "A1", "PR1", "H1", "PR2", "RT1", "RP1", "AG1", "GH coinbase", "GH airbnb", "GH databricks", "GH robinhood", "GH figma", "Lap"];
const SR_TAGS = ["SR back end developer", "SR nurse", "SR software engineer", "SR front end developer", "SR registered nurse", "SR ai engineer", "SR customer success", "SR privacy", "SR product designer", "SR data analyst", "SR devops engineer", "SR full stack developer", "SR pharmacist"];

describe("section 99zzzzzzzz-board-103: before .103 serves", () => {
  it("prints no FAIL and reads nothing past the preflight while .102 answers", () => {
    const r = run(WORLD({ build: "2026-09-09.102" }));
    expect(fails(r.lines)).toEqual([]);
    expect(verdict(r.lines, "build")).toEqual(["INFO"]);
    expect(verdict(r.lines, "ROOM")).toEqual(["INFO"]);
    expect(r.calls.map((c) => c.method)).toEqual(["OPTIONS"]);
  });
  it("ROOM fails over the 4,450,000 guard whatever is serving", () => {
    const r = run(WORLD({ build: "2026-09-09.102" }), { env: { VD103_TALLY: "4450001" } });
    expect(failTags(r.lines)).toEqual(["ROOM"]);
  });
  it("judges the search as soon as .103 answers, and waits for a slice for everything else", () => {
    const r = run(WORLD({ status: STATUS({ sliceStats: { build: "2026-09-09.102", buildSince: iso(9 * 24 * H) } }) }), { state: null });
    expect(fails(r.lines)).toEqual([]);
    for (const t of SR_TAGS) expect(verdict(r.lines, t), t).toEqual(["PASS"]);
    for (const t of SLICE_TAGS) expect(verdict(r.lines, t), t).toEqual(["INFO"]);
  });
});

describe("section 99zzzzzzzz-board-103: a good .103, two days in", () => {
  it("passes every claim and prints no FAIL", () => {
    const r = run(WORLD());
    expect(fails(r.lines)).toEqual([]);
    for (const t of [...SR_TAGS, ...SLICE_TAGS, "build"]) expect(verdict(r.lines, t), t).toEqual(["PASS"]);
    for (const p of ["back end developer / backend developer", "front end developer / frontend developer", "full stack developer / full-stack developer", "devops engineer / dev ops engineer"]) {
      expect(verdict(r.lines, `SR pair ${p}`), p).toEqual(["PASS"]);
    }
    for (const t of ["PROBE", "IN1", "SA1", "DS1", "clock", "ROOM"]) expect(verdict(r.lines, t), t).toEqual(["INFO"]);
    // The state keeps both pass ends, so the next run can judge two in a row.
    expect((r.state as { passEnds: unknown[] }).passEnds).toHaveLength(2);
  });
  it("a first run after the deploy stamps when it saw the prune unblocked and judges no prune line before a later pass end", () => {
    const r = run(WORLD(), { state: null });
    expect(fails(r.lines)).toEqual([]);
    for (const t of ["H1", "PR2", "RT1"]) expect(verdict(r.lines, t), t).toEqual(["INFO"]);
    expect(Date.parse((r.state as { unblockedAt: string }).unblockedAt)).toBeGreaterThan(NOW - MIN);
  });
});

describe("section 99zzzzzzzz-board-103: each claim fails alone", () => {
  const cases: Array<[string, () => { world: World; opts?: Opts }, string[]]> = [
    ["the search rewrite reverted (live counts of 2026-11-17)", () => {
      const s = SEARCH();
      Object.assign(s, { "back end developer": sr(32), "backend developer": sr(281), "front end developer": sr(70), "frontend developer": sr(158), "full stack developer": sr(730), "full-stack developer": sr(125), "devops engineer": sr(1_117), "dev ops engineer": sr(21) });
      return { world: WORLD({ search: s }) };
    }, ["SR back end developer", "SR front end developer", "SR full stack developer",
      "SR pair back end developer / backend developer", "SR pair front end developer / frontend developer",
      "SR pair full stack developer / full-stack developer", "SR pair devops engineer / dev ops engineer"]],
    ["ranked search fell back on one term", () => ({ world: WORLD({ search: { ...SEARCH(), nurse: sr(10_000, { ranked: false }) } }) }), ["SR nurse"]],
    ["a term lost a third of its jobs", () => ({ world: WORLD({ search: { ...SEARCH(), privacy: sr(200) } }) }), ["SR privacy"]],
    ["the pass end does not chain into hop 0, twice", () => ({
      world: WORLD({ status: STATUS({ passEnd: { startedAt: iso(2 * H), hop0At: iso(2 * H - 4 * MIN), doneAt: iso(2 * H - 6 * MIN) } }) }),
      opts: { state: { ...STATE, passEnds: [{ startedAt: iso(12 * H), hop0At: iso(12 * H - 5 * MIN), doneAt: iso(12 * H - 5 * MIN) }] } },
    }), ["P1"]],
    ["two tails ran past 10 minutes", () => ({
      world: WORLD({ status: STATUS({ passEnd: { startedAt: iso(2 * H), hop0At: iso(2 * H - 30_000), doneAt: iso(2 * H - 30 * MIN) } }) }),
      opts: { state: { ...STATE, passEnds: [{ startedAt: iso(12 * H), hop0At: iso(12 * H - 40_000), doneAt: iso(12 * H - 25 * MIN) }] } },
    }), ["T1"]],
    ["Lever read closer than its stated second", () => ({ world: WORLD({ status: STATUS({ pacing: { "api.lever.co": { reads: 400, minGapMs: 300, since: SINCE } } }) }) }), ["PC1"]],
    ["the gate saw no Lever read in two days", () => ({ world: WORLD({ status: STATUS({ pacing: {} }) }) }), ["PC1"]],
    ["a held board still serves after the pass end", () => ({ world: WORLD({ counts: { "ashby:amplitude": 30, "workable:weekday-1": 153 } }) }), ["H1"]],
    ["the clamp was not applied", () => ({ world: WORLD({ status: STATUS({ catalogHighwater: 44_499, orphanPruneBlocked: true }) }) }), ["PR1"]],
    ["the live catalogue is not this checkout's", () => ({ world: WORLD({ status: STATUS({ catalogSize: 44_499, catalogHighwater: 44_499 }) }) }), ["PR1"]],
    ["a pruned key still serves", () => ({ world: WORLD({ counts: { "ashby:amplitude": 30, "greenhouse:deadone": 4 } }) }), ["PR2"]],
    ["a repoint's old key still serves", () => ({ world: WORLD({ counts: { "ashby:amplitude": 30, "greenhouse:amplitude": 12 } }) }), ["PR2"]],
    ["usasurveyjob still serves", () => ({ world: WORLD({ counts: { "ashby:amplitude": 30, "lever:usasurveyjob": 559 } }) }), ["RT1"]],
    ["a repointed board serves nothing", () => ({ world: WORLD({ counts: {} }) }), ["RP1"]],
    ["a Distro row lost its agency flag", () => ({ world: WORLD({ rows: { ...ROWS(), "lever:distro": [{ id: "d:1", agency: true }, { id: "d:2" }] } }) }), ["AG1"]],
    ["Greenhouse stated pay does not reach Coinbase's rows", () => ({ world: WORLD({ rows: { ...ROWS(), "greenhouse:coinbase": gh(40, 3) } }) }), ["GH coinbase"]],
    ["a Greenhouse board was not re-read in two days", () => ({ world: WORLD({ rows: { ...ROWS(), "greenhouse:airbnb": gh(10, 9) } }) }), ["GH airbnb"]],
    ["status lost inst", () => { const s = STATUS(); delete s.inst; return { world: WORLD({ status: s }) }; }, ["IN1"]],
    ["no audit run in 26 hours", () => ({ world: WORLD({ status: STATUS({ audit: { startedAt: iso(40 * H), doneAt: iso(39 * H) } }) }) }), ["A1"]],
    ["status lost dbBand", () => { const s = STATUS(); delete s.dbBand; return { world: WORLD({ status: s }) }; }, ["DS1"]],
    ["dbBand stale 26 h after cost2 applied", () => ({ world: WORLD(), opts: { env: { VD103_COST2_APPLIED_AT: iso(40 * H) } } }), ["DS1"]],
    ["the lap ran over the bar", () => ({ world: WORLD({ status: STATUS({ lastWrapMin: 700 }) }) }), ["Lap"]],
  ];
  it.each(cases)("%s", (_name, make, want) => {
    const { world, opts } = make();
    const r = run(world, opts);
    expect(failTags(r.lines).sort()).toEqual([...want].sort());
  });
});

describe("section 99zzzzzzzz-board-103: the catalogue lane absent", () => {
  it("is INFO for every catalogue line and reads no catalogue key", () => {
    const r = run(WORLD(), { fixture: null });
    expect(fails(r.lines)).toEqual([]);
    for (const t of ["PR2", "RT1", "RP1", "AG1"]) expect(verdict(r.lines, t), t).toEqual(["INFO"]);
    const lists = r.calls.filter((c) => c.data && /"action":"list"/.test(c.data)).map((c) => JSON.parse(c.data as string) as { companies?: string[] });
    for (const t of ["deadone", "deadtwo", "amplitude", "usasurveyjob", "distro"]) expect(lists.some((b) => (b.companies ?? []).includes(t)), t).toBe(false);
  });
});

describe("section 99zzzzzzzz-board-103: what it sends and writes", () => {
  it("declares the probe and the maintenance caller on every read but the nonce, never prints the key, and writes only its own files", () => {
    const r = run(WORLD());
    const fn = r.calls.filter((c) => /\/functions\/v1\/job-board$/.test(c.url));
    expect(r.calls.every((c) => /\/functions\/v1\/job-board$/.test(c.url))).toBe(true);
    const nonce = fn.filter((c) => c.data && /"q":"vd103-probe-/.test(c.data));
    expect(nonce).toHaveLength(1);
    expect(nonce[0]).toMatchObject({ method: "POST", probe: true, caller: false });
    expect(JSON.parse(nonce[0].data as string).noLog).toBeUndefined();
    for (const c of fn.filter((x) => x !== nonce[0])) {
      expect(c, JSON.stringify(c)).toMatchObject({ probe: true, caller: true });
      if (c.method === "POST" && JSON.parse(c.data as string).action === "list") expect(JSON.parse(c.data as string).noLog, c.data as string).toBe(true);
    }
    // Reads only: status and list, nothing else.
    for (const c of fn.filter((x) => x.method === "POST")) expect(["status", "list"]).toContain(JSON.parse(c.data as string).action);
    expect(r.out).not.toContain(KEY);
    // The owner's SQL names the nonce the section sent.
    const q = JSON.parse(nonce[0].data as string).q as string;
    expect(r.lines.find((l) => l.startsWith("INFO  PROBE:"))).toContain(`q = '${q}'`);
    // Nothing outside the run directory: every vd_103 file lands in it.
    expect(readdirSync(r.dir).some((f) => f.startsWith("vd_103_st_"))).toBe(true);
  });
});
