// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl and a fake gh on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-ops-alerts-b CAN FAIL WHAT IT CLAIMS, NEVER
 * FAILS ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-ops-alerts-b.sh judges part B's
 * ops-alerts lane from outside: two builds (B1, B2), the two health readers
 * still closed to anon (the shared probe), six marks in the three owner page
 * chunks (F1-F6), the closure readings board-health now judges (C1), and the
 * latest scheduled board-health run (G1). Run here against a fake curl and a
 * fake gh:
 *   - production as it was on 2026-11-17 (both functions 2026-11-09.1, the
 *     pages without a mark of the lane, closures inside their bars, the latest
 *     scheduled run on a workflow without the closure checks) prints INFO and
 *     PASS and no FAIL;
 *   - a good deploy prints PASS on every line;
 *   - each regression prints FAIL: no build header, a reader opened to anon,
 *     a published page missing any one mark or still carrying the old text, a
 *     bundle whose entry names no page chunk, each closure reading outside its
 *     bar or missing, and a scheduled run on the new workflow that printed
 *     neither the closure line nor a closure failure, or raised on closures;
 *   - every curl is a GET or an OPTIONS but the job-board status read, which
 *     carries x-rb-budget: probe; gh only lists, views and GETs; the key is
 *     never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 240_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-ops-alerts-b.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const PROBE = /^probe\(\) \{[\s\S]*?esac; \}$/m.exec(SCRIPT)?.[0] ?? "";
const JHELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bugs_ops_alerts_b";
const P = "https://p\\.supabase\\.co";
const S = "https://site\\.test";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const body=r.body??"";
const hdr="HTTP/2 "+(r.status??200)+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

