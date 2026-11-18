// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-board-102-core CAN FAIL WHAT IT CLAIMS, PRINTS NO
 * FAIL BEFORE .102 SERVES, AND WRITES NOTHING BUT ITS OWN STATE FILE.
 *
 * scripts/verify-deploy.d/99zzzzzzz-board-102-core.sh judges job-board .102's
 * core lane from outside. Run here against a fake curl that answers from
 * routes and logs every call:
 *   - production before the deploy (job-board .101) prints INFO and no FAIL,
 *     and makes no read past the preflight;
 *   - .102 serving before any slice of it has run is INFO for every board line;
 *   - a good .102 deploy prints PASS for every claim and no FAIL;
 *   - each claim fails alone when only its own fix is missing, and a line
 *     that waits on time (7 days, 24 h, 16-24Z) is INFO until then;
 *   - the lap bar is built from the build that served just before .102 only:
 *     the sampler's status.jsonl (a wrap is two samples under 360 min apart
 *     whose rotation start moved) and section 90's ledger, never a .100 lap;
 *   - the cold cursor is judged by its rate across the status reads, beside
 *     the slice count, against the sampler's pre-.102 rate;
 *   - the feeds are read only after robots.txt allows them, 1.1 s apart, and
 *     a disallowed feed is INFO, not read;
 *   - every POST is job-board with the probe header or one of two anon read
 *     RPCs, nothing asks a writer route, the key is never printed, and the only
 *     file written outside the run's own directory is the state file it names.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Each case runs bash and fifty-odd node processes; on a loaded machine a run
// took over ten seconds, and the catalogue case adds a tsx start.
vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-board-102-core.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_FN = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const R_FN = /^R\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_board_102_core";

type Exists = { open?: readonly string[]; unknown?: readonly string[]; fakeKnown?: boolean; unknownNull?: boolean; noUnknownKey?: boolean };
type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string; bodies?: string[]; exists?: Exists };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\t"+(hs.some((h)=>/^x-rb-budget: probe$/i.test(h))?"probe":"noprobe")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?" "+data:"");
const idx=routes.findIndex((x)=>new RegExp(x.match).test(key));const r=idx>=0?routes[idx]:{status:404,body:""};
const seenFile=process.env.VD_CALLS+".seen."+idx;let seen=0;try{seen=Number(fs.readFileSync(seenFile,"utf8"))}catch{}
fs.writeFileSync(seenFile,String(seen+1));
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let body=r.bodies?r.bodies[Math.min(seen,r.bodies.length-1)]:(r.body??"");
if(r.exists){const e=r.exists;const ids=(JSON.parse(data||"{}").ids)||[];const open={};for(const id of ids)open[id]=(e.open||[]).includes(id);
  const unknown=ids.filter((id)=>/verify-never-held/.test(id)?!e.fakeKnown:(e.unknown||[]).includes(id));
  body=JSON.stringify(e.noUnknownKey?{open,rowTest:"served"}:{open,rowTest:"served",unknown:e.unknownNull?null:unknown});}
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const NOW = Date.now();
const H = 3_600_000;
const DAY = 24 * H;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const SINCE = iso(8 * DAY);

const BOARDS = [
  ["recruitee", "transperfect"], ["recruitee", "vdkgroep"], ["recruitee", "riedmair"], ["recruitee", "livezoku"],
  ["pinpoint", "trilongroup"], ["workable", "cxg"], ["workable", "tehora"], ["workable", "solution-sft"],
] as const;
const HELD = ["nogigiddy", "weekday-1", "hire-resolve-the-top-recruitment-agency"];
const NAMED: Array<[string, string, string]> = [
  ["ashby", "creatoriq", "CreatorIQ"], ["ashby", "harmattan-ai", "Harmattan AI"],
  ["personio", "deag-deutsche-entertainment-ag", "DEAG Deutsche Entertainment AG"], ["lever", "americaatwork", "America At Work"],
];
const TWINS = ["pinpoint:helsing", "greenhouse:wayve", "greenhouse:clickhouse", "lever:swordhealth", "greenhouse:lovable", "greenhouse:kalshi", "greenhouse:webflow", "greenhouse:worldlabs"];

type Opts = {
  env?: Record<string, string>;
  state?: unknown;
  laps?: unknown;
  catalog?: string[] | null;
  baseline?: unknown[]; // the lap sampler's status.jsonl lines
  clockStepS?: number; // each status read's clock (date +%s) moves this far
};

