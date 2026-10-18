// @vitest-environment node
/**
 * SECTION 92 (WAVE 4 ROUND 2, THE GENERATORS) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/92-w4b-generators.sh is what the owner reads after
 * this round's generators deploy. A PASS is worth something only if a
 * regression could have turned it into a FAIL (verify-deploy.d/README), so the
 * section runs here in bash against a fake curl, with the real build_ge and
 * probe cut from the verifier. The answers it reads for the writing tools,
 * the free Career Path and scrape-linkedin are the REAL handlers' answers to
 * the section's own requests, run here with only their network faked. Each
 * claim's regression must read FAIL, and a bundle older than this round's is
 * never POSTed (it would write a letter for anyone).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { WritingWorld, loadWriter } from "./helpers/writing-harness";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-generators.sh"), "utf8");
const cut = (re: RegExp, what: string) => { const m = re.exec(SCRIPT); if (!m) throw new Error(`${what} is gone from verify-deploy.sh`); return m[0]; };
const HELPERS = [cut(/^probe\(\) \{[\s\S]*?esac; \}$/m, "probe"), cut(/^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge")].join("\n");

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(["-H","-m","-A"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const key=method+" "+url+(data!==null?" "+data:"");
fs.appendFileSync(process.env.VD_CALLS,key+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-92g-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${HELPERS}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 110_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l));
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

const ROUND = [
  "generate-cover-letter", "generate-tailored-resume", "generate-interview-coach", "generate-application-answers", "generate-apply-package",
  "generate-freelance-boost", "generate-career-path", "scrape-linkedin", "free-keyword-scan-stream",
  "analyze-linkedin-profile", "application-fit", "generate-ats-defense", "generate-career-snapshot", "generate-cover-letter-stream", "generate-elevator-pitch",
  "generate-graduate-gameplan", "generate-keyword-fix", "generate-premium-package", "generate-premium-package-stream", "generate-product-preview",
  "generate-recruiter-view", "generate-resume-roast", "generate-summary", "import-freelance-profile", "job-fit", "nl-search", "parse-resume-structured",
  "shortlist-evaluate", "test-ai-fallback",
];
const buildOf = (fn: string) => {
  const m = /const FN_BUILD = "([^"]+)"/.exec(readFileSync(resolve(ROOT, "supabase/functions", fn, "index.ts"), "utf8"));
  if (!m) throw new Error(`${fn} has no FN_BUILD`);
  return m[1];
};
const preflights = (over: Record<string, string> = {}): Route[] =>
  [...ROUND, "free-keyword-scan"].map((fn) => ({ match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: { "x-fn-build": over[fn] ?? buildOf(fn) } }));

/** The section's own POST bodies, read out of the section so the handlers answer exactly what it sends. */
const RESUME = /VD92G_RESUME="([^"]+)"/.exec(SECTION)![1];
const BODIES: Record<string, string> = {
  "generate-cover-letter": JSON.stringify({ resumeText: RESUME, jobTitle: "Data Engineer", jobCompany: "Probe" }),
  "generate-tailored-resume": JSON.stringify({ resumeText: RESUME, jobTitle: "Data Engineer" }),
  "generate-interview-coach": JSON.stringify({ resumeText: RESUME, targetRole: "Data Engineer" }),
  "generate-career-path": JSON.stringify({ resumeText: RESUME }),
  "scrape-linkedin": JSON.stringify({ url: "https://www.linkedin.com/in/verifier-probe" }),
};
const real: Record<string, { status: number; body: string }> = {};
let world: WritingWorld;

