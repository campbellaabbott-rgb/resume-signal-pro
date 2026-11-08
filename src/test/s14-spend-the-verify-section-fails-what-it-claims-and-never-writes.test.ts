// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE S14 SPEND LANE'S VERIFY SECTION FAILS WHAT IT CLAIMS, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzz-hotfix-spend.sh is run against a fake curl
 * that answers from routes and logs every call:
 *   - before the deploy (every function on an earlier build) it prints INFO
 *     lines and no FAIL, and POSTs nothing;
 *   - a good deploy prints a PASS for each of the thirteen builds, each of
 *     the three refusals and the diagnostic's preflight, and no FAIL;
 *   - a function the deploy left behind, a preflight with no build, an answer
 *     that drafted, extracted or ran a model, a gateway's HTML, and a
 *     preflight that refuses x-admin-key each print a FAIL;
 *   - a later build passes; the only POSTs go to the three functions, only
 *     once they serve this lane's build; the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-hotfix-spend.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_spend";

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
  const dir = mkdtempSync(join(tmpdir(), "vdsp-"));
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
  "generate-application-answers", "import-freelance-profile", "test-ai-fallback", "generate-apply-package", "generate-ats-defense",
  "generate-career-path", "generate-career-snapshot", "generate-cover-letter-stream", "generate-graduate-gameplan",
  "generate-interview-coach", "generate-keyword-fix", "generate-premium-package", "generate-premium-package-stream",
];
const ALLOW = "authorization, x-client-info, apikey, content-type, x-admin-key";
const preflights = (build: (fn: string) => string | null, allow = ALLOW): Route[] =>
  FNS.map((fn) => {
    const b = build(fn);
    const headers: Record<string, string> = { "access-control-allow-headers": fn === "test-ai-fallback" ? allow : "authorization, x-client-info, apikey, content-type" };
    if (b) headers["x-fn-build"] = b;
    return { match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers };
  });
const NEW = (fn: string) => `${fn}.2026-11-10.1`;
const OLD = (fn: string) => `${fn}.2026-11-03.1`;
const ANSWERS_REFUSAL: Route = { match: "^POST https://p\\.supabase\\.co/functions/v1/generate-application-answers ", status: 401, body: JSON.stringify({ error: "sign_in_required", code: "sign_in_required" }) };
const IMPORT_REFUSAL: Route = { match: "^POST https://p\\.supabase\\.co/functions/v1/import-freelance-profile ", status: 402, body: JSON.stringify({ error: "Import is part of a Freelance Boost purchase. Open the link in your purchase email to use it.", requiresPurchase: true }) };
const DIAG_REFUSAL: Route = { match: "^POST https://p\\.supabase\\.co/functions/v1/test-ai-fallback ", status: 401, body: JSON.stringify({ success: false, error: "Unauthorized: the AI diagnostic needs the admin key." }) };
const good = (over: Route[] = [], build: (fn: string) => string | null = NEW, allow = ALLOW): Route[] => [...over, ...preflights(build, allow), ANSWERS_REFUSAL, IMPORT_REFUSAL, DIAG_REFUSAL];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const posts = (calls: string[]) => calls.filter((c) => /^curl\tPOST /.test(c));

