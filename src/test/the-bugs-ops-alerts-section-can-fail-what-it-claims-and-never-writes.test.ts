// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-ops-alerts CAN FAIL WHAT IT CLAIMS, NEVER
 * FAILS ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-ops-alerts.sh judges the bug round's
 * ops-alerts lane from outside: four builds (B1), the cron reader R10's new
 * one- and three-hour windows read (C1), and, when asked, the heartbeat flap
 * watch NEW-OPS-ALERTS-01 keeps (W1). Run here against a fake curl:
 *   - production as it was on 2026-11-15 (scan-heartbeat 2026-11-09.2, the
 *     other three older, get_cron_health answering 58 jobs) prints INFO and
 *     PASS and no FAIL;
 *   - a good deploy prints PASS for every build and both windows;
 *   - each regression prints FAIL: no build header, a window that answers no
 *     rows, no job, or rows missing a column R10 reads; a heartbeat that
 *     flips to healthy after a failing hourly run in two hours of the watch,
 *     and a watch that saw the heartbeat write fewer than two rows;
 *   - one flipped hour, and flips on a build without the hourly carry, are
 *     INFO: a real recovery looks the same once;
 *   - every request is a GET or an OPTIONS, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 240_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-ops-alerts.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bugs_ops_alerts";
const P = "https://p\\.supabase\\.co";

/** A route answers one body, or, with seq, the next of its bodies on each call (the last repeats). */
type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string; seq?: string[] };

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
const idx=routes.findIndex((x)=>new RegExp(x.match).test(key));
const r=idx<0?{status:404,body:""}:routes[idx];
let body=r.body??"";
if(r.seq){const cf=process.env.VD_CALLS+".seq"+idx;let n=0;try{n=Number(fs.readFileSync(cf,"utf8"))||0}catch{}
  body=r.seq[Math.min(n,r.seq.length-1)];fs.writeFileSync(cf,String(n+1));}
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], extra: NodeJS.ProcessEnv = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbo-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    VD_BUGS_OPS_WATCH: "", VD_BUGS_OPS_WATCH_GAP: "0",
    ...extra,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const FNS = ["scan-heartbeat", "mail-watch", "check-alerts", "check-error-spikes"] as const;
type Fn = typeof FNS[number];
const TODAY: Record<Fn, string> = {
  "scan-heartbeat": "scan-heartbeat.2026-11-09.2", "mail-watch": "mail-watch.2026-11-03.1",
  "check-alerts": "check-alerts.2026-10-11.28", "check-error-spikes": "check-error-spikes.2026-10-08.1",
};
const COLS = ["ch_jobname", "ch_schedule", "ch_active", "ch_timeout", "ch_runs", "ch_failed", "ch_timeouts", "ch_last_start", "ch_last_status", "ch_last_seconds", "ch_max_seconds"];
const job = (name: string, runs: number, failed: number, last: string) => ({
  ch_jobname: name, ch_schedule: "*/10 * * * *", ch_active: true, ch_timeout: null, ch_runs: runs, ch_failed: failed, ch_timeouts: 0,
  ch_last_start: "2026-11-16T03:20:00+00:00", ch_last_status: last, ch_last_seconds: 0.4, ch_max_seconds: 1.2,
});
const QUIET = JSON.stringify(Array.from({ length: 58 }, (_, i) => job(`job-${i}`, 6, 0, "succeeded")));
const beat = (iso: string, status: string) => JSON.stringify([{ status, last_heartbeat_status: status, last_heartbeat_time: iso, issues: [] }]);

