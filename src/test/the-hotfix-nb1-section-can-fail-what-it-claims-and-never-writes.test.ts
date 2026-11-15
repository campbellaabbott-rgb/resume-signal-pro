// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE HOTFIX NB-1 SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS BEFORE THE
 * DEPLOY, AND NEVER WRITES (scripts/verify-deploy.d/99zzzzzzz-hotfix-nb1.sh).
 *
 * WHAT WAS WRONG. The NB-1 hotfix stamped free-keyword-scan 2026-11-15.1 and
 * no section asked for it: the cost wave's sections ask for 2026-11-09.2 or
 * later, which the old build already serves, so a deploy that never landed
 * would have read as verified everywhere but the ledger's section 49.
 *
 * Run against a fake curl that answers from routes and logs every call:
 *   - before the deploy (the cost wave's 2026-11-09.2) it prints INFO and no
 *     FAIL;
 *   - 2026-11-15.1 or a later build passes;
 *   - a preflight with no x-fn-build fails, and another function's build
 *     (the stream fork's) never stands in for this one;
 *   - the one call is an OPTIONS, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-hotfix-nb1.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_hotfix_nb1";

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
  const dir = mkdtempSync(join(tmpdir(), "vdhotfixnb1-"));
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

const preflight = (build: string | null): Route[] =>
  [{ match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/free-keyword-scan$", headers: build ? { "x-fn-build": build } : {} }];
const verdicts = (lines: string[], v: "PASS" | "FAIL") => lines.filter((l) => l.startsWith(v));

describe("the hotfix NB-1 section", () => {
  it("prints its header, so the tally files its lines under it", () => {
    expect(run(preflight("free-keyword-scan.2026-11-15.1")).out).toMatch(/^== 99zzzzzzz\. hotfix NB-1: .* ==$/m);
  });

  it("before the deploy says INFO and fails nothing", () => {
    const { lines, out } = run(preflight("free-keyword-scan.2026-11-09.2"));
    expect(verdicts(lines, "FAIL"), out).toEqual([]);
    expect(verdicts(lines, "PASS"), out).toEqual([]);
    expect(lines, out).toContain("INFO  B free-keyword-scan preflight x-fn-build = free-keyword-scan.2026-11-09.2: hotfix NB-1 (2026-11-15.1) is not deployed yet");
  });

  it("the hotfix's build, or a later one, passes", () => {
    for (const build of ["free-keyword-scan.2026-11-15.1", "free-keyword-scan.2026-11-15.2", "free-keyword-scan.2026-12-01.1"]) {
      const { lines, out } = run(preflight(build));
      expect(verdicts(lines, "FAIL"), out).toEqual([]);
      expect(verdicts(lines, "PASS"), out).toEqual([`PASS  B free-keyword-scan preflight x-fn-build = ${build} (2026-11-15.1 or later: the rule score reads a résumé in its own language)`]);
    }
  });

  it("a preflight with no x-fn-build fails, and the stream fork's build never stands in for the scan's", () => {
    const none = run(preflight(null));
    expect(verdicts(none.lines, "FAIL"), none.out).toEqual([
      "FAIL  B free-keyword-scan preflight carries no x-fn-build (not deployed, or its preflight does not answer; want free-keyword-scan.2026-11-15.1 or later)",
    ]);
    const stream = run(preflight("free-keyword-scan-stream.2026-11-15.1"));
    expect(verdicts(stream.lines, "PASS"), stream.out).toEqual([]);
  });

  it("never writes: its one call is an OPTIONS with no body, and the key is never printed", () => {
    const { calls, out } = run(preflight("free-keyword-scan.2026-11-15.1"));
    expect(calls).toEqual(["curl\tOPTIONS https://p.supabase.co/functions/v1/free-keyword-scan"]);
    expect(out).not.toContain(KEY);
  });
});
