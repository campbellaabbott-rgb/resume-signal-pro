// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE HOTFIX PRO SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS BEFORE THE
 * DEPLOY, AND NEVER WRITES (scripts/verify-deploy.d/99zzzzzz-hotfix-pro.sh).
 *
 * Run against a fake curl that answers from routes and logs every call:
 *   - before the deploy (every function on its 2026-11-03.1) it prints INFO
 *     for the builds and no FAIL;
 *   - a full deploy passes all eleven builds;
 *   - a partial deploy fails each function left behind, a missing header
 *     after the deploy fails, and a later build passes;
 *   - an anonymous check that describes a plan, a portal that opens without a
 *     session, and a webhook that answers a GET each fail;
 *   - every call is an OPTIONS or a GET, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-hotfix-pro.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_hotfix_pro";

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
  const dir = mkdtempSync(join(tmpdir(), "vdhotfixpro-"));
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

const FNS = [
  "check-subscription", "create-portal-session", "create-subscription-checkout", "stripe-webhook", "analyze-resume", "create-agent-checkout",
  "create-checkout", "create-product-checkout", "generate-apply-package", "generate-freelance-boost", "verify-product-purchase",
];
const preflights = (build: (fn: string) => string | null): Route[] =>
  FNS.map((fn) => { const b = build(fn); return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, status: fn === "stripe-webhook" ? 405 : 200, headers: b ? { "x-fn-build": b } : {} }; });
const anonAnswers = (over: { check?: unknown; portal?: number; webhook?: number } = {}): Route[] => [
  { match: "^GET https://p\\.supabase\\.co/functions/v1/check-subscription$", body: JSON.stringify(over.check ?? { active: false, status: "sign_in_required" }) },
  { match: "^GET https://p\\.supabase\\.co/functions/v1/create-portal-session$", status: over.portal ?? 401, body: JSON.stringify({ error: "Sign in required" }) },
  { match: "^GET https://p\\.supabase\\.co/functions/v1/stripe-webhook$", status: over.webhook ?? 405, body: "Method not allowed" },
];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("the hotfix pro section", () => {
  it("before the deploy says INFO for every build and fails nothing", () => {
    const { lines, out } = run([...preflights((fn) => `${fn}.2026-11-03.1`), ...anonAnswers()]);
    expect(fails(lines), out).toEqual([]);
    for (const fn of FNS) expect(lines.some((l) => l.startsWith(`INFO  ${fn} preflight x-fn-build = ${fn}.2026-11-03.1: hotfix pro is not deployed yet`)), `${fn}\n${out}`).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), out).toHaveLength(3);
  });

  it("a full deploy passes all eleven builds and the three guards", () => {
    const { lines, out } = run([...preflights((fn) => `${fn}.2026-11-10.1`), ...anonAnswers()]);
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")), out).toHaveLength(FNS.length + 3);
  });

  it("a partial deploy fails each function left behind, and a missing header fails once others serve the build", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "stripe-webhook" ? "stripe-webhook.2026-11-03.1" : fn === "verify-product-purchase" ? null : `${fn}.2026-11-10.1`)),
      ...anonAnswers(),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  stripe-webhook preflight x-fn-build = stripe-webhook.2026-11-03.1 while others serve 2026-11-10.1: a partial deploy (want stripe-webhook.2026-11-10.1 or later)",
      "FAIL  verify-product-purchase preflight carries no x-fn-build while others serve 2026-11-10.1 (want verify-product-purchase.2026-11-10.1 or later)",
    ]);
  });

  it("a later build passes, and another function's build never stands in for this one", () => {
    const { lines, out } = run([
      ...preflights((fn) => (fn === "create-checkout" ? "create-product-checkout.2026-11-10.1" : `${fn}.2026-11-14.2`)),
      ...anonAnswers(),
    ]);
    expect(fails(lines), out).toEqual([
      "FAIL  create-checkout preflight x-fn-build = create-product-checkout.2026-11-10.1 while others serve 2026-11-10.1: a partial deploy (want create-checkout.2026-11-10.1 or later)",
    ]);
  });

  it("an anonymous check that describes a plan, a portal opened without a session, and a webhook that answers a GET each fail", () => {
    const { lines, out } = run([
      ...preflights((fn) => `${fn}.2026-11-10.1`),
      ...anonAnswers({ check: { active: false, status: "sign_in_required", needsPaymentUpdate: true }, portal: 200, webhook: 200 }),
    ]);
    const f = fails(lines);
    expect(f, out).toHaveLength(3);
    expect(f[0]).toMatch(/^FAIL {2}A1 check-subscription with no session .*it said needsPaymentUpdate/);
    expect(f[1]).toBe("FAIL  A2 create-portal-session with no session -> 200 (want 401: billing opens only for a signed-in account)");
    expect(f[2]).toBe("FAIL  A3 stripe-webhook GET -> 200 (want 405: only a signed POST from Stripe is read)");
    const live = run([...preflights((fn) => `${fn}.2026-11-10.1`), ...anonAnswers({ check: { active: true, status: "active" } })]);
    expect(fails(live.lines), live.out).toHaveLength(1);
  });

  it("never writes: every call is an OPTIONS or a GET, no body is sent, and the key is never printed", () => {
    const { calls, out } = run([...preflights((fn) => `${fn}.2026-11-10.1`), ...anonAnswers()]);
    expect(calls.length).toBe(FNS.length + 3);
    expect(calls.every((c) => /^curl\t(OPTIONS|GET) /.test(c) && c.split("\t").length === 2), calls.join("\n")).toBe(true);
    expect(out).not.toContain(KEY);
  });
});