describe("section 99zzzzzz (S14 hotfix, spend)", () => {
  it("before the deploy it prints INFO and no FAIL, and POSTs nothing", () => {
    const { lines, calls, out } = run(good([], OLD));
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")), out).toEqual([]);
    expect(lines.filter((l) => /not deployed yet/.test(l))).toHaveLength(FNS.length);
    expect(posts(calls), "a function on an older bundle was asked, and would have spent a model call").toEqual([]);
  });

  it("a good deploy PASSes all thirteen builds, the three refusals and the diagnostic's preflight, with no FAIL", () => {
    const { lines, out } = run(good());
    expect(fails(lines), out).toEqual([]);
    const pass = lines.filter((l) => l.startsWith("PASS"));
    expect(pass.filter((l) => /preflight x-fn-build/.test(l))).toHaveLength(FNS.length);
    expect(pass.some((l) => /^PASS  generate-application-answers answers a stranger 401/.test(l)), out).toBe(true);
    expect(pass.some((l) => /^PASS  import-freelance-profile answers a stranger 402/.test(l)), out).toBe(true);
    expect(pass.some((l) => /^PASS  test-ai-fallback answers a stranger 401/.test(l)), out).toBe(true);
    expect(pass.some((l) => /^PASS  test-ai-fallback preflight allows x-admin-key/.test(l)), out).toBe(true);
  });

  it("a later build of each passes too", () => {
    const { lines, out } = run(good([], (fn) => `${fn}.2026-11-24.3`));
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => /^PASS .*preflight x-fn-build/.test(l))).toHaveLength(FNS.length);
  });

  it("a function the deploy left behind is a FAIL, once any of the thirteen serves the new build", () => {
    const { lines, out } = run(good([], (fn) => (fn === "generate-keyword-fix" ? OLD(fn) : NEW(fn))));
    expect(fails(lines), out).toEqual([expect.stringMatching(/^FAIL  generate-keyword-fix preflight x-fn-build = generate-keyword-fix\.2026-11-03\.1: the deploy .* left this one behind/)]);
  });

  it("a preflight that carries no build is a FAIL, before the deploy and after it", () => {
    for (const other of [OLD, NEW]) {
      const { lines, out } = run(good([], (fn) => (fn === "test-ai-fallback" ? null : other(fn))));
      expect(fails(lines).some((l) => /^FAIL  test-ai-fallback preflight carries no x-fn-build/.test(l)), out).toBe(true);
    }
  });

  it("an answers function that drafted for a visitor is a FAIL", () => {
    const { lines, out } = run(good([{ match: "^POST https://p\\.supabase\\.co/functions/v1/generate-application-answers ", status: 200, body: JSON.stringify({ answers: [{ question: "Why?", answer: "Because." }], skipped: [] }) }]));
    expect(fails(lines).some((l) => /^FAIL  generate-application-answers did not refuse .*HTTP 200.*it carries answers/.test(l)), out).toBe(true);
  });

  it("an importer that extracted for a caller with no purchase is a FAIL", () => {
    const { lines, out } = run(good([{ match: "^POST https://p\\.supabase\\.co/functions/v1/import-freelance-profile ", status: 200, body: JSON.stringify({ success: true, data: { projects: [] } }) }]));
    expect(fails(lines).some((l) => /^FAIL  import-freelance-profile did not refuse .*HTTP 200.*extraction/.test(l)), out).toBe(true);
  });

  it("a diagnostic that ran its models for a stranger is a FAIL", () => {
    const { lines, out } = run(good([{ match: "^POST https://p\\.supabase\\.co/functions/v1/test-ai-fallback ", status: 200, body: JSON.stringify({ success: true, mode: "quick", chains: [] }) }]));
    expect(fails(lines).some((l) => /^FAIL  test-ai-fallback did not refuse .*a model ran/.test(l)), out).toBe(true);
  });

  it("a gateway's HTML answer is a FAIL that shows it, never a crash into silence", () => {
    const { lines, out } = run(good([{ match: "^POST https://p\\.supabase\\.co/functions/v1/import-freelance-profile ", status: 502, body: "<html>Bad gateway</html>" }]));
    expect(fails(lines).some((l) => /^FAIL  import-freelance-profile did not refuse .*no JSON body.*Bad gateway/.test(l)), out).toBe(true);
  });

  it("a diagnostic preflight that refuses x-admin-key is a FAIL", () => {
    const { lines, out } = run(good([], NEW, "authorization, x-client-info, apikey, content-type"));
    expect(fails(lines).some((l) => /^FAIL  test-ai-fallback preflight does not allow x-admin-key/.test(l)), out).toBe(true);
  });

  it("POSTs only the three functions, each once, never a paid generator, and never prints the key", () => {
    const { calls, out } = run(good());
    const posted = posts(calls).map((c) => /functions\/v1\/([a-z-]+)/.exec(c)?.[1]).sort();
    expect(posted).toEqual(["generate-application-answers", "import-freelance-profile", "test-ai-fallback"]);
    // The importer is never sent a session, so it answers before any lookup.
    expect(posts(calls).find((c) => c.includes("import-freelance-profile"))).not.toMatch(/sessionId/);
    // The diagnostic is never sent a key.
    expect(posts(calls).find((c) => c.includes("test-ai-fallback"))).not.toMatch(/adminKey/);
    expect(out).not.toContain(KEY);
  });

  it("says where the migration's counts are kept, as INFO", () => {
    const { lines } = run(good());
    expect(lines.some((l) => /^INFO  20261110140000 .*paid_session_names/.test(l))).toBe(true);
  });
});
