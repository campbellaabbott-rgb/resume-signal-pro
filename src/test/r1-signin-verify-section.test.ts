// @vitest-environment node
//
// Node, not jsdom: this file runs verify section 95 in bash, with stubs for
// the network, through child_process.
/**
 * R1: VERIFY SECTION 95 CAN FAIL ON EVERYTHING IT PASSES.
 *
 * scripts/verify-deploy.d/95-r1-signin.sh judges the deployed site: the
 * first <head> script on three pages, the live Auth chunk, and each sign-in
 * switch read from the bundle against the account guard being READY (lead
 * decision A, third fixer round): auth-signed-in's R1 build AND migration
 * 20261014110000, read as anon the way section 96 reads it. Each line is run
 * here against a stub site with a positive control (it passes on the R1
 * build over its migration) and a negative one (it fails on the build R1
 * replaces, on a switch flipped before the guard is ready -- the build absent
 * OR the tables missing behind a serving build -- and on Apple).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const SITE = "https://site.test";
const SECTION = resolve(ROOT, "scripts/verify-deploy.d/95-r1-signin.sh");

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Route = { match: string; status?: number; body?: string };
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url,opts)=>{const u=String(url);fs.appendFileSync(process.env.VD_CALLS,((opts&&opts.method)||"GET")+" "+u+"\\n");
const r=routes.find((x)=>new RegExp(x.match).test(u));
return r?new Response(r.body??"",{status:r.status??200}):new Response("",{status:404});};
`;
/**
 * curl answers the auth-signed-in preflight with the build this case names,
 * and the anon GETs of the proof tables and the account-change reader as the
 * case's migration state says: "applied" (42501 for each), "missing" (the
 * table does not exist, the reader is not found), or "readable" (a table
 * anyone can read).
 */
const CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",o=null,w=null,D=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];else if(x==="-D")D=a[++i];
  else if(["-H","-m","-A","-d"].includes(x))i++;else if(/^https?:/.test(x))url=x;}
