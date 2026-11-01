// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzz CAN FAIL EVERY CLAIM IT MAKES (the free-scan wave,
 * engine half).
 *
 * scripts/verify-deploy.d/99zzzz-free-scan-wave-engine.sh is the post-deploy
 * proof of the wave's three function builds and its two migrations. A PASS is
 * worth something only if a regression could have turned it into a FAIL
 * (verify-deploy.d/README.md), so the section runs here against a fake curl:
 *   - a good deploy prints PASS for every claim and no FAIL;
 *   - an older build, a benchmark without its scorer or exclusion counts, a
 *     software_engineering industry, a level correction still refused (42501)
 *     or reaching a write before refusing (25006), a table RLS alone holds,
 *     a census with an uncallable allowlisted function, and a gateway's HTML
 *     page each print FAIL, never a crash into silence;
 *   - log_seniority_correction goes out only as a GET, and the publishable
 *     key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-free-scan-wave-engine.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const R_HELPER = /^R\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_fse";
const P = "https://p\\.supabase\\.co";

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

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdfse-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${R_HELPER}\n`;
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

type Over = {
  builds?: Record<string, string | null>; insights?: string; seniority?: { status: number; body: string }; table?: { status: number; body: string }; census?: string;
};
const GOOD_INSIGHTS = { scorer: "primary", excluded: { fallback_scanner: 45, rule_based_report: 12 }, overall: { n: 80 }, industries: [{ industry: "technology", n: 50 }, { industry: "healthcare", n: 30 }] };
const DENIED = JSON.stringify({ code: "42501", message: "permission denied for table seniority_corrections" });
function routes(o: Over = {}): Route[] {
  const builds: Record<string, string | null> = {
    "free-keyword-scan": "free-keyword-scan.2026-11-01.1", "free-keyword-scan-stream": "free-keyword-scan-stream.2026-11-01.1", "parse-docx": "parse-docx.2026-11-01.1", ...o.builds,
  };
  return [
    ...Object.entries(builds).map(([fn, b]) => ({ match: `^OPTIONS ${P}/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} })),
    { match: `^POST ${P}/rest/v1/rpc/get_public_scan_insights\\t`, body: o.insights ?? JSON.stringify(GOOD_INSIGHTS) },
    { match: `^GET ${P}/rest/v1/rpc/log_seniority_correction\\?`, status: o.seniority?.status ?? 200, body: o.seniority?.body ?? "false" },
    { match: `^GET ${P}/rest/v1/seniority_corrections\\?`, status: o.table?.status ?? 401, body: o.table?.body ?? DENIED },
    { match: `^POST ${P}/rest/v1/rpc/client_callable_census\\t`, body: o.census ?? JSON.stringify({ allowlisted: 81, allowlisted_not_callable: [], closed_tables_still_open: [], closed: 56 }) },
  ];
}
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");

describe("a good deploy", () => {
  const { lines, calls, out } = run(routes());
  it("prints PASS for every claim and no FAIL", () => {
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
    for (const fn of ["free-keyword-scan", "free-keyword-scan-stream", "parse-docx"]) {
      expect(has(lines, "PASS", new RegExp(`^PASS {2}${fn} preflight x-fn-build = ${fn}\\.2026-11-01\\.1`)), show(lines)).toBe(true);
    }
    expect(has(lines, "PASS", /score benchmark is the primary scanner's/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /lists technology once/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /log_seniority_correction answers the publishable key/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /seniority_corrections refuses anon by name/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /the census: 81 allowlisted/), show(lines)).toBe(true);
  });
  it("every line is a verdict, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
  it("the level correction goes out only as a read-only GET, and no other writer is asked", () => {
    const lsc = calls.filter((c) => /log_seniority_correction/.test(c));
    expect(lsc.length).toBe(1);
    expect(lsc[0]).toMatch(/^curl\tGET /);
    expect(calls.filter((c) => /^curl\tPOST /.test(c)).map((c) => /rpc\/(\w+)/.exec(c)?.[1]).sort()).toEqual(["client_callable_census", "get_public_scan_insights"]);
  });
});

describe("each regression prints FAIL", () => {
  it("an older build, or none", () => {
    const { lines } = run(routes({ builds: { "free-keyword-scan": "free-keyword-scan.2026-10-31.1", "parse-docx": null } }));
    expect(has(lines, "FAIL", /^FAIL {2}free-keyword-scan preflight x-fn-build = free-keyword-scan\.2026-10-31\.1 \(want/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /^FAIL {2}parse-docx preflight carries no x-fn-build/), show(lines)).toBe(true);
  });
  it("a benchmark from before 20261101100000: no scorer, no exclusion counts, software_engineering beside technology", () => {
    const { lines } = run(routes({ insights: JSON.stringify({ overall: { n: 137 }, industries: [{ industry: "technology" }, { industry: "software_engineering" }] }) }));
    expect(has(lines, "FAIL", /score benchmark is the primary scanner's/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /software_engineering/), show(lines)).toBe(true);
  });
  it("a benchmark with no industry yet is INFO, not a PASS over nothing", () => {
    const { lines } = run(routes({ insights: JSON.stringify({ ...GOOD_INSIGHTS, industries: [] }) }));
    expect(has(lines, "INFO", /publishes no industry yet/), show(lines)).toBe(true);
  });
  it("the level correction still refused, or reaching a write before it refuses", () => {
    const closed = run(routes({ seniority: { status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for function log_seniority_correction" }) } }));
    expect(has(closed.lines, "FAIL", /42501: 20261101110000 has not applied/), show(closed.lines)).toBe(true);
    const writes = run(routes({ seniority: { status: 500, body: JSON.stringify({ code: "25006", message: "cannot execute INSERT in a read-only transaction" }) } }));
    expect(has(writes.lines, "FAIL", /validation does not run first/), show(writes.lines)).toBe(true);
    const accepts = run(routes({ seniority: { status: 200, body: "true" } }));
    expect(has(accepts.lines, "FAIL", /accepted mid -> mid/), show(accepts.lines)).toBe(true);
  });
  it("a table RLS alone holds", () => {
    const { lines } = run(routes({ table: { status: 200, body: "[]" } }));
    expect(has(lines, "FAIL", /RLS alone holds it/), show(lines)).toBe(true);
  });
  it("a census with an allowlisted function anon cannot call", () => {
    const { lines } = run(routes({ census: JSON.stringify({ allowlisted: 81, allowlisted_not_callable: ["public.log_seniority_correction(text,text,text,text,integer,text)"], closed_tables_still_open: [] }) }));
    expect(has(lines, "FAIL", /the census: 81 allowlisted; uncallable \["public\.log_seniority_correction/), show(lines)).toBe(true);
  });
  it("a gateway's HTML page in place of every answer prints FAILs, never a crash", () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    const { lines } = run(routes({ insights: html, census: html, seniority: { status: 502, body: html }, table: { status: 502, body: html } }));
    expect(lines.filter((l) => l.startsWith("FAIL")).length, show(lines)).toBeGreaterThanOrEqual(4);
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l)), show(lines)).toBe(true);
  });
});
