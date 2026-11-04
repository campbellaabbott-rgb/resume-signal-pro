// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE AUDIT-REST HELD MAIL SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzz-audit-rest-held-mail.sh).
 *
 * The section is run against a fake curl that answers from routes and logs every
 * call:
 *   - a good deploy prints PASS and INFO lines and no FAIL;
 *   - the deploy before this round (each function on its older build, no locale
 *     column) fails each build and the column;
 *   - a later build passes; a missing header, a readable saved search, and a give
 *     function anon can run or that does not exist each fail;
 *   - no request writes, no function is POSTed, and the key is never printed;
 *   - every test file the INFO lines name exists.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-audit-rest-held-mail.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_held_mail";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
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
  const dir = mkdtempSync(join(tmpdir(), "vdheldmail-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${SECTION}`);
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

const FNS = ["send-search-digest", "send-scan-report", "save-lead", "reconcile-stripe"];
const preflights = (build: (fn: string) => string | null): Route[] =>
  FNS.map((fn) => { const b = build(fn); return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} }; });
const locale = (status: number, body: unknown): Route => ({ match: "^GET https://p\\.supabase\\.co/rest/v1/user_job_searches\\?select=locale", status, body: JSON.stringify(body) });
const give = (status: number, body: unknown): Route => ({ match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/mail_door_give", status, body: JSON.stringify(body) });
const good = (): Route[] => [
  ...preflights((fn) => `${fn}.2026-11-03.1`),
  locale(200, []),
  give(401, { code: "42501", message: "permission denied for function mail_door_give" }),
];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("the audit-rest held mail section", () => {
  it("a good deploy passes every claim and fails none", () => {
    const { lines, out } = run(good());
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")).length, out).toBe(FNS.length + 2);
    expect(lines.filter((l) => l.startsWith("INFO")).length, out).toBeGreaterThanOrEqual(5);
  });

  it("the deploy before this round fails each build and the column", () => {
    const { lines, out } = run([
      { match: "^OPTIONS .*/send-search-digest$", headers: { "x-fn-build": "send-search-digest.2026-11-02.1" } },
      { match: "^OPTIONS .*/send-scan-report$", headers: { "x-fn-build": "send-scan-report.2026-11-01.1" } },
      { match: "^OPTIONS .*/save-lead$", headers: { "x-fn-build": "save-lead.2026-11-01.1" } },
      { match: "^OPTIONS .*/reconcile-stripe$", headers: { "x-fn-build": "reconcile-stripe.2026-10-28.1" } },
      locale(400, { code: "42703", message: "column user_job_searches.locale does not exist" }),
      give(404, { code: "PGRST202", message: "Could not find the function" }),
    ]);
    for (const fn of FNS) expect(fails(lines).some((l) => l.startsWith(`FAIL  ${fn} preflight x-fn-build = ${fn}.`)), `${fn}\n${out}`).toBe(true);
    expect(fails(lines).some((l) => /no locale column \(42703\)/.test(l)), out).toBe(true);
    expect(fails(lines).some((l) => /mail_door_give does not exist/.test(l)), out).toBe(true);
    expect(fails(lines)).toHaveLength(FNS.length + 2);
  });

  it("a later build passes, a missing header fails, and a closed column passes", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "save-lead" ? null : `${fn}.2026-11-14.2`)),
      locale(401, { code: "42501", message: "permission denied" }),
      give(401, { code: "42501" }),
    ]);
    expect(fails(lines), out).toEqual(["FAIL  save-lead preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)"]);
    expect(lines.filter((l) => l.startsWith("PASS")).length, out).toBe(FNS.length - 1 + 2);
  });

  it("a saved search anon can read fails, and so does a give anon can run", () => {
    const { lines, out } = run([
      ...preflights((fn) => `${fn}.2026-11-03.1`),
      locale(200, [{ locale: "fr" }]),
      give(200, true),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  anon read a user_job_searches row: saved searches are exposed",
      "FAIL  mail_door_give ran for anon: 20261103165000 must leave it to the service role",
    ]);
  });

  it("an answer it cannot read fails rather than passes", () => {
    const { lines, out } = run([
      ...preflights((fn) => `${fn}.2026-11-03.1`),
      { match: "^GET .*user_job_searches", status: 503, body: "<html>bad gateway</html>" },
      { match: "^GET .*mail_door_give", status: 503, body: "<html>bad gateway</html>" },
    ]);
    expect(fails(lines), out).toHaveLength(2);
  });

  it("never writes: nothing but preflights and two GETs, and the key is never printed", () => {
    const { calls, out } = run(good());
    expect(calls.every((c) => /^(OPTIONS|GET) /.test(c)), calls.join("\n")).toBe(true);
    expect(calls.filter((c) => /functions\/v1\//.test(c)).every((c) => c.startsWith("OPTIONS "))).toBe(true);
    expect(calls.filter((c) => c.startsWith("GET ")).length).toBe(2);
    expect(out).not.toContain(KEY);
  });

  it("every test the section's INFO lines name exists", () => {
    const named = [...SECTION.matchAll(/src\/test\/[A-Za-z0-9._-]+\.test\.tsx?/g)].map((m) => m[0]);
    expect(named.length).toBeGreaterThanOrEqual(5);
    for (const f of named) expect(existsSync(resolve(ROOT, f)), f).toBe(true);
  });
});
