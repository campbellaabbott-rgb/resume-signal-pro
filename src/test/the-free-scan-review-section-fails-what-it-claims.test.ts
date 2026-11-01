// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzz-free-scan-wave-review CAN FAIL EVERY CLAIM IT MAKES
 * (the free-scan wave's review round, 2026-11-01).
 *
 * A PASS is worth something only if a regression could have turned it into
 * a FAIL (verify-deploy.d/README.md). The section runs here against a fake
 * curl serving the real en.json as the English chunk:
 *   - a good deploy prints PASS for every claim and no FAIL;
 *   - an older bundle, a bundle whose layout moved, a benchmark page that
 *     still says "completed scans", a page baked before the migration while
 *     the RPC names its scorer, a page naming a scorer the RPC does not, and
 *     a gateway's HTML page each print FAIL, never a crash into silence;
 *   - every call is a GET but the one aggregate RPC read, and the publishable
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
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-free-scan-wave-review.sh"), "utf8");
const R_HELPER = /^R\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const EN = readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8");
const KEY = "pk_test_SECRET_marker_fsr";
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
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
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
  const dir = mkdtempSync(join(tmpdir(), "vdfsr-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${R_HELPER}\n`;
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

const BASIS = "Every figure is scored by our primary scanner. Left out: 45 scans the fallback scanner answered and 12 reports our rules wrote when the AI could not.";
const page = (subline: string, count = "412 scans logged") =>
  `<!doctype html><html><head><title>ATS score benchmarks</title></head><body>${"<p>filler</p>".repeat(60)}<p>${count}</p><p class="text-xs">Computed live from our scan corpus${subline}</p></body></html>`;
const GOOD_PAGE = page(`<span class="block mt-1">${BASIS}</span>`);
const PRIMARY = JSON.stringify({ scorer: "primary", excluded: { fallback_scanner: 45, rule_based_report: 12 }, overall: { n: 412 } });
const BLENDED = JSON.stringify({ overall: { n: 412 } });

type Over = { chunk?: string; entry?: string; study?: string; insights?: string };
function routes(o: Over = {}): Route[] {
  return [
    { match: `^GET ${S}/$`, body: '<html><script type="module" src="/assets/index-abc123.js"></script></html>' },
    { match: `^GET ${S}/assets/index-abc123\\.js$`, body: o.entry ?? 'import("./rb-en_all-xyz789.js");import("./en-GB-qq11.js");' },
    { match: `^GET ${S}/assets/rb-en_all-xyz789\\.js$`, body: o.chunk ?? `export default ${EN};` },
    { match: `^GET ${S}/assets/en-GB-qq11\\.js$`, body: `export default ${EN};` },
    { match: `^GET ${S}/research/ats-score-benchmarks$`, body: o.study ?? GOOD_PAGE },
    { match: `^POST ${P}/rest/v1/rpc/get_public_scan_insights\\t`, body: o.insights ?? PRIMARY },
  ];
}
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");

describe("a good deploy", () => {
  const { lines, calls, out } = run(routes());
  it("prints PASS for every claim and no FAIL", () => {
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
    expect(has(lines, "PASS", /^PASS {2}FR1 the English strings \(rb-en_all-xyz789\.js\) carry/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /FR2 the crawler benchmark page counts scans logged and never says completed scans/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /FR2 the RPC answers scorer primary and the baked subline names the primary scanner/), show(lines)).toBe(true);
  });
  it("every line is a verdict, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
  it("every call is a GET but the one aggregate read, and the British chunk is never read", () => {
    expect(calls.filter((c) => !/^curl\tGET /.test(c)).map((c) => /rpc\/(\w+)/.exec(c)?.[1])).toEqual(["get_public_scan_insights"]);
    expect(calls.some((c) => /en-GB-/.test(c))).toBe(false);
  });
});

describe("each regression prints FAIL", () => {
  it("a bundle published before the review round: every missing string is named", () => {
    const old = JSON.parse(EN);
    delete old.freeResults.builderHandoff;
    delete old.uploader.scanFooterPro;
    delete old.homepage.toast.resumeTooLongDescription;
    delete old.uploader.resume.tooLong;
    delete old.freeResults.scoreSimulator.noGainCeiling;
    old.freeResults.languageNotice.body = "Its keyword and section checks are built for English, Spanish, French.";
    const { lines } = run(routes({ chunk: `export default ${JSON.stringify(old)};` }));
    const fail = lines.find((l) => l.startsWith("FAIL  FR1")) ?? "";
    expect(fail, show(lines)).toMatch(/S13-038 no-rewrite hand-off, S13-094 Pro footer, S13-008 too-long refusal, S13-058 simulator cap line, S13-024 language banner/);
  });
  it("a bundle whose layout moved is a FAIL that says so, never a pass over nothing", () => {
    const { lines } = run(routes({ entry: 'import("./en-GB-qq11.js");' }));
    expect(has(lines, "FAIL", /FR1 no English chunk the entry \/assets\/index-abc123\.js names holds resumeBuilder's strings/), show(lines)).toBe(true);
  });
  it("a benchmark page that still says completed scans", () => {
    const { lines } = run(routes({ study: page(`<span class="block mt-1">${BASIS}</span>`, "412 completed scans") }));
    expect(has(lines, "FAIL", /FR2 the crawler benchmark page never says scans logged and still says completed scans/), show(lines)).toBe(true);
  });
  it("a page baked before the migration while the RPC names its scorer", () => {
    const { lines } = run(routes({ study: page("") }));
    expect(has(lines, "FAIL", /published before 20261101100000 applied; publish the frontend again/), show(lines)).toBe(true);
  });
  it("before the migration: no scorer named is INFO, a scorer named is FAIL", () => {
    const before = run(routes({ study: page(""), insights: BLENDED }));
    expect(has(before.lines, "INFO", /does not answer scorer primary yet/), show(before.lines)).toBe(true);
    expect(before.lines.filter((l) => l.startsWith("FAIL")), show(before.lines)).toEqual([]);
    const claims = run(routes({ insights: BLENDED }));
    expect(has(claims.lines, "FAIL", /names the primary scanner while get_public_scan_insights answers no scorer/), show(claims.lines)).toBe(true);
  });
  it("a gateway's HTML page in place of every answer prints FAILs, never a crash", () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    const { lines } = run([{ match: ".", status: 502, body: html }]);
    expect(lines.filter((l) => l.startsWith("FAIL")).length, show(lines)).toBeGreaterThanOrEqual(2);
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l)), show(lines)).toBe(true);
  });
});
