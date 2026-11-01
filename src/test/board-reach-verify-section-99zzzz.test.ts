// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl and a fake sleep on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzz-board-reach CAN FAIL EVERY CLAIM IT MAKES, AND WAITS
 * FOR ITS BUILD.
 *
 * scripts/verify-deploy.d/99zzzz-board-reach.sh is the post-deploy proof that
 * job-board 2026-09-09.100 reads the Workday tenants that refuse the runtime
 * language on their first page (S8-003), proves a lap on a UKG board over 600
 * (S10-004) and on an Oracle tenant over the 10,000 result cap (S10-003). The
 * section runs here against a fake curl that answers from routes (matched on
 * method, URL and body) and logs every call:
 *   - a good deploy prints only PASS lines, one per claim;
 *   - an older build prints one INFO and asks nothing else; a preflight with
 *     no build is a FAIL;
 *   - a Workday board serving 0 rows is INFO for 36 h from the first slice of
 *     this build and FAIL after; one the catalogue does not carry, or an
 *     unreadable list, is a FAIL;
 *   - Ollie's without lap_proven is INFO for 5 days, FAIL after;
 *   - an Oracle tenant without lap_proven is FAIL after 7 days only when its
 *     own row 9,999 is older than the fence; a floor inside the fence, or no
 *     row 9,999 at all, is INFO;
 *   - slice stats an older build wrote time nothing, a status with no
 *     buildSince and an unreadable fill curve are FAILs;
 *   - the key is never printed, every call to the board carries
 *     x-rb-budget: probe, every POST is a job-board status or list read, the
 *     fill curve is a GET, and every GET to an Oracle host follows a sleep of
 *     a second or more.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-board-reach.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_HELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_reach";
