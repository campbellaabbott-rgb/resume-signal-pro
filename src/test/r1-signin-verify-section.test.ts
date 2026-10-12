// @vitest-environment node
//
// Node, not jsdom: this file runs verify section 95 in bash, with stubs for
// the network, through child_process.
/**
 * R1: VERIFY SECTION 95 CAN FAIL ON EVERYTHING IT PASSES.
 *
 * scripts/verify-deploy.d/95-r1-signin.sh judges the deployed site: the
 * first <head> script on three pages, the live Auth chunk, and each sign-in
 * switch read from the bundle against the account guard's build. Each line
 * is run here against a stub site with a positive control (it passes on the
 * R1 build) and a negative one (it fails on the build R1 replaces, on a
 * switch flipped before auth-signed-in serves, and on Apple).
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

function run(routes: Route[], fnBuild = "") {
  const dir = mkdtempSync(join(tmpdir(), "vd-r1-95-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  // curl answers only the auth-signed-in preflight, with the build this case names.
  writeFileSync(join(dir, "bin", "curl"), `#!/bin/sh\necho "OPTIONS $*" >> "$VD_CALLS"\n[ -n "$VD_FN_BUILD" ] && printf 'HTTP/2 200\\r\\nx-fn-build: %s\\r\\n\\r\\n' "$VD_FN_BUILD"\nexit 0\n`);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=${SITE}; UA=ua\n${BUILD_GE}\n. ${JSON.stringify(SECTION)}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VD_FN_BUILD: fnBuild,
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

  it("Google and recovery on before auth-signed-in serves its R1 build fail; after, they pass", () => {
    const on = site({ marks: marks({ google: "on", recovery: "on" }), authExtra: `const g="auth.google.continue",r="auth.reset.title";` });
    const early = run(on, "auth-signed-in.2026-10-13.4").lines;
    expect(has(early, "FAIL", /Google sign-in is ON while auth-signed-in does not serve its R1 build/), show(early)).toBe(true);
    expect(has(early, "FAIL", /Password recovery is ON while auth-signed-in does not serve its R1 build/)).toBe(true);
    const late = run(on, "auth-signed-in.2026-10-14.1").lines;
    expect(has(late, "PASS", /Google sign-in is on, and auth-signed-in serves its R1 build/), show(late)).toBe(true);
    expect(has(late, "PASS", /recovery is on: the bundle carries the reset form and the one-time-code field/)).toBe(true);
    expect(late.filter((l) => l.startsWith("FAIL")), show(late)).toEqual([]);
  });

  it("Apple on always fails", () => {
    expect(has(run(site({ marks: marks({ apple: "on" }) }), "auth-signed-in.2026-10-14.1").lines, "FAIL", /Apple sign-in is ON: owner decision D10/)).toBe(true);
  });

  it("a mark the build did not fold cannot be read, and says so", () => {
    const both = site({ marks: `${marks()},"rb-auth:google=on"` });
    expect(has(run(both).lines, "INFO", /Google sign-in: the bundle carries both halves of its mark/)).toBe(true);
  });
});
