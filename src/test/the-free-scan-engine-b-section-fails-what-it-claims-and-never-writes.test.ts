// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE FREE-SCAN-ENGINE-B SECTION FAILS WHAT IT CLAIMS, NEVER FAILS BEFORE THE
 * PASTE, AND NEVER WRITES (scripts/verify-deploy.d/99zzzzzzz-bugs-free-scan-engine-b.sh).
 *
 * Run against a fake curl that answers from routes and logs every call, and
 * against copies of this checkout's own modules with each fix taken out:
 *   - before the paste (today's builds, and part A's) it prints INFO for the
 *     builds and no FAIL; the offline lines judge this checkout and pass;
 *   - after the paste every build line passes, and later builds pass too;
 *   - each claim fails on the state it exists to catch: a partial paste, a
 *     preflight with no build, a presence test that reads a broken word as
 *     absent or "security" in "securities" (each copy on its own line), two
 *     copies that drifted apart, a chain that still names the model the
 *     gateway never served, a stream fork walking another list;
 *   - a stale answer left in its files by an earlier run is never read back;
 *   - every call is an OPTIONS with no body, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// Each run starts tsx once; the pre-push suite runs every file at once.
vi.setConfig({ testTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-free-scan-engine-b.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_free_scan_engine_b";
const PRESENCE = readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan/term-presence.ts"), "utf8");
const CHAIN = readFileSync(resolve(ROOT, "supabase/functions/_shared/scan-models.ts"), "utf8");
const FORK = readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan-stream/index.ts"), "utf8");

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
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Run = { lines: string[]; calls: string[]; out: string };
type Files = { primary?: string; stream?: string; chain?: string; fork?: string };

function run(routes: Route[], files: Files = {}, stale: Record<string, string> = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), "vdbugsfseb-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  for (const [name, body] of Object.entries(stale)) writeFileSync(join(dir, name), body);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  // A file handed in replaces this checkout's own for that one run.
  const at = (name: string, text: string | undefined) => {
    if (text === undefined) return;
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
  };
  const over: Record<string, string | undefined> = {
    VDFSB_TP_PRIMARY: at("primary-term-presence.ts", files.primary),
    VDFSB_TP_STREAM: at("stream-term-presence.ts", files.stream),
    VDFSB_CHAIN: at("scan-models.ts", files.chain),
    VDFSB_FORK: at("fork-index.ts", files.fork),
  };
  for (const [k, v] of Object.entries(over)) if (v) env[k] = v; else delete env[k];
  delete env.VDFSB_WANT;
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 170_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const FN = { primary: "free-keyword-scan", stream: "free-keyword-scan-stream", diag: "test-ai-fallback" } as const;
type Name = keyof typeof FN;
const routesFor = (builds: Record<Name, string | null>): Route[] =>
  (Object.keys(FN) as Name[]).map((n) => ({
    match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${FN[n]}$`,
    headers: builds[n] ? { "x-fn-build": builds[n] as string } : {},
  }));

/** Production today: the cost wave's builds. */
const TODAY = { primary: "free-keyword-scan.2026-11-09.2", stream: "free-keyword-scan-stream.2026-11-10.3", diag: "test-ai-fallback.2026-11-10.3" };
/** Part A pasted: the primary at 2026-11-15.2, the stream at 2026-11-12.1. */
const PART_A = { primary: "free-keyword-scan.2026-11-15.2", stream: "free-keyword-scan-stream.2026-11-12.1", diag: "test-ai-fallback.2026-11-10.3" };
/** This lane pasted. */
const PART_B = { primary: "free-keyword-scan.2026-11-15.3", stream: "free-keyword-scan-stream.2026-11-13.1", diag: "test-ai-fallback.2026-11-13.1" };

const verdicts = (lines: string[], v: "PASS" | "FAIL" | "INFO") => lines.filter((l) => l.startsWith(v));
const fails = (r: Run) => verdicts(r.lines, "FAIL");

/** This checkout's presence test with one fix taken out (the replacement must apply). */
function without(fix: "RC-OI-25" | "S14X-280"): string {
  const swaps: Array<[string, string]> = fix === "RC-OI-25"
    ? [["return out.filter(({ form }) => !NO_INFLECT.has(form));", "return out;"]]
    : [["const clean = unmark(text);", "const clean = text;"], ["if (!LINE_END_HYPHEN.test(clean)) return [prepare(clean)];", "return [prepare(clean)];"]];
  let text = PRESENCE;
  for (const [from, to] of swaps) {
    expect(text.includes(from), `the fix's line moved: ${from}`).toBe(true);
    text = text.replace(from, to);
  }
  return text;
}

const OFFLINE_PASS = [
  "PASS  T free-keyword-scan term-presence.ts reads all 7 cases right: a word broken by a line end, a soft hyphen, a non-ASCII hyphen or a zero-width space is the word, and security is not found in securities",
  "PASS  T free-keyword-scan-stream term-presence.ts reads all 7 cases right: a word broken by a line end, a soft hyphen, a non-ASCII hyphen or a zero-width space is the word, and security is not found in securities",
  "PASS  I the stream fork's term-presence.ts is byte-identical to the primary's",
  "PASS  M both scanners walk google/gemini-2.5-flash > google/gemini-2.5-pro: no step the gateway does not serve",
];

describe("the free-scan-engine-b section", () => {
  it("before the paste, today and after part A alone, says INFO for the builds and fails nothing", () => {
    for (const world of [TODAY, PART_A]) {
      const r = run(routesFor(world));
      expect(r.out).toMatch(/^== 99zzzzzzz-bugs-free-scan-engine-b\. bug round B free-scan-engine-b: .* ==$/m);
      expect(fails(r), r.out).toEqual([]);
      expect(verdicts(r.lines, "PASS"), r.out).toEqual(OFFLINE_PASS);
      expect(r.lines, r.out).toContain(`INFO  B free-keyword-scan preflight x-fn-build = ${world.primary}: bug round B's free-scan-engine-b (2026-11-15.3) is not pasted yet`);
      expect(verdicts(r.lines, "INFO").filter((l) => l.startsWith("INFO  B ")), r.out).toHaveLength(3);
    }
  });

  it("after the paste every claim passes, and later builds pass too", () => {
    const later = { primary: "free-keyword-scan.2026-12-01.1", stream: "free-keyword-scan-stream.2026-11-20.2", diag: "test-ai-fallback.2026-11-13.4" };
    for (const world of [PART_B, later]) {
      const r = run(routesFor(world));
      expect(fails(r), r.out).toEqual([]);
      const pass = verdicts(r.lines, "PASS");
      expect(pass, r.out).toContain(`PASS  B free-keyword-scan preflight x-fn-build = ${world.primary} (2026-11-15.3 or later: bug round B)`);
      expect(pass, r.out).toContain(`PASS  B free-keyword-scan-stream preflight x-fn-build = ${world.stream} (2026-11-13.1 or later: bug round B)`);
      expect(pass, r.out).toContain(`PASS  B test-ai-fallback preflight x-fn-build = ${world.diag} (2026-11-13.1 or later: bug round B)`);
      expect(pass, r.out).toHaveLength(7);
    }
  });
});

describe("each claim can fail", () => {
  it("B: a partial paste fails each function left behind", () => {
    const r = run(routesFor({ ...PART_B, stream: PART_A.stream, diag: PART_A.diag }));
    expect(fails(r), r.out).toEqual([
      "FAIL  B free-keyword-scan-stream preflight x-fn-build = free-keyword-scan-stream.2026-11-12.1 while another of this lane's functions serves bug round B: a partial paste (want free-keyword-scan-stream.2026-11-13.1 or later)",
      "FAIL  B test-ai-fallback preflight x-fn-build = test-ai-fallback.2026-11-10.3 while another of this lane's functions serves bug round B: a partial paste (want test-ai-fallback.2026-11-13.1 or later)",
    ]);
  });

  it("B: part A's primary build is not this lane's, and the stream's build never stands in for the primary's", () => {
    const a = run(routesFor({ ...PART_B, primary: PART_A.primary }));
    expect(fails(a), a.out).toEqual([
      "FAIL  B free-keyword-scan preflight x-fn-build = free-keyword-scan.2026-11-15.2 while another of this lane's functions serves bug round B: a partial paste (want free-keyword-scan.2026-11-15.3 or later)",
    ]);
    const swapped = run(routesFor({ ...PART_B, primary: "free-keyword-scan-stream.2026-11-15.3" }));
    expect(fails(swapped).filter((l) => l.startsWith("FAIL  B free-keyword-scan preflight")), swapped.out).toHaveLength(1);
  });

  it("B: a preflight with no x-fn-build fails, before the paste too", () => {
    const r = run(routesFor({ ...TODAY, diag: null }));
    expect(fails(r), r.out).toEqual([
      "FAIL  B test-ai-fallback preflight carries no x-fn-build (not deployed, or its preflight does not answer; want test-ai-fallback.2026-11-13.1 or later)",
    ]);
  });

  it("T: a copy that reads security in securities fails, naming the cases, on its own line", () => {
    const old = without("RC-OI-25");
    const r = run(routesFor(PART_B), { stream: old });
    expect(fails(r).filter((l) => !l.startsWith("FAIL  I ")), r.out).toEqual([
      "FAIL  T free-keyword-scan-stream term-presence.ts reads RC-OI-25 the Securities and Exchange Commission as present; RC-OI-25 securities trading as present",
    ]);
    expect(verdicts(r.lines, "PASS"), r.out).toContain(OFFLINE_PASS[0]);
  });

  it("T: a copy that reads a broken word as absent fails, naming each break", () => {
    const old = without("S14X-280");
    const r = run(routesFor(PART_B), { primary: old, stream: old });
    expect(fails(r), r.out).toEqual(["free-keyword-scan", "free-keyword-scan-stream"].map((c) =>
      `FAIL  T ${c} term-presence.ts reads S14X-280 a line-end hyphen as absent; S14X-280 a soft hyphen as absent; S14X-280 a non-breaking hyphen as absent; S14X-280 a zero-width space as absent`));
  });

  it("T: a stale answer from an earlier run is never read back; a module that does not load is INFO", () => {
    const stale = JSON.stringify([{ copy: "free-keyword-scan", name: "stale", want: true, got: true }, { copy: "free-keyword-scan-stream", name: "stale", want: true, got: true }]);
    const r = run(routesFor(PART_B), { primary: "export const broken = ;\n", stream: "export const broken = ;\n" }, { "vd_fseb_presence.json": stale });
    expect(verdicts(r.lines, "PASS").filter((l) => l.startsWith("PASS  T ")), r.out).toEqual([]);
    expect(r.lines.filter((l) => l.startsWith("INFO  T the presence test could not be read here")), r.out).toHaveLength(1);
  });

  it("I: two copies that drifted apart fail", () => {
    const r = run(routesFor(PART_B), { stream: `${PRESENCE}\n// drift\n` });
    expect(fails(r), r.out).toEqual(["FAIL  I the stream fork's term-presence.ts differs from the primary's (or one is missing): the two scanners read the same résumé differently"]);
  });

  it("M: a chain that still names the model the gateway never served fails, in either list", () => {
    const unserved = ["openai", "gpt-4o-mini"].join("/");
    const chain = CHAIN.replace(/("google\/gemini-2\.5-pro",)/, `$1\n  "${unserved}",`);
    expect(chain).not.toBe(CHAIN);
    const a = run(routesFor(PART_B), { chain });
    expect(fails(a), a.out).toEqual([`FAIL  M the scanner chain still names a model the gateway does not serve: ${unserved} (shared google/gemini-2.5-flash > google/gemini-2.5-pro > ${unserved}; stream fork google/gemini-2.5-flash > google/gemini-2.5-pro)`]);
    const fork = FORK.replace(/("google\/gemini-2\.5-pro",\s*\/\/ Fallback 1)/, `$1\n        "${unserved}",`);
    expect(fork).not.toBe(FORK);
    const b = run(routesFor(PART_B), { fork });
    expect(fails(b).filter((l) => l.startsWith("FAIL  M the scanner chain still names")), b.out).toHaveLength(1);
  });

  it("M: a stream fork walking another list fails, and a layout it cannot read fails", () => {
    const fork = FORK.replace(/"google\/gemini-2\.5-flash",(\s*)"google\/gemini-2\.5-pro",/, `"google/gemini-2.5-pro",$1"google/gemini-2.5-flash",`);
    expect(fork).not.toBe(FORK);
    const swapped = run(routesFor(PART_B), { fork });
    expect(fails(swapped), swapped.out).toEqual(["FAIL  M the stream fork walks google/gemini-2.5-pro > google/gemini-2.5-flash where the shared chain is google/gemini-2.5-flash > google/gemini-2.5-pro"]);
    const gone = run(routesFor(PART_B), { fork: "export {};\n" });
    expect(fails(gone).filter((l) => l.startsWith("FAIL  M the model chain could not be read here")), gone.out).toHaveLength(1);
  });
});

describe("the section never writes", () => {
  it("every call is an OPTIONS preflight with no body, and the key is never printed", () => {
    const r = run(routesFor(PART_B));
    expect(r.calls.length, r.out).toBe(3);
    for (const c of r.calls) expect(c, c).toMatch(/^curl\tOPTIONS https:\/\/p\.supabase\.co\/functions\/v1\/[a-z-]+$/);
    expect(r.out).not.toContain(KEY);
  });
});