/** gh answers from a JSON file: auth (false = signed out), list, log, wf (undefined = the call fails). */
const FAKE_GH = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
fs.appendFileSync(process.env.VD_CALLS,"gh\\t"+a.join(" ")+"\\n");
const g=JSON.parse(fs.readFileSync(process.env.VD_GH,"utf8"));
const say=(v)=>{if(v===undefined||v===null)process.exit(1);process.stdout.write(v);process.exit(0)};
if(a[0]==="auth")process.exit(g.auth===false?1:0);
if(a[0]==="run"&&a[1]==="list")say(g.list);
if(a[0]==="run"&&a[1]==="view")say(g.log);
if(a[0]==="api")say(g.wf);
process.exit(1);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Gh = { auth?: boolean; list?: string | null; log?: string | null; wf?: string | null };
function run(routes: Route[], gh: Gh): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbob-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  writeFileSync(join(dir, "bin", "gh"), FAKE_GH);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "gh.json"), JSON.stringify(gh));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${JHELPER}\n${PROBE}\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VD_GH: join(dir, "gh.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// ── the pages, as the minifier leaves them ──────────────────────────────────
const OLD = {
  hc: 'y=h>0?((h-f)/h*100).toFixed(1):"100.0",z=1;w=k>0?1:"100.0";q=m>0?2:"100.0";children:"Unavailable: this panel"',
  ed: 'sx("p",{className:"text-xs",children:"Last 24 hours"});"vs prev hour";setInterval(()=>{},3e4)',
  ad: '"users";"No visitors were recorded in this range. That is a real measurement, not a broken chart, the pipeline is verified working, so this means nobody arrived."',
};
const VISIBLE = 'document.addEventListener("visibilitychange",o)';
const NEW = {
  hc: 'import{u as V}from"./use-visible-interval-V1.js";p=t>0?((t-f)/t*100).toFixed(1):null;children:"Unavailable: this panel"',
  ed: 'import{u as V}from"./use-visible-interval-V1.js";children:["Showing the newest ",n," of ",t," errors in this range"];"new this hour (none the hour before)"',
  ad: '"Counts are events: one per page, per browser session, per day that reached the step. They are not people.";"Visitors per day (new shown separately), days in ",e.audience.dayZone??"UTC";"visitors who allowed analytics, de-duplicated by visitor id"',
};
type Pages = { hc: string; ed: string; ad: string; deps?: string; entry?: string };

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const pgMinutesAgo = (m: number) => minutesAgo(m).replace(/\.(\d{3})Z$/, ".$1041+00:00");
const STATUS = (lapMin: number | null, popMin: number | null) => JSON.stringify({
  ok: true,
  deepCursor: { laps: { tracking: 1088, proven: 1040, disarmed: 29, lastProvenAt: lapMin === null ? null : minutesAgo(lapMin), firstLapAt: minutesAgo(80 * 1440) } },
  closurePopulation: popMin === null ? null : { as_of: pgMinutesAgo(popMin), boards_lap_pending: 46 },
});
const DENIED = (fn: string) => JSON.stringify({ code: "42501", details: null, hint: null, message: `permission denied for function ${fn}` });

type Over = {
  builds?: { tel?: string | null; ana?: string | null };
  pages?: Pages;
  geo?: string;
  status?: string;
  takedowns?: string;
};
function routes(o: Over = {}, deployed = true): Route[] {
  const tel = o.builds && "tel" in o.builds ? o.builds.tel : deployed ? "get-error-telemetry.2026-11-13.1" : "get-error-telemetry.2026-11-09.1";
  const ana = o.builds && "ana" in o.builds ? o.builds.ana : deployed ? "get-analytics.2026-11-13.1" : "get-analytics.2026-11-09.1";
  const pages: Pages = o.pages ?? (deployed ? { ...NEW, deps: VISIBLE } : OLD);
  const entry = pages.entry ?? 'const a=()=>import("./HealthCheck-H1.js"),b=()=>import("./ErrorDashboard-E1.js"),c=()=>import("./AnalyticsDashboard-A1.js");';
  const opt = (fn: string, b: string | null | undefined): Route => ({
    match: `^OPTIONS ${P}/functions/v1/${fn}$`,
    headers: { "access-control-allow-origin": "*", ...(b ? { "x-fn-build": b } : {}) },
  });
  return [
    opt("get-error-telemetry", tel),
    opt("get-analytics", ana),
    { match: `^GET ${P}/rest/v1/rpc/get_geo_latency_stats\\?p_hours_back=1$`, body: o.geo ?? DENIED("get_geo_latency_stats") },
    { match: `^GET ${P}/rest/v1/rpc/get_ai_generation_metrics_hourly\\?p_hours_back=1$`, body: DENIED("get_ai_generation_metrics_hourly") },
    { match: `^GET ${S}/$`, body: '<html><script type="module" crossorigin src="/assets/index-AAA.js"></script></html>' },
    { match: `^GET ${S}/assets/index-AAA\\.js$`, body: entry },
    { match: `^GET ${S}/assets/HealthCheck-H1\\.js$`, body: pages.hc },
    { match: `^GET ${S}/assets/ErrorDashboard-E1\\.js$`, body: pages.ed },
    { match: `^GET ${S}/assets/AnalyticsDashboard-A1\\.js$`, body: pages.ad },
    { match: `^GET ${S}/assets/use-visible-interval-V1\\.js$`, body: pages.deps ?? "" },
    { match: `^POST ${P}/functions/v1/job-board\\t\\{"action":"status"\\}$`, body: o.status ?? STATUS(3, 19) },
    { match: `^GET ${P}/rest/v1/rpc/get_takedowns_today$`, body: o.takedowns ?? "17106" },
  ];
}

const OLD_WF = "name: board-health\n# probes total, lastSliceAgeMin and sliceStats.workAt\n";
const NEW_WF = "name: board-health\n# ... $SB_URL/rest/v1/rpc/get_takedowns_today ...\n";
const LIST = (conclusion = "success") => JSON.stringify([{ databaseId: 44067910089, createdAt: "2026-11-17T10:46:26Z", conclusion, headSha: "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12" }]);
const OK_LOG = "probe\tProbe the board\t2026-11-17T10:46:40Z board OK: total=712232, lastSliceAgeMin=1, last slice work 3 min ago, laps last proven 2 min ago, closure population 19 min old, takedowns in 24 h = 17106\n";
const TODAY_LOG = "probe\tProbe the board\t2026-11-17T10:46:40Z board OK: total=712232, lastSliceAgeMin=1, last slice work 3 min ago\n";
const GH_TODAY: Gh = { list: LIST(), log: TODAY_LOG, wf: OLD_WF };
const GH_GOOD: Gh = { list: LIST(), log: OK_LOG, wf: NEW_WF };

const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

function readOnly(calls: string[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    if (c.startsWith("gh\t")) { expect(c, c).toMatch(/^gh\t(auth status|run list |run view \d+ --log|api -H Accept: application\/vnd\.github\.raw repos\/\{owner\}\/\{repo\}\/contents\/)/); expect(c, c).not.toMatch(/--method|-X |-f |--field|--input/); continue; }
    if (/^curl\tPOST /.test(c)) { expect(c, c).toMatch(/^curl\tPOST https:\/\/p\.supabase\.co\/functions\/v1\/job-board\t\{"action":"status"\}\theaders:.*x-rb-budget: probe/); continue; }
    expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
  }
}

describe("today's production, before the paste, the publish and the merge", () => {
  const { lines, calls, out } = run(routes({}, false), GH_TODAY);
  it("prints no FAIL: builds, page marks and the alarm run are INFO; the readers and the closure readings pass", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^INFO {2}B[12] /.test(l)), show(lines)).toHaveLength(2);
    expect(lines.filter((l) => /^INFO {2}F[1-6] /.test(l)), show(lines)).toHaveLength(6);
    expect(lines.filter((l) => /^PASS {2}get_(geo_latency_stats|ai_generation_metrics_hourly) as anon -> 42501/.test(l)), show(lines)).toHaveLength(2);
    expect(has(lines, "PASS", /^PASS {2}C1 .*laps last proven 3 min ago.*closure population 19 min old.*takedowns in 24 h = 17106/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /G1 .*without the closure checks/), show(lines)).toBe(true);
  });
  it("names what each page shows today", () => {
    expect(has(lines, "INFO", /F1 .*today: 3 "100\.0" literal/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /F6 .*today: the empty range is called proof/), show(lines)).toBe(true);
  });
  it("reads only, and never prints the key", () => {
    readOnly(calls);
    expect(out).not.toContain(KEY);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO) {2}|^== /);
  });
});