fs.appendFileSync(process.env.VD_CALLS,"curl "+method+" "+url+"\\n");
const build=process.env.VD_FN_BUILD||"";const mig=process.env.VD_MIGRATION||"applied";
let status=200,body="",head="";
if(method==="OPTIONS"){if(build)head="HTTP/2 200\\r\\nx-fn-build: "+build+"\\r\\n\\r\\n";}
else if(url.includes("/rest/v1/rpc/")){if(mig==="missing"){status=404;body=JSON.stringify({code:"PGRST202",message:"Could not find the function"});}else{status=401;body=JSON.stringify({code:"42501",message:"permission denied"});}}
else if(url.includes("/rest/v1/account_")){if(mig==="missing"){status=404;body=JSON.stringify({code:"PGRST205",message:"Could not find the table"});}else if(mig==="readable"){body="[]";}else{status=401;body=JSON.stringify({code:"42501",message:"permission denied"});}}
if(D==="-")process.stdout.write(head);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o&&D!=="-")process.stdout.write(body);
if(w)process.stdout.write(w.replace("%{http_code}",String(status)));
`;

function run(routes: Route[], fnBuild = "", migration: "applied" | "missing" | "readable" = "applied") {
  const dir = mkdtempSync(join(tmpdir(), "vd-r1-95-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "95.sh"), readFileSync(SECTION, "utf8").split("/tmp/").join(`${dir}/`));
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=${SITE}; UA=ua\n${BUILD_GE}\n. ${JSON.stringify(join(dir, "95.sh"))}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VD_FN_BUILD: fnBuild, VD_MIGRATION: migration,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8") };
}
const has = (lines: string[], status: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${status}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

const esc = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const route = (path: string, body: string, status = 200): Route => ({ match: `^${esc(SITE + path)}$`, status, body });

// The stash script exactly as index.html ships it.
const INDEX = readFileSync(resolve(ROOT, "index.html"), "utf8");
const STASH = /<head[^>]*>\s*(<script>[\s\S]*?<\/script>)/i.exec(INDEX)?.[1] ?? "";
const page = (head: string) => `<!doctype html><html><head>${head}<meta charset="UTF-8"><script type="module" crossorigin src="/assets/index-AAA.js"></script></head><body><div id="root"></div></body></html>`;
const marks = (o: { google?: string; code?: string; recovery?: string; apple?: string } = {}) =>
  ["google", "code", "recovery", "apple"].map((k) => `"rb-auth:${k}=${(o as Record<string, string>)[k] ?? "off"}"`).join(",");

function site(o: { stash?: boolean; magic?: boolean; marks?: string; authExtra?: string } = {}) {
  const head = o.stash === false ? `<script type="application/ld+json">{}</script>` : STASH;
  const main = `const routes={a:()=>import("./Auth-BBB.js")};const flags=[${o.marks ?? marks()}];`;
  const auth = `import{a as x}from"./index-AAA.js";import{C as y}from"./CodeEntry-CCC.js";export default function A(){return ${o.magic ? `"Magic link sent — click it in your inbox"` : `"auth.title"`}}${o.authExtra ?? ""}`;
  return [
    route("/", page(head)),
    route("/auth", page(head)),
    route("/jobs", page(head)),
    route("/assets/index-AAA.js", main),
    route("/assets/Auth-BBB.js", auth),
    route("/assets/CodeEntry-CCC.js", `export const C="one-time-code";`),
  ];
}
const R1_BUILD = "auth-signed-in.2026-10-14.1";

describe("section 95: the first-script stash", () => {
  it("passes on the R1 build, on all three pages", () => {
    const { lines } = run(site());
    for (const p of ["/", "/auth", "/jobs"]) expect(has(lines, "PASS", new RegExp(`^PASS  ${esc(p)}: the first <head> script is the inline classic stash, and the first child`)), p + show(lines)).toBe(true);
  });

  it("fails on the build R1 replaces (an ld+json block first, no stash)", () => {
    const { lines } = run(site({ stash: false }));
    expect(lines.filter((l) => /^FAIL {2}\/(auth|jobs)?: the first <head> script is not the stash/.test(l)).length, show(lines)).toBe(3);
  });

  it("fails on a stash moved behind a module script or deferred", () => {
    const deferred = site().map((r) => r.match.endsWith("/auth$") ? { ...r, body: page(STASH.replace("<script>", "<script defer>")) } : r);
    expect(has(run(deferred).lines, "FAIL", /^FAIL {2}\/auth: the first <head> script is the stash but not inline classic/)).toBe(true);
  });
});

describe("section 95: the live stash script, run for two purchases on /success (S13-002)", () => {
  // The script before the hotfix: the same, without the /success pair rule.
  const BEFORE = STASH.replace(/\n[ \t]*if \(P === "\/success" && \(S\.session_id[^\n]*\n(?:[^\n]*\n){3}[ \t]*\}(?=\n)/, "");

  it("passes on the hotfix script: the second purchase's arrival drops the first one's share", () => {
    const { lines } = run(site());
    expect(has(lines, "PASS", /the live stash script, run for two purchases on \/success in one tab, drops the first purchase share when the second arrives \(S13-002\)/), show(lines)).toBe(true);
    expect(lines.filter((l) => /S13-002/.test(l) && l.startsWith("FAIL")), show(lines)).toEqual([]);
  });

  it("fails on the script R1 shipped first, which kept the old share beside the new purchase", () => {
    expect(BEFORE, "the pre-hotfix script could not be rebuilt from index.html").not.toBe(STASH);
    expect(BEFORE).toContain("rb_url_stash");
    const routes = site().map((r) => r.match.endsWith(`${esc(SITE)}/$`) ? { ...r, body: page(BEFORE) } : r);
    const { lines } = run(routes);
    expect(has(lines, "FAIL", /keeps the first purchase share beside a second purchase on \/success \(S13-002\)/), show(lines)).toBe(true);
  });

  it("fails when the page's stash script cannot be read", () => {
    const routes = site().map((r) => r.match.endsWith(`${esc(SITE)}/$`) ? { ...r, status: 500 } : r);
    expect(has(run(routes).lines, "FAIL", /its \/success rule \(S13-002\) could not be run/)).toBe(true);
  });
});

describe("section 95: the Auth chunk and the switches", () => {
  it("the R1 page with every switch off passes, and names the switches", () => {
    const { lines, calls } = run(site());
    expect(has(lines, "PASS", /Auth-BBB\.js \(with 1 imported chunks\) is the R1 sign-in page/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /carries no magic-link copy/)).toBe(true);
    expect(has(lines, "INFO", /google=off code=off recovery=off apple=off/)).toBe(true);
    for (const l of ["Google sign-in", "Emailed sign-in code", "Password recovery", "Apple sign-in"]) expect(has(lines, "PASS", new RegExp(`${l} is off in the live bundle`)), l).toBe(true);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
    expect(calls).not.toMatch(/^POST /m);
  });

  it("the page R1 replaces fails: no flags mark", () => {
    const { lines } = run(site({ marks: `"nothing"`, magic: true }));
    expect(has(lines, "FAIL", /carries no rb-auth flags mark: the R1 sign-in page is not serving/), show(lines)).toBe(true);
  });

  it("the magic-link copy fails on an R1 page", () => {
    expect(has(run(site({ magic: true })).lines, "FAIL", /still carries the magic-link copy/)).toBe(true);
  });

  it("Google and recovery on before the guard's build serves fail; with the build over its migration, they pass", () => {
    const on = site({ marks: marks({ google: "on", recovery: "on" }), authExtra: `const g="auth.google.continue",r="auth.reset.title";` });
    const early = run(on, "auth-signed-in.2026-10-13.4").lines;
    expect(has(early, "FAIL", /Google sign-in is ON while the account guard is not ready/), show(early)).toBe(true);
    expect(has(early, "FAIL", /Password recovery is ON while the account guard is not ready/)).toBe(true);
    const late = run(on, R1_BUILD).lines;
    expect(has(late, "INFO", /the account guard is ready: auth-signed-in x-fn-build = auth-signed-in\.2026-10-14\.1, and 20261014110000 is applied/), show(late)).toBe(true);
    expect(has(late, "PASS", /Google sign-in is on, and the account guard is ready/), show(late)).toBe(true);
    expect(has(late, "PASS", /recovery is on: the bundle carries the reset form and the one-time-code field/)).toBe(true);
    expect(late.filter((l) => l.startsWith("FAIL")), show(late)).toEqual([]);
  });

  it("the guard's build serving over a MISSING migration is not ready: Google and recovery on FAIL, and the gate line says which object is missing (lead decision A)", () => {
    const on = site({ marks: marks({ google: "on", recovery: "on" }), authExtra: `const g="auth.google.continue",r="auth.reset.title";` });
    const { lines, calls } = run(on, R1_BUILD, "missing");
    expect(has(lines, "FAIL", /auth-signed-in serves auth-signed-in\.2026-10-14\.1 but the account guard is NOT ready: 20261014110000 is not applied \(as anon: account_mailbox_proofs -> PGRST205 account_password_clears -> PGRST205 auth_changed_since -> PGRST202; want 42501 for each\)/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /Google sign-in is ON while the account guard is not ready/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /Password recovery is ON while the account guard is not ready/), show(lines)).toBe(true);
    expect(lines.some((l) => /the account guard is ready/.test(l) && l.startsWith("INFO")), "a missing migration read as ready").toBe(false);
    // The gate's own reads select a real column and go to the reader as a GET.
    expect(calls).toMatch(/curl GET https:\/\/p\.supabase\.co\/rest\/v1\/account_mailbox_proofs\?select=user_id&limit=1/);
    expect(calls).toMatch(/curl GET https:\/\/p\.supabase\.co\/rest\/v1\/account_password_clears\?select=session_id&limit=1/);
    expect(calls).toMatch(/curl GET https:\/\/p\.supabase\.co\/rest\/v1\/rpc\/auth_changed_since\?/);
    expect(calls).not.toMatch(/curl POST /);
  });

  it("a proof table a client can read is not ready either", () => {
    const on = site({ marks: marks({ google: "on" }), authExtra: `const g="auth.google.continue";` });
    const { lines } = run(on, R1_BUILD, "readable");
    expect(has(lines, "FAIL", /the account guard is NOT ready: .*account_mailbox_proofs -> ROWS:0/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /Google sign-in is ON while the account guard is not ready/), show(lines)).toBe(true);
  });

  it("a live page offering Google or Forgot password before the guard is ready fails on the controls themselves, marks or not (S12-057 deploy order)", () => {
    // Even with marks that read "off" or cannot be read, the controls in the
    // bundle say what the page offers.
    const offers = site({ marks: `${marks()},"rb-auth:google=on","rb-auth:recovery=on"`, authExtra: `const g="Continue with Google",f="Forgot password?";` });
    const early = run(offers, "auth-signed-in.2026-10-13.4").lines;
    expect(has(early, "FAIL", /offers Google and "Forgot password\?" while the account guard is not ready: the frontend was published before section 96 passed/), show(early)).toBe(true);
    const behindMissing = run(offers, R1_BUILD, "missing").lines;
    expect(has(behindMissing, "FAIL", /offers Google and "Forgot password\?" while the account guard is not ready: the frontend was published before section 96 passed/), show(behindMissing)).toBe(true);
    const late = run(offers, R1_BUILD).lines;
    expect(has(late, "PASS", /offers Google and "Forgot password\?", and the account guard is ready/), show(late)).toBe(true);
    const plain = run(site(), "auth-signed-in.2026-10-13.4").lines;
    expect(plain.some((l) => /offers Google|Forgot password/.test(l)), "a page offering neither was judged on them").toBe(false);
  });

  it("Apple on always fails", () => {
    expect(has(run(site({ marks: marks({ apple: "on" }) }), R1_BUILD).lines, "FAIL", /Apple sign-in is ON: owner decision D10/)).toBe(true);
  });

  it("a mark the build did not fold cannot be read, and says so", () => {
    const both = site({ marks: `${marks()},"rb-auth:google=on"` });
    expect(has(run(both).lines, "INFO", /Google sign-in: the bundle carries both halves of its mark/)).toBe(true);
  });
});
