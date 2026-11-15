// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE COST AUDIT'S AI-LANE VERIFY SECTION FAILS WHAT IT CLAIMS, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzz-cost-ai.sh is run against a fake curl that
 * answers from routes and logs every call:
 *   - before the deploy (every function on an earlier build) it prints INFO
 *     lines and no FAIL, and POSTs nothing;
 *   - a good deploy prints a PASS for each of the 28 builds, the seven
 *     retired answers, the warm-up's two refusals, its preflight's header and
 *     the five Max-Age headers, and no FAIL; a later build passes too;
 *   - a function the deploy left behind, a preflight with no build, a
 *     retired endpoint that still writes, a warm-up that warmed for a
 *     stranger or for a name off its list, a gateway's HTML, a preflight
 *     with no Max-Age and a warm-up preflight that refuses x-admin-key each
 *     print a FAIL;
 *   - the only POSTs go to the seven retired endpoints and the warm-up, each
 *     only once it serves this lane's build, the warm-up never with a key or
 *     a real target; the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-cost-ai.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_cost_ai";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url+(data!==null?" "+data:"")))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdca-"));
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
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

/** The cost wave's build of every function the section asks for, as the code carries it (the integration's where two lanes stamped one build). */
const LANE: Record<string, string> = {
  "warm-up": "2026-11-09.1", "nl-search": "2026-11-09.1", "generate-product-preview": "2026-11-09.1",
  "generate-application-answers": "2026-11-10.2", "import-freelance-profile": "2026-11-10.2",
  "generate-summary": "2026-11-09.1", "generate-resume-roast": "2026-11-09.1", "generate-recruiter-view": "2026-11-09.1",
  "generate-elevator-pitch": "2026-11-09.1", "analyze-linkedin-profile": "2026-11-09.1",
  "generate-cover-letter-stream": "2026-11-10.2", "generate-premium-package-stream": "2026-11-10.2",
  "admin-regenerate-delivery": "2026-11-09.1", "analyze-resume": "2026-11-10.4", "free-keyword-scan": "2026-11-09.2",
  "generate-apply-package": "2026-11-10.4", "generate-ats-defense": "2026-11-10.3", "generate-career-path": "2026-11-10.3",
  "generate-career-snapshot": "2026-11-10.3", "generate-cover-letter": "2026-11-09.2", "generate-freelance-boost": "2026-11-10.3",
  "generate-graduate-gameplan": "2026-11-10.3", "generate-interview-coach": "2026-11-10.3", "generate-keyword-fix": "2026-11-10.3",
  "generate-premium-package": "2026-11-10.3", "generate-tailored-resume": "2026-11-09.2", "parse-resume-structured": "2026-11-09.2",
  "test-ai-fallback": "2026-11-10.3",
};
const FNS = Object.keys(LANE);
const RETIRED = ["generate-summary", "generate-resume-roast", "generate-recruiter-view", "generate-elevator-pitch", "analyze-linkedin-profile", "generate-cover-letter-stream", "generate-premium-package-stream"];
const MAX_AGE = ["warm-up", "nl-search", "generate-product-preview", "generate-application-answers", "import-freelance-profile"];
const ALLOW = "authorization, x-client-info, apikey, content-type, x-admin-key";

const NEW = (fn: string) => `${fn}.${LANE[fn]}`;
const OLD = (fn: string) => `${fn}.2026-11-03.1`;
const fnRe = (fn: string) => fn.replace(/-/g, "\\-");

function preflights(build: (fn: string) => string | null, o: { allow?: string; noAge?: string } = {}): Route[] {
  return FNS.map((fn) => {
    const headers: Record<string, string> = { "access-control-allow-headers": fn === "warm-up" ? (o.allow ?? ALLOW) : "authorization, x-client-info, apikey, content-type" };
    if (MAX_AGE.includes(fn) && o.noAge !== fn) headers["access-control-max-age"] = "7200";
    const b = build(fn);
    if (b) headers["x-fn-build"] = b;
    return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fnRe(fn)}$`, headers };
  });
}
const RETIRED_ANSWERS: Route[] = RETIRED.map((fn) => ({
  match: `^POST https://p\\.supabase\\.co/functions/v1/${fnRe(fn)} `, status: 410,
  body: JSON.stringify({ error: "This endpoint has been retired.", code: "retired" }),
}));
const WARM_REFUSAL: Route = { match: "^POST https://p\\.supabase\\.co/functions/v1/warm\\-up \\{\\}$", status: 401, body: JSON.stringify({ success: false, error: "Unauthorized: the full warm-up needs the admin key. Name one function as target to warm it alone.", code: "admin_key_required" }) };
const WARM_UNKNOWN: Route = { match: "^POST https://p\\.supabase\\.co/functions/v1/warm\\-up .*\"target\"", status: 400, body: JSON.stringify({ success: false, error: "Unknown warm-up target.", code: "unknown_target" }) };

