// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND SITE-SHELL SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * BEFORE THE PASTE, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzzzzz-bugs-site-shell.sh).
 *
 * Run against a fake curl that answers from routes and logs every call, and a
 * ledger fixture standing in for docs/deploy-ledger.json:
 *   - before the paste (both functions on an older build, ab_purchase_known
 *     missing, the old head script, the old bundle) it prints INFO and no
 *     FAIL, and SEO-F10 prints owner pending;
 *   - a full paste passes both builds, the helper, the claim page, the head
 *     script and the published shell; the head script judged is this
 *     branch's own index.html;
 *   - a partial paste fails the function left behind; a later build passes
 *     and the other function's build never stands in;
 *   - the helper missing after the paste, answering anon, or read beside a
 *     negative control that does not answer PGRST202 each fail;
 *   - a claim page that is not a page fails; a head whose only mention of the
 *     token is a comment does not pass;
 *   - after the paste an unpublished shell fails, naming what is missing;
 *   - SEO-F10, once decided, judges the fallback shell;
 *   - every call is an OPTIONS or a GET, no body is sent, and the key is
 *     never printed;
 *   - every string the section looks for in the bundle is one this branch's
 *     source writes.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-site-shell.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bugs_site_shell";
const INDEX_HTML = readFileSync(resolve(ROOT, "index.html"), "utf8");

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