describe("a good deploy", () => {
  const { lines, calls, out } = run(routes(), GH_GOOD);
  it("passes every line", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => l.startsWith("INFO")), show(lines)).toEqual([]);
    for (const id of ["B1", "B2", "F1 (S14X-156)", "F2 (S14X-157)", "F3 (CW2-HB1)", "F4 (S14X-189)", "F5 (S14X-190)", "F6 (S14X-191)", "C1", "G1 (S14X-243)"]) {
      expect(lines.some((l) => l.startsWith(`PASS  ${id} `)), `${id}\n${show(lines)}`).toBe(true);
    }
    expect(has(lines, "PASS", /G1 .*laps last proven 2 min ago.*takedowns in 24 h = 17106/), show(lines)).toBe(true);
  });
  it("reads only, and never prints the key", () => { readOnly(calls); expect(out).not.toContain(KEY); });
});

describe("each regression fails", () => {
  it("B1: a function whose preflight carries no build header", () => {
    expect(has(run(routes({ builds: { tel: null } }), GH_GOOD).lines, "FAIL", /^FAIL {2}B1 get-error-telemetry preflight carries no x-fn-build/)).toBe(true);
  });

  it("a build older than the round is INFO, never FAIL", () => {
    const { lines } = run(routes({ builds: { ana: "get-analytics.2026-11-09.1" } }), GH_GOOD);
    expect(has(lines, "INFO", /B2 get-analytics x-fn-build = get-analytics\.2026-11-09\.1/), show(lines)).toBe(true);
    expect(fails(lines), show(lines)).toEqual([]);
  });

  it("M1: a health reader that answers anon with rows", () => {
    const { lines } = run(routes({ geo: JSON.stringify([{ country: "US", total_scans: 6 }]) }), GH_GOOD);
    expect(has(lines, "FAIL", /get_geo_latency_stats as anon -> ROWS:1/), show(lines)).toBe(true);
  });

  const published = (patch: Partial<Pages>): Pages => ({ ...NEW, deps: VISIBLE, ...patch });
  it("F1: a published /health-check that still prints 100.0", () => {
    const { lines } = run(routes({ pages: published({ hc: NEW.hc + ';x=n>0?1:"100.0"' }) }), GH_GOOD);
    expect(has(lines, "FAIL", /^FAIL {2}F1 .*"100\.0" 1 time/), show(lines)).toBe(true);
  });
  it("F2: a published /errors with no sample note, or with the fixed label", () => {
    expect(has(run(routes({ pages: published({ ed: NEW.ed.replace("Showing the newest ", "Rows ") }) }), GH_GOOD).lines, "FAIL", /^FAIL {2}F2 .*never says it shows a sample/)).toBe(true);
    expect(has(run(routes({ pages: published({ ed: NEW.ed + ';children:"Last 24 hours"' }) }), GH_GOOD).lines, "FAIL", /^FAIL {2}F2 .*still labels a card Last 24 hours/)).toBe(true);
  });
  it("F3: a published page whose poller has no visibility listener", () => {
    const noDep = run(routes({ pages: published({ ed: NEW.ed.replace('import{u as V}from"./use-visible-interval-V1.js";', "") }) }), GH_GOOD).lines;
    expect(has(noDep, "FAIL", /^FAIL {2}F3 .*reaches \/errors/), show(noDep)).toBe(true);
    const emptyDep = run(routes({ pages: published({ deps: "export const u=()=>{}" }) }), GH_GOOD).lines;
    expect(has(emptyDep, "FAIL", /^FAIL {2}F3 .*\/health-check or \/errors/), show(emptyDep)).toBe(true);
  });
  it("F4, F5, F6: a published /analytics missing each mark, or keeping the old proof claim", () => {
    expect(has(run(routes({ pages: published({ ad: NEW.ad.replace("Counts are events", "Counts") }) }), GH_GOOD).lines, "FAIL", /^FAIL {2}F4 /)).toBe(true);
    expect(has(run(routes({ pages: published({ ad: NEW.ad.replace("days in ", "days ") }) }), GH_GOOD).lines, "FAIL", /^FAIL {2}F5 /)).toBe(true);
    expect(has(run(routes({ pages: published({ ad: NEW.ad + OLD.ad }) }), GH_GOOD).lines, "FAIL", /^FAIL {2}F6 .*still says an empty range proves nobody arrived/)).toBe(true);
    expect(has(run(routes({ pages: published({ ad: NEW.ad.replace("allowed analytics", "came") }) }), GH_GOOD).lines, "FAIL", /^FAIL {2}F6 .*never says its visitors are those who allowed analytics/)).toBe(true);
  });
  it("F1: an entry that names no page chunk cannot be judged", () => {
    const { lines } = run(routes({ pages: { ...NEW, deps: VISIBLE, entry: "const a=1;" } }), GH_GOOD);
    expect(has(lines, "FAIL", /^FAIL {2}F1 the served entry .*names no chunk for HealthCheck, ErrorDashboard, AnalyticsDashboard/), show(lines)).toBe(true);
  });

  it("C1: each closure reading outside its bar, or missing", () => {
    expect(has(run(routes({ status: STATUS(30 * 60, 19) }), GH_GOOD).lines, "FAIL", /^FAIL {2}C1 .*last lap proof is 1800 min old/)).toBe(true);
    expect(has(run(routes({ status: STATUS(null, 19) }), GH_GOOD).lines, "FAIL", /^FAIL {2}C1 .*no last lap proof/)).toBe(true);
    expect(has(run(routes({ status: STATUS(3, 240) }), GH_GOOD).lines, "FAIL", /^FAIL {2}C1 .*closure population is 240 min old/)).toBe(true);
    expect(has(run(routes({ status: STATUS(3, null) }), GH_GOOD).lines, "FAIL", /^FAIL {2}C1 .*no closure population as_of/)).toBe(true);
    expect(has(run(routes({ takedowns: "0" }), GH_GOOD).lines, "FAIL", /^FAIL {2}C1 .*no takedown in the last 24 hours/)).toBe(true);
    expect(has(run(routes({ takedowns: JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }) }), GH_GOOD).lines, "FAIL", /^FAIL {2}C1 .*get_takedowns_today answered no count/)).toBe(true);
    expect(has(run(routes({ status: "<html>504</html>" }), GH_GOOD).lines, "FAIL", /^FAIL {2}C1 .*no last lap proof.*no closure population/)).toBe(true);
  });

  it("G1: a run on the new workflow that printed no closure line, or raised on closures", () => {
    const quiet = run(routes(), { ...GH_GOOD, log: TODAY_LOG }).lines;
    expect(has(quiet, "FAIL", /^FAIL {2}G1 .*printed neither/), show(quiet)).toBe(true);
    const raised = run(routes(), { list: LIST("failure"), wf: NEW_WF, log: "Fail the run\t2026-11-17T10:46:44Z ##[error]::error title=Board health::no takedown was recorded in the last 24 hours (the closure writer has stopped)\n" }).lines;
    expect(has(raised, "FAIL", /^FAIL {2}G1 .*raised the alarm on the closures: no takedown was recorded/), show(raised)).toBe(true);
  });

  it("G1 is INFO, never FAIL, when it cannot judge: signed out, no run, a run that failed on something else, an unreadable file", () => {
    const cases: Gh[] = [
      { auth: false },
      { list: "[]" },
      { list: LIST("failure"), wf: NEW_WF, log: "Fail the run\t::error title=Board health::board query returned no numeric total\n" },
      { list: LIST(), wf: null, log: OK_LOG },
    ];
    for (const gh of cases) {
      const { lines } = run(routes(), gh);
      expect(lines.filter((l) => /^(PASS|FAIL) {2}G1 /.test(l)), `${JSON.stringify(gh)}\n${show(lines)}`).toEqual([]);
      expect(lines.some((l) => /^INFO {2}G1 /.test(l)), show(lines)).toBe(true);
    }
  });
});
