// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl and a fake sleep on PATH, through child_process.
/**
 * VERIFY SECTION 99z CAN FAIL EVERY CLAIM IT MAKES, AND WAITS FOR ITS BUILD.
 *
 * scripts/verify-deploy.d/99z-oracle-regionless.sh is the post-deploy proof
 * that job-board 2026-09-09.95 reads JPMorgan Chase's region-less Oracle host
 * and still reads the regional ones. A PASS is worth something only if a
 * regression could have turned it into a FAIL (verify-deploy.d/README.md).
 * The section runs here against a fake curl that answers from routes
 * (matched on method, URL and body) and logs every call:
 *   - a good deploy prints only PASS lines, one per claim;
 *   - an older build prints one INFO and asks nothing else; a preflight with
 *     no build is a FAIL;
 *   - an uncarried token, a proven read serving far from the employer's own
 *     count, an apply link on another host, an apply page that does not
 *     answer, a requisition the employer's detail endpoint does not list, an
 *     empty description, a regional control that serves nothing, on the wrong
 *     host or unread for days, and an unreadable list each print FAIL;
 *   - a count before the first full read is proven is INFO, and so is a board
 *     not read yet;
 *   - the publishable key is never printed, every POST is a job-board list or
 *     detail read carrying x-rb-budget: probe, the fill-curve read is a GET,
 *     and every GET to JPMorgan's host is paced by a sleep of a second or more.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99z-oracle-regionless.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_HELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_99z";
const FB = "https://p\\.supabase\\.co/functions/v1/job-board";
const JPMC = "https://jpmc\\.fa\\.oraclecloud\\.com";

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
  const dir = mkdtempSync(join(tmpdir(), "vd99z-"));
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

const TOK = "jpmc~~CX_1001";
const NOW = new Date().toISOString();
const jpmcJob = (id: string, over: Record<string, unknown> = {}) => ({
  id: `oracle:${TOK}:${id}`, source: "oracle", token: TOK, company: "JPMorgan Chase", title: "Software Engineer",
  applyUrl: `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${id}`, lastSeen: NOW, ...over,
});
const ctlJob = (id: string, over: Record<string, unknown> = {}) => ({
  id: `oracle:efet~us2~CX_1:${id}`, source: "oracle", token: "efet~us2~CX_1", company: "Hilton", title: "Front Desk Agent",
  applyUrl: `https://efet.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/${id}`, lastSeen: NOW, ...over,
});
type Over = {
  build?: string | null; list?: string; served?: number; jobs?: unknown[]; unknown?: boolean; bucket?: string | null;
  inWindow?: number | null; ctl?: string; ctlTotal?: number; ctlJobs?: unknown[]; applyStatus?: number; reqItems?: number; description?: string;
};
function routes(o: Over = {}): Route[] {
  const build = o.build === undefined ? "job-board.2026-09-09.95" : o.build;
  const list = o.list ?? JSON.stringify({
    jobs: o.jobs ?? [jpmcJob("210587260"), jpmcJob("210588623")], total: o.served ?? 3700, hasMore: true,
    ...(o.unknown ? { unknownCompanies: [TOK] } : {}),
  });
  const curve = JSON.stringify(o.bucket === null ? [] : [{ company_token: TOK, observability_bucket: o.bucket ?? "lap_proven", open_roles: o.served ?? 3700 }]);
  const feed = JSON.stringify({ items: [{ TotalJobsCount: 7244, postingDatesFacet: o.inWindow === null ? [] : [{ Id: 7, TotalCount: 1283 }, { Id: 30, TotalCount: o.inWindow ?? 3728 }, { Id: 31, TotalCount: 3516 }], requisitionList: [{ Id: "210587260" }] }] });
  const ctl = o.ctl ?? JSON.stringify({ jobs: o.ctlJobs ?? [ctlJob("1"), ctlJob("2")], total: o.ctlTotal ?? 2802, hasMore: true });
  return [
    { match: `^OPTIONS ${FB}$`, status: 204, headers: build ? { "x-fn-build": build } : {} },
    { match: `^POST ${FB}\\t.*"action":"list".*"jpmc~~CX_1001"`, body: list },
    { match: `^POST ${FB}\\t.*"action":"list".*"efet~us2~CX_1"`, body: ctl },
    { match: `^POST ${FB}\\t.*"action":"detail"`, body: JSON.stringify({ job: jpmcJob("210587260"), description: o.description ?? "Builds trading systems. ".repeat(40) }) },
    { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/get_company_fill_curve\\?p_tokens=", body: curve },
    { match: `^GET ${JPMC}/hcmRestApi/resources/latest/recruitingCEJobRequisitions\\?`, body: feed },
    { match: `^GET ${JPMC}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails\\?`, body: JSON.stringify({ items: Array.from({ length: o.reqItems ?? 1 }, () => ({ Id: "210587260" })) }) },
    { match: `^GET ${JPMC}/hcmUI/CandidateExperience/`, status: o.applyStatus ?? 200, body: "<html></html>" },
  ];
}
const verdicts = (lines: string[], v: "PASS" | "FAIL" | "INFO") => lines.filter((l) => l.startsWith(`${v}  `));
const show = (lines: string[]) => lines.join("\n");
const hasLine = (lines: string[], v: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${v}  `) && re.test(l));

describe("section 99z: Oracle hosts with no region", () => {
  it("a good deploy prints one PASS per claim and nothing else", () => {
    const { lines } = run(routes());
    expect(verdicts(lines, "FAIL"), show(lines)).toEqual([]);
    expect(verdicts(lines, "INFO"), show(lines)).toEqual([]);
    const pass = verdicts(lines, "PASS");
    for (const re of [/x-fn-build = job-board\.2026-09-09\.95/, /carries jpmc~~CX_1001/, /serves 3700 rows against 3728/, /apply link is on jpmc\.fa\.oraclecloud\.com/,
      /answers 200/, /requisition 210587260 answers on the employer detail endpoint with 1 item/, /-character description/, /control efet~us2~CX_1 serves 2802/, /last read 0\.\d h ago/]) {
      expect(pass.some((l) => re.test(l)), `${re}\n${show(lines)}`).toBe(true);
    }
    expect(pass.length).toBe(9);
    expect(lines[0]).toMatch(/^== 99z\. /);
  });

  it("an older build is one INFO and nothing else is asked; a preflight with no build is a FAIL", () => {
    const old = run(routes({ build: "job-board.2026-09-09.93" }));
    expect(old.lines.slice(1), show(old.lines)).toEqual([expect.stringMatching(/^INFO {2}job-board preflight x-fn-build = job-board\.2026-09-09\.93: .*not serving yet/)]);
    expect(old.calls.filter((c) => !/^curl\tOPTIONS /.test(c)), old.calls.join("\n")).toEqual([]);
    const none = run(routes({ build: null }));
    expect(hasLine(none.lines, "FAIL", /carries no x-fn-build/), show(none.lines)).toBe(true);
    expect(none.calls.filter((c) => !/^curl\tOPTIONS /.test(c))).toEqual([]);
    const later = run(routes({ build: "job-board.2026-10-30.1" }));
    expect(hasLine(later.lines, "PASS", /job-board\.2026-10-30\.1 \(job-board\.2026-09-09\.95 or later/), show(later.lines)).toBe(true);
  });

  it("FAILs a catalogue that does not carry the token", () => {
    const { lines } = run(routes({ unknown: true, served: 0, jobs: [] }));
    expect(hasLine(lines, "FAIL", /does NOT carry jpmc~~CX_1001/), show(lines)).toBe(true);
  });

  it("judges the count only once the first full read is proven, and FAILs a proven read far from the employer's own count", () => {
    const far = run(routes({ served: 2000 }));
    expect(hasLine(far.lines, "FAIL", /serves 2000 rows against 3728 .*ratio 0\.536/), show(far.lines)).toBe(true);
    const over = run(routes({ served: 4200, bucket: "full_read" }));
    expect(hasLine(over.lines, "FAIL", /serves 4200 rows against 3728/), show(over.lines)).toBe(true);
    const pending = run(routes({ served: 2000, bucket: "lap_pending" }));
    expect(hasLine(pending.lines, "INFO", /serves 2000 rows .*first full read is not proven/), show(pending.lines)).toBe(true);
    expect(verdicts(pending.lines, "FAIL"), show(pending.lines)).toEqual([]);
    const fresh = run(routes({ served: 0, jobs: [], bucket: null }));
    expect(hasLine(fresh.lines, "INFO", /serves 0 rows .*re-run later/), show(fresh.lines)).toBe(true);
    expect(hasLine(fresh.lines, "INFO", /no JPMorgan row with an apply link/), show(fresh.lines)).toBe(true);
    expect(verdicts(fresh.lines, "FAIL"), show(fresh.lines)).toEqual([]);
    const nofacet = run(routes({ inWindow: null }));
    expect(hasLine(nofacet.lines, "INFO", /did not state a less-than-30-days count/), show(nofacet.lines)).toBe(true);
  });

  it("FAILs an apply link on another host, and then asks that host nothing", () => {
    const { lines, calls } = run(routes({ jobs: [jpmcJob("1", { applyUrl: "https://jpmc.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/1" })] }));
    expect(hasLine(lines, "FAIL", /apply link is on jpmc\.fa\.us2\.oraclecloud\.com \(want jpmc\.fa\.oraclecloud\.com\)/), show(lines)).toBe(true);
    expect(calls.filter((c) => /CandidateExperience|RequisitionDetails|"action":"detail"/.test(c))).toEqual([]);
  });

  it("FAILs an apply page that does not answer, a requisition the employer does not list, and an empty description", () => {
    expect(hasLine(run(routes({ applyStatus: 404 })).lines, "FAIL", /apply link answers HTTP 404/)).toBe(true);
    expect(hasLine(run(routes({ reqItems: 0 })).lines, "FAIL", /requisition 210587260 answers on the employer detail endpoint with 0 item/)).toBe(true);
    expect(hasLine(run(routes({ description: "" })).lines, "FAIL", /reads a 0-character description/)).toBe(true);
  });

  it("FAILs a regional control that serves nothing, sits on the wrong host, or was not read for days", () => {
    expect(hasLine(run(routes({ ctlTotal: 0, ctlJobs: [] })).lines, "FAIL", /control efet~us2~CX_1 serves 0 rows/)).toBe(true);
    expect(hasLine(run(routes({ ctlJobs: [ctlJob("1", { applyUrl: "https://efet.fa.oraclecloud.com/hcmUI/x/job/1" })] })).lines, "FAIL", /apply links on \["efet\.fa\.oraclecloud\.com"\]/)).toBe(true);
    const stale = new Date(Date.now() - 72 * 3_600_000).toISOString();
    expect(hasLine(run(routes({ ctlJobs: [ctlJob("1", { lastSeen: stale })] })).lines, "FAIL", /last read 72\.\d h ago/)).toBe(true);
  });

  it("FAILs an unreadable list, never crashing into silence", () => {
    const { lines } = run(routes({ list: "<html>gateway</html>", ctl: "<html>gateway</html>" }));
    expect(hasLine(lines, "FAIL", /list for jpmc~~CX_1001 is unreadable: <html>gateway/), show(lines)).toBe(true);
    expect(hasLine(lines, "FAIL", /list for the regional control efet~us2~CX_1 is unreadable/), show(lines)).toBe(true);
  });

  it("never prints the key, POSTs only job-board reads with x-rb-budget: probe, reads the fill curve with a GET, and paces JPMorgan's host", () => {
    const { out, calls } = run(routes());
    expect(out).not.toContain(KEY);
    const posts = calls.filter((c) => /^curl\tPOST /.test(c));
    expect(posts.length).toBe(3);
    for (const p of posts) {
      expect(p, p).toMatch(new RegExp(`^curl\\tPOST ${FB}\\t\\{"action":"(list|detail)"`));
      expect(p, p).toMatch(/headers:.*x-rb-budget: probe/);
    }
    expect(calls.some((c) => /^curl\tGET https:\/\/p\.supabase\.co\/rest\/v1\/rpc\/get_company_fill_curve\?/.test(c))).toBe(true);
    // Every GET to JPMorgan's host after the first follows a sleep of at least a second.
    const seq = calls.filter((c) => /^sleep\t/.test(c) || /^curl\tGET https:\/\/jpmc\.fa\.oraclecloud\.com\//.test(c) || /"action":"detail"/.test(c));
    const vendorAt = seq.map((c, i) => (/^sleep/.test(c) ? -1 : i)).filter((i) => i >= 0);
    expect(vendorAt.length, seq.join("\n")).toBe(4);
    for (const i of vendorAt.slice(1)) {
      expect(seq[i - 1], seq.join("\n")).toMatch(/^sleep\t/);
      expect(Number(seq[i - 1].split("\t")[1]), seq.join("\n")).toBeGreaterThanOrEqual(1);
    }
  });
});
