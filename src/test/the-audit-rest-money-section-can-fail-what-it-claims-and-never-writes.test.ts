// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE AUDIT-REST MONEY SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzz-audit-rest-money.sh).
 *
 * The section is run against a fake curl that answers from routes and logs
 * every call:
 *   - a good deploy (every preflight on 2026-11-03.1, every new function
 *     closed to anon) prints PASS and INFO lines and no FAIL, and names the
 *     job R10 will ring for;
 *   - nothing deployed prints a FAIL for each of the nine builds and each of
 *     the three functions the migrations add;
 *   - a later build passes; a function anon can run fails;
 *   - the only POST is the anon cron aggregate; no function is POSTed, no
 *     writer is called, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-audit-rest-money.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const R_FN = /^R\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_money";

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
  const dir = mkdtempSync(join(tmpdir(), "vdmoney-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${R_FN}\n`;
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

const FNS = ["stripe-webhook", "verify-product-purchase", "create-checkout", "create-test-coupon", "analyze-resume", "reconcile-stripe", "mail-watch", "scan-heartbeat", "notify-owner"];
const MIGRATED = ["affiliate_address_key", "cron_command_secret_names", "cron_disarmed_jobs"];
const preflights = (build: (fn: string) => string | null): Route[] =>
  FNS.map((fn) => { const b = build(fn); return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} }; });
const rpcAnswer = (fn: string, status: number, body: unknown): Route => ({ match: `^GET https://p\\.supabase\\.co/rest/v1/rpc/${fn}(\\?|$)`, status, body: JSON.stringify(body) });
const CRON = [
  { ch_jobname: "refresh-stats-cache", ch_active: true, ch_runs: 26, ch_failed: 26, ch_timeouts: 26, ch_last_status: "failed" },
  { ch_jobname: "mail-watch", ch_active: true, ch_runs: 104, ch_failed: 0, ch_timeouts: 0, ch_last_status: "succeeded" },
];
const cron = (rows: unknown): Route => ({ match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health", body: JSON.stringify(rows) });
const good = (): Route[] => [
  ...preflights((fn) => `${fn}.2026-11-03.1`),
  ...MIGRATED.map((fn) => rpcAnswer(fn, 401, { code: "42501", message: `permission denied for function ${fn}` })),
  cron(CRON),
];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("the audit-rest money section", () => {
  it("a good deploy passes every claim, fails none, and names what R10 will ring for", () => {
    const { lines, out } = run(good());
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")).length, out).toBe(FNS.length + MIGRATED.length);
    expect(lines.some((l) => /^INFO .*R10 will ring on its first run.*refresh-stats-cache \(26 of 26\)/.test(l)), out).toBe(true);
  });

  it("nothing deployed fails every build and every migrated function", () => {
    const { lines, out } = run([
      ...preflights((fn) => `${fn}.2026-10-31.1`),
      ...MIGRATED.map((fn) => rpcAnswer(fn, 404, { code: "PGRST202", message: "Could not find the function" })),
      cron([]),
    ]);
    for (const fn of FNS) expect(fails(lines).some((l) => l.includes(`${fn} preflight x-fn-build = ${fn}.2026-10-31.1`)), `${fn}\n${out}`).toBe(true);
    for (const fn of MIGRATED) expect(fails(lines).some((l) => l.startsWith(`FAIL  ${fn} does not exist`)), `${fn}\n${out}`).toBe(true);
    expect(fails(lines)).toHaveLength(FNS.length + MIGRATED.length);
  });

  it("a later build passes, a missing header fails, and a function anon can run fails", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "mail-watch" ? null : `${fn}.2026-11-14.2`)),
      rpcAnswer("affiliate_address_key", 200, "probe@example.invalid"),
      rpcAnswer("cron_command_secret_names", 401, { code: "42501" }),
      rpcAnswer("cron_disarmed_jobs", 200, []),
      cron(CRON),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  mail-watch preflight carries no x-fn-build (the function is not deployed, or its preflight does not answer)",
      "FAIL  affiliate_address_key ran for anon: 20261103100000 must leave it to the service role",
      "FAIL  cron_disarmed_jobs ran for anon: 20261103120000 must leave it to the service role",
    ]);
    expect(lines.filter((l) => l.startsWith("PASS")).length, out).toBe(FNS.length - 1 + 1);
  });

  it("never writes: the only POST is the anon cron aggregate, no function is POSTed, and the key is never printed", () => {
    const { calls, out } = run(good());
    const posts = calls.filter((c) => c.startsWith("curl\tPOST "));
    expect(posts.map((c) => c.split("\t")[1])).toEqual(["POST https://p.supabase.co/rest/v1/rpc/get_cron_health"]);
    expect(calls.filter((c) => /functions\/v1\//.test(c)).every((c) => c.startsWith("curl\tOPTIONS "))).toBe(true);
    expect(out).not.toContain(KEY);
  });
});