function run(routes: Route[], opts: Opts = {}): { lines: string[]; calls: string[]; out: string; state: unknown; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbc-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "bin", "sleep"), `#!/bin/sh\nprintf 'sleep\\t%s\\n' "$1" >> "$VD_CALLS"\nexit 0\n`);
  chmodSync(join(dir, "bin", "sleep"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const statePath = join(dir, "state", "board-102-core.json");
  if (opts.state !== undefined) { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(opts.state)); }
  writeFileSync(join(dir, "laps.json"), JSON.stringify(opts.laps ?? LAPS));
  writeFileSync(join(dir, "status.jsonl"), (opts.baseline ?? []).map((x) => JSON.stringify(x)).join("\n"));
  if (opts.clockStepS) {
    writeFileSync(join(dir, "bin", "date"), `#!/bin/sh\nif [ "$1" = "+%s" ]; then n=$(cat "${dir}/clock" 2>/dev/null || echo 0); echo $(( ${Math.floor(NOW / 1000) - 3600} + n * ${opts.clockStepS} )); echo $((n + 1)) > "${dir}/clock"; else exec /bin/date "$@"; fi\n`);
    chmodSync(join(dir, "bin", "date"), 0o755);
  }
  const catalog = opts.catalog === undefined ? CATALOG : opts.catalog;
  if (catalog) writeFileSync(join(dir, "catalog.json"), JSON.stringify(catalog));
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${J_FN}\n${R_FN}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    VDBC_STATE: statePath, VDBC_LAPS: join(dir, "laps.json"), VDBC_BASELINE: join(dir, "status.jsonl"), VDBC_TALLY: "4420000", VDBC_READS: "2", VDBC_HOUR: "18",
    ...(catalog ? { VDBC_CATALOG: join(dir, "catalog.json") } : {}),
    ...opts.env,
  };
  if (!catalog) delete env.VDBC_CATALOG;
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 170_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  let state: unknown = null;
  try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* none */ }
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out, state, dir };
}

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const tagged = (lines: string[], tag: string) => lines.filter((l) => l.slice(6).startsWith(tag + ":"));
const verdict = (lines: string[], tag: string) => tagged(lines, tag).map((l) => l.slice(0, 4));
const FN = "https://p\\.supabase\\.co/functions/v1/job-board";
const RPC = (fn: string) => `^POST https://p\\.supabase\\.co/rest/v1/rpc/${fn}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const list = (pat: string, o: unknown): Route => ({ match: `^POST ${FN} .*${pat}`, body: JSON.stringify(o) });
const preflight = (build: string | null, maxAge: string | null = "7200"): Route => ({
  match: `^OPTIONS ${FN}$`,
  headers: { ...(build ? { "x-fn-build": build } : {}), ...(maxAge ? { "Access-Control-Max-Age": maxAge } : {}) },
});

const CATALOG = [
  ...Array.from({ length: 1200 }, (_, i) => `filler-${i}`),
  ...BOARDS.map(([, t]) => t), ...HELD, "usasurveyjob", "workable:afg", "greenhouse:afg", "bjakcareer", "gopuff",
];
const LAPS = { wraps: [
  { endedAt: "2026-11-08T23:10:00Z", wrapMin: 459, build: "2026-09-09.101" },
  { endedAt: "2026-11-09T07:00:00Z", wrapMin: 470, build: "2026-09-09.101" },
  { endedAt: "2026-11-09T14:40:00Z", wrapMin: 460, build: "2026-09-09.101" },
] };
const STATE = { ids: [{ id: "lever:closed-co:9", savedAt: iso(2 * DAY) }], unblockedSeenAt: iso(3 * H) };

const ss = (o: Record<string, unknown> = {}) => ({
  build: "2026-09-09.102", buildSince: SINCE, at: iso(60_000), hop: 5, slices: 1000,
  streamed: 1, lastPhase: "cold", rateLimited: [], rawNoRows: ["recruitee:aaff"], srPartial: ["ThePlace1"], ...o,
});
const reg = (key: string, source: string, at = iso(60_000)) => ({ token: key.includes(":") ? key.slice(key.indexOf(":") + 1) : key, key, source, mb: 4, at });
const STATUS = (o: Record<string, unknown> = {}) => ({
  version: "2026-09-09.102",
  sliceStats: ss(),
  oversizeBoards: HELD.map((t) => reg(t, "workable")),
  descCoverage: [{ source: "workday", total: 400_000, described: 399_000 }, { source: "workable", total: 20_000, described: 19_500 }],
  descCoverageAgeMin: 10,
  passEnd: {
    startedAt: iso(2 * H),
    steps: { sweep: { statedClosed: 12, doneAt: iso(H) }, names: { detail: "name sync v7 done", doneAt: iso(H) }, serve: { doneAt: iso(H) } },
  },
  chainWatchdog: { at: iso(30_000), decision: "chain_alive", pulseAgeMs: 40_000, thresholdMs: 200_000, lastKick: { at: iso(5 * DAY) } },
  chainKick: { at: iso(60_000) },
  dateCoverageSource: "rollup", dateCoverageAgeMin: 20,
  lastWrapMin: 470, lastWrapAt: iso(H),
  failedCount: 41, recentFailures: ["Revyse (vendor: HTTP 404)"],
  orphanPruneBlocked: false, catalogSize: 44_499, catalogHighwater: 44_499,
  ...o,
});
const status = (...reads: Array<Record<string, unknown>>): Route => ({ match: `^POST ${FN} .*"action":"status"`, bodies: reads.map((r) => JSON.stringify(r)) });

const row = (id: string, o: Record<string, unknown> = {}) => ({ id, lastSeen: iso(H), ...o });
const rows = (prefix: string, n: number, o: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => row(`${prefix}:${i}`, o));
const recent = iso(2 * DAY);
const feedBody = (vendor: string, n: number) =>
  vendor === "recruitee" ? { offers: Array.from({ length: n }, () => ({ published_at: recent })) }
  : vendor === "pinpoint" ? { data: Array.from({ length: n }, () => ({ id: 1 })) }
  : { jobs: Array.from({ length: n }, () => ({ published_on: recent })) };
const host = (vendor: string, t: string) => vendor === "recruitee" ? `${t}.recruitee.com` : vendor === "pinpoint" ? `${t}.pinpointhq.com` : "apply.workable.com";
const feedPath = (vendor: string, t: string) => vendor === "recruitee" ? "/api/offers/" : vendor === "pinpoint" ? "/postings.json" : `/api/v1/widget/accounts/${t}?details=false`;

type Over = { count?: Record<string, number>; feed?: Record<string, number>; robots?: string; held?: Record<string, number>; rowsAre?: Record<string, unknown> };
const boardRoutes = (o: Over = {}): Route[] => [
  ...BOARDS.flatMap(([v, t]) => [
    list(`"companies":\\["${esc(t)}"\\],"vendor":\\["${v}"\\],"countOnly":true`, { total: o.count?.[t] ?? 100 }),
    list(`"companies":\\["${esc(t)}"\\],"vendor":\\["${v}"\\],"limit":60`, { jobs: rows(`${v}:${t}`, 3, o.rowsAre), hasMore: true, nextOffset: 60 }),
    { match: `^GET https://${esc(host(v, t))}/robots\\.txt$`, body: o.robots ?? "User-agent: *\nDisallow: /admin\n" },
    { match: `^GET https://${esc(host(v, t) + feedPath(v, t))}$`, body: JSON.stringify(feedBody(v, o.feed?.[t] ?? 100)) },
  ]),
  ...HELD.map((t) => list(`"companies":\\["${esc(t)}"\\],"vendor":\\["workable"\\],"countOnly":true`, { total: o.held?.[t] ?? 0 })),
];
const namedRoutes = (wrong: Record<string, string> = {}, ends: Record<string, unknown> = {}): Route[] => NAMED.map(([v, t, name]) =>
  list(`"companies":\\["${esc(t)}"\\],"vendor":\\["${v}"\\],"limit":60`, { jobs: rows(`${v}:${t}`, 2, { company: wrong[t] ?? name }), hasMore: false, nextOffset: null, ...ends }));
const twinRoutes = (served: Record<string, string[]> = {}): Route[] => TWINS.map((k) => {
  const [v, t] = k.split(":");
  return list(`"companies":\\["${esc(t)}"\\],"vendor":\\["${v}"\\],"limit":5`, { jobs: (served[k] ?? []).map((id) => row(id)), hasMore: false, nextOffset: null });
});
const NEWEST = (o: Record<string, unknown> = {}) => list(`"sort":"newest"`, { jobs: [row("greenhouse:acme:1", { postedAt: iso(H) }), ...rows("lever:other", 19, { postedAt: iso(2 * H) })], hasMore: true, nextOffset: 20, ...o });
const BMS = (jobs: unknown[] = [row("workday:bristolmyerssquibb~wd5~BMS:1", { country: "US", location: "New Brunswick - NJ - US", salaryCurrency: "USD" })]) =>
  list(`"companies":\\["bristolmyerssquibb~wd5~BMS"\\]`, { jobs, hasMore: false, nextOffset: null });
