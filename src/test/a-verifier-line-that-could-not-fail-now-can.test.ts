// @vitest-environment node
//
// Node, not jsdom: this file runs verifier sections in bash, with node stubs
// for the network, through child_process.
/**
 * A VERIFIER LINE THAT COULD NOT FAIL (sweep S11, 2026-10-11).
 *
 * scripts/verify-deploy.d is the owner's post-deploy checklist. A PASS line is
 * worth something only if a regression could have turned it into a FAIL
 * (README: "A PASS needs something that could have made it FAIL"). Three
 * lines could not:
 *   - S11-153, section 76 F1: the hiringOrganization check skipped every token
 *     the override table names (the Morgan Stanley "Ms" case it was written
 *     for), so a regression to "Ms" on ms~wd5~external was skipped;
 *   - S11-154, section 76 F2a/S3: F2a fell back to the sitemap the new bake
 *     wrote, which cannot show what became of the old URLs; S3 passed on any
 *     sitemap with two dates, which the guides' own dates always gave;
 *   - S11-156, section 78: the Deploy line grepped the run log for "Deploy
 *     verified", which GitHub echoes from the step's script on EVERY run.
 * Each is run here in bash against stubs, with a positive control (the line
 * passes on a good answer) and a negative one (it fails, or says it cannot
 * judge, on the regression). S11-013's company-page controls ride in 76 too.
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

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Route = { match: string; status?: number; body?: string };
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url)=>{const u=String(url);fs.appendFileSync(process.env.VD_CALLS,u+"\\n");
const r=routes.find((x)=>new RegExp(x.match).test(u));
return r?new Response(r.body??"",{status:r.status??200}):new Response("",{status:404});};
`;

/** Source one section in bash: node's fetch answers from `routes`, and gh/curl are fakes on PATH. */
function runSection(file: string, opts: { routes?: Route[]; home?: Record<string, string>; gh?: string; rewriteTmp?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vd-s11-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "home"));
  writeFileSync(join(dir, "bin", "curl"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "bin", "gh"), opts.gh ?? "#!/bin/sh\nexit 1\n");
  chmodSync(join(dir, "bin", "gh"), 0o755);
  for (const [rel, body] of Object.entries(opts.home ?? {})) { mkdirSync(dirname(join(dir, "home", rel)), { recursive: true }); writeFileSync(join(dir, "home", rel), body); }
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(opts.routes ?? []));
  writeFileSync(join(dir, "calls.log"), "");
  let target = resolve(ROOT, "scripts/verify-deploy.d", file);
  if (opts.rewriteTmp) {
    target = join(dir, file);
    writeFileSync(target, readFileSync(resolve(ROOT, "scripts/verify-deploy.d", file), "utf8").split("/tmp/").join(`${dir}/`));
  }
  const prelude = `set -u\nK=pk_test; B=https://p.supabase.co; SITE=${SITE}; UA=ua\nJ() { echo '{}'; }\n${BUILD_GE}\n. ${JSON.stringify(target)}\n`;
  writeFileSync(join(dir, "run.sh"), prelude);
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
const has = (lines: string[], status: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${status}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

// ── section 76 fixtures ─────────────────────────────────────────────────────
const HOME = `<html><head><title>Live Jobs Straight From Employers | Resume Booster</title><link rel="canonical" href="${SITE}/" /></head><body>home</body></html>`;
const posting = (org: string, robots = "index, follow") => `<html><head><title>Analyst at ${org}</title><meta name="robots" content="${robots}"><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "Analyst", hiringOrganization: { "@type": "Organization", name: org } })}</script></head><body>${org}</body></html>`;
const company = (name: string, robots: string | null, openings: number) => `<html><head><title>${name} jobs</title>${robots ? `<meta name="robots" content="${robots}">` : ""}</head><body>${Array.from({ length: openings }, (_, i) => `<a href="/jobs/posting/workday/x~wd1~X/${i}">r</a>`).join("")}</body></html>`;
const MS = "/jobs/posting/workday/ms~wd5~external/R1";
const INTEL = "/jobs/posting/workday/intel~wd1~External/R2";
const sitemap = (urls: [string, string][]) => `<?xml version="1.0"?><urlset>${urls.map(([p, d]) => `<url><loc>${SITE}${p}</loc><lastmod>${d}</lastmod></url>`).join("")}</urlset>`;
const ledger = (pages: Record<string, string>, builtAt = "2026-10-11") => JSON.stringify({ builtAt, postings: {}, pages: Object.fromEntries(Object.entries(pages).map(([p, d]) => [p, { fp: "x", lastmod: d }])) });
const esc = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const route = (path: string, body: string, status = 200): Route => ({ match: `^${esc(SITE + path)}$`, status, body });

function site76(o: { msOrg?: string; withMs?: boolean; urls?: [string, string][]; pages?: Record<string, string>; intel?: string } = {}) {
  const urls = o.urls ?? [["/guides/a", "2026-09-01"], ["/guides/b", "2026-09-20"], ["/jobs", "2026-10-11"], ...(o.withMs === false ? [] : [[MS, "2026-10-11"] as [string, string]]), [INTEL, "2026-10-11"]];
  return [
    route("/", HOME),
    route("/sitemap.xml", sitemap(urls)),
    route("/prerender-ledger.json", ledger(o.pages ?? Object.fromEntries(urls.filter(([p]) => !p.startsWith("/guides/")).map(([p, d]) => [p, d])))),
    route(MS, posting(o.msOrg ?? "Morgan Stanley")),
    route(INTEL, posting("Intel")),
    ...(o.intel ? [route("/jobs/company/intel~wd1~External", o.intel)] : []),
  ];
}

describe("S11-153: section 76 judges hiringOrganization on override tokens, and can fail", () => {
  it("positive control: a page on ms~wd5~external naming Morgan Stanley passes", () => {
    const lines = runSection("76-wave3-seo-content.sh", { routes: site76() });
    expect(has(lines, "PASS", /1 posting pages on override tokens name the employer by its override as hiringOrganization \(F1\)/), show(lines)).toBe(true);
  });

  it("a regression to the tenant code (\"Ms\") on an override token is a FAIL", () => {
    const lines = runSection("76-wave3-seo-content.sh", { routes: site76({ msOrg: "Ms" }) });
    expect(has(lines, "FAIL", /posting pages on override tokens do not name the override as hiringOrganization: ms~wd5~external "Ms" \(want "Morgan Stanley"\)/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /override/), show(lines)).toBe(false);
  });

  it("with no override token in the sitemap, F1's positive half says it was not judged", () => {
    const lines = runSection("76-wave3-seo-content.sh", { routes: site76({ withMs: false }) });
    expect(has(lines, "INFO", /F1 not judged positively: the sitemap names no posting page on a token the override table covers/), show(lines)).toBe(true);
    // Intel is a real name equal to its code: the negative half does not flag it
    expect(has(lines, "PASS", /1 sampled Workday\/Oracle posting pages: none names a reviewed tenant code/), show(lines)).toBe(true);
  });
});

describe("S11-013 controls in section 76: a real employer named by its code keeps an indexable company page", () => {
  it("passes when Intel's page is indexable, fails when it is noindex while listing its own openings", () => {
    const good = runSection("76-wave3-seo-content.sh", { routes: site76({ intel: company("Intel", null, 6) }) });
    expect(has(good, "PASS", /real employers named by their tenant code keep indexable company pages: Intel \(S11-013\)/), show(good)).toBe(true);
    const bad = runSection("76-wave3-seo-content.sh", { routes: site76({ intel: company("Intel", "noindex, follow", 6) }) });
    expect(has(bad, "FAIL", /noindex company pages: Intel \(6 openings listed\) \(S11-013\)/), show(bad)).toBe(true);
    const thin = runSection("76-wave3-seo-content.sh", { routes: site76({ intel: company("Intel", "noindex, follow", 1) }) });
    expect(has(thin, "FAIL", /S11-013/), show(thin)).toBe(false);
    expect(has(thin, "INFO", /S11-013 controls not judged.*noindex with under three openings: Intel/), show(thin)).toBe(true);
  });
});

describe("S11-151 in section 76: the typed '10 languages' on /vs, the Spanish landing and the SPA JSON-LD", () => {
  const homeWithJs = HOME.replace("</head>", `<script type="module" src="/assets/index-abc123.js"></script></head>`);
  const spa = (desc: string) => [route("/", homeWithJs), route("/assets/index-abc123.js", `import("./Index-def456.js")`), route("/assets/Index-def456.js", `const d=\`${desc}\`;`)];
  it("fails on the old copy and passes on the derived count", () => {
    const bad = runSection("76-wave3-seo-content.sh", { routes: [...spa("across 58 industries and 10 languages."), route("/vs/kickresume", "<p>10 languages including full Spanish resume detection.</p>"), route("/es/revisar-curriculum", "<li>además de 10 idiomas</li>"), ...site76()] });
    expect(has(bad, "FAIL", /still says 10 languages over the eight the interface ships: \/vs\/kickresume, \/es\/revisar-curriculum \(S11-151\)/), show(bad)).toBe(true);
    expect(has(bad, "FAIL", /SPA's WebApplication JSON-LD still says 10 languages/), show(bad)).toBe(true);
    const good = runSection("76-wave3-seo-content.sh", { routes: [...spa("across 58 industries, with an interface in 8 languages."), route("/vs/kickresume", "<p>An interface in 8 languages, plus full Spanish resume detection.</p>"), route("/es/revisar-curriculum", "<li>con la interfaz en 8 idiomas</li>"), ...site76()] });
    expect(has(good, "PASS", /print the derived interface language count, not 10 \(S11-151\)/), show(good)).toBe(true);
    expect(has(good, "PASS", /SPA's WebApplication JSON-LD prints the derived interface language count/), show(good)).toBe(true);
  });
});

describe("S11-154: F2a judges the previous publish's URLs or says it cannot; S3 ignores guide dates", () => {
  const LAST = ".config/resumebooster/seo/last-sitemap.xml";

  it("without a saved sitemap F2a prints INFO 'cannot judge' and no F2a PASS", () => {
    const lines = runSection("76-wave3-seo-content.sh", { routes: site76() });
    expect(has(lines, "INFO", /F2a cannot judge the previous publish's posting URLs: no saved sitemap at .*last-sitemap\.xml\. Save the live sitemap there BEFORE each publish/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS") && /\(F2a\)/.test(l)), show(lines)).toBe(false);
  });

  it("a saved sitemap identical to the live one is this publish's own: still cannot judge", () => {
    const routes = site76();
    const live = (routes.find((r) => r.match.includes("sitemap"))?.body) ?? "";
    const lines = runSection("76-wave3-seo-content.sh", { routes, home: { [LAST]: live } });
    expect(has(lines, "INFO", /F2a cannot judge.*the saved sitemap is this publish's own/), show(lines)).toBe(true);
  });

  it("a previous URL that now serves the homepage copy FAILs F2a; one that serves a page passes", () => {
    const old = "/jobs/posting/greenhouse/acme/9";
    const prev = sitemap([[old, "2026-10-01"], [MS, "2026-10-01"]]);
    const bad = runSection("76-wave3-seo-content.sh", { routes: [route(old, HOME), ...site76()], home: { [LAST]: prev } });
    expect(has(bad, "FAIL", /2 posting URLs from the previous publish's sitemap: 1 homepage copies, 0 non-200 .*\(F2a; F2a was 364 of 371\)/), show(bad)).toBe(true);
    const good = runSection("76-wave3-seo-content.sh", { routes: [route(old, posting("Acme", "noindex, follow")), ...site76()], home: { [LAST]: prev } });
    expect(has(good, "PASS", /2 posting URLs from the previous publish's sitemap: 1 live pages, 1 noindex "no longer listed" pages, 0 homepage copies \(F2a\)/), show(good)).toBe(true);
  });

  it("S3: two guide dates over pages all dated this bake is not a PASS", () => {
    const lines = runSection("76-wave3-seo-content.sh", { routes: site76() });
    expect(lines.some((l) => l.startsWith("PASS") && /S3/.test(l)), show(lines)).toBe(false);
    expect(has(lines, "INFO", /S3 not judged: all 3 non-guide pages the ledger dates carry 2026-10-11, this bake's date/), show(lines)).toBe(true);
  });

  it("S3 positive control: non-guide pages carrying their own ledger dates pass; a lastmod off the ledger fails", () => {
    const urls: [string, string][] = [["/guides/a", "2026-09-01"], ["/jobs", "2026-10-11"], [MS, "2026-10-04"], [INTEL, "2026-10-11"]];
    const good = runSection("76-wave3-seo-content.sh", { routes: site76({ urls }) });
    expect(has(good, "PASS", /3 non-guide sitemap URLs carry 2 distinct lastmod dates, each its page's ledger date \(S3/), show(good)).toBe(true);
    const off = runSection("76-wave3-seo-content.sh", { routes: site76({ urls, pages: { "/jobs": "2026-10-11", [MS]: "2026-10-02", [INTEL]: "2026-10-11" } }) });
    expect(has(off, "FAIL", /1 of 3 sitemap URLs carry a lastmod that is not their ledger date.*2026-10-04 vs 2026-10-02 \(S3\)/), show(off)).toBe(true);
  });
});

// ── section 78 ──────────────────────────────────────────────────────────────
// The log format `gh run view --log` prints: job TAB step TAB timestamp SPACE
// line, with GitHub's ANSI-coloured echo of the step's script above the
// output, and a BOM before the timestamp of a group's first line. The
// old-step lines are from run 38101773006 (2026-10-11).
const ESC = "\u001b";
const STEP = "verify\tCompare the live BUILD_VERSION against this commit\t";
const echo = (t: string, line: string) => `${STEP}${t} ${ESC}[36;1m${line}${ESC}[0m`;
const NEW_STEP_ECHO = [
  `${STEP}﻿2026-10-12T01:26:14.4542236Z ##[group]Run set -u`,
  echo("2026-10-12T01:26:14.4542817Z", "set -u"),
  echo("2026-10-12T01:26:14.4551977Z", `  echo "::error title=Deployed code is not this commit::job-board serves '$LIVE' and this commit is '$EXPECTED'. Either the Lovable deploy has not run yet (re-run this job after it does) or it shipped stale code, which happened twice on 2026-08-07."`),
  echo("2026-10-12T01:26:14.4553556Z", `echo "::notice title=Deploy verified::job-board serves $LIVE (this commit is $EXPECTED)"`),
  `${STEP}2026-10-12T01:26:14.4599256Z ##[endgroup]`,
  `${STEP}2026-10-12T01:26:20.1000000Z repo expects: 2026-09-09.92`,
];
const BEHIND_LOG = [...NEW_STEP_ECHO,
  `${STEP}2026-10-12T01:26:20.2000000Z live reports: 2026-09-09.91`,
  `${STEP}2026-10-12T01:26:20.3000000Z ##[error]job-board serves '2026-09-09.91' and this commit is '2026-09-09.92'. Either the Lovable deploy has not run yet (re-run this job after it does) or it shipped stale code, which happened twice on 2026-08-07.`,
  `${STEP}2026-10-12T01:26:20.4000000Z ##[error]Process completed with exit code 1.`,
].join("\n");
const VERIFIED_LOG = [...NEW_STEP_ECHO,
  `${STEP}2026-10-12T01:26:20.2000000Z live reports: 2026-09-09.92`,
  `${STEP}2026-10-12T01:26:20.3000000Z ##[notice]job-board serves 2026-09-09.92 (this commit is 2026-09-09.92)`,
].join("\n");
const OLD_STEP_LOG = [
  `${STEP}﻿2026-10-11T01:26:14.4542236Z ##[group]Run set -euo pipefail`,
  echo("2026-10-11T01:26:14.4544137Z", `  echo "::warning::SUPABASE_URL / SUPABASE_ANON_KEY not set — cannot verify what is live."`),
  echo("2026-10-11T01:26:14.4553556Z", `echo "::notice title=Deploy verified::job-board is serving $LIVE"`),
  `${STEP}2026-10-11T01:26:14.4599256Z ##[endgroup]`,
  `${STEP}2026-10-11T01:26:14.4679437Z ##[warning]SUPABASE_URL / SUPABASE_ANON_KEY not set — cannot verify what is live.`,
].join("\n");

/** A gh that is signed in, lists one Deploy run with `conclusion`, and prints `log` for it. */
const fakeGh = (conclusion: string | null, log: string) => `#!/usr/bin/env node
const a=process.argv.slice(2);
if(a[0]==="auth"){process.exit(0)}
if(a[0]==="run"&&a[1]==="list"){const wf=a[a.indexOf("--workflow")+1];
  process.stdout.write(wf==="deploy.yml"?${JSON.stringify(JSON.stringify([{ databaseId: 42, conclusion, createdAt: "2026-10-12T01:25:00Z" }]))}:"[]");process.exit(0)}
if(a[0]==="run"&&a[1]==="view"&&a.includes("--log")){process.stdout.write(${JSON.stringify(log)});process.exit(0)}
if(a[0]==="run"&&a[1]==="view"){process.stdout.write('{"jobs":[]}');process.exit(0)}
process.exit(1);
`;
const deployLine = (lines: string[]) => lines.filter((l) => /latest Deploy run/.test(l));

describe("S11-156: section 78 judges the Deploy run by its conclusion and executed verdicts", () => {
  it("a run that failed because production was behind is not a PASS, though its echoed script says 'Deploy verified'", () => {
    const lines = runSection("78-wave3-tests-ci.sh", { gh: fakeGh("failure", BEHIND_LOG), rewriteTmp: true });
    expect(deployLine(lines).some((l) => l.startsWith("PASS")), show(lines)).toBe(false);
    expect(has(lines, "INFO", /latest Deploy run \(failure\) compared and production was behind that commit/), show(lines)).toBe(true);
  });

  it("positive control: a successful run that executed the verified notice passes", () => {
    const lines = runSection("78-wave3-tests-ci.sh", { gh: fakeGh("success", VERIFIED_LOG), rewriteTmp: true });
    expect(has(lines, "PASS", /latest Deploy run compared the live job-board build and it matched this commit or later: job-board serves 2026-09-09\.92 \(this commit is 2026-09-09\.92\)/), show(lines)).toBe(true);
  });

  it("a successful run whose log carries only the echo, or that ran the old step, is never a PASS", () => {
    const echoOnly = runSection("78-wave3-tests-ci.sh", { gh: fakeGh("success", NEW_STEP_ECHO.join("\n")), rewriteTmp: true });
    expect(deployLine(echoOnly).some((l) => l.startsWith("PASS")), show(echoOnly)).toBe(false);
    expect(has(echoOnly, "INFO", /executed no verdict of its own/), show(echoOnly)).toBe(true);
    const old = runSection("78-wave3-tests-ci.sh", { gh: fakeGh("success", OLD_STEP_LOG), rewriteTmp: true });
    expect(has(old, "FAIL", /still ran the old verify step/), show(old)).toBe(true);
  });

  it("the verified notice a run printed counts only from a successful run", () => {
    const lines = runSection("78-wave3-tests-ci.sh", { gh: fakeGh(null, VERIFIED_LOG), rewriteTmp: true });
    expect(deployLine(lines).some((l) => l.startsWith("PASS")), show(lines)).toBe(false);
  });
});