function run(routes: Route[], ownerDecided: Record<string, unknown> = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbugssiteshell-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided } } }));
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDBS_LEDGER: join(dir, "ledger.json"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GET = (url: string) => `^GET ${esc(url)}$`;

const FNS = ["company-claim", "track-ab-event"];
const OLD = (fn: string) => `${fn}.2026-11-09.1`;
const NEW = (fn: string) => `${fn}.2026-11-12.1`;
const preflights = (build: (fn: string) => string | null): Route[] =>
  FNS.map((fn) => { const b = build(fn); return { match: `^OPTIONS ${esc(`https://p.supabase.co/functions/v1/${fn}`)}$`, headers: b ? { "x-fn-build": b } : {} }; });

const RPC = (name: string) => GET(`https://p.supabase.co/rest/v1/rpc/${name}?p_session_id=cs_test_rbverify`);
const NOT_FOUND = { status: 404, body: JSON.stringify({ code: "PGRST202", message: "Could not find the function" }) };
const REFUSED = { status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for function ab_purchase_known" }) };
const helper = (state: "missing" | "refused" | "answers", control: Partial<Route> = NOT_FOUND): Route[] => [
  { match: RPC("rb_verify_never_a_function"), ...control },
  { match: RPC("ab_purchase_known"), ...(state === "missing" ? NOT_FOUND : state === "refused" ? REFUSED : { body: "false" }) },
];

const LANDER = "https://site.test/jobs/company/careers.ulta.com/?claim_verify=00000000-0000-0000-0000-000000000000";
const PAGE = "https://site.test/jobs/company/careers.ulta.com/";
/** This branch's head, as the host serves it. */
const HEAD_NEW = INDEX_HTML;
/** The same head without the line that moves the token: its comment still names it. */
const HEAD_OLD = INDEX_HTML.replace(/^.*v = q\.get\("claim_verify"\);.*\n/m, "");
const claimPage = (head: string, lander: Partial<Route> = { body: "x".repeat(20_000) }): Route[] => [
  { match: GET(LANDER), ...lander },
  { match: GET(PAGE), body: head },
];

const ENTRY_NEW = [
  `const a=()=>import("./NotFound-Nf1.js");`,
  `console.debug("Funnel landing after consent failed:",e);`,
  `const r=/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;`,
  `const s={siteShell:{newVersion:{loading:"Loading the new version…"}}};`,
  `t("siteShell.crashHome","Go to the homepage");t(\`siteShell.titles.\${k}\`);`,
].join("");
const ENTRY_OLD = `const a=()=>import("./NotFound-Nf1.js");const r=/Unable to preload CSS/;sessionStorage.setItem("rb_chunk_reload_at",n);`;
const NF_NEW = `t("notFound.returnHome");t("siteShell.notFound.jobs");t("siteShell.notFound.pricing");`;
const NF_OLD = `s.useEffect(()=>{console.error("404 Error: User attempted to access non-existent route:",o.pathname)},[o.pathname]);`;
const site = (published: boolean, opts: { entry?: string; fallback?: string } = {}): Route[] => [
  { match: GET("https://site.test/"), body: '<script type="module" src="/assets/index-AbC123.js"></script>' },
  { match: GET("https://site.test/assets/index-AbC123.js"), body: opts.entry ?? (published ? ENTRY_NEW : ENTRY_OLD) },
  { match: GET("https://site.test/assets/NotFound-Nf1.js"), body: published ? NF_NEW : NF_OLD },
  { match: GET("https://site.test/rb-verify-no-baked-page-here"), body: opts.fallback ?? INDEX_HTML },
];

const before = (): Route[] => [...preflights(OLD), ...helper("missing"), ...claimPage(HEAD_OLD), ...site(false)];
const after = (): Route[] => [...preflights(NEW), ...helper("refused"), ...claimPage(HEAD_NEW), ...site(true)];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));

describe("the bug round site-shell section", () => {
  it("before the paste says INFO for every build, the helper, the head script, the shell and the owner key, and fails nothing", () => {
    const { lines, out } = run(before());
    expect(fails(lines), out).toEqual([]);
    for (const fn of FNS) expect(lines.some((l) => l.startsWith(`INFO  B ${fn} preflight x-fn-build = ${OLD(fn)}: bug round A is not pasted yet`)), `${fn}\n${out}`).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  M1 ab_purchase_known does not exist yet")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  H1 the served head's first script does not stash the claim token yet (notoken nopath)")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  F1 the published site lacks the landing held for the analytics yes (S14X-040); the chunk-load test the boundaries read (NB-41); the new-version screen's English string (NB-41); the crash screen's homepage link (NB-40); the route titles (NB-43); the 404 page's board and pricing links (NB-44); a 404 page without its console error (NB-44)")), out).toBe(true);
    expect(lines.some((l) => l.startsWith("INFO  SEO-F10 owner pending")), out).toBe(true);
    // The claim page is today's fact, judged before the paste too.
    expect(passes(lines), out).toEqual([expect.stringMatching(/^PASS {2}L1 /)]);
  });

  it("a full paste passes both builds, the helper, the claim page, this branch's head script and the published shell", () => {
    const { lines, out } = run(after());
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines).map((l) => l.slice(0, 10)), out).toEqual(["PASS  B co", "PASS  B tr", "PASS  M1 a", "PASS  L1 /", "PASS  H1 t", "PASS  F1 t"]);
    expect(lines.some((l) => l.startsWith("INFO  SEO-F10 owner pending")), out).toBe(true);
  });

  it("a partial paste fails the function left behind, and a missing header fails once the other serves the build", () => {
    const old = run([...preflights((fn) => (fn === "track-ab-event" ? OLD(fn) : NEW(fn))), ...helper("refused"), ...claimPage(HEAD_NEW), ...site(true)]);
    expect(fails(old.lines), old.out).toEqual([
      "FAIL  B track-ab-event preflight x-fn-build = track-ab-event.2026-11-09.1 while the lane's other function serves 2026-11-12.1: a partial paste (want track-ab-event.2026-11-12.1 or later)",
    ]);
    const none = run([...preflights((fn) => (fn === "company-claim" ? null : NEW(fn))), ...helper("refused"), ...claimPage(HEAD_NEW), ...site(true)]);
    expect(fails(none.lines), none.out).toEqual([
      "FAIL  B company-claim preflight carries no x-fn-build while the lane's other function serves 2026-11-12.1 (want company-claim.2026-11-12.1 or later)",
    ]);
  });

  it("a later build passes, and the other function's build never stands in", () => {
    const later = run([...preflights((fn) => `${fn}.2026-11-14.3`), ...helper("refused"), ...claimPage(HEAD_NEW), ...site(true)]);
    expect(fails(later.lines), later.out).toEqual([]);
    const borrowed = run([...preflights((fn) => (fn === "company-claim" ? "track-ab-event.2026-11-12.1" : NEW(fn))), ...helper("refused"), ...claimPage(HEAD_NEW), ...site(true)]);
    expect(fails(borrowed.lines), borrowed.out).toEqual([
      "FAIL  B company-claim preflight x-fn-build = track-ab-event.2026-11-12.1 while the lane's other function serves 2026-11-12.1: a partial paste (want company-claim.2026-11-12.1 or later)",
    ]);
  });

  it("the helper missing after the paste fails, answering anon fails even before it, and a control that does not answer PGRST202 fails", () => {
    const missing = run([...preflights(NEW), ...helper("missing"), ...claimPage(HEAD_NEW), ...site(true)]);
    expect(fails(missing.lines), missing.out).toEqual([
      "FAIL  M1 ab_purchase_known does not exist while the lane's functions serve 2026-11-12.1: 20261112140517 did not apply, so track-ab-event records every purchase conversion as unverified (re-apply it under a fresh stamp)",
    ]);
    const answers = run([...preflights(OLD), ...helper("answers"), ...claimPage(HEAD_OLD), ...site(false)]);
    expect(fails(answers.lines), answers.out).toEqual([
      "FAIL  M1 ab_purchase_known answered anon (200 false): a stranger can ask which checkout ids exist; it must be the service role's alone",
    ]);
    const control = run([...preflights(NEW), ...helper("refused", REFUSED), ...claimPage(HEAD_NEW), ...site(true)]);
    expect(fails(control.lines), control.out).toEqual([
      "FAIL  M1 the negative control (rpc/rb_verify_never_a_function) answered 42501, not PGRST202: the API is not answering by name, so ab_purchase_known's answer (42501) cannot be read",
    ]);
  });

  it("a claim page that is not a page fails, before the paste and after it", () => {
    const gone = run([...preflights(OLD), ...helper("missing"), ...claimPage(HEAD_OLD, { status: 404, body: "Not found" }), ...site(false)]);
    expect(fails(gone.lines), gone.out).toEqual([
      "FAIL  L1 /jobs/company/careers.ulta.com/?claim_verify=... answered 404 with 9 bytes (want 200 and more than 10,000): the company page the claim mail links is not a page",
    ]);
    const thin = run([...preflights(NEW), ...helper("refused"), ...claimPage(HEAD_NEW, { body: "<html></html>" }), ...site(true)]);
    expect(fails(thin.lines), thin.out).toEqual([expect.stringMatching(/^FAIL {2}L1 .* answered 200 with 13 bytes/)]);
  });

  it("after the paste the old head script fails, a head with no inline script fails, and a comment naming the token never passes", () => {
    const old = run([...preflights(NEW), ...helper("refused"), ...claimPage(HEAD_OLD), ...site(true)]);
    expect(HEAD_OLD).toContain("claim_verify");
    expect(fails(old.lines), old.out).toEqual([
      "FAIL  H1 the served head's first script does not stash the claim token (notoken nopath) while the lane's functions serve 2026-11-12.1: the round's frontend publish has not happened",
    ]);
    const commented = run([...preflights(NEW), ...helper("refused"), ...claimPage(`<html><head><script>/* q.get("claim_verify") and S.claim_verify_path = P */ var x = 1;</script></head></html>`), ...site(true)]);
    expect(fails(commented.lines), commented.out).toEqual([expect.stringContaining("FAIL  H1 the served head's first script does not stash the claim token (notoken nopath)")]);
    const bare = run([...preflights(OLD), ...helper("missing"), ...claimPage(`<html><head><title>t</title><script src="/a.js"></script></head></html>`), ...site(false)]);
    expect(fails(bare.lines), bare.out).toEqual([
      "FAIL  H1 /jobs/company/careers.ulta.com/ as served has no inline script in its head: the stash script that must run first is gone",
    ]);
  });

  it("after the paste an unpublished shell fails, naming what is missing, and one missing string is named alone", () => {
    const { lines, out } = run([...preflights(NEW), ...helper("refused"), ...claimPage(HEAD_NEW), ...site(false)]);
    expect(fails(lines), out).toEqual([
      "FAIL  F1 the published site lacks the landing held for the analytics yes (S14X-040); the chunk-load test the boundaries read (NB-41); the new-version screen's English string (NB-41); the crash screen's homepage link (NB-40); the route titles (NB-43); the 404 page's board and pricing links (NB-44); a 404 page without its console error (NB-44) while the lane's functions serve 2026-11-12.1: the round's frontend publish has not happened",
    ]);
    const one = run([...preflights(NEW), ...helper("refused"), ...claimPage(HEAD_NEW), ...site(true, { entry: ENTRY_NEW.replace("siteShell.crashHome", "x") })]);
    expect(fails(one.lines), one.out).toEqual([
      "FAIL  F1 the published site lacks the crash screen's homepage link (NB-40) while the lane's functions serve 2026-11-12.1: the round's frontend publish has not happened",
    ]);
  });

  it("an entry that names no NotFound chunk is a FAIL even before the paste: nothing could be judged", () => {
    const { lines, out } = run([...preflights(OLD), ...helper("missing"), ...claimPage(HEAD_OLD), ...site(false, { entry: "const x=1;" })]);
    expect(fails(lines), out).toEqual([
      "FAIL  F1 the served entry (/assets/index-AbC123.js) names no NotFound chunk: the frontend is not serving, or the bundle layout moved, so the published shell cannot be judged",
    ]);
  });

  it("SEO-F10 once decided judges the fallback shell, and a decision to keep it ships nothing", () => {
    const FALLBACK = `${INDEX_HTML}<script data-fallback-noindex>/* noindex */</script>`;
    const shipped = run([...after().filter((r) => !r.match.includes("rb-verify")), ...site(true, { fallback: FALLBACK })], { "SEO-F10": "noindex on the fallback for every path except '/'" });
    expect(fails(shipped.lines), shipped.out).toEqual([]);
    expect(shipped.lines.some((l) => l.startsWith("PASS  SEO-F10 decided (noindex on the fallback for every path except '/')")), shipped.out).toBe(true);
    const unshipped = run(after(), { "SEO-F10": { choice: "noindex on the fallback for every path except '/'" } });
    expect(fails(unshipped.lines), unshipped.out).toEqual([
      "FAIL  SEO-F10 decided (noindex on the fallback for every path except '/'), but the fallback shell served for an address with no baked page carries no noindex script while the lane's functions serve 2026-11-12.1: the owner half did not publish",
    ]);
    const early = run(before(), { "SEO-F10": "noindex on the fallback for every path except '/'" });
    expect(fails(early.lines), early.out).toEqual([]);
    expect(early.lines.some((l) => l.startsWith("INFO  SEO-F10 decided") && l.includes("the round has not published")), early.out).toBe(true);
    const kept = run(after(), { "SEO-F10": "keep index, follow" });
    expect(kept.lines.some((l) => l === "INFO  SEO-F10 decided (keep index, follow): the fallback keeps index, follow, as today; nothing ships"), kept.out).toBe(true);
    expect(kept.calls.some((c) => c.includes("rb-verify-no-baked-page-here")), "a decision that ships nothing still fetched the fallback").toBe(false);
  });

  it("every call is an OPTIONS or a GET with no body, and the key is never printed", () => {
    for (const { calls, out } of [run(before()), run(after(), { "SEO-F10": "noindex" })]) {
      expect(calls.length).toBeGreaterThan(8);
      for (const c of calls) expect(c, c).toMatch(/^curl\t(OPTIONS|GET) https:\/\/\S+$/);
      expect(out).not.toContain(KEY);
    }
  });
});

