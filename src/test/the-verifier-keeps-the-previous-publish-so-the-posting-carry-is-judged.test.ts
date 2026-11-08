// @vitest-environment node
//
// Node, not jsdom: section 76 runs in bash with node stubs for the network,
// and the save runs as the command verify-deploy.sh starts.
/**
 * THE VERIFIER KEEPS THE PREVIOUS PUBLISH, SO THE POSTING CARRY IS JUDGED
 * (SEO/GEO audit 2026-11-07, F10 / B10).
 *
 * Section 76 F2a checks that every posting URL the PREVIOUS publish named
 * still serves a page of its own, never the homepage copy (the defect behind
 * the homepage-copy incidents). It needs that publish's sitemap, saved before
 * the next one, and the save was a manual curl nobody ran: the 2026-11-06
 * verify printed "F2a cannot judge ... no saved sitemap" and the folder did
 * not exist. Now:
 *   - scripts/verify-deploy.sh ends a run that reached its end by saving the
 *     live sitemap and ledger (scripts/seo-previous-publish.mjs --save), and
 *     a new publish rotates the pair before it to prev-*;
 *   - F2a reads the newest saved sitemap that is not the live one, names each
 *     carried URL that serves the homepage copy, and FAILs (not INFO) when a
 *     saved sitemap went missing after this machine had saved one.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pairPaths, previousSitemap, savePair } from "../../scripts/seo-previous-publish.mjs";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://site.test";
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };

const sitemap = (paths: string[], day = "2026-11-08") => `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>${SITE}${p}</loc><lastmod>${day}</lastmod></url>`).join("")}</urlset>`;
const ledger = (builtAt: string) => JSON.stringify({ builtAt, postings: {}, pages: {} });

describe("the save keeps the live pair and rotates the one before it only on a new publish", () => {
  const A = { sitemapXml: sitemap(["/", "/jobs/posting/greenhouse/a/1"], "2026-11-07"), ledgerText: ledger("2026-11-07") };
  const B = { sitemapXml: sitemap(["/", "/jobs/posting/greenhouse/b/2"], "2026-11-08"), ledgerText: ledger("2026-11-08") };
  const C = { sitemapXml: sitemap(["/", "/jobs/posting/greenhouse/c/3"], "2026-11-09"), ledgerText: ledger("2026-11-09") };

  it("first save, a re-run of the same publish, then two new publishes", () => {
    const dir = join(tmp("seo-pair-"), "seo");
    const p = pairPaths(dir);
    const first = savePair({ dir, ...A });
    expect(first.status).toBe("PASS");
    expect(first.line).toMatch(/^saved this publish's sitemap \(2 URLs\) and ledger \(built 2026-11-07\)/);
    expect(readFileSync(p.sitemap, "utf8")).toBe(A.sitemapXml);
    expect(readFileSync(p.ledger, "utf8")).toBe(A.ledgerText);
    expect(existsSync(p.prevSitemap)).toBe(false);

    const again = savePair({ dir, ...A });
    expect(again).toMatchObject({ status: "PASS", rotated: false });
    expect(again.line).toMatch(/already this publish's/);
    expect(existsSync(p.prevSitemap)).toBe(false);

    expect(savePair({ dir, ...B })).toMatchObject({ status: "PASS", rotated: true });
    expect(readFileSync(p.sitemap, "utf8")).toBe(B.sitemapXml);
    expect(readFileSync(p.prevSitemap, "utf8")).toBe(A.sitemapXml);
    expect(readFileSync(p.prevLedger, "utf8")).toBe(A.ledgerText);

    // a second verify of publish B keeps A as the publish before it
    savePair({ dir, ...B });
    expect(readFileSync(p.prevSitemap, "utf8")).toBe(A.sitemapXml);

    savePair({ dir, ...C });
    expect(readFileSync(p.sitemap, "utf8")).toBe(C.sitemapXml);
    expect(readFileSync(p.prevSitemap, "utf8")).toBe(B.sitemapXml);
    expect(readFileSync(p.prevLedger, "utf8")).toBe(B.ledgerText);
    expect(readFileSync(p.log, "utf8").trim().split("\n")).toHaveLength(5);
  });

  it("a sitemap saved by hand with no ledger is the same publish: the ledger is added beside it, nothing rotates", () => {
    const dir = tmp("seo-pair-hand-");
    const p = pairPaths(dir);
    writeFileSync(p.sitemap, A.sitemapXml);
    expect(savePair({ dir, ...A })).toMatchObject({ status: "PASS", rotated: false });
    expect(readFileSync(p.ledger, "utf8")).toBe(A.ledgerText);
    expect(existsSync(p.prevSitemap)).toBe(false);
  });

  it("an error page or an unreadable ledger is never saved, and the pair stays as it was", () => {
    const dir = tmp("seo-pair-bad-");
    const p = pairPaths(dir);
    savePair({ dir, ...A });
    const html = savePair({ dir, sitemapXml: "<!doctype html><html><title>Live Jobs</title></html>", ledgerText: B.ledgerText });
    expect(html.status).toBe("FAIL");
    expect(html.line).toMatch(/not a <urlset>/);
    const noLedger = savePair({ dir, sitemapXml: B.sitemapXml, ledgerText: "<html>" });
    expect(noLedger.status).toBe("FAIL");
    expect(noLedger.line).toMatch(/the live ledger is not JSON/);
    expect(readFileSync(p.sitemap, "utf8")).toBe(A.sitemapXml);
    expect(existsSync(p.prevSitemap)).toBe(false);
  });

  it("F2a's pick: the last save when it is not the live sitemap, else the one before it", () => {
    const dir = tmp("seo-pick-");
    expect(previousSitemap({ dir, liveSitemapXml: B.sitemapXml })).toMatchObject({ raw: "", reason: "none", everSaved: false });
    savePair({ dir, ...A });
    expect(previousSitemap({ dir, liveSitemapXml: B.sitemapXml })).toMatchObject({ raw: A.sitemapXml, from: pairPaths(dir).sitemap });
    expect(previousSitemap({ dir, liveSitemapXml: A.sitemapXml })).toMatchObject({ raw: "", reason: "own" });
    savePair({ dir, ...B });
    expect(previousSitemap({ dir, liveSitemapXml: B.sitemapXml })).toMatchObject({ raw: A.sitemapXml, from: pairPaths(dir).prevSitemap });
    rmSync(pairPaths(dir).sitemap);
    expect(previousSitemap({ dir, liveSitemapXml: B.sitemapXml })).toMatchObject({ raw: "", reason: "missing", everSaved: true });
  });
});

describe("verify-deploy.sh saves the pair as its last step, with two GETs", () => {
  const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
  const code = SCRIPT.split("\n").filter((l) => !/^\s*#/.test(l));
  it("the save runs once, after every section file and right before done", () => {
    const save = code.findIndex((l) => /^SITE="\$SITE" UA="\$UA" node scripts\/seo-previous-publish\.mjs --save$/.test(l));
    const loop = code.findIndex((l) => l.startsWith("for f in scripts/verify-deploy.d/*.sh; do"));
    const done = code.findIndex((l) => l === 'echo "done."');
    expect(save, "the save is gone from verify-deploy.sh").toBeGreaterThan(0);
    expect(code.filter((l) => /seo-previous-publish\.mjs/.test(l))).toHaveLength(1);
    expect(loop).toBeGreaterThan(0);
    expect(save).toBeGreaterThan(loop);
    expect(code.slice(save + 1, done).filter((l) => l.trim())).toEqual([]);
    expect(code[save - 1]).toMatch(/^echo "== save\. /);
  });

  it("the command GETs the live sitemap and ledger and writes them where VD_SEO_DIR says", () => {
    const dir = tmp("seo-save-cli-");
    const live = sitemap(["/", "/jobs/posting/greenhouse/z/9"]);
    writeFileSync(join(dir, "fetch.cjs"), `const fs=require("fs");
globalThis.fetch=async(url,init)=>{const u=String(url);fs.appendFileSync(process.env.SV_CALLS,((init&&init.method)||"GET")+" "+u+"\\n");
if(u.endsWith("/sitemap.xml"))return new Response(${JSON.stringify(live)},{status:200});
if(u.endsWith("/prerender-ledger.json"))return new Response(${JSON.stringify(ledger("2026-11-08"))},{status:200});
return new Response("",{status:404});};
`);
    writeFileSync(join(dir, "calls.log"), "");
    const out = execFileSync(process.execPath, ["scripts/seo-previous-publish.mjs", "--save"], {
      cwd: ROOT, encoding: "utf8", timeout: 20_000,
      env: { PATH: process.env.PATH ?? "", HOME: dir, SITE, UA: "ua", VD_SEO_DIR: join(dir, "seo"), SV_CALLS: join(dir, "calls.log"), NODE_OPTIONS: `--require ${join(dir, "fetch.cjs")}` },
    });
    expect(out.trim()).toMatch(/^PASS {2}saved this publish's sitemap \(2 URLs\) and ledger \(built 2026-11-08\)/);
    expect(readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n")).toEqual([`GET ${SITE}/sitemap.xml`, `GET ${SITE}/prerender-ledger.json`]);
    expect(readFileSync(join(dir, "seo", "last-sitemap.xml"), "utf8")).toBe(live);
  });
});

// ── section 76 F2a, run in bash against stubs ───────────────────────────────
type Route = { match: string; status?: number; body?: string };
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url)=>{const u=String(url);fs.appendFileSync(process.env.VD_CALLS,u+"\\n");
const r=routes.find((x)=>new RegExp(x.match).test(u));
return r?new Response(r.body??"",{status:r.status??200}):new Response("",{status:404});};
`;
function runSection76(routes: Route[], home: Record<string, string> = {}) {
  const dir = tmp("vd-b10-");
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "home"));
  writeFileSync(join(dir, "bin", "curl"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "bin", "curl"), 0o755);
  for (const [rel, body] of Object.entries(home)) { mkdirSync(dirname(join(dir, "home", rel)), { recursive: true }); writeFileSync(join(dir, "home", rel), body); }
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=${SITE}; UA=ua\nJ() { echo '{}'; }\n. ${JSON.stringify(resolve(ROOT, "scripts/verify-deploy.d/76-wave3-seo-content.sh"))}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(dir, "home"),
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
const f2a = (lines: string[]) => lines.filter((l) => /F2a/.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

const HOME = `<html><head><title>Live Jobs Straight From Employers | Resume Booster</title><link rel="canonical" href="${SITE}/" /></head><body>home</body></html>`;
const posting = (org: string, robots = "index, follow") => `<html><head><title>Analyst at ${org}</title><meta name="robots" content="${robots}"></head><body>${org}</body></html>`;
const esc = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const route = (path: string, body: string, status = 200): Route => ({ match: `^${esc(SITE + path)}$`, status, body });
const LIVE_POSTING = "/jobs/posting/workday/intel~wd1~External/R2";
const CARRIED = "/jobs/posting/greenhouse/northwind/41";
const KEPT = "/jobs/posting/greenhouse/northwind/42";
const LIVE_SITEMAP = sitemap(["/jobs", LIVE_POSTING]);
const site = (extra: Route[] = []) => [
  route("/", HOME),
  route("/sitemap.xml", LIVE_SITEMAP),
  route("/prerender-ledger.json", ledger("2026-11-08")),
  route(LIVE_POSTING, posting("Intel")),
  ...extra,
];
const SEO = ".config/resumebooster/seo";

describe("section 76 F2a judges the carry from the saved previous sitemap", () => {
  it("a carried URL that now serves the homepage copy is a FAIL that names it", () => {
    const lines = runSection76(site([route(CARRIED, HOME), route(KEPT, posting("Northwind", "noindex, follow"))]), { [`${SEO}/last-sitemap.xml`]: sitemap([CARRIED, KEPT], "2026-11-01") });
    expect(f2a(lines).some((l) => l.startsWith("FAIL  2 posting URLs from the previous publish's sitemap: 1 homepage copies, 0 non-200") && l.includes(`${CARRIED} serves the homepage copy`)), show(lines)).toBe(true);
    expect(f2a(lines).some((l) => l.includes(KEPT) && l.startsWith("FAIL")), show(lines)).toBe(false);
  });

  it("positive control: every carried URL serving a page of its own passes", () => {
    const lines = runSection76(site([route(CARRIED, posting("Northwind")), route(KEPT, posting("Northwind", "noindex, follow"))]), { [`${SEO}/last-sitemap.xml`]: sitemap([CARRIED, KEPT], "2026-11-01") });
    expect(f2a(lines).some((l) => l.startsWith('PASS  2 posting URLs from the previous publish\'s sitemap: 1 live pages, 1 noindex "no longer listed" pages, 0 homepage copies (F2a)')), show(lines)).toBe(true);
  });

  it("when the last save is this publish's own (an earlier run saved it), F2a judges the publish before it", () => {
    const lines = runSection76(site([route(CARRIED, HOME)]), {
      [`${SEO}/last-sitemap.xml`]: LIVE_SITEMAP,
      [`${SEO}/prev-sitemap.xml`]: sitemap([CARRIED], "2026-11-01"),
      [`${SEO}/saves.log`]: "x\n",
    });
    expect(f2a(lines).some((l) => l.startsWith("FAIL  1 posting URLs from the previous publish's sitemap: 1 homepage copies") && l.includes("read from prev-sitemap.xml") && l.includes(CARRIED)), show(lines)).toBe(true);
  });

  it("a saved sitemap gone missing after this machine saved one is a FAIL, not an INFO", () => {
    const lines = runSection76(site(), { [`${SEO}/saves.log`]: "2026-11-07T00:00:00.000Z\tbuilt 2026-11-07\t2 URLs\tfirst save\n" });
    expect(f2a(lines).some((l) => /^FAIL {2}F2a cannot judge the previous publish's posting URLs: no saved sitemap at .*last-sitemap\.xml, although saves\.log says this machine saved one/.test(l)), show(lines)).toBe(true);
  });

  it("a machine that never saved one is told the run saves it, as INFO", () => {
    const lines = runSection76(site());
    expect(f2a(lines).some((l) => /^INFO {2}F2a cannot judge the previous publish's posting URLs: no saved sitemap at .*last-sitemap\.xml yet\. verify-deploy\.sh saves the live sitemap and ledger at the end of every run that reaches its end/.test(l)), show(lines)).toBe(true);
    expect(f2a(lines).some((l) => l.startsWith("FAIL")), show(lines)).toBe(false);
  });
});
