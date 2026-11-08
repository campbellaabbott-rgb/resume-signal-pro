// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzz-hotfix-privacy CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzz-hotfix-privacy.sh judges H6 (the published
 * referral hook), H7 (the published stylesheet), M-S14-064 (the backup
 * scanner's build) and M-S14-040 (the rollup's new columns, and the prune
 * still closed). Run here against a fake curl:
 *   - production as it is today (the old hook, the old stylesheet, the
 *     2026-11-03.1 stream, no new columns) prints INFO and no FAIL;
 *   - a good deploy prints PASS for every claim and no FAIL;
 *   - each regression prints FAIL: the held line beside the old store, a
 *     stylesheet without the rule once the hook is live, a stream older than
 *     2026-11-10.1 once the migration landed, no build header, columns still
 *     missing on 1 December, a column set applied in part, a readable rollup,
 *     a callable prune, and pages that cannot be read;
 *   - every request is a GET or an OPTIONS, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-hotfix-privacy.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const PROBE = /^probe\(\) \{[\s\S]*?esac; \}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_hpv";
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

function run(routes: Route[], today = "2026-11-10"): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdhpv-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${PROBE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDPV_TODAY: today,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// The referral hook as production serves it today (2026-11-08, use-affiliate-auth-BWXOUY9w.js) ...
const OLD_HOOK = 'import{r as i,s as p}from"./index-A1.js";const c="affiliate_ref",_=30;function T(){i.useEffect(()=>{const t=new URLSearchParams(window.location.search).get("ref");if(t){const o=Date.now()+_*24*60*60*1e3,r=JSON.stringify({code:t,expires:o});localStorage.setItem(c,r),E(c,r,_),(async()=>{try{await p.rpc("track_affiliate_click",{p_referral_code:t})}catch{console.debug("Affiliate click tracking failed")}})()}},[])}export{T as u};';
// ... and as this branch builds it (vite build, 2026-11-08).
const NEW_HOOK = 'import{r as i,s as w,ak as x,aw as A}from"./index-B2.js";const c="affiliate_ref",b=30;let d=null,p=!1;function N(e){const t=Date.now()+b*24*60*60*1e3,a=JSON.stringify({code:e,expires:t});try{localStorage.setItem(c,a)}catch{}(async()=>{try{await w.rpc("track_affiliate_click",{p_referral_code:e})}catch{}})()}function y(){p&&(p=!1,window.removeEventListener(A,E))}function E(){if(!d){y();return}if(!x()){p||(p=!0,window.addEventListener(A,E),console.debug("Affiliate referral held until analytics are allowed"));return}const e=d;d=null,y(),N(e)}function J(){i.useEffect(()=>{const t=new URLSearchParams(window.location.search).get("ref");t&&(d=t,E())},[])}export{J as u};';
const OLD_CSS = ".x{color:red}body[data-scroll-locked] [data-floating-help]{display:none!important}.y{margin:0}";
const NEW_CSS = ".x{color:red}body[data-scroll-locked] [data-floating-help],body[data-scroll-locked] [data-consent-banner]{display:none!important}.y{margin:0}";
const DENIED = (t: string) => JSON.stringify({ code: "42501", message: `permission denied for table ${t}` });
const MISSING = (c: string) => JSON.stringify({ code: "42703", message: `column layoff_filing_rollup.${c} does not exist` });
const COLS = ["superseded_n", "amendment_n", "rescinded_n", "non_workforce_n"];

type Over = {
  home?: string; entry?: string; hook?: string; css?: string; build?: string | null;
  cols?: Record<string, { status: number; body: string }>; control?: { status: number; body: string }; prune?: { status: number; body: string };
};
function routes(o: Over = {}, deployed = true): Route[] {
  const cols: Record<string, { status: number; body: string }> = Object.fromEntries(COLS.map((c) => [c, deployed ? { status: 401, body: DENIED("layoff_filing_rollup") } : { status: 400, body: MISSING(c) }]));
  Object.assign(cols, o.cols);
  const build = o.build === undefined ? (deployed ? "free-keyword-scan-stream.2026-11-10.1" : "free-keyword-scan-stream.2026-11-03.1") : o.build;
  return [
    { match: `^GET ${S}/$`, body: o.home ?? '<html><head><script type="module" src="/assets/index-A1.js"></script><link rel="stylesheet" href="/assets/index-C3.css"></head></html>' },
    { match: `^GET ${S}/assets/index-A1\\.js$`, body: o.entry ?? 'const m=["assets/Index-Q.js","assets/use-affiliate-auth-H6.js"];' },
    { match: `^GET ${S}/assets/use-affiliate-auth-H6\\.js$`, body: o.hook ?? (deployed ? NEW_HOOK : OLD_HOOK) },
    { match: `^GET ${S}/assets/index-C3\\.css$`, body: o.css ?? (deployed ? NEW_CSS : OLD_CSS) },
    { match: `^GET ${P}/rest/v1/layoff_filing_rollup\\?select=filings&`, status: o.control?.status ?? 401, body: o.control?.body ?? DENIED("layoff_filing_rollup") },
    ...COLS.map((c) => ({ match: `^GET ${P}/rest/v1/layoff_filing_rollup\\?select=${c}&`, status: cols[c].status, body: cols[c].body })),
    { match: `^OPTIONS ${P}/functions/v1/free-keyword-scan-stream$`, headers: build ? { "x-fn-build": build } : {} },
    { match: `^GET ${P}/rest/v1/rpc/roll_up_and_prune_layoff_filings\\?p_keep_days=365$`, status: o.prune?.status ?? 401, body: o.prune?.body ?? JSON.stringify({ code: "42501", message: "permission denied for function roll_up_and_prune_layoff_filings" }) },
  ];
}
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("today's production, before the merge and the paste", () => {
  const { lines, out } = run(routes({}, false));
  it("prints no FAIL: every claim not yet shipped is INFO, and the regression guard passes", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of ["P1", "P2", "M1", "F1"]) expect(has(lines, "INFO", new RegExp(`^INFO {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
    expect(has(lines, "PASS", /^PASS {2}M2 .*42501/), show(lines)).toBe(true);
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
    for (const c of ["P1", "P2", "M1", "F1", "M2"]) expect(has(lines, "PASS", new RegExp(`^PASS {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("asks only with GET and OPTIONS: nothing is posted, the prune is probed read-only", () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
    expect(calls.filter((c) => /roll_up_and_prune_layoff_filings/.test(c))).toHaveLength(1);
  });
});

describe("each regression prints FAIL", () => {
  it("P1: the held line beside the old store, the held line with no listener, and neither shape", () => {
    const both = NEW_HOOK.replace("function J(){", 'function T(){i.useEffect(()=>{const t=new URLSearchParams(window.location.search).get("ref");if(t){const o=Date.now()+1;localStorage.setItem(c,o)}},[])}function J(){');
    expect(has(run(routes({ hook: both })).lines, "FAIL", /^FAIL {2}P1 .*still stores the code the moment it reads it/)).toBe(true);
    const deaf = NEW_HOOK.split("window.addEventListener(A,E),").join("");
    expect(has(run(routes({ hook: deaf })).lines, "FAIL", /^FAIL {2}P1 .*listens for no consent event/)).toBe(true);
    const neither = 'import{s as p}from"./index-B2.js";function J(){p.rpc("track_affiliate_click",{})}export{J as u};';
    expect(has(run(routes({ hook: neither })).lines, "FAIL", /^FAIL {2}P1 .*neither the old shape nor the held one/)).toBe(true);
  });

  it("P1: no entry, or an entry that names no referral chunk", () => {
    expect(has(run(routes({ home: "<html></html>" })).lines, "FAIL", /^FAIL {2}P1 the homepage names no/)).toBe(true);
    expect(has(run(routes({ entry: "const m=[];" })).lines, "FAIL", /^FAIL {2}P1 .*names no use-affiliate-auth chunk/)).toBe(true);
  });

  it("P2: the hook is live and the stylesheet still lets the banner cover the sheet; and a stylesheet that is not the site's", () => {
    const { lines } = run(routes({ css: OLD_CSS }));
    expect(has(lines, "FAIL", /^FAIL {2}P2 .*no rule hiding the banner under a locked page, though the same merge's referral hook is live/), show(lines)).toBe(true);
    expect(has(run(routes({ css: ".x{color:red}" })).lines, "FAIL", /^FAIL {2}P2 .*no rule for the floating help/)).toBe(true);
  });

  it("F1: an older stream once the paste applied the migration, and no build header at all", () => {
    const { lines } = run(routes({ build: "free-keyword-scan-stream.2026-11-03.1" }));
    expect(has(lines, "FAIL", /^FAIL {2}F1 .*2026-11-03\.1, older than 2026-11-10\.1, though the paste applied/), show(lines)).toBe(true);
    expect(has(run(routes({ build: null })).lines, "FAIL", /^FAIL {2}F1 .*carries no x-fn-build/)).toBe(true);
    expect(has(run(routes({ build: null }, false)).lines, "FAIL", /^FAIL {2}F1 .*carries no x-fn-build/)).toBe(true);
  });

  it("M1: the columns still missing on 1 December, a column set applied in part, a readable rollup, a control that is not refused", () => {
    const dec = run(routes({}, false), "2026-12-01").lines;
    expect(has(dec, "FAIL", /^FAIL {2}M1 it is 2026-12-01 .*20261110160000 is not applied/), show(dec)).toBe(true);
    expect(has(run(routes({}, false), "2026-11-30").lines, "INFO", /^INFO {2}M1 /)).toBe(true);
    const part = run(routes({ cols: { rescinded_n: { status: 400, body: MISSING("rescinded_n") } } })).lines;
    expect(has(part, "FAIL", /^FAIL {2}M1 .*has 3 of the four new columns/), show(part)).toBe(true);
    const open = run(routes({ control: { status: 200, body: "[]" } })).lines;
    expect(has(open, "FAIL", /^FAIL {2}M1 .*answered rows to the publishable key/), show(open)).toBe(true);
    const gateway = run(routes({ control: { status: 502, body: "<html>Bad gateway</html>" } })).lines;
    expect(has(gateway, "FAIL", /^FAIL {2}M1 the control column .*NONJSON/), show(gateway)).toBe(true);
  });

  it("M2: a prune anon can call", () => {
    const { lines } = run(routes({ prune: { status: 400, body: JSON.stringify({ code: "25006", message: "cannot execute DELETE in a read-only transaction" }) } }));
    expect(has(lines, "FAIL", /^FAIL {2}M2 roll_up_and_prune_layoff_filings is CALLABLE as anon/), show(lines)).toBe(true);
  });
});
