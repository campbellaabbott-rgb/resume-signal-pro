// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * R1: VERIFY SECTION 96 CAN FAIL, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/96-r1-signin-server.sh is the post-deploy proof for
 * the sign-in server half. A PASS is worth something only if a regression
 * could have turned it into a FAIL (verify-deploy.d/README.md). The section
 * is cut into bash here and run against a fake curl that answers from routes
 * and logs every call:
 *   - a good deploy prints only PASS lines;
 *   - nothing deployed yet prints FAIL for the builds and INFO for what
 *     cannot be judged before they serve;
 *   - a table a client can read, a definer a client can call, a refusal that
 *     comes from the old build, or a preflight that does not answer the site's
 *     origin, each prints FAIL;
 *   - every RPC is a GET, the only POSTs are the two refused auth-signed-in
 *     calls, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/96-r1-signin-server.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const PROBE = /^probe\(\) \{[\s\S]*?esac; \}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_123";

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

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd96-"));
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
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const ASI = "auth-signed-in.2026-10-14.1";
const VPP = "verify-product-purchase.2026-10-14.1";
const denied = (code = "42501") => JSON.stringify({ code, message: "permission denied" });
const GOOD: Route[] = [
  { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/auth-signed-in$", headers: { "x-fn-build": ASI, "access-control-allow-origin": "https://resumebooster.work" } },
  { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/verify-product-purchase$", headers: { "x-fn-build": VPP } },
  { match: "^POST https://p\\.supabase\\.co/functions/v1/auth-signed-in$", status: 401, headers: { "x-fn-build": ASI }, body: JSON.stringify({ error: "Sign in first.", reason: "not_signed_in" }) },
  { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 401, body: denied() },
  { match: "^GET https://p\\.supabase\\.co/rest/v1/account_", status: 401, body: denied() },
];
const statuses = (lines: string[]) => lines.map((l) => l.slice(0, 4));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

describe("verify section 96", () => {
  it("a good deploy prints only PASS lines, one per claim", () => {
    const { lines } = run(GOOD);
    expect(lines[0]).toMatch(/^== 96\./);
    const body = lines.slice(1);
    expect(statuses(body).every((s) => s === "PASS"), show(lines)).toBe(true);
    expect(body.length, show(lines)).toBe(10);
    expect(body.some((l) => /publishable key -> 401 reason not_signed_in from auth-signed-in\.2026-10-14\.1/.test(l)), show(lines)).toBe(true);
  });

  it("nothing deployed: the builds FAIL, and what cannot be judged before they serve is INFO", () => {
    const { lines } = run([
      { match: "^POST https://p\\.supabase\\.co/functions/v1/auth-signed-in$", status: 404, body: "{}" },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 404, body: JSON.stringify({ code: "PGRST202", message: "Could not find the function" }) },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/account_", status: 404, body: JSON.stringify({ code: "PGRST205", message: "Could not find the table" }) },
    ]);
    const fails = lines.filter((l) => l.startsWith("FAIL"));
    expect(fails.some((l) => /auth-signed-in preflight carries no x-fn-build/.test(l)), show(lines)).toBe(true);
    expect(fails.some((l) => /verify-product-purchase preflight carries no x-fn-build/.test(l)), show(lines)).toBe(true);
    expect(fails.some((l) => /POST with no token -> 404/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^INFO {2}auth-signed-in POST with the publishable key/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => /^INFO .*PGRST202/.test(l))).toHaveLength(3);
    expect(lines.filter((l) => /^INFO .*not applied/.test(l))).toHaveLength(5);
    expect(lines.some((l) => l.startsWith("PASS")), show(lines)).toBe(false);
  });

  it("each regression is a FAIL: an old build's refusal, a 200, a readable table, a callable definer, a preflight that refuses the site", () => {
    const old = run(GOOD.map((r) => (r.match.startsWith("^POST") ? { ...r, headers: { "x-fn-build": "auth-signed-in.2026-10-13.9" } } : r)));
    expect(old.lines.some((l) => /^FAIL .*publishable key -> 401 reason not_signed_in build auth-signed-in\.2026-10-13\.9/.test(l)), show(old.lines)).toBe(true);

    const opened = run(GOOD.map((r) => (r.match.startsWith("^POST") ? { ...r, status: 200, body: JSON.stringify({ proven: false }) } : r)));
    expect(opened.lines.filter((l) => /^FAIL .*auth-signed-in POST/.test(l)), show(opened.lines)).toHaveLength(2);

    const readable = run([{ match: "^GET https://p\\.supabase\\.co/rest/v1/account_mailbox_proofs", status: 200, body: "[]" }, ...GOOD]);
    expect(readable.lines.some((l) => /^FAIL {2}account_mailbox_proofs is READABLE as anon/.test(l)), show(readable.lines)).toBe(true);

    const callable = run([{ match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/auth_user_has_password", status: 500, body: JSON.stringify({ code: "25006", message: "read-only" }) }, ...GOOD]);
    expect(callable.lines.some((l) => /^FAIL {2}auth_user_has_password is CALLABLE as anon/.test(l)), show(callable.lines)).toBe(true);

    const star = run(GOOD.map((r) => (r.match.includes("OPTIONS https://p\\.supabase\\.co/functions/v1/auth-signed-in") ? { ...r, headers: { "x-fn-build": ASI, "access-control-allow-origin": "https://evil.example" } } : r)));
    expect(star.lines.some((l) => /^FAIL {2}auth-signed-in preflight access-control-allow-origin = https:\/\/evil\.example/.test(l)), show(star.lines)).toBe(true);

    const stale = run(GOOD.map((r) => (r.match.includes("verify-product-purchase") ? { ...r, headers: { "x-fn-build": "verify-product-purchase.2026-10-09.71" } } : r)));
    expect(stale.lines.some((l) => /^FAIL {2}verify-product-purchase preflight x-fn-build = verify-product-purchase\.2026-10-09\.71/.test(l)), show(stale.lines)).toBe(true);
  });

  it("never writes: every RPC is a GET, the only POSTs are the two refused auth-signed-in calls, and the key is never printed", () => {
    const { calls, out } = run(GOOD);
    const posts = calls.filter((c) => /^curl\tPOST /.test(c));
    expect(posts).toHaveLength(2);
    for (const p of posts) expect(p).toMatch(/^curl\tPOST https:\/\/p\.supabase\.co\/functions\/v1\/auth-signed-in\t\{\}$/);
    expect(calls.filter((c) => /rest\/v1\/rpc\//.test(c)).every((c) => /^curl\tGET /.test(c))).toBe(true);
    expect(calls.filter((c) => /rest\/v1\/rpc\//.test(c))).toHaveLength(3);
    expect(calls.some((c) => /verify-product-purchase/.test(c) && !/^curl\tOPTIONS /.test(c)), "verify-product-purchase is only ever preflighted").toBe(false);
    expect(out).not.toContain(KEY);
  });
});