const COUNTS = (o: Record<string, number> = {}): Route[] => [
  list(`"companies":\\["aaff"\\],"vendor":\\["recruitee"\\],"countOnly":true`, { total: o.aaff ?? 12 }),
  list(`"companies":\\["ThePlace1"\\],"vendor":\\["smartrecruiters"\\],"countOnly":true`, { total: o.ThePlace1 ?? 30 }),
];
const EXISTS = (e: Exists = { open: ["greenhouse:acme:1"] }): Route => ({ match: `^POST ${FN} .*"action":"exists"`, exists: e });
const HEALTH = (closed = 40): Route => ({ match: RPC("get_company_hiring_health"), body: JSON.stringify([{ company_token: "usajobs", open_roles: 18_000, closed_90d: closed }]) });
const CRON = (schedule = "*/30 * * * *"): Route => ({ match: RPC("get_cron_health"), body: JSON.stringify([{ ch_jobname: "job-board-stats-rollup", ch_schedule: schedule, ch_active: true }]) });

/** A good .102 deploy; routes given first win over the good ones they share a matcher with. */
const good = (...over: Route[]): Route[] => [
  ...over,
  preflight("job-board.2026-09-09.102"),
  status(STATUS(), STATUS({ sliceStats: ss({ at: iso(10_000), hop: 6, slices: 1001 }) })),
  ...COUNTS(), ...boardRoutes(), ...namedRoutes(), ...twinRoutes(), NEWEST(), BMS(), EXISTS(), HEALTH(), CRON(),
];
const ok = (routes: Route[], opts: Opts = {}) => run(routes, { state: STATE, ...opts });