type Over = { builds?: Partial<Record<Fn, string | null>>; cron1?: string; cron3?: string; watch?: string[] };
function routes(o: Over = {}, deployed = true): Route[] {
  const builds: Record<Fn, string | null> = {
    ...(deployed ? Object.fromEntries(FNS.map((f) => [f, `${f}.2026-11-12.1`])) as Record<Fn, string> : TODAY),
    ...o.builds,
  };
  return [
    ...FNS.map((fn): Route => ({
      match: `^OPTIONS ${P}/functions/v1/${fn}$`,
      headers: { "access-control-allow-origin": "*", ...(builds[fn] ? { "x-fn-build": builds[fn] as string } : {}) },
    })),
    { match: `^GET ${P}/rest/v1/rpc/get_cron_health\\?p_hours=1$`, body: o.cron1 ?? QUIET },
    { match: `^GET ${P}/rest/v1/rpc/get_cron_health\\?p_hours=3$`, body: o.cron3 ?? QUIET },
    { match: `^GET ${P}/rest/v1/rpc/get_scan_health_status$`, seq: o.watch ?? [beat("2026-11-16T03:20:09Z", "degraded")] },
  ];
}
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const WATCH = { VD_BUGS_OPS_WATCH: "1", VD_BUGS_OPS_WATCH_SAMPLES: "13" };
/** Thirteen heartbeat rows, ten minutes apart from 10:00:30, each status given by the minute it was written. */
const rowsFrom = (statusAt: (hour: number, minute: number) => string) =>
  Array.from({ length: 13 }, (_, i) => {
    const t = new Date(Date.parse("2026-11-16T10:00:30Z") + i * 600_000);
    return beat(t.toISOString(), statusAt(t.getUTCHours(), t.getUTCMinutes()));
  });

describe("today's production, before the paste", () => {
  const { lines, out } = run(routes({}, false));
  it("prints no FAIL: the builds not yet shipped are INFO, the cron reader passes, the watch says it did not run", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^INFO {2}B1 /.test(l)), show(lines)).toHaveLength(4);
    expect(lines.filter((l) => /^PASS {2}C1 /.test(l)), show(lines)).toHaveLength(2);
    expect(has(lines, "PASS", /^PASS {2}C1 get_cron_health as anon over the last hour answers 58 job\(s\) .*none failing every run/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}W1 .*did not run/), show(lines)).toBe(true);
  });
  it("every line is a verdict or the header, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l) || /^== 99zzzzzzz\. /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
});

describe("a good deploy", () => {
  const { lines, calls } = run(routes());
  it("prints PASS for every build and both windows, and no FAIL", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^PASS {2}B1 /.test(l)), show(lines)).toHaveLength(4);
    expect(lines.filter((l) => /^PASS {2}C1 /.test(l)), show(lines)).toHaveLength(2);
  });
  it("a later build passes too: this round's build or later", () => {
    const later = run(routes({ builds: { "mail-watch": "mail-watch.2026-11-13.1" } })).lines;
    expect(has(later, "PASS", /^PASS {2}B1 mail-watch x-fn-build = mail-watch\.2026-11-13\.1/), show(later)).toBe(true);
  });
  it("asks only with GET and OPTIONS: nothing is posted, no function is called but for its preflight", () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
    for (const c of calls.filter((x) => /\/functions\/v1\//.test(x))) expect(c, c).toMatch(/^curl\tOPTIONS /);
  });
});

