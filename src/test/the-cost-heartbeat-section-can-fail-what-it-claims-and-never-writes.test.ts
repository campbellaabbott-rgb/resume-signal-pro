// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzz-cost-heartbeat CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzz-cost-heartbeat.sh judges the cost audit's
 * heartbeat lane from outside: three builds (B1), the scanners' preflight
 * cache (C1), the published scan hover's warm-up target (H1), the checkout
 * warm-up kept (H2, a regression guard), the ten-minute heartbeat still
 * writing its row off the hour (L1), and its full scans once an hour (L2).
 * Run here against a fake curl:
 *   - production as it was on 2026-11-08 (every build 2026-11-03.1, no
 *     max-age, the hover warming the stream, six heartbeat scans an hour)
 *     prints INFO and no FAIL;
 *   - a good deploy prints PASS for every claim and no FAIL;
 *   - each regression prints FAIL: no build header, a new build whose
 *     preflight lost the max-age, a hover that warms both scanners or
 *     neither, a bundle that names no hover chunk, a checkout hook that no
 *     longer warms or opens checkout, a heartbeat older than 30 minutes, and
 *     no heartbeat scan in an hour on the new build;
 *   - every request is a GET or an OPTIONS, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Each case runs bash and node a few times; on a loaded machine one run took
// fifteen seconds, so a case with four of them needs more than a minute.
vi.setConfig({ testTimeout: 240_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-cost-heartbeat.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_cost_heartbeat";
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
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

// The clock the section reads, pinned: 23 minutes past the hour.
const NOW = "2026-11-10T10:23:00Z";
const at = (iso: string) => new Date(iso).toISOString();

function run(routes: Route[], now = NOW): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdch-"));
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
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDCH_NOW: now,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// The hover as production minifies it (Index-BRmMKfza.js, 2026-11-08), and as this branch's source becomes.
const HOVER = (target: string) => `l=o.useCallback(async()=>{console.log("[ScanPrefetch] Starting prefetch on hover");const[_]=await Promise.all([Promise.resolve(fs(t)),fetch("https://p.supabase.co/functions/v1/warm-up",{method:"POST",body:JSON.stringify(${target}),signal:F}).catch(K=>null)])});`;
const OLD_HOVER = HOVER('{target:"free-keyword-scan-stream"}');
const NEW_HOVER = HOVER('{target:"free-keyword-scan"}');
// The checkout hook as production serves it (use-product-checkout-RQdXovGD.js, 2026-11-08), in part.
const CHECKOUT = 'await fetch("https://p.supabase.co/functions/v1/warm-up",{method:"POST",body:JSON.stringify({target:"create-product-checkout"})});const{data:a,error:b}=await s.functions.invoke("create-product-checkout",{body:c});';

type Over = {
  builds?: Partial<Record<"scan-heartbeat" | "free-keyword-scan" | "free-keyword-scan-stream", string | null>>;
  maxAge?: Partial<Record<"free-keyword-scan" | "free-keyword-scan-stream", string | null>>;
  home?: string; entry?: string; hover?: string; checkout?: string;
  lastBeat?: string | null; beatScans?: number | null;
};
function routes(o: Over = {}, deployed = true): Route[] {
  const builds = {
    "scan-heartbeat": deployed ? "scan-heartbeat.2026-11-09.1" : "scan-heartbeat.2026-11-03.1",
    "free-keyword-scan": deployed ? "free-keyword-scan.2026-11-09.1" : "free-keyword-scan.2026-11-03.1",
    "free-keyword-scan-stream": deployed ? "free-keyword-scan-stream.2026-11-10.2" : "free-keyword-scan-stream.2026-11-03.1",
    ...o.builds,
  };
  const maxAge = { "free-keyword-scan": deployed ? "7200" : null, "free-keyword-scan-stream": deployed ? "7200" : null, ...o.maxAge };
  // An off-hour row: the :20 run's, written three minutes before NOW.
  const lastBeat = o.lastBeat === undefined ? at("2026-11-10T10:20:31Z") : o.lastBeat;
  const beatScans = o.beatScans === undefined ? (deployed ? 1 : 6) : o.beatScans;
  const preflight = (fn: keyof typeof builds): Route => {
    const headers: Record<string, string> = { "access-control-allow-origin": "*" };
    if (builds[fn]) headers["x-fn-build"] = builds[fn] as string;
    const age = fn === "scan-heartbeat" ? null : maxAge[fn];
    if (age) headers["access-control-max-age"] = age;
    return { match: `^OPTIONS ${P}/functions/v1/${fn}$`, headers };
  };
  return [
    preflight("scan-heartbeat"), preflight("free-keyword-scan"), preflight("free-keyword-scan-stream"),
    { match: `^GET ${S}/$`, body: o.home ?? '<html><head><script type="module" src="/assets/index-A1.js"></script></head></html>' },
    { match: `^GET ${S}/assets/index-A1\\.js$`, body: o.entry ?? 'const m=["assets/Index-Small.js","assets/Index-Page.js","assets/use-product-checkout-C9.js"];' },
    { match: `^GET ${S}/assets/Index-Small\\.js$`, body: "export{};" },
    { match: `^GET ${S}/assets/Index-Page\\.js$`, body: o.hover ?? (deployed ? NEW_HOVER : OLD_HOVER) },
    { match: `^GET ${S}/assets/use-product-checkout-C9\\.js$`, body: o.checkout ?? CHECKOUT },
    { match: `^GET ${P}/rest/v1/rpc/get_scan_health_status$`, body: JSON.stringify([{ status: "degraded", last_heartbeat_status: "degraded", last_heartbeat_time: lastBeat, issues: [] }]) },
    { match: `^GET ${P}/rest/v1/rpc/get_scan_success_rate\\?p_scan_type=heartbeat&p_hours_back=1$`, body: beatScans === null ? "<html>Bad gateway</html>" : JSON.stringify([{ total_scans: beatScans, completed_scans: beatScans, p50_duration_ms: 27000 }]) },
  ];
}
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("today's production, before the merge and the paste", () => {
  const { lines, out } = run(routes({}, false));
  it("prints no FAIL: every claim not yet shipped is INFO, and the regression guard passes", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of ["B1", "C1", "H1", "L1", "L2"]) expect(has(lines, "INFO", new RegExp(`^INFO {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
    expect(lines.filter((l) => /^INFO {2}B1 /.test(l))).toHaveLength(3);
    expect(has(lines, "PASS", /^PASS {2}H2 \(a regression guard/), show(lines)).toBe(true);
  });
  it("every line is a verdict or the header, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l) || /^== 99zzzzzz\. /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
});

describe("a good deploy", () => {
  const { lines, calls } = run(routes());
  it("prints PASS for every claim and no FAIL", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^PASS {2}B1 /.test(l)), show(lines)).toHaveLength(3);
    expect(lines.filter((l) => /^PASS {2}C1 /.test(l)), show(lines)).toHaveLength(2);
    for (const c of ["H1", "H2", "L1", "L2"]) expect(has(lines, "PASS", new RegExp(`^PASS {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("asks only with GET and OPTIONS: nothing is posted, no function is called but for its preflight", () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
    for (const c of calls.filter((x) => /\/functions\/v1\//.test(x))) expect(c, c).toMatch(/^curl\tOPTIONS /);
  });
});

describe("each regression prints FAIL", () => {
  it("B1: a function whose preflight carries no build header, before the paste or after", () => {
    expect(has(run(routes({ builds: { "scan-heartbeat": null } })).lines, "FAIL", /^FAIL {2}B1 scan-heartbeat preflight carries no x-fn-build/)).toBe(true);
    expect(has(run(routes({ builds: { "free-keyword-scan": null } }, false)).lines, "FAIL", /^FAIL {2}B1 free-keyword-scan preflight carries no x-fn-build/)).toBe(true);
  });

  it("C1: a scanner on the new build whose preflight lost the max-age, or answers another value", () => {
    const { lines } = run(routes({ maxAge: { "free-keyword-scan": null } }));
    expect(has(lines, "FAIL", /^FAIL {2}C1 free-keyword-scan serves free-keyword-scan\.2026-11-09\.1 but .*'none'/), show(lines)).toBe(true);
    expect(has(run(routes({ maxAge: { "free-keyword-scan-stream": "5" } })).lines, "FAIL", /^FAIL {2}C1 free-keyword-scan-stream serves .*'5'/)).toBe(true);
    // A build older than this lane's is not judged on the header it never carried.
    expect(has(run(routes({ builds: { "free-keyword-scan-stream": "free-keyword-scan-stream.2026-11-10.1" }, maxAge: { "free-keyword-scan-stream": null } })).lines, "INFO", /^INFO {2}C1 free-keyword-scan-stream /)).toBe(true);
  });

  it("H1: a hover that warms both scanners, or neither, and a bundle that names no hover chunk", () => {
    const both = NEW_HOVER + OLD_HOVER;
    expect(has(run(routes({ hover: both })).lines, "FAIL", /^FAIL {2}H1 .*asks warm-up for both scanners/)).toBe(true);
    expect(has(run(routes({ hover: HOVER('{target:"health-check"}') })).lines, "FAIL", /^FAIL {2}H1 .*asks warm-up for neither scanner/)).toBe(true);
    expect(has(run(routes({ hover: "export{};" })).lines, "FAIL", /^FAIL {2}H1 no Index or ResumeUploader chunk .*logs the scan hover/)).toBe(true);
    expect(has(run(routes({ home: "<html></html>" })).lines, "FAIL", /^FAIL {2}H1 the homepage names no/)).toBe(true);
  });

  it("H2: a checkout hook that no longer warms create-product-checkout, or no longer opens checkout through it", () => {
    const cold = CHECKOUT.replace('{target:"create-product-checkout"}', "{}");
    expect(has(run(routes({ checkout: cold })).lines, "FAIL", /^FAIL {2}H2 .*a purchase may not open/)).toBe(true);
    const shut = CHECKOUT.replace('invoke("create-product-checkout"', 'invoke("create-checkout"');
    expect(has(run(routes({ checkout: shut })).lines, "FAIL", /^FAIL {2}H2 /)).toBe(true);
    expect(has(run(routes({ entry: 'const m=["assets/Index-Page.js"];' })).lines, "FAIL", /^FAIL {2}H2 neither the entry nor the hover's chunk names/)).toBe(true);
  });

  it("L1: a heartbeat row older than 30 minutes, on either build, and no row at all", () => {
    expect(has(run(routes({ lastBeat: at("2026-11-10T09:38:00Z") })).lines, "FAIL", /^FAIL {2}L1 the heartbeat last wrote its row 45 min ago/)).toBe(true);
    expect(has(run(routes({ lastBeat: at("2026-11-10T09:38:00Z") }, false)).lines, "FAIL", /^FAIL {2}L1 /)).toBe(true);
    expect(has(run(routes({ lastBeat: at("2026-11-10T09:58:00Z") })).lines, "INFO", /^INFO {2}L1 .*25 min ago/)).toBe(true);
    expect(has(run(routes({ lastBeat: null })).lines, "FAIL", /^FAIL {2}L1 get_scan_health_status as anon answered no last heartbeat/)).toBe(true);
  });

  it("L1 passes only on an off-hour row: the hourly run's row is not that proof", () => {
    // At 10:05 the newest row is the :00 run's, written at 10:02.
    const hourly = run(routes({ lastBeat: at("2026-11-10T10:02:10Z") }), "2026-11-10T10:05:00Z").lines;
    expect(has(hourly, "INFO", /^INFO {2}L1 the newest heartbeat row .* is the hourly run/), show(hourly)).toBe(true);
  });

  it("L2: no heartbeat scan in an hour on the new build; an hour that straddles the paste is only INFO", () => {
    expect(has(run(routes({ beatScans: 0 })).lines, "FAIL", /^FAIL {2}L2 the heartbeat wrote no scan row in the last hour on the new build/)).toBe(true);
    expect(has(run(routes({ beatScans: 4 })).lines, "INFO", /^INFO {2}L2 .*straddles the paste/)).toBe(true);
    expect(has(run(routes({ beatScans: null })).lines, "INFO", /^INFO {2}L2 .*unreadable/)).toBe(true);
  });
});
