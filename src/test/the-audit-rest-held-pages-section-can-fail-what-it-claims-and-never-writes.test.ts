// @vitest-environment node
//
// Node, not jsdom: this file runs a verifier section in bash, with a fake curl
// on PATH, through child_process.
/**
 * THE AUDIT-REST HELD-PAGES SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzz-audit-rest-held-pages.sh).
 *
 * The section runs against a fake curl that answers from routes and logs every
 * call:
 *   - a good publish, every spend-gate function at 2026-11-03.1, passes every
 *     claim and fails none;
 *   - what c4a29736 serves fails: every function's build is older, the homepage
 *     chunk carries the job it invented, the board chunk has no such control;
 *   - a chunk the homepage line cannot judge fails rather than passes;
 *   - every call is an OPTIONS preflight or a GET, and the key is never printed.
 * The list of functions is held to the repo: every function that imports the
 * spend gate is in it, so a new importer cannot go unjudged.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-audit-rest-held-pages.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_heldpages";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary"||x==="-T"||x==="--upload-file")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+"\\n");
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
  const dir = mkdtempSync(join(tmpdir(), "vdheld-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const FUNCTIONS = /for VDHP_FN in ([\s\S]*?); do/.exec(SECTION)![1].replace(/\\\n/g, " ").trim().split(/\s+/);

const GOOD_INDEX = 'x("generate-tailored-resume",{jobDescription:a||void 0})';
const OLD_INDEX = 'x("generate-tailored-resume",{jobDescription:`A ${b} role requiring strong skills and experience.`})';
const GOOD_JOBS = 't("jobsPage.tailorResumeOpen","o");t("jobsPage.coverLetterOpen","o");t("jobsPage.tailorResumeAgain","a")';
const OLD_JOBS = 't("jobsPage.tailorResume","o");t("jobsPage.coverLetter","o")';

function routes(opts: { build?: (fn: string) => string | null; index?: string; jobs?: string; chunks?: string } = {}): Route[] {
  const build = opts.build ?? ((fn: string) => `${fn}.2026-11-03.1`);
  return [
    ...FUNCTIONS.map((fn) => {
      const b = build(fn);
      return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {}, body: "" };
    }),
    { match: "^GET https://site\\.test/$", body: '<script src="/assets/index-AbC123.js"></script>' },
    { match: "^GET https://site\\.test/assets/index-AbC123\\.js$", body: opts.chunks ?? '["./Index-Ix1.js","./Jobs-Jb1.js"]' },
    { match: "^GET https://site\\.test/assets/Index-Ix1\\.js$", body: opts.index ?? GOOD_INDEX },
    { match: "^GET https://site\\.test/assets/Jobs-Jb1\\.js$", body: opts.jobs ?? GOOD_JOBS },
  ];
}
const fails = (lines: string[], re: RegExp) => lines.some((l) => l.startsWith("FAIL") && re.test(l));
const passes = (lines: string[], re: RegExp) => lines.some((l) => l.startsWith("PASS") && re.test(l));

describe("the list of functions", () => {
  it("names every function that bundles the spend gate, and nothing else", () => {
    const fnDir = resolve(ROOT, "supabase/functions");
    const importers = readdirSync(fnDir)
      .filter((f) => f !== "_shared" && statSync(join(fnDir, f)).isDirectory() && existsSync(join(fnDir, f, "index.ts")))
      .filter((f) => readdirSync(join(fnDir, f)).filter((n) => n.endsWith(".ts")).some((n) => /from\s+["'][^"']*_shared\/model-spend-gate\.ts["']/.test(readFileSync(join(fnDir, f, n), "utf8"))));
    expect(importers.length).toBeGreaterThan(20);
    expect([...FUNCTIONS].sort()).toEqual(importers.sort());
  });
});

describe("the section", () => {
  it("passes a good publish on every claim and fails none", () => {
    const { lines } = run(routes());
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")).length).toBe(FUNCTIONS.length + 2);
  });

  it("fails what c4a29736 serves, on every line", () => {
    const { lines } = run(routes({ build: (fn) => `${fn}.2026-10-28.1`, index: OLD_INDEX, jobs: OLD_JOBS }));
    expect(lines.filter((l) => l.startsWith("PASS"))).toEqual([]);
    expect(lines.filter((l) => l.startsWith("FAIL")).length).toBe(FUNCTIONS.length + 2);
    expect(fails(lines, /homepage chunk .* still invents a job/)).toBe(true);
    expect(fails(lines, /board chunk .* has no control/)).toBe(true);
  });

  it("fails one function left behind, naming it, and passes the rest", () => {
    const { lines } = run(routes({ build: (fn) => (fn === "free-keyword-scan" ? "free-keyword-scan.2026-11-01.1" : `${fn}.2026-11-03.1`) }));
    expect(lines.filter((l) => l.startsWith("FAIL")).length).toBe(1);
    expect(fails(lines, /^FAIL {2}free-keyword-scan x-fn-build/)).toBe(true);
  });

  it("fails a function whose preflight names no build", () => {
    const { lines } = run(routes({ build: (fn) => (fn === "job-fit" ? null : `${fn}.2026-11-03.1`) }));
    expect(fails(lines, /^FAIL {2}job-fit preflight carries no x-fn-build/)).toBe(true);
  });

  it("will not pass a homepage chunk it cannot judge", () => {
    const { lines } = run(routes({ index: "nothing about the writer here" }));
    expect(fails(lines, /names no tailored-résumé writer/)).toBe(true);
    expect(passes(lines, /homepage chunk/)).toBe(false);
  });

  it("fails an entry that names neither chunk", () => {
    const { lines } = run(routes({ chunks: "[]" }));
    expect(fails(lines, /names no Index chunk/)).toBe(true);
    expect(fails(lines, /names no Jobs chunk/)).toBe(true);
  });

  it("only preflights and reads, and never prints the key", () => {
    const { calls, out } = run(routes());
    expect(calls.length).toBeGreaterThan(FUNCTIONS.length);
    expect(calls.filter((c) => !/^(OPTIONS|GET) /.test(c))).toEqual([]);
    expect(out).not.toContain(KEY);
  });
});