const good = (over: Route[] = [], build: (fn: string) => string | null = NEW, o: { allow?: string; noAge?: string } = {}): Route[] =>
  [...over, ...preflights(build, o), ...RETIRED_ANSWERS, WARM_REFUSAL, WARM_UNKNOWN];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));
const posts = (calls: string[]) => calls.filter((c) => /^curl\tPOST /.test(c));
/** One run of the good deploy, shared by the tests that only read it (each run starts ~45 processes). */
let goodRun: ReturnType<typeof run> | null = null;
const theGoodRun = () => (goodRun ??= run(good()));

describe("section 99zzzzzz (cost audit, lane ai)", () => {
  it("names every function this lane stamped, at the build its code carries", () => {
    for (const fn of FNS) {
      const src = readFileSync(resolve(ROOT, "supabase/functions", fn, "index.ts"), "utf8");
      expect(src, fn).toContain(`"${fn}.${LANE[fn]}"`);
      const [day, n] = LANE[fn].split(/\.(?=\d+$)/);
      expect(SECTION, fn).toContain(`${fn}|${day}|${n}`);
    }
  });

  it("before the deploy it prints INFO and no FAIL, and POSTs nothing", () => {
    const { lines, calls, out } = run(good([], OLD));
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines), out).toEqual([]);
    expect(lines.filter((l) => /not deployed yet/.test(l))).toHaveLength(FNS.length);
    expect(posts(calls), "a function on an older bundle was asked, and would have done the work").toEqual([]);
  });

  it("a good deploy PASSes every build, every refusal and every header, with no FAIL", () => {
    const { lines, out } = theGoodRun();
    expect(fails(lines), out).toEqual([]);
    const pass = passes(lines);
    expect(pass.filter((l) => /preflight x-fn-build/.test(l))).toHaveLength(FNS.length);
    for (const fn of RETIRED) expect(pass.some((l) => l.startsWith(`PASS  ${fn} answers 410 retired`)), `${fn}\n${out}`).toBe(true);
    expect(pass.some((l) => /^PASS  warm-up answers 401 admin_key_required/.test(l)), out).toBe(true);
    expect(pass.some((l) => /^PASS  warm-up answers 400 unknown_target/.test(l)), out).toBe(true);
    expect(pass.some((l) => /^PASS  warm-up preflight allows x-admin-key/.test(l)), out).toBe(true);
    for (const fn of MAX_AGE) expect(pass.some((l) => l.startsWith(`PASS  ${fn} preflight carries Access-Control-Max-Age 7200`)), fn).toBe(true);
  });

  it("a later build of each passes too", () => {
    const { lines, out } = run(good([], (fn) => `${fn}.2026-11-24.3`));
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => /^PASS .*preflight x-fn-build/.test(l))).toHaveLength(FNS.length);
  });

  it("a function the deploy left behind is a FAIL, and is not asked", () => {
    // In the section's order: the retired endpoints are listed before the restamped ones.
    const behind = ["generate-summary", "free-keyword-scan"];
    const { lines, calls, out } = run(good([], (fn) => (behind.includes(fn) ? OLD(fn) : NEW(fn))));
    expect(fails(lines), out).toEqual(behind.map((fn) => expect.stringMatching(new RegExp(`^FAIL  ${fn} preflight x-fn-build = ${fn}\\.2026-11-03\\.1: the deploy .* left this one behind`))));
    for (const fn of behind) expect(posts(calls).some((c) => c.includes(`/functions/v1/${fn}\t`)), `${fn} on an older bundle was POSTed`).toBe(false);
  });

  it("a preflight that carries no build is a FAIL, before the deploy and after it", () => {
    for (const other of [OLD, NEW]) {
      const { lines, out } = run(good([], (fn) => (fn === "nl-search" ? null : other(fn))));
      expect(fails(lines).some((l) => /^FAIL  nl-search preflight carries no x-fn-build/.test(l)), out).toBe(true);
    }
  });

  it("a retired endpoint that still writes, and a gateway's HTML answer, are each a FAIL that shows what came back", () => {
    const { lines, out } = run(good([
      { match: "^POST https://p\\.supabase\\.co/functions/v1/generate\\-summary ", status: 200, body: JSON.stringify({ summary: "Jane, your resume..." }) },
      { match: "^POST https://p\\.supabase\\.co/functions/v1/analyze\\-linkedin\\-profile ", status: 502, body: "<html>Bad gateway</html>" },
    ]));
    expect(fails(lines), out).toEqual([
      expect.stringMatching(/^FAIL  generate-summary does not answer as retired.*HTTP 200.*code undefined.*it carries summary/),
      expect.stringMatching(/^FAIL  analyze-linkedin-profile does not answer .*no JSON body.*Bad gateway/),
    ]);
  });

  it("a warm-up that warmed for a stranger, or for a name off its list, is a FAIL", () => {
    const warmed = JSON.stringify({ success: true, summary: { warm: 16 }, results: [] });
    const { lines, out } = run(good([
      { match: "^POST https://p\\.supabase\\.co/functions/v1/warm\\-up \\{\\}$", status: 200, body: warmed },
      { match: "^POST https://p\\.supabase\\.co/functions/v1/warm\\-up .*\"target\"", status: 200, body: warmed },
    ]));
    expect(fails(lines), out).toEqual([
      expect.stringMatching(/^FAIL  warm-up does not answer as a full warm-up .*HTTP 200.*it carries results/),
      expect.stringMatching(/^FAIL  warm-up does not answer as a target off the list .*HTTP 200/),
    ]);
  });

  it("a preflight without Access-Control-Max-Age 7200 is a FAIL that says the gateway may drop it", () => {
    const { lines, out } = run(good([], NEW, { noAge: "nl-search" }));
    expect(fails(lines), out).toEqual([expect.stringMatching(/^FAIL  nl-search preflight carries Access-Control-Max-Age '', not 7200/)]);
  });

  it("a warm-up preflight that refuses x-admin-key is a FAIL", () => {
    const { lines, out } = run(good([], NEW, { allow: "authorization, x-client-info, apikey, content-type" }));
    expect(fails(lines), out).toEqual([expect.stringMatching(/^FAIL  warm-up preflight does not allow x-admin-key/)]);
  });

  it("POSTs only the seven retired endpoints and the warm-up, never with a key or a real target, and never prints the key", () => {
    const { calls, out } = theGoodRun();
    const posted = posts(calls).map((c) => /functions\/v1\/([a-z-]+)/.exec(c)?.[1]).sort();
    expect(posted).toEqual([...RETIRED, "warm-up", "warm-up"].sort());
    const warm = posts(calls).filter((c) => c.includes("/functions/v1/warm-up"));
    for (const c of warm) expect(c).not.toMatch(/adminKey/);
    const target = /"target":"([^"]+)"/.exec(warm.join(" "))?.[1] ?? "";
    expect(target).not.toBe("");
    expect(FNS.includes(target) || /^(health-check|free-keyword-scan-stream|track-ab-event|create-|stripe-|verify-|scheduled-)/.test(target), `the probe target ${target} would warm a real function`).toBe(false);
    expect(out).not.toContain(KEY);
  });

  it("names the owner step for the scheduled warm-up and where the unprovable claims are proved", () => {
    const { lines } = theGoodRun();
    expect(lines.some((l) => /^INFO  OWNER STEP: the scheduled job warm-up-edge-functions/.test(l))).toBe(true);
    expect(lines.some((l) => /^INFO  nl-search's eight seconds .*the-board-search-parse-answers-inside-eight-seconds/.test(l))).toBe(true);
    expect(lines.some((l) => /^INFO  the free tools' chain .*a-free-tool-falls-back/.test(l))).toBe(true);
  });
});