describe("each regression prints FAIL", () => {
  it("B1: a function whose preflight carries no build header, before the paste or after", () => {
    for (const fn of FNS) {
      const after = run(routes({ builds: { [fn]: null } })).lines;
      expect(has(after, "FAIL", new RegExp(`^FAIL {2}B1 ${fn} preflight carries no x-fn-build`)), show(after)).toBe(true);
    }
    expect(has(run(routes({ builds: { "mail-watch": null } }, false)).lines, "FAIL", /^FAIL {2}B1 mail-watch preflight carries no x-fn-build/)).toBe(true);
  });

  it("C1: a window that answers no rows, no job, or rows missing a column R10 reads", () => {
    const refused = run(routes({ cron1: JSON.stringify({ code: "42501", message: "permission denied for function get_cron_health" }) })).lines;
    expect(has(refused, "FAIL", /^FAIL {2}C1 get_cron_health as anon over the last hour answered no rows/), show(refused)).toBe(true);
    expect(has(run(routes({ cron3: "<html>Bad gateway</html>" })).lines, "FAIL", /^FAIL {2}C1 .*last 3 hours answered no rows/)).toBe(true);
    expect(has(run(routes({ cron1: "[]" })).lines, "FAIL", /^FAIL {2}C1 .*lists no scheduled job/)).toBe(true);
    const narrow = JSON.stringify([Object.fromEntries(Object.entries(job("a", 6, 0, "succeeded")).filter(([k]) => k !== "ch_failed" && k !== "ch_last_status"))]);
    const shape = run(routes({ cron3: narrow })).lines;
    expect(has(shape, "FAIL", /^FAIL {2}C1 .*last 3 hours answers 1 of 1 row\(s\) without the columns R10 reads: missing ch_failed, ch_last_status/), show(shape)).toBe(true);
    // The eleven columns are the ones the shipped mail-watch reads.
    const MW = readFileSync(resolve(ROOT, "supabase/functions/mail-watch/index.ts"), "utf8");
    for (const c of ["ch_jobname", "ch_runs", "ch_failed", "ch_timeouts", "ch_last_status", "ch_active", "ch_last_start"]) expect(MW, c).toContain(c);
    expect(COLS).toHaveLength(11);
  });

  it("C1 names a job failing every run in its window, which R10 rings for", () => {
    const failing = JSON.stringify([job("refresh-stats-cache", 6, 6, "failed"), job("quiet", 6, 0, "succeeded"), job("two-of-six", 6, 2, "failed")]);
    const r = run(routes({ cron1: failing })).lines;
    expect(has(r, "PASS", /^PASS {2}C1 .*last hour answers 3 job\(s\) .*R10 rings for them on its next run, as it should: refresh-stats-cache \(6 of 6\)$/), show(r)).toBe(true);
  });

  it("W1: a heartbeat that reads healthy after a failing hourly run in two hours of the watch", () => {
    // 10:00 and 11:00 fail an hourly check; every off-hour run reads healthy: the flap the cost wave fixed.
    const flap = rowsFrom((_h, m) => (m < 10 ? "degraded" : "healthy"));
    const r = run(routes({ watch: flap }), WATCH).lines;
    expect(has(r, "FAIL", /^FAIL {2}W1 \(NEW-OPS-ALERTS-01\) the heartbeat read healthy on the off-hour run after a failing hourly run in 2 hours \(10:00 degraded to 10:10 healthy; 11:00 degraded to 11:10 healthy\)/), show(r)).toBe(true);
  });

  it("W1: a watch that saw fewer than two heartbeat rows (the heartbeat stopped, or the reader is down)", () => {
    const stuck = run(routes({ watch: [beat("2026-11-16T09:00:30Z", "healthy")] }), WATCH).lines;
    expect(has(stuck, "FAIL", /^FAIL {2}W1 the flap watch read 1 distinct heartbeat row\(s\) in 13 samples/), show(stuck)).toBe(true);
    const down = run(routes({ watch: ['{"message":"no"}'] }), WATCH).lines;
    expect(has(down, "FAIL", /^FAIL {2}W1 the flap watch read 0 distinct/), show(down)).toBe(true);
  });
});

describe("the watch does not FAIL what a real recovery also looks like", () => {
  it("a heartbeat that stays degraded through the off-hour runs passes", () => {
    const carried = rowsFrom(() => "degraded");
    const r = run(routes({ watch: carried }), WATCH);
    expect(has(r.lines, "PASS", /^PASS {2}W1 \(NEW-OPS-ALERTS-01\) 13 heartbeat rows watched/), show(r.lines)).toBe(true);
    expect(fails(r.lines), show(r.lines)).toEqual([]);
    expect(r.calls.filter((c) => c.includes("get_scan_health_status"))).toHaveLength(13);
    for (const c of r.calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
    expect(r.out).not.toContain(KEY);
  });

  it("one flipped hour is INFO", () => {
    const once = rowsFrom((h, m) => (h === 10 && m < 10 ? "degraded" : "healthy"));
    const r = run(routes({ watch: once }), WATCH).lines;
    expect(has(r, "INFO", /^INFO {2}W1 \(NEW-OPS-ALERTS-01\) one hour flipped .*10:00 degraded to 10:10 healthy/), show(r)).toBe(true);
    expect(fails(r), show(r)).toEqual([]);
  });

  it("flips on a heartbeat build older than the one that carries the hourly checks are INFO", () => {
    const flap = rowsFrom((_h, m) => (m < 10 ? "degraded" : "healthy"));
    const r = run(routes({ watch: flap, builds: { "scan-heartbeat": "scan-heartbeat.2026-11-03.1" } }, false), WATCH).lines;
    expect(has(r, "INFO", /^INFO {2}W1 .*does not serve 2026-11-09\.2/), show(r)).toBe(true);
    expect(fails(r), show(r)).toEqual([]);
  });
});
