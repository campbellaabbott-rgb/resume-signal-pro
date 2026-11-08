// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE HOTFIX PAID SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzzzz-hotfix-paid.sh).
 *
 * The section is run against a fake curl that answers from routes and logs
 * every call:
 *   - a good deploy (four preflights on 2026-11-10.1, the lease table closed
 *     to anon, the published page carrying the PDF fix and the stored ask and
 *     reading only its own purchase's pointer, the homepage's press keeping
 *     no pointer that names no purchase) prints PASS lines and no FAIL;
 *   - today, before the deploy (older builds, no table, the page before the
 *     merge), prints INFO lines and no FAIL;
 *   - with analyze-resume live, a missing table and an unpublished page FAIL;
 *     a page or press still using the pointer that names no purchase FAILs;
 *     a table anon can read FAILs; a missing build header FAILs; a bundle
 *     whose press cannot be found FAILs rather than passing over nothing;
 *   - nothing is POSTed, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-hotfix-paid.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_hotfix_paid";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdhotfixpaid-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const FNS = ["analyze-resume", "verify-scan-pack-purchase", "scan-credits", "create-checkout"];
const preflights = (build: (fn: string) => string | null): Route[] =>
  FNS.map((fn) => { const b = build(fn); return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} }; });
const lease = (status: number, body: unknown): Route => ({ match: "^GET https://p\\.supabase\\.co/rest/v1/analysis_run_leases\\?", status, body: JSON.stringify(body) });
const CLOSED = lease(401, { code: "42501", message: "permission denied for table analysis_run_leases" });
const MISSING = lease(404, { code: "PGRST205", message: "Could not find the table 'public.analysis_run_leases' in the schema cache" });
const NEW_PAGE = 'const s="*,*::before,*::after{animation:none!important;transition:none!important}";jsx("div",{id:"quantification",children:x});f({body:{language:l.language,resumeText:"",sessionId:n,fromStored:!0}});N&&Ye(`tempSessionId:${N}`),Ye("tempSessionId");const v=Ke(`tempSessionId:${N}`);if(!v){}';
/** The page as published today: its purchase's pointer, or else the one naming no purchase. */
const OLD_FALLBACK = 'const v=Ke(`tempSessionId:${N}`)||Ke("tempSessionId");if(!v){}';
// The toaster's own stylesheet switches animations off in the other order; a
// page carrying only that has not shipped the PDF fix.
const OLD_PAGE = '.sonner-loading-bar{transition:none!important;animation:none!important}jsx("div",{id:"metrics",children:x});f({body:{resumeText:"",sessionId:n,language:l.language}});' + OLD_FALLBACK;
/** The homepage's press, after and before: the old one kept a pointer naming no purchase before create-checkout answered. */
const NEW_PRESS = 'console.log("[Checkout] Resume stored, calling create-checkout"),console.log("[Checkout] Calling create-checkout");W())return;va("tempSessionId"),f();Os(`tempSessionId:${he.sessionId}`,Te)';
const OLD_PRESS = 'console.log("[Checkout] Resume stored, calling create-checkout"),Os("tempSessionId",Te),console.log("[Checkout] C");W())return;va("tempSessionId"),f();';
const site = (chunk: string | null, press: string | null = NEW_PRESS): Route[] => [
  { match: "^GET https://site\\.test/$", body: '<script type="module" src="/assets/index-AbC123.js"></script>' },
  { match: "^GET https://site\\.test/assets/index-AbC123\\.js$", body: chunk === null ? "no chunks here" : 'import("./Success-XyZ789.js");import("./Index-IdX456.js")' },
  { match: "^GET https://site\\.test/assets/Success-XyZ789\\.js$", body: chunk ?? "" },
  { match: "^GET https://site\\.test/assets/Index-IdX456\\.js$", body: press ?? "a chunk without the press" },
];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("the hotfix paid section", () => {
  it("a good deploy passes every claim and fails none", () => {
    const { lines, out } = run([...preflights((fn) => `${fn}.2026-11-10.1`), CLOSED, ...site(NEW_PAGE)]);
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")).length, out).toBe(FNS.length + 3);
  });

  it("today, before anything is deployed, prints no FAIL: every claim reads as not yet", () => {
    const { lines, out } = run([...preflights((fn) => `${fn}.2026-11-03.1`), MISSING, ...site(OLD_PAGE, OLD_PRESS)]);
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")), out).toEqual([]);
    expect(lines.filter((l) => /^INFO  HP[1235] /.test(l)).length, out).toBe(FNS.length + 3);
  });

  it("the frontend published first, before the functions: the page passes and nothing fails", () => {
    const { lines, out } = run([...preflights((fn) => `${fn}.2026-11-03.1`), MISSING, ...site(NEW_PAGE)]);
    expect(fails(lines), out).toEqual([]);
    expect(lines.some((l) => l.startsWith("PASS  HP3 ")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS  HP5 ")), out).toBe(true);
  });

  it("with analyze-resume live, a missing lease table and an unpublished page fail", () => {
    const { lines, out } = run([...preflights((fn) => `${fn}.2026-11-10.1`), MISSING, ...site(OLD_PAGE, OLD_PRESS)]);
    expect(fails(lines).map((l) => l.slice(0, 9)), out).toEqual(["FAIL  HP2", "FAIL  HP3", "FAIL  HP5"]);
    expect(fails(lines)[1], out).toContain("the PDF's animation switch-off; the quantification section; the ask from the copy kept at checkout; reading only its own purchase's pointer");
  });

  it("a lease table anon can read fails; a missing build header fails; a later build passes", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "scan-credits" ? null : `${fn}.2026-11-21.3`)),
      lease(200, []),
      ...site(NEW_PAGE),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  HP1 scan-credits preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)",
      "FAIL  HP2 analysis_run_leases answered anon with rows (ROWS:0): anyone could read, and so lock or free, a buyer's run",
    ]);
  });

  it("an entry that names no Success chunk fails rather than passing over nothing", () => {
    const { lines, out } = run([...preflights((fn) => `${fn}.2026-11-10.1`), CLOSED, ...site(null)]);
    expect(fails(lines).map((l) => l.slice(0, 9)), out).toEqual(["FAIL  HP3", "FAIL  HP5"]);
  });

  it("a published success page that still falls back to the pointer naming no purchase fails once analyze-resume is live, and only for that", () => {
    const { lines, out } = run([...preflights((fn) => `${fn}.2026-11-10.1`), CLOSED, ...site(NEW_PAGE.replace("const v=Ke(`tempSessionId:${N}`);if(!v){}", OLD_FALLBACK))]);
    expect(fails(lines), out).toHaveLength(1);
    expect(fails(lines)[0], out).toMatch(/^FAIL  HP3 .* lacks reading only its own purchase's pointer while analyze-resume serves/);
  });

  it("a published press that still keeps the pointer naming no purchase fails once analyze-resume is live; a chunk without the press fails as unjudgeable", () => {
    const old = run([...preflights((fn) => `${fn}.2026-11-10.1`), CLOSED, ...site(NEW_PAGE, OLD_PRESS)]);
    expect(fails(old.lines), old.out).toEqual([expect.stringMatching(/^FAIL  HP5 the published homepage \(Index-IdX456\.js\) still keeps a stored-résumé pointer naming no purchase while analyze-resume serves/)]);
    const gone = run([...preflights((fn) => `${fn}.2026-11-10.1`), CLOSED, ...site(NEW_PAGE, null)]);
    expect(fails(gone.lines).map((l) => l.slice(0, 9)), gone.out).toEqual(["FAIL  HP5"]);
    expect(fails(gone.lines)[0], gone.out).toContain("cannot be judged");
  });

  it("never writes: nothing is POSTed, and the key is never printed", () => {
    const { calls, out } = run([...preflights((fn) => `${fn}.2026-11-10.1`), CLOSED, ...site(NEW_PAGE)]);
    expect(calls.filter((c) => c.startsWith("curl\tPOST ")), calls.join("\n")).toEqual([]);
    expect(calls.every((c) => /^curl\t(GET|OPTIONS) /.test(c)), calls.join("\n")).toBe(true);
    expect(out).not.toContain(KEY);
  });

  it("every line it prints is a verdict", () => {
    const { out } = run([...preflights((fn) => `${fn}.2026-11-10.1`), CLOSED, ...site(NEW_PAGE)]);
    const stray = out.split("\n").filter((l) => l && !/^(PASS|FAIL|INFO|==)/.test(l));
    expect(stray, out).toEqual([]);
  });
});