const FB = "https://p\\.supabase\\.co/functions/v1/job-board";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time"].includes(x))i++;
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
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;
const FAKE_SLEEP = `#!/bin/sh\nprintf 'sleep\\t%s\\n' "$1" >> "$VD_CALLS"\n`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdreach-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  writeFileSync(join(dir, "bin", "sleep"), FAKE_SLEEP);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  chmodSync(join(dir, "bin", "sleep"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${J_HELPER}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const WD = ["truist~wd1~careers", "geico~wd1~External", "wvumedicine~wd1~UHA", "wvumedicine~wd1~WVUH", "7eleven~wd3~7eleven"];
const OLL = "recruiting~OLL1000OLLIE~355913c1-206d-48a4-bb34-020064efe845";
const ORA: Record<string, string> = { "eluq~us2~CX_1": "Kroger", "egud~us2~CX_1": "AutoZone", "ejwl~us2~CX": "Marriott", "hcbt~em2~CX_1001": "Kotak" };
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Over = {
  build?: string | null; buildSince?: string | null; sliceBuild?: string; status?: string;
  wdTotal?: Record<string, number>; wdBody?: Record<string, string>; unknown?: string[];
  buckets?: Record<string, string | null>; curve?: string; floors?: Record<string, string | null>;
};
function routes(o: Over = {}): Route[] {
  const build = o.build === undefined ? "job-board.2026-09-09.100" : o.build;
  const since = o.buildSince === undefined ? ago(2) : o.buildSince;
  const status = o.status ?? JSON.stringify({ version: "2026-09-09.100", sliceStats: since === null ? {} : { build: o.sliceBuild ?? "2026-09-09.100", buildSince: since } });
  const bucket = (t: string) => (o.buckets && t in o.buckets ? o.buckets[t] : "lap_proven");
  const curve = o.curve ?? JSON.stringify([OLL, ...Object.keys(ORA)].filter((t) => bucket(t) !== null).map((t) => ({ company_token: t, observability_bucket: bucket(t), open_roles: 100 })));
  const out: Route[] = [
    { match: `^OPTIONS ${FB}$`, status: 204, headers: build ? { "x-fn-build": build } : {} },
    { match: `^POST ${FB}\\t\\{"action":"status"\\}`, body: status },
    { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/get_company_fill_curve\\?p_tokens=", body: curve },
  ];
  for (const t of WD) {
    const total = o.wdTotal?.[t] ?? 40;
    const body = o.wdBody?.[t] ?? JSON.stringify({ jobs: total ? [{ id: `workday:${t}:1` }] : [], total, hasMore: total > 1, ...(o.unknown?.includes(t) ? { unknownCompanies: [t] } : {}) });
    out.push({ match: `^POST ${FB}\\t\\{"action":"list","companies":\\["${esc(t)}"\\]`, body });
  }
  for (const t of Object.keys(ORA)) {
    const [a, r] = t.split("~");
    const floor = o.floors && t in o.floors ? o.floors[t] : day(45);
    const feed = floor === null ? { items: [{ TotalJobsCount: 0, requisitionList: [] }] } : { items: [{ TotalJobsCount: 11_267, requisitionList: [{ Id: "1", PostedDate: floor }] }] };
    out.push({ match: `^GET https://${esc(`${a}.fa.${r}.oraclecloud.com`)}/hcmRestApi/resources/latest/recruitingCEJobRequisitions\\?`, body: JSON.stringify(feed) });
  }
  return out;
}
const verdicts = (lines: string[], v: "PASS" | "FAIL" | "INFO") => lines.filter((l) => l.startsWith(`${v}  `));
const show = (lines: string[]) => lines.join("\n");
const hasLine = (lines: string[], v: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${v}  `) && re.test(l));

describe("section 99zzzz-board-reach: Workday first pages, UKG and Oracle laps", () => {
  it("a good deploy prints one PASS per claim and nothing else", () => {
    const { lines } = run(routes());
    expect(lines[0]).toMatch(/^== 99zzzz-board-reach\. /);
    expect(verdicts(lines, "FAIL"), show(lines)).toEqual([]);
    expect(verdicts(lines, "INFO"), show(lines)).toEqual([]);
    const pass = verdicts(lines, "PASS");
    for (const re of [/x-fn-build = job-board\.2026-09-09\.100/, ...WD.map((t) => new RegExp(`\\(${esc(t)}\\) serves 40 rows`)),
      /Ollie's Bargain Outlet \(UKG, over 600 postings\) has proven a lap/, ...Object.keys(ORA).map((t) => new RegExp(`\\(${esc(t)}, Oracle\\) has proven a lap at the 10,000 cap`))]) {
      expect(pass.some((l) => re.test(l)), `${re}\n${show(lines)}`).toBe(true);
    }
    expect(pass.length).toBe(11);
    expect(lines.every((l, i) => i === 0 || /^(PASS|FAIL|INFO) {2}/.test(l)), show(lines)).toBe(true);
  });

  it("an older build is one INFO and nothing else is asked; a preflight with no build is a FAIL", () => {
    const old = run(routes({ build: "job-board.2026-09-09.99" }));
    expect(old.lines.slice(1), show(old.lines)).toEqual([expect.stringMatching(/^INFO {2}job-board preflight x-fn-build = job-board\.2026-09-09\.99: .*not serving yet/)]);
    expect(old.calls.filter((c) => !/^curl\tOPTIONS /.test(c)), old.calls.join("\n")).toEqual([]);
    const none = run(routes({ build: null }));
    expect(hasLine(none.lines, "FAIL", /carries no x-fn-build/), show(none.lines)).toBe(true);
    expect(none.calls.filter((c) => !/^curl\tOPTIONS /.test(c))).toEqual([]);
    const later = run(routes({ build: "job-board.2026-11-04.1" }));
    expect(hasLine(later.lines, "PASS", /job-board\.2026-11-04\.1 \(job-board\.2026-09-09\.100 or later/), show(later.lines)).toBe(true);
  });

  it("a Workday board serving nothing waits 36 h from the first slice, then FAILs", () => {
    const zero = { "geico~wd1~External": 0, "7eleven~wd3~7eleven": 0 };
    const young = run(routes({ wdTotal: zero, buildSince: ago(20) }));
    expect(hasLine(young.lines, "INFO", /Geico \(geico~wd1~External\) serves 0 rows yet; the first slice of this build was 20\.\d h ago/), show(young.lines)).toBe(true);
    expect(verdicts(young.lines, "FAIL"), show(young.lines)).toEqual([]);
    const late = run(routes({ wdTotal: zero, buildSince: ago(40) }));
    expect(hasLine(late.lines, "FAIL", /Geico \(geico~wd1~External\) serves 0 rows 40\.\d h after the first slice/), show(late.lines)).toBe(true);
    expect(hasLine(late.lines, "FAIL", /7-Eleven \(7eleven~wd3~7eleven\) serves 0 rows 40\.\d h after/), show(late.lines)).toBe(true);
    expect(hasLine(late.lines, "PASS", /Truist \(truist~wd1~careers\) serves 40 rows/), show(late.lines)).toBe(true);
  });

  it("FAILs a Workday board the catalogue does not carry, and an unreadable list", () => {
    const { lines } = run(routes({ unknown: ["wvumedicine~wd1~UHA"], wdTotal: { "wvumedicine~wd1~UHA": 0 }, wdBody: { "truist~wd1~careers": "<html>gateway</html>" } }));
    expect(hasLine(lines, "FAIL", /does NOT carry WVU Medicine UHA \(wvumedicine~wd1~UHA\)/), show(lines)).toBe(true);
    expect(hasLine(lines, "FAIL", /list for truist~wd1~careers is unreadable: <html>gateway/), show(lines)).toBe(true);
  });

  it("Ollie's without a proven lap waits 5 days from the first slice, then FAILs", () => {
    const young = run(routes({ buckets: { [OLL]: "lap_pending" }, buildSince: ago(100) }));
    expect(hasLine(young.lines, "INFO", /Ollie's Bargain Outlet \(UKG\) reads bucket lap_pending; the first slice of this build was 100\.\d h ago/), show(young.lines)).toBe(true);
    expect(verdicts(young.lines, "FAIL"), show(young.lines)).toEqual([]);
    for (const b of ["unprovable", "lap_pending", null]) {
      const late = run(routes({ buckets: { [OLL]: b }, buildSince: ago(130) }));
      expect(hasLine(late.lines, "FAIL", new RegExp(`Ollie's Bargain Outlet \\(UKG\\) still reads bucket ${b} 130\\.\\d h after`)), show(late.lines)).toBe(true);
    }
  });

  it("an Oracle tenant without a proven lap FAILs after 7 days only when its own row 9,999 is older than the fence", () => {
    const pend = { buckets: { "eluq~us2~CX_1": "lap_pending", "hcbt~em2~CX_1001": "lap_pending", "ejwl~us2~CX": "lap_pending" } };
    const young = run(routes({ ...pend, buildSince: ago(100) }));
    expect(hasLine(young.lines, "INFO", /Kroger \(eluq~us2~CX_1\) reads bucket lap_pending; its own row 9,999 is posted .* \(FAIL after 7 days/), show(young.lines)).toBe(true);
    expect(verdicts(young.lines, "FAIL"), show(young.lines)).toEqual([]);
    const late = run(routes({ ...pend, buildSince: ago(200), floors: { "hcbt~em2~CX_1001": day(20), "ejwl~us2~CX": null } }));
    expect(hasLine(late.lines, "FAIL", new RegExp(`Kroger \\(eluq~us2~CX_1\\) still reads bucket lap_pending 200\\.\\d h after .*row 9,999 is posted ${day(45)}.*older than the fence`)), show(late.lines)).toBe(true);
    expect(hasLine(late.lines, "INFO", new RegExp(`Kotak \\(hcbt~em2~CX_1001\\) reads bucket lap_pending: its own row 9,999 is posted ${day(20)} .*inside the 30-day fence`)), show(late.lines)).toBe(true);
    expect(hasLine(late.lines, "INFO", /Marriott \(ejwl~us2~CX\) reads bucket lap_pending, and its own feed served no row 9,999 .*not judged/), show(late.lines)).toBe(true);
    expect(hasLine(late.lines, "PASS", /AutoZone \(egud~us2~CX_1, Oracle\) has proven a lap/), show(late.lines)).toBe(true);
    expect(verdicts(late.lines, "FAIL").length, show(late.lines)).toBe(1);
  });

  it("never dates this build by slice stats an older build wrote", () => {
    const { lines } = run(routes({ wdTotal: { "geico~wd1~External": 0 }, buckets: { [OLL]: "unprovable", "eluq~us2~CX_1": "lap_pending" }, sliceBuild: "2026-09-09.99", buildSince: ago(400) }));
    expect(verdicts(lines, "FAIL"), show(lines)).toEqual([]);
    expect(hasLine(lines, "INFO", /sliceStats\.build is 2026-09-09\.99, not the serving 2026-09-09\.100: no slice of this build has run yet/), show(lines)).toBe(true);
  });

  it("FAILs a status with no buildSince and an unreadable fill curve, never crashing into silence", () => {
    const blind = run(routes({ buildSince: null }));
    expect(hasLine(blind.lines, "FAIL", /states no sliceStats\.buildSince/), show(blind.lines)).toBe(true);
    const garbled = run(routes({ status: "<html>502</html>", curve: "<html>gateway</html>" }));
    expect(hasLine(garbled.lines, "FAIL", /states no sliceStats\.buildSince \(with sliceStats\.build\), so nothing dates this build: <html>502/), show(garbled.lines)).toBe(true);
    expect(hasLine(garbled.lines, "FAIL", /fill-curve read is unreadable: <html>gateway/), show(garbled.lines)).toBe(true);
  });

  it("never prints the key, POSTs only job-board reads with x-rb-budget: probe, reads the fill curve with a GET, and paces the Oracle hosts", () => {
    const { out, calls } = run(routes());
    expect(out).not.toContain(KEY);
    const board = calls.filter((c) => /functions\/v1\/job-board/.test(c));
    expect(board.length).toBe(7);
    for (const c of board) expect(c, c).toMatch(/headers:.*x-rb-budget: probe/);
    const posts = calls.filter((c) => /^curl\tPOST /.test(c));
    expect(posts.length).toBe(6);
    for (const p of posts) expect(p, p).toMatch(new RegExp(`^curl\\tPOST ${FB}\\t\\{"action":"(list|status)"`));
    expect(calls.some((c) => /^curl\tGET https:\/\/p\.supabase\.co\/rest\/v1\/rpc\/get_company_fill_curve\?/.test(c))).toBe(true);
    const seq = calls.filter((c) => /^sleep\t/.test(c) || /^curl\tGET https:\/\/[a-z0-9]+\.fa\.[a-z0-9]+\.oraclecloud\.com\//.test(c));
    const vendorAt = seq.map((c, i) => (/^sleep/.test(c) ? -1 : i)).filter((i) => i >= 0);
    expect(vendorAt.length, seq.join("\n")).toBe(4);
    for (const i of vendorAt) {
      expect(seq[i - 1], seq.join("\n")).toMatch(/^sleep\t/);
      expect(Number(seq[i - 1].split("\t")[1]), seq.join("\n")).toBeGreaterThanOrEqual(1);
    }
    for (const c of calls.filter((x) => /oraclecloud\.com/.test(x))) expect(c, c).toMatch(/limit%3D1%2Coffset%3D9999%2CsortBy%3DPOSTING_DATES_DESC/);
  });
});