describe("what the section looks for is what this branch writes", () => {
  const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
  it("each bundle string is in the source the section names, and the 404 page's old console error is gone", () => {
    expect(src("src/hooks/use-funnel-tracking.ts")).toContain("Funnel landing after consent failed:");
    expect(src("src/lib/new-version-reload.ts")).toContain("Importing a module script failed");
    expect(JSON.parse(src("src/i18n/shards/site-shell/en.json")).siteShell.newVersion.loading).toContain("Loading the new version");
    expect(src("src/components/ErrorBoundary.tsx")).toContain('"siteShell.crashHome"');
    expect(src("src/components/RouteDefaultHead.tsx")).toContain("siteShell.titles.");
    expect(src("src/pages/NotFound.tsx")).toContain("'siteShell.notFound.jobs'");
    expect(src("src/pages/NotFound.tsx")).not.toContain("404 Error: User attempted");
  });

  it("this branch's head script moves the claim token, as the section reads it", () => {
    const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(INDEX_HTML)?.[1] ?? "";
    const first = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i.exec(head)?.[1] ?? "";
    const code = first.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toMatch(/get\("claim_verify"\)/);
    expect(code).toMatch(/claim_verify_path\s*=\s*P\b/);
  });

  it("the company claim and the event writer are the two functions the section judges", () => {
    expect(SECTION).toMatch(/for VDBS_F in company-claim track-ab-event; do/);
    expect(src("supabase/functions/company-claim/index.ts")).toMatch(/companyLanderPath/);
  });
});