beforeAll(async () => {
  world = new WritingWorld();
  world.install();
  for (const fn of ["generate-cover-letter", "generate-tailored-resume", "generate-interview-coach", "generate-career-path"]) {
    const h = await loadWriter(fn);
    const res = await h(new Request(`https://p.supabase.co/functions/v1/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: "anon_harness", authorization: "Bearer anon_harness" },
      body: BODIES[fn],
    }));
    real[fn] = { status: res.status, body: await res.text() };
  }
  const sl: EdgeHandler = await loadEdgeHandler("scrape-linkedin", { "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }" });
  const res = await sl(new Request("https://p.supabase.co/functions/v1/scrape-linkedin", { method: "POST", body: BODIES["scrape-linkedin"] }));
  real["scrape-linkedin"] = { status: res.status, body: await res.text() };
});

const post = (fn: string, r: { status: number; body: string }): Route => ({ match: `^POST https://p\\.supabase\\.co/functions/v1/${fn} `, status: r.status, body: r.body });
const goodRoutes = (over: Partial<Record<string, Route>> = {}, builds: Record<string, string> = {}): Route[] => [
  ...preflights(builds),
  ...Object.keys(BODIES).map((fn) => over[fn] ?? post(fn, real[fn])),
  { match: "rpc/take_writing_tools\\?", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for function take_writing_tools" }) },
  { match: "rpc/refund_writing_tools\\?", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for function refund_writing_tools" }) },
  over.uses ?? { match: "rest/v1/writing_tool_uses", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for table writing_tool_uses" }) },
];

describe("the real handlers answer what the section expects", () => {
  it("signed out, each writing tool is a 401 sign_in_required; the retired two are 410", () => {
    for (const fn of ["generate-cover-letter", "generate-tailored-resume", "generate-interview-coach"]) {
      expect(real[fn].status, fn).toBe(401);
      expect(JSON.parse(real[fn].body).error, fn).toBe("sign_in_required");
    }
    expect(real["generate-career-path"].status).toBe(410);
    expect(real["scrape-linkedin"].status).toBe(410);
    expect(world.ai, "a visitor's probe reached the model").toEqual([]);
    expect(world.takes, "a visitor's probe took a use").toEqual([]);
  });
});

describe("section 92, generators", () => {
  it("reads PASS over this round's real answers, with no FAIL", () => {
    const { lines } = run(goodRoutes());
    expect(fails(lines), show(lines)).toEqual([]);
    for (const fn of ["generate-cover-letter", "generate-tailored-resume", "generate-interview-coach"]) {
      expect(has(lines, "PASS", new RegExp(`^PASS  ${fn} answers a visitor with no account 401 sign_in_required`)), show(lines)).toBe(true);
    }
    expect(has(lines, "PASS", /generate-career-path answers 410 retired/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /scrape-linkedin answers 410 retired/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /take_writing_tools as anon -> 42501/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /writing_tool_uses as anon -> 42501/), show(lines)).toBe(true);
    expect(lines.filter((l) => /^PASS  \S+ preflight x-fn-build/.test(l)).length).toBe(ROUND.length + 1);
  });

  it("a writing tool that writes for a visitor is a FAIL", () => {
    const { lines } = run(goodRoutes({ "generate-cover-letter": post("generate-cover-letter", { status: 200, body: JSON.stringify({ coverLetter: "Dear hiring manager" }) }) }));
    expect(has(lines, "FAIL", /generate-cover-letter did not refuse a visitor with no account: HTTP 200/), show(lines)).toBe(true);
  });

  it("an older bundle is a FAIL and is never POSTed", () => {
    const { lines, calls } = run(goodRoutes({}, { "generate-tailored-resume": "generate-tailored-resume.2026-10-09.4", "free-keyword-scan": "free-keyword-scan.2026-10-11.24" }));
    expect(has(lines, "FAIL", /generate-tailored-resume preflight x-fn-build = generate-tailored-resume\.2026-10-09\.4/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /generate-tailored-resume was not asked as a visitor/), show(lines)).toBe(true);
    expect(calls.some((c) => c.startsWith("POST https://p.supabase.co/functions/v1/generate-tailored-resume"))).toBe(false);
    // R1 stamped free-keyword-scan 2026-10-14.1, so a 2026-10-11 build is older.
    expect(has(lines, "FAIL", /free-keyword-scan preflight x-fn-build = free-keyword-scan\.2026-10-11\.24/), show(lines)).toBe(true);
  });

  it("a generator serving its own round's build without the integration's classifier or credit change is a FAIL", () => {
    // generate-application-answers and generate-apply-package also bundle
    // agents-api's classifier, and free-keyword-scan payments-delivery's
    // claimed-credit rule: the integration stamped each .29, so .24 names a
    // bundle without them.
    const { lines } = run(goodRoutes({}, {
      "generate-apply-package": "generate-apply-package.2026-10-11.24",
      "generate-application-answers": "generate-application-answers.2026-10-11.24",
      "free-keyword-scan": "free-keyword-scan.2026-10-14.24",
    }));
    expect(has(lines, "FAIL", /generate-apply-package preflight x-fn-build = generate-apply-package\.2026-10-11\.24 \(want generate-apply-package\.2026-10-11\.29/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /generate-application-answers preflight x-fn-build = generate-application-answers\.2026-10-11\.24/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /free-keyword-scan preflight x-fn-build = free-keyword-scan\.2026-10-14\.24 \(want free-keyword-scan\.2026-10-14\.29/), show(lines)).toBe(true);
  });

  it("a scraper that still answers is a FAIL", () => {
    const { lines } = run(goodRoutes({ "scrape-linkedin": post("scrape-linkedin", { status: 429, body: JSON.stringify({ success: false, error: "Rate limit exceeded." }) }) }));
    expect(has(lines, "FAIL", /scrape-linkedin is not retired: HTTP 429/), show(lines)).toBe(true);
  });

  it("an RPC callable as anon, or a readable table, is a FAIL", () => {
    const routes = goodRoutes({ uses: { match: "rest/v1/writing_tool_uses", status: 200, body: "[]" } });
    routes.splice(routes.findIndex((r) => r.match.startsWith("rpc/take")), 1, { match: "rpc/take_writing_tools\\?", status: 400, body: JSON.stringify({ code: "25006", message: "cannot execute INSERT in a read-only transaction" }) });
    const { lines } = run(routes);
    expect(has(lines, "FAIL", /take_writing_tools is CALLABLE as anon/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /writing_tool_uses is readable by anon/), show(lines)).toBe(true);
  });
});