describe("the board .102 core section", () => {
  it("before .102 serves, every line is INFO and nothing is read past the preflight", () => {
    const { lines, calls, out } = run([preflight("job-board.2026-09-09.101", null)]);
    expect(fails(lines), out).toEqual([]);
    expect(verdict(lines, "build"), out).toEqual(["INFO"]);
    expect(verdict(lines, "PERF-06"), out).toEqual(["INFO"]);
    expect(verdict(lines, "ROOM"), out).toEqual(["INFO"]);
    expect(calls.filter((c) => c.startsWith("curl")), out).toEqual([expect.stringMatching(/^curl\tOPTIONS https:\/\/p\.supabase\.co\/functions\/v1\/job-board\tprobe$/)]);
  });

  it("a checkout over the upload cap fails ROOM whatever serves, and a build with no header fails", () => {
    const over = run([preflight("job-board.2026-09-09.101", null)], { env: { VDBC_TALLY: "4450001" } });
    expect(fails(over.lines), over.out).toEqual([expect.stringMatching(/^FAIL {2}ROOM: .* 4450001 bytes, over the 4,450,000 cap/)]);
    const none = run([preflight(null, null)]);
    expect(fails(none.lines), none.out).toEqual([expect.stringMatching(/^FAIL {2}build: job-board preflight carries no x-fn-build/)]);
  });

  it("ROOM measures the checkout's counted bytes when no tally is given", () => {
    const { lines, out } = run([preflight("job-board.2026-09-09.101", null)], { env: { VDBC_TALLY: "" } });
    const room = tagged(lines, "ROOM");
    expect(room, out).toEqual([expect.stringMatching(/^INFO {2}ROOM: job-board\/\*\* \+ _shared\/\*\* at HEAD is \d{7} bytes, \d+ under the 4,450,000 cap$/)]);
  });

  it(".102 serving before any slice of it has run judges no board line", () => {
    const { lines, out } = ok(good(status(STATUS({ sliceStats: { ...ss(), build: "2026-09-09.101" } }))));
    expect(fails(lines), out).toEqual([]);
    for (const tag of ["D12 registry", "D12/D7 recruitee:transperfect", "D12 held nogigiddy", "D7 descriptions", "XR-1", "CAP-8", "BB-09", "VF-BMS", "Name sync", "Retired twins"]) {
      expect(verdict(lines, tag), `${tag}\n${out}`).toEqual(["INFO"]);
    }
    expect(lines.some((l) => /^INFO {2}clock: sliceStats\.build is 2026-09-09\.101, not the serving 2026-09-09\.102/.test(l)), out).toBe(true);
  });

  it("a good .102 deploy passes every claim and fails none", () => {
    const { lines, out } = ok(good());
    expect(fails(lines), out).toEqual([]);
    const passed = lines.filter((l) => l.startsWith("PASS"));
    for (const tag of [
      "build", "PERF-06", "D12 registry", ...BOARDS.map(([v, t]) => `D12/D7 ${v}:${t}`), ...HELD.map((t) => `D12 held ${t}`),
      "D12 Pinpoint dates", "D7 descriptions", "XR-1", "BB-10", "CAP-8", "BB-09", "HB-1", "UPK-3", "UPK-DROP", "BR-04", "BR-03", "VF-BMS",
      "S14X-063(b)", "S14X-121", ...NAMED.map(([v, t]) => `Name sync ${v}:${t}`), "Retired twins", "lastWrapMin", "Lap",
    ]) expect(passed.some((l) => l.startsWith(`PASS  ${tag}: `)), `${tag}\n${out}`).toBe(true);
    expect(passed.length, out).toBe(35);
  });

  it("PERF-06 fails when .102's preflight carries no two-hour max-age", () => {
    const { lines, out } = ok(good(preflight("job-board.2026-09-09.102", null)));
    expect(fails(lines), out).toEqual(["FAIL  PERF-06: preflight Access-Control-Max-Age = (none), want 7200"]);
  });

  it("D12 registry fails on a stream board still oversize 12 h after the build, and on a key the catalogue dropped; a held board may stay", () => {
    const late = iso(8 * DAY - 13 * H);
    const stuck = ok(good(status(STATUS({ oversizeBoards: [reg("livezoku", "recruitee", late), reg("cxg", "workable", late), reg("nogigiddy", "workable", late)] }))));
    expect(fails(stuck.lines), stuck.out).toEqual([expect.stringMatching(/^FAIL {2}D12 registry: 2 board\(s\) the stream or a details-free read should now read were still oversize 12 h after buildSince: \[\["livezoku","recruitee"/)]);
    const early = ok(good(status(STATUS({ oversizeBoards: [reg("livezoku", "recruitee", iso(8 * DAY - 11 * H))] }))));
    expect(fails(early.lines), early.out).toEqual([]);
    const early12 = iso(8 * DAY - H);
    const dropped = ok(good(status(STATUS({ oversizeBoards: [reg("huzzle", "workable", early12), reg("pinpoint:helsing", "pinpoint", early12)] }))));
    expect(fails(dropped.lines), dropped.out).toEqual([expect.stringMatching(/^FAIL {2}D12 registry: 2 key\(s\) name a board the catalogue does not carry .*"huzzle".*"pinpoint:helsing"/)]);
    // A bare key an older build wrote for a token now shared reads as its own vendor's board.
    const bare = ok(good(status(STATUS({ oversizeBoards: [reg("afg", "workable", early12), reg("afg", "lever")] }))));
    expect(fails(bare.lines), bare.out).toEqual([expect.stringMatching(/^FAIL {2}D12 registry: 1 key\(s\) .*\["afg","lever"/)]);
    const none = ok(good(status(STATUS({ oversizeBoards: undefined }))));
    expect(fails(none.lines), none.out).toEqual([expect.stringMatching(/^FAIL {2}D12 registry: status carries no oversizeBoards list/)]);
  });

  it("D12 registry fails on a board of any stream vendor still oversize, and on one waiting 2 h for a stream; a bare Workable board stays, and no Lever board is exempt", () => {
    const late = iso(8 * DAY - 13 * H);
    // lever:usasurveyjob was the one exemption (W4) until board .103 retired it (OD1(a), a paid-survey
    // ad feed). A registry that still names it while a catalogue carries it is a stream board read late.
    const dark = ok(good(status(STATUS({ oversizeBoards: [reg("bjakcareer", "ashby", late), reg("gopuff", "lever", late), reg("usasurveyjob", "lever", late)] }))));
    expect(fails(dark.lines), dark.out).toEqual([expect.stringMatching(/^FAIL {2}D12 registry: 3 board\(s\) .*\[\["bjakcareer","ashby".*\["gopuff","lever".*\["usasurveyjob","lever"/)]);
    const waiting = (at: string) => ok(good(status(STATUS({ oversizeBoards: [{ ...reg("vdkgroep", "recruitee", at), wait: true }, { ...reg("cxg", "workable", late), bare: true }] }))));
    const short = waiting(iso(H));
    expect(fails(short.lines), short.out).toEqual([]);
    expect(tagged(short.lines, "D12 registry count"), short.out).toEqual([expect.stringMatching(/"vdkgroep wait","cxg bare"/)]);
    // A wait's at is its first refusal: one first refused before buildSince + 12 h and still waiting is starved.
    expect(fails(waiting(iso(3 * H)).lines)).toEqual([expect.stringMatching(/^FAIL {2}D12 registry: 1 board\(s\) .*\[\["vdkgroep","recruitee"/)]);
    expect(fails(waiting(iso(7 * DAY)).lines)).toEqual([expect.stringMatching(/^FAIL {2}D12 registry: 1 board\(s\) .*\[\["vdkgroep","recruitee"/)]);
  });

  it("the catalogue is read from this checkout's sources.ts when none is given, which no longer carries lever:usasurveyjob", () => {
    const { lines, out } = ok(good(status(STATUS({ oversizeBoards: [reg("shieldai", "lever", iso(8 * DAY - H)), reg("usasurveyjob", "lever"), reg("retired-nowhere-token", "lever")] }))), { catalog: null });
    expect(fails(lines), out).toEqual([expect.stringMatching(/^FAIL {2}D12 registry: 2 key\(s\) name a board the catalogue does not carry .*"usasurveyjob".*"retired-nowhere-token"/)]);
  });

  it("a board count off its feed by more than 15% fails, within it passes, and a feed robots.txt disallows is not read", () => {
    const off = ok(good(...boardRoutes({ count: { transperfect: 84, cxg: 116 } })));
    expect(fails(off.lines), off.out).toEqual([
      expect.stringMatching(/^FAIL {2}D12\/D7 recruitee:transperfect: 84 served against 100 in-window on the feed \(84%/),
      expect.stringMatching(/^FAIL {2}D12\/D7 workable:cxg: 116 served against 100 in-window/),
    ]);
    const edge = ok(good(...boardRoutes({ count: { transperfect: 85, cxg: 115 } })));
    expect(fails(edge.lines), edge.out).toEqual([]);
    const robots = ok(good(...boardRoutes({ count: { transperfect: 10 }, robots: "User-agent: *\nDisallow: /\n" })));
    expect(fails(robots.lines), robots.out).toEqual([]);
    expect(verdict(robots.lines, "D12/D7 recruitee:transperfect"), robots.out).toEqual(["INFO"]);
    expect(robots.calls.filter((c) => /^curl\tGET /.test(c) && !/robots\.txt/.test(c)), robots.out).toEqual([]);
  });

  it("a board whose rows were all stored before the deploy is judged once this build has read it: recheckedAt, not lastSeen, says so", () => {
    const stored = { lastSeen: iso(200 * H), recheckedAt: iso(H), source: "recruitee" };
    const off = ok(good(...boardRoutes({ count: { transperfect: 84 }, rowsAre: stored })));
    expect(fails(off.lines), off.out).toEqual([expect.stringMatching(/^FAIL {2}D12\/D7 recruitee:transperfect: 84 served against 100 in-window on the feed \(84%.*3 of the first 3 rows read after buildSince/)]);
    const unread = ok(good(...boardRoutes({ count: { transperfect: 84 }, rowsAre: { ...stored, recheckedAt: iso(200 * H) } })));
    expect(fails(unread.lines), unread.out).toEqual([]);
    expect(tagged(unread.lines, "D12/D7 recruitee:transperfect"), unread.out).toEqual([expect.stringMatching(/^INFO {2}D12\/D7 recruitee:transperfect: 84 served, none read after buildSince yet/)]);
    expect(unread.calls.filter((c) => /^curl\tGET .*\/api\/offers\//.test(c)), unread.out).toEqual([]);
  });

  it("a held Workable board that serves rows fails on .102, and is INFO on a later build that spec section 7 lets serve it", () => {
    const { lines, out } = ok(good(...boardRoutes({ held: { "weekday-1": 3 } })));
    expect(fails(lines), out).toEqual(["FAIL  D12 held weekday-1: 3 row(s) served (a held board stays dark until the mill screen and an owner call)"]);
    const later = ok(good(preflight("job-board.2026-09-09.103"), status(STATUS({ version: "2026-09-09.103", sliceStats: ss({ build: "2026-09-09.103" }) })), ...boardRoutes({ held: { "weekday-1": 3 } })));
    expect(fails(later.lines).filter((l) => /D12 held/.test(l)), later.out).toEqual([]);
    expect(tagged(later.lines, "D12 held weekday-1"), later.out).toEqual([expect.stringMatching(/^INFO {2}D12 held weekday-1: 3 row\(s\) served .*on 2026-09-09\.103, a later build may serve it under spec section 7/)]);
  });

  it("a Pinpoint row dated at its insert fails; one dated later by the backfill does not", () => {
    const stamped = ok(good(list(`"companies":\\["trilongroup"\\],"vendor":\\["pinpoint"\\],"limit":60`, { jobs: [row("pinpoint:trilongroup:1", { postedAt: iso(H) })], hasMore: false, nextOffset: null })));
    expect(fails(stamped.lines), stamped.out).toEqual([expect.stringMatching(/^FAIL {2}D12 Pinpoint dates: 1 of 1 trilongroup rows carry a date stamped at insert/)]);
    const backfilled = ok(good(list(`"companies":\\["trilongroup"\\],"vendor":\\["pinpoint"\\],"limit":60`, { jobs: [row("pinpoint:trilongroup:1", { postedAt: iso(5 * DAY) })], hasMore: false, nextOffset: null })));
    expect(fails(backfilled.lines), backfilled.out).toEqual([]);
    expect(verdict(backfilled.lines, "D12 Pinpoint dates"), backfilled.out).toEqual(["PASS"]);
  });

  it("Workable descriptions under 95% fail 7 days after the build and are INFO before", () => {
    const low = (since: string) => ok(good(status(STATUS({ sliceStats: ss({ buildSince: since }), descCoverage: [{ source: "workable", total: 20_000, described: 17_340 }] }))));
    expect(fails(low(SINCE).lines)).toEqual([expect.stringMatching(/^FAIL {2}D7 descriptions: 17340 of 20000 Workable rows described \(86\.7%/)]);
    const young = low(iso(2 * DAY));
    expect(fails(young.lines), young.out).toEqual([]);
    expect(verdict(young.lines, "D7 descriptions"), young.out).toEqual(["INFO"]);
  });

  it("CAP-8 fails on two streamed reads in a slice of either phase, or a record with no count; one streamed read in the hot phase passes", () => {
    for (const [o, want] of [
      [{ streamed: 2 }, /broke the envelope/], [{ streamed: 2, lastPhase: "hot" }, /broke the envelope/], [{ streamed: undefined }, /broke the envelope/],
    ] as const) {
      const { lines, out } = ok(good(status(STATUS({ sliceStats: ss(o) }))));
      expect(fails(lines), out).toEqual([expect.stringMatching(new RegExp("^FAIL {2}CAP-8: 1 slice record\\(s\\) of this build " + want.source))]);
    }
    // A hot-tier board has no other read: its one stream comes in the hot phase.
    const hotOne = ok(good(status(STATUS({ sliceStats: ss({ streamed: 1, lastPhase: "hot" }) }))));
    expect(fails(hotOne.lines), hotOne.out).toEqual([]);
    expect(verdict(hotOne.lines, "CAP-8"), hotOne.out).toEqual(["PASS"]);
  });

  it("XR-1 fails with no stated close 7 days after the build and is INFO before", () => {
    const none = ok(good(HEALTH(0)));
    expect(fails(none.lines), none.out).toEqual([expect.stringMatching(/^FAIL {2}XR-1: passEnd\.steps\.sweep\.statedClosed 12 .* usajobs closed_90d 0 \(want both above 0 within 7 days/)]);
    const noStep = ok(good(status(STATUS({ passEnd: { steps: { sweep: { doneAt: iso(H) } } } }))));
    expect(fails(noStep.lines), noStep.out).toEqual([expect.stringMatching(/^FAIL {2}XR-1: passEnd\.steps\.sweep\.statedClosed null/)]);
    const young = ok(good(HEALTH(0), status(STATUS({ sliceStats: ss({ buildSince: iso(3 * DAY) }) }))));
    expect(fails(young.lines), young.out).toEqual([]);
    expect(verdict(young.lines, "XR-1"), young.out).toEqual(["INFO"]);
  });

  it("BB-10 fails on a stored tomorrow from 16:00Z a day after the build, and is INFO outside those hours", () => {
    const tomorrow = NEWEST({ jobs: [row("greenhouse:acme:1", { postedAt: new Date(NOW + 2 * H).toISOString() })] });
    const late = ok(good(tomorrow));
    expect(fails(late.lines), late.out).toEqual([expect.stringMatching(/^FAIL {2}BB-10: 1 of the newest 1 rows carry a postedAt later than now \+ 5 min/)]);
    const morning = ok(good(tomorrow), { env: { VDBC_HOUR: "10" } });
    expect(fails(morning.lines), morning.out).toEqual([]);
    expect(verdict(morning.lines, "BB-10"), morning.out).toEqual(["INFO"]);
    const fresh = ok(good(tomorrow, status(STATUS({ sliceStats: ss({ buildSince: iso(10 * H) }) }))));
    expect(verdict(fresh.lines, "BB-10"), fresh.out).toEqual(["INFO"]);
  });

  it("BB-09 fails on a slice record with no rateLimited, and on a failure recorded between two reads that names HTTP 429", () => {
    const noKey = ok(good(status(STATUS({ sliceStats: ss({ rateLimited: undefined }) }))));
    expect(fails(noKey.lines), noKey.out).toEqual([expect.stringMatching(/^FAIL {2}BB-09: 1 slice record\(s\) of this build carry no rateLimited/)]);
    const grew = ok(good(status(STATUS(), STATUS({ sliceStats: ss({ at: iso(10_000), hop: 6, slices: 1001 }), failedCount: 42, recentFailures: ["Revyse (vendor: HTTP 404)", "Acme (vendor: HTTP 429)"] }))));
    expect(fails(grew.lines), grew.out).toEqual([expect.stringMatching(/^FAIL {2}BB-09: 1 failure\(s\) recorded between two reads name HTTP 429/)]);
    // An older 429 still in the tail, with nothing new recorded, is not this build's.
    const old = ok(good(status(STATUS({ recentFailures: ["Acme (vendor: HTTP 429)"] }), STATUS({ sliceStats: ss({ at: iso(10_000), hop: 6, slices: 1001 }), recentFailures: ["Acme (vendor: HTTP 429)"] }))));
    expect(fails(old.lines), old.out).toEqual([]);
    expect(verdict(old.lines, "BB-09"), old.out).toEqual(["PASS"]);
  });

  it("HB-1 fails when the watchdog calls a chain alive on a stamp older than its threshold", () => {
    const { lines, out } = ok(good(status(STATUS({ chainKick: { at: iso(30_000 + 200_000 + 61_000) } }))));
    expect(fails(lines), out).toEqual([expect.stringMatching(/^FAIL {2}HB-1: 2 read\(s\) answered chain_alive on a chain stamp older than thresholdMs/)]);
    const inside = ok(good(status(STATUS({ chainKick: { at: iso(30_000 + 200_000 + 59_000) } }))));
    expect(fails(inside.lines), inside.out).toEqual([]);
  });

  it("UPK-3 fails when the hop drops to 0 and the old count comes back with no stale read, kick or pass end between; a real restart passes", () => {
    const three = (hops: number[], o: Array<Record<string, unknown>> = [{}, {}, {}]) =>
      ok(good(status(...hops.map((hop, i) => STATUS({ sliceStats: ss({ at: iso(300_000 - i * 90_000), hop, slices: 1000 + i * 2 }), passEnd: { startedAt: iso(DAY), steps: { sweep: { statedClosed: 3, doneAt: iso(H) }, names: { detail: "name sync v7 done", doneAt: iso(H) }, serve: { doneAt: iso(H) } } }, ...o[i] })))), { env: { VDBC_READS: "3" } });
    const relabel = three([5, 0, 9]);
    expect(fails(relabel.lines), relabel.out).toEqual([expect.stringMatching(/^FAIL {2}UPK-3: 1 drop\(s\) to hop 0 with no stale read, no kick and no pass end between/)]);
    const restart = three([5, 0, 2]);
    expect(fails(restart.lines), restart.out).toEqual([]);
    expect(tagged(restart.lines, "UPK-3"), restart.out).toEqual([expect.stringMatching(/^PASS {2}UPK-3: .*1 drop\(s\) to 0 were real restarts/)]);
    const stale = three([5, 0, 9], [{}, { chainWatchdog: { at: iso(30_000), decision: "rekick", pulseAgeMs: 400_000, thresholdMs: 200_000 } }, {}]);
    expect(fails(stale.lines), stale.out).toEqual([]);
  });

  it("UPK-DROP fails on a boardUpkeep key, a source that is neither rollup nor unavailable, and a rollup older than twice its cadence", () => {
    const key = ok(good(status(STATUS({ boardUpkeep: null }))));
    expect(fails(key.lines), key.out).toEqual(["FAIL  UPK-DROP: status still carries boardUpkeep"]);
    const cache = ok(good(status(STATUS({ dateCoverageSource: "cache" }))));
    expect(fails(cache.lines), cache.out).toEqual(['FAIL  UPK-DROP: dateCoverageSource is "cache", want rollup or unavailable']);
    const old = ok(good(status(STATUS({ dateCoverageAgeMin: 61 }))));
    expect(fails(old.lines), old.out).toEqual(["FAIL  UPK-DROP: the date-coverage rollup is 61 min old, over twice the 30-min cadence (*/30 * * * *)"]);
    const fifteen = ok(good(CRON("*/15 * * * *"), status(STATUS({ dateCoverageAgeMin: 31 }))));
    expect(fails(fifteen.lines), fifteen.out).toEqual(["FAIL  UPK-DROP: the date-coverage rollup is 31 min old, over twice the 15-min cadence (*/15 * * * *)"]);
    const unavailable = ok(good(status(STATUS({ dateCoverageSource: "unavailable", dateCoverageAgeMin: null }))));
    expect(fails(unavailable.lines), unavailable.out).toEqual([]);
  });

  it("BR-04 fails on a list that ended its results and still names a next offset, or drops the key", () => {
    const next = ok(good(...namedRoutes({}, { nextOffset: 60 })));
    expect(fails(next.lines), next.out).toEqual([expect.stringMatching(/^FAIL {2}BR-04: 4 list answer\(s\) with nothing after them still name a next offset/)]);
    const gone = ok(good(BMS(), ...namedRoutes({}, { nextOffset: undefined })));
    expect(fails(gone.lines), gone.out).toEqual([expect.stringMatching(/^FAIL {2}BR-04: 4 list answer\(s\) .*"\(no key\)"/)]);
  });

  it("BR-03 names the fake id unknown and no other; a saved closed id is needed for a PASS, and the open id is saved", () => {
    const pass = ok(good());
    expect(tagged(pass.lines, "BR-03"), pass.out).toEqual(["PASS  BR-03: unknown = [the fake id] only, with 1 closed and 1 open id(s) asked"]);
    expect((pass.state as { ids: Array<{ id: string }> }).ids.map((x) => x.id)).toEqual(["lever:closed-co:9", "greenhouse:acme:1"]);
    const first = run(good());
    expect(fails(first.lines), first.out).toEqual([]);
    expect(verdict(first.lines, "BR-03"), first.out).toEqual(["INFO"]);
    for (const [e, want] of [
      [{ open: ["greenhouse:acme:1"], noUnknownKey: true }, /^FAIL {2}BR-03: exists answers no unknown key$/],
      [{ open: ["greenhouse:acme:1"], fakeKnown: true }, /^FAIL {2}BR-03: the fake id greenhouse:verify-never-held:\d+ is not unknown$/],
      [{ unknown: ["greenhouse:acme:1"] }, /^FAIL {2}BR-03: the open id greenhouse:acme:1 is called unknown$/],
      [{ open: ["greenhouse:acme:1"], unknown: ["lever:closed-co:9"] }, /^FAIL {2}BR-03: 1 saved id\(s\) the board served within 80 days are called unknown/],
    ] as const) {
      const { lines, out } = ok(good(EXISTS(e)));
      expect(fails(lines), out).toEqual([expect.stringMatching(want)]);
    }
    const nul = ok(good(EXISTS({ open: ["greenhouse:acme:1"], unknownNull: true })));
    expect(fails(nul.lines), nul.out).toEqual([]);
    expect(verdict(nul.lines, "BR-03"), nul.out).toEqual(["INFO"]);
  });

  it("VF-BMS fails on a New Brunswick (US) row paid in CAD from 24 h after the build, and is INFO before", () => {
    const cad = [row("workday:bristolmyerssquibb~wd5~BMS:1", { country: "US", location: "New Brunswick - NJ - US", salaryCurrency: "CAD" })];
    const late = ok(good(BMS(cad)));
    expect(fails(late.lines), late.out).toEqual([expect.stringMatching(/^FAIL {2}VF-BMS: 1 of 1 New Brunswick \(US\) rows are paid in CAD/)]);
    const early = ok(good(BMS(cad), status(STATUS({ sliceStats: ss({ buildSince: iso(10 * H) }) }))));
    expect(verdict(early.lines, "VF-BMS"), early.out).toEqual(["INFO"]);
    expect(fails(early.lines).filter((l) => /VF-BMS/.test(l)), early.out).toEqual([]);
  });

  it("a board a slice named in rawNoRows or srPartial that serves nothing fails", () => {
    const { lines, out } = ok(good(...COUNTS({ aaff: 0, ThePlace1: 0 })));
    expect(fails(lines), out).toEqual([
      expect.stringMatching(/^FAIL {2}S14X-063\(b\): 1 board\(s\) whose items did not normalise serve no row .*\["recruitee:aaff"\]/),
      expect.stringMatching(/^FAIL {2}S14X-121: 1 board\(s\) whose later SmartRecruiters page failed serve no row .*\["ThePlace1"\]/),
    ]);
    const empty = ok(good(status(STATUS({ sliceStats: ss({ rawNoRows: [], srPartial: [] }) }))));
    expect(verdict(empty.lines, "S14X-063(b)"), empty.out).toEqual(["INFO"]);
    expect(verdict(empty.lines, "S14X-121"), empty.out).toEqual(["INFO"]);
  });

  it("the name sync fails a board still printing its old name once v7 has run, and waits before", () => {
    const wrong = ok(good(...namedRoutes({ "deag-deutsche-entertainment-ag": "Deag" })));
    expect(fails(wrong.lines), wrong.out).toEqual([expect.stringMatching(/^FAIL {2}Name sync personio:deag-deutsche-entertainment-ag: 2 of 2 rows still read \["Deag"\], want "DEAG Deutsche Entertainment AG"/)]);
    const v6 = ok(good(...namedRoutes({ "deag-deutsche-entertainment-ag": "Deag" }), status(STATUS({ passEnd: { steps: { sweep: { statedClosed: 1 }, names: { detail: "name sync v6 done", doneAt: iso(H) }, serve: { doneAt: iso(H) } } } }))));
    expect(fails(v6.lines), v6.out).toEqual([]);
    expect(verdict(v6.lines, "Name sync"), v6.out).toEqual(["INFO"]);
  });

  it("a retired twin still serving its own vendor's rows after an unblocked prune fails; the kept vendor's rows do not", () => {
    const left = ok(good(...twinRoutes({ "greenhouse:wayve": ["greenhouse:wayve:7"], "pinpoint:helsing": ["greenhouse:helsing:3"] })));
    expect(fails(left.lines), left.out).toEqual(['FAIL  Retired twins: 1 retired board(s) still serve rows after an unblocked prune: [["greenhouse:wayve",1]]']);
    // No read has seen the prune unblocked yet: this run stamps it, and judges on a later run.
    const first = ok(good(...twinRoutes({ "greenhouse:wayve": ["greenhouse:wayve:7"] })), { state: { ids: STATE.ids } });
    expect(fails(first.lines), first.out).toEqual([]);
    expect(verdict(first.lines, "Retired twins"), first.out).toEqual(["INFO"]);
    expect(typeof (first.state as { unblockedSeenAt?: string }).unblockedSeenAt).toBe("string");
    const blocked = ok(good(...twinRoutes({ "greenhouse:wayve": ["greenhouse:wayve:7"] }), status(STATUS({ orphanPruneBlocked: true }))), { state: { ids: STATE.ids } });
    expect(verdict(blocked.lines, "Retired twins"), blocked.out).toEqual(["INFO"]);
    expect((blocked.state as { unblockedSeenAt?: string }).unblockedSeenAt).toBeUndefined();
  });

  it("lastWrapMin fails when .102's status lacks it, and the lap fails over 1.1 x the longest baseline lap", () => {
    const { lastWrapMin: _drop, ...noWrap } = STATUS();
    const missing = ok(good(status(noWrap)));
    expect(fails(missing.lines), missing.out).toEqual(["FAIL  lastWrapMin: status carries no lastWrapMin"]);
    const slow = ok(good(status(STATUS({ lastWrapMin: 518 }))));
    expect(fails(slow.lines), slow.out).toEqual([expect.stringMatching(/^FAIL {2}Lap: the last wrap on this build took 518 min \(bar 517 = 1\.1 x the longest of \[459,470,460\] on 2026-09-09\.101\)/)]);
    const atBar = ok(good(status(STATUS({ lastWrapMin: 517 }))));
    expect(fails(atBar.lines), atBar.out).toEqual([]);
    const few = ok(good(status(STATUS({ lastWrapMin: 900 }))), { laps: { wraps: LAPS.wraps.slice(0, 2) } });
    expect(fails(few.lines), few.out).toEqual([]);
    expect(verdict(few.lines, "Lap"), few.out).toEqual(["INFO"]);
  });

  // The ledger as it stands: two .100 wraps, and one .101 wrap section 90 might add.
  const MIXED = { wraps: [
    { endedAt: "2026-11-05T10:00:00Z", wrapMin: 612, build: "2026-09-09.100" },
    { endedAt: "2026-11-05T20:00:00Z", wrapMin: 597, build: "2026-09-09.100" },
    { endedAt: "2026-11-09T14:07:00Z", wrapMin: 455, build: "2026-09-09.101" },
  ] };
  /** Sampler lines on .101: a rotation starts at each given minute; one sample 15 min after each start and one halfway to the next keep every gap under 360 min. */
  const sampler = (starts: number[]) => {
    const t0 = Date.parse("2026-11-08T12:00:00Z");
    const line = (m: number, age: number) => ({ sampledAt: new Date(t0 + m * 60_000).toISOString(), status: { version: "2026-09-09.101", lastRotationAgeMin: age, coldBoards: 44_523, cursor: { cold: 0 }, sliceStats: { lastPhase: "hot" } } });
    return starts.flatMap((m, i) => [line(m + 15, 15), ...(i + 1 < starts.length ? [line(Math.round((m + starts[i + 1]) / 2), Math.round((starts[i + 1] - m) / 2))] : [])]);
  };

  it("the lap bar never mixes builds: two .100 wraps and one .101 is not a baseline, and the sampler's .101 laps are", () => {
    const mixed = ok(good(status(STATUS({ lastWrapMin: 640 }))), { laps: MIXED });
    expect(fails(mixed.lines), mixed.out).toEqual([]);
    expect(tagged(mixed.lines, "Lap"), mixed.out).toEqual([expect.stringMatching(/^INFO {2}Lap: fewer than 3 baseline laps on 2026-09-09\.101 \(\[455\]/)]);
    // Laps of 460, 440, 455 and 542 min: the last three set the bar, 1.1 x 542 = 596.
    const lines = sampler([0, 460, 900, 1355, 1897]);
    const fromSampler = (w: number) => ok(good(status(STATUS({ lastWrapMin: w }))), { laps: MIXED, baseline: lines });
    const slow = fromSampler(600);
    expect(fails(slow.lines), slow.out).toEqual([expect.stringMatching(/^FAIL {2}Lap: the last wrap on this build took 600 min \(bar 596 = 1\.1 x the longest of \[455,455,542\] on 2026-09-09\.101\)/)]);
    const fine = fromSampler(590);
    expect(fails(fine.lines), fine.out).toEqual([]);
    expect(verdict(fine.lines, "Lap"), fine.out).toEqual(["PASS"]);
    // The sampler alone, with no ledger: the same three laps' bar.
    const alone = ok(good(status(STATUS({ lastWrapMin: 600 }))), { laps: { wraps: [] }, baseline: lines });
    expect(fails(alone.lines), alone.out).toEqual([expect.stringMatching(/^FAIL {2}Lap: .*600 min \(bar 596 = 1\.1 x the longest of \[440,455,542\] on 2026-09-09\.101\)/)]);
  });

  it("the stale reads are a record with the sampler's count beside them, never a check", () => {
    const cw = (stale: boolean) => ({ chainWatchdog: { pulseAgeMs: stale ? 300_000 : 20_000, thresholdMs: 200_000 } });
    const samp = sampler([0, 460, 900, 1355, 1897]).map((x, i) => ({ ...x, status: { ...x.status, ...cw(i < 2) } }));
    const r = ok(good(status(STATUS(cw(true)), STATUS(cw(true)))), { baseline: samp });
    expect(fails(r.lines), r.out).toEqual([]);
    expect(tagged(r.lines, "Stale-read record"), r.out).toEqual([expect.stringMatching(/^INFO {2}Stale-read record: 2 of 2 read\(s\) of this build were stale .*the sampler saw 2 of 9 on 2026-09-09\.101\. A record, not a check/)]);
    expect(r.lines.filter((l) => /death proxy/.test(l)), r.out).toEqual([]);
  });

  it("the cold cursor fails when the slices run and it stands still, or moves at under half the sampler's pre-.102 rate", () => {
    // The sampler on .101: 100 boards a minute, cold samples 10 min apart for 2 h.
    const base = Array.from({ length: 13 }, (_, i) => ({ sampledAt: new Date(NOW - 3 * DAY + i * 600_000).toISOString(), status: { version: "2026-09-09.101", coldBoards: 44_523, cursor: { cold: 1000 + i * 1000 }, sliceStats: { lastPhase: "cold" } } }));
    const reads = (cold: number[], slices: number[]) => status(...cold.map((c, i) => STATUS({ coldBoards: 44_499, cursor: { cold: c }, sliceStats: ss({ at: iso(60_000 - i * 1000), slices: slices[i], cursorStep: { to: c } }) })));
    const go = (cold: number[], slices = [1000, 1003, 1006]) => ok(good(reads(cold, slices)), { baseline: base, clockStepS: 300, env: { VDBC_READS: "3" } });
    const stalled = go([5000, 5000, 5000]);
    expect(fails(stalled.lines), stalled.out).toEqual([expect.stringMatching(/^FAIL {2}Cursor: the cold cursor moved 0 boards in 10\.0 min of cold reads .*: the slices ran and the cursor did not move/)]);
    const slow = go([5000, 5200, 5400]);
    expect(fails(slow.lines), slow.out).toEqual([expect.stringMatching(/^FAIL {2}Cursor: the cold cursor moved 400 boards in 10\.0 min of cold reads = 40\/min.*baseline 100\/min over 120 min of cold samples on 2026-09-09\.101: under half the pre-\.102 rate/)]);
    const fine = go([5000, 5450, 5900]);
    expect(fails(fine.lines), fine.out).toEqual([]);
    expect(verdict(fine.lines, "Cursor"), fine.out).toEqual(["PASS"]);
    // The catalogue's retirements shift positions; a wrap past the end is a move, not a stall.
    const wrapped = go([44_000, 400, 900]);
    expect(fails(wrapped.lines), wrapped.out).toEqual([]);
    const young = ok(good(reads([5000, 5000], [1000, 1003])), { baseline: base });
    expect(verdict(young.lines, "Cursor"), young.out).toEqual(["INFO"]);
  });

  it("a status that is not JSON fails and says what came back", () => {
    const { lines, out } = ok(good({ match: `^POST ${FN} .*"action":"status"`, body: "<html>bad gateway</html>" }));
    expect(fails(lines), out).toEqual([expect.stringMatching(/^FAIL {2}status: no status read answered JSON: <html>bad gateway<\/html>/)]);
  });

  it("only reads: job-board with the probe header, two anon read RPCs, robots.txt before each feed host, 1.1 s between requests to one host; the key is never printed", () => {
    const { calls, out, dir } = ok(good());
    const curls = calls.filter((c) => c.startsWith("curl\t"));
    for (const c of curls.filter((x) => x.startsWith("curl\tPOST"))) {
      const url = c.split("\t")[1].replace("POST ", "");
      if (url.endsWith("/functions/v1/job-board")) expect(c, c).toMatch(/\tprobe$/);
      else expect(url, c).toMatch(/\/rest\/v1\/rpc\/(get_company_hiring_health|get_cron_health)$/);
    }
    expect(curls.some((c) => /"action":"(refresh|upkeep|click|report|save|track)"/.test(c))).toBe(false);
    expect(curls.filter((c) => c.startsWith("curl\tPOST")).every((c) => /"noLog":true|"action":"(status|exists)"|rest\/v1\/rpc/.test(c))).toBe(true);
    const gets = curls.filter((c) => c.startsWith("curl\tGET"));
    expect(gets.length, out).toBe(8 + 6);
    const hostOf = (c: string) => /^curl\tGET https:\/\/([^/]+)/.exec(c)?.[1] ?? "";
    for (const c of gets.filter((x) => !/robots\.txt/.test(x))) {
      const i = calls.indexOf(c);
      const before = calls.slice(0, i);
      expect(before.some((b) => b.startsWith("curl\tGET") && /robots\.txt/.test(b) && hostOf(b) === hostOf(c)), c).toBe(true);
      // The step before every feed read is a pause of at least 1.1 s.
      expect(before[before.length - 1], c).toMatch(/^sleep\t1\.1$/);
    }
    expect(out).not.toContain(KEY);
    expect(existsSync(join(dir, "state", "board-102-core.json"))).toBe(true);
  });

  it("every line it prints starts PASS, FAIL or INFO, after its header", () => {
    for (const r of [ok(good()), run([preflight("job-board.2026-09-09.101", null)])]) {
      for (const l of r.out.split("\n").filter(Boolean)) expect(l, l).toMatch(/^(PASS|FAIL|INFO|== )/);
    }
  });
});
