// @vitest-environment node
/**
 * SECTION 98zzz CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES (SEO audit
 * 2026-11-18, lane A, phase A1: R1, R2, R4, R5, R7; phase A2: R3, R6, R8-R12).
 *
 * The section is sourced against a stubbed site (every request a GET, or the
 * stub throws): once as the bake now serves it, where each claim PASSes, and
 * once with each defect the audit found, where each claim FAILs naming it.
 * Phase A1's claims read synthetic posting pages; phase A2's read the files a
 * real bake writes (offline, its data pages fed by a stubbed network with a
 * re-check 44 hours old), served as they are and then with each defect the
 * audit found written back into them.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://site.test";
const TODAY = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

// R4b reads the newest posting-closure run through gh. A fake gh goes first on
// PATH so this harness never asks GitHub: its run measured yesterday and
// names the one closed page (CLOSED) these sites serve. R4b's own cases are in
// the-closure-line-fails-when-the-newest-run-names-a-live-page.test.ts.
let GH_DIR = "";
function ghDir(): string {
  if (GH_DIR) return GH_DIR;
  GH_DIR = mkdtempSync(join(tmpdir(), "vd-98zzz-gh-"));
  dirs.push(GH_DIR);
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  writeFileSync(join(GH_DIR, "runs.json"), JSON.stringify([{ databaseId: 1, createdAt: `${day}T00:44:08Z`, status: "completed", conclusion: "success" }]));
  writeFileSync(join(GH_DIR, "run.log"), [
    `check\tMeasure the closed share and apply the rule\t${day}T00:45:29.0Z posting closure: ${day} checked 2: 1 open, 1 closed, 0 unknown; closed share 50.0% (95% CI 9.5-90.5%), unknown 0.0%`,
    `check\tMeasure the closed share and apply the rule\t${day}T00:45:29.1Z posting closure:   closed at the employer: ${CLOSED}`,
  ].join("\n"));
  writeFileSync(join(GH_DIR, "gh"), `#!/bin/sh\nif [ "$1 $2" = "run list" ]; then cat "${join(GH_DIR, "runs.json")}"; exit 0; fi\nif [ "$1 $2 $3" = "run view 1" ]; then cat "${join(GH_DIR, "run.log")}"; exit 0; fi\nexit 1\n`);
  chmodSync(join(GH_DIR, "gh"), 0o755);
  return GH_DIR;
}

const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url,init)=>{const u=String(url);
if(init&&init.method&&init.method!=="GET")throw new Error("not a GET: "+init.method+" "+u);
const r=routes.find((x)=>x.url===u);
if(!r)return new Response("",{status:404,headers:{"content-type":"text/plain"}});
return new Response(r.body??"",{status:r.status??200,headers:{"content-type":r.type??"text/html"}});};
`;
type Route = { url: string; status?: number; body?: string; type?: string };
function runSection(routes: Route[], list: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-98zzz-"));
  dirs.push(dir);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "closed.txt"), list);
  writeFileSync(join(dir, "run.sh"), `set -u\nSITE=${SITE}; UA=ua\n. ${JSON.stringify(resolve(ROOT, "scripts/verify-deploy.d/98zzz-seo-1118-bake.sh"))}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${ghDir()}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"),
    VD98ZZZ_LIST: join(dir, "closed.txt"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
const has = (lines: string[], level: string, re: RegExp) => lines.some((l) => l.startsWith(level) && re.test(l));
const show = (lines: string[]) => lines.join("\n");

type Posting = { path: string; lastmod: string; ld: Record<string, unknown> | null; posted: string; robots?: string };
const DESC = (seed: string) => `${seed} leads the regional team and owns the forecast, the weekly review with the plant managers and the supplier scorecards for every site in the region.\nYou will report to the operations director and work with finance on the annual plan.`;
const ld = (o: { title: string; org: string; locality: string; country: string; posted: string; validThrough: string; description: string }) => ({
  "@context": "https://schema.org", "@type": "JobPosting", title: o.title, description: o.description, datePosted: o.posted,
  validThrough: `${o.validThrough}T23:59:59+00:00`, hiringOrganization: { "@type": "Organization", name: o.org },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: o.country, addressLocality: o.locality } },
});
const pageHtml = (p: Posting) => `<!doctype html><html><head><meta name="robots" content="${p.robots ?? "index, follow"}">${p.ld ? `<script type="application/ld+json">${JSON.stringify(p.ld)}</script>` : ""}</head><body><div id="root"><h1>t</h1><p>Posted ${p.posted}, as stated by the employer.</p></div></body></html>`;
function site(postings: Posting[], opts: { manifest?: string[]; ledger?: Record<string, unknown>; extra?: Route[] } = {}): Route[] {
  const sitemap = `<?xml version="1.0"?><urlset>${["/jobs", ...postings.map((p) => p.path)].map((p) => {
    const lm = postings.find((x) => x.path === p)?.lastmod ?? TODAY;
    return `<url><loc>${SITE}${p}</loc><lastmod>${lm}</lastmod></url>`;
  }).join("")}</urlset>`;
  return [
    { url: `${SITE}/sitemap.xml`, body: sitemap, type: "application/xml" },
    { url: `${SITE}/posting-pages.json`, body: JSON.stringify({ at: TODAY, live: opts.manifest ?? postings.map((p) => p.path) }), type: "application/json" },
    { url: `${SITE}/prerender-ledger.json`, body: JSON.stringify({ postings: opts.ledger ?? {} }), type: "application/json" },
    ...postings.map((p) => ({ url: `${SITE}${p.path}`, body: pageHtml(p) })),
    ...(opts.extra ?? []),
  ];
}

const P = (n: string) => `/jobs/posting/greenhouse/acme/${n}`;
const CLOSED = "/jobs/posting/workday/asml~wd3~asmlext1/J-00348204";
const posted = daysAgo(6);
const GOOD: Posting[] = [
  { path: P("1"), lastmod: daysAgo(2), posted, ld: ld({ title: "General Manager", org: "Domino's", locality: "Seattle", country: "US", posted, validThrough: daysAgo(-3), description: DESC("The general manager") }) },
  { path: P("2"), lastmod: daysAgo(1), posted, ld: ld({ title: "Customer Success Manager", org: "think-cell", locality: "Berlin", country: "DE", posted, validThrough: daysAgo(-20), description: DESC("The success manager") }) },
  { path: P("3"), lastmod: posted, posted, ld: null },
];
const goodLedger = { [P("1")]: { state: "live", stated: { employerValidThrough: daysAgo(-3) } } };
const closedStub: Route = { url: `${SITE}${CLOSED}`, body: pageHtml({ path: CLOSED, lastmod: TODAY, posted, ld: null, robots: "noindex, follow" }) };

describe("as the bake now serves it", () => {
  const lines = runSection(site(GOOD, { ledger: goodLedger, extra: [closedStub] }), `# closed\n${CLOSED} ${daysAgo(1)} employer\n`);
  it("PASSes R1, R2, R4, R4b, R5 and R7, and FAILs none of them (this site serves no page phase A2 reads)", () => {
    for (const r of ["R1", "R2", "R4", "R4b", "R5", "R7"]) expect(has(lines, "PASS", new RegExp(`^PASS\\s+${r} `)), `${r}\n${show(lines)}`).toBe(true);
    expect(lines.filter((l) => /^FAIL\s+(?:R[12457] |R4b |98zzz)/.test(l)), show(lines)).toEqual([]);
    expect(has(lines, "INFO", /R5 0 of 2 JobPosting descriptions are HTML paragraphs/), show(lines)).toBe(true);
  });
});

describe("with each defect the audit found", () => {
  const bad: Posting[] = [
    // A store code and street, pay, an open application, a locality "Client", a paragraph twice.
    { path: P("1"), lastmod: daysAgo(2), posted, ld: ld({ title: "General Manager (05867) - 602 11th Avenue NW", org: "Domino's", locality: "Seattle", country: "US", posted, validThrough: daysAgo(-30), description: DESC("The general manager") }) },
    { path: P("4"), lastmod: daysAgo(2), posted, ld: ld({ title: "$15.50/hr Part Time Floor Staff", org: "Regal", locality: "King of Prussia", country: "US", posted, validThrough: daysAgo(-3), description: DESC("The floor staff") }) },
    { path: P("5"), lastmod: daysAgo(2), posted, ld: ld({ title: "Candidatura Spontanea per Internship", org: "Santander", locality: "Torino", country: "IT", posted, validThrough: daysAgo(-3), description: DESC("The intern") }) },
    { path: P("6"), lastmod: daysAgo(2), posted, ld: ld({ title: "Clinical Research Associate", org: "Syneos Health", locality: "Client", country: "CN", posted, validThrough: daysAgo(-3), description: `${DESC("The associate")}\n${DESC("The associate").split("\n")[0]}` }) },
    // One job twice: a typo apart, the same employer once a suffix is dropped, the same place and text.
    { path: P("7"), lastmod: daysAgo(2), posted, ld: ld({ title: "R&D Lead Software Develper", org: "ABB", locality: "Hangzhou", country: "CN", posted, validThrough: daysAgo(-3), description: DESC("The lead developer") }) },
    { path: P("8"), lastmod: daysAgo(2), posted, ld: ld({ title: "R&D Lead Software Developer", org: "ABB Ltd", locality: "Hangzhou", country: "CN", posted, validThrough: daysAgo(-3), description: DESC("The lead developer") }) },
    // A lastmod before its posting date.
    { path: P("9"), lastmod: daysAgo(10), posted, ld: null },
    // The page the daily check found closed, still in the sitemap.
    { path: CLOSED, lastmod: daysAgo(1), posted, ld: ld({ title: "Domain Network Lead", org: "ASML", locality: "Tainan", country: "TW", posted, validThrough: daysAgo(-3), description: DESC("The network lead") }) },
  ];
  const lines = runSection(site(bad, {
    manifest: bad.slice(1).map((p) => p.path),
    ledger: { [P("1")]: { state: "live", stated: { employerValidThrough: daysAgo(1) } } },
  }), `${CLOSED} ${daysAgo(1)} employer\n/jobs/posting/greenhouse/acme/old ${daysAgo(30)} employer\n`);

  it("R1 FAILs a manifest that is not the sitemap", () => {
    expect(has(lines, "FAIL", /^FAIL\s+R1 \/posting-pages\.json of \d{4}-\d{2}-\d{2} is not the sitemap: 0 live there and not in the sitemap, 1 in the sitemap and not there; e\.g\. \/jobs\/posting\/greenhouse\/acme\/1/), show(lines)).toBe(true);
  });
  it("R2 FAILs a validThrough past the carried employer end", () => {
    expect(has(lines, "FAIL", new RegExp(`^FAIL\\s+R2 0 of 1 .*acme/1 validThrough ${daysAgo(-30)}, employer end ${daysAgo(1)}`)), show(lines)).toBe(true);
  });
  it("R4 FAILs a listed page still in the sitemap, and ignores a line over 14 days old", () => {
    expect(has(lines, "FAIL", /^FAIL\s+R4 1 page\(s\) the daily check found closed at the employer: \/jobs\/posting\/workday\/asml~wd3~asmlext1\/J-00348204 is in the sitemap/), show(lines)).toBe(true);
  });
  it("R4b FAILs the page the newest closure run named, still in the sitemap with its JobPosting", () => {
    expect(has(lines, "FAIL", /^FAIL\s+R4b the newest posting-closure run 1 \(.*\) measured \d{4}-\d{2}-\d{2} and named 1 page\(s\) closed at the employer: 1 still served as open; \/jobs\/posting\/workday\/asml~wd3~asmlext1\/J-00348204 is in the sitemap, serves no noindex, serves a JobPosting$/), show(lines)).toBe(true);
  });
  it("R5 FAILs each title, place, repeated paragraph and duplicate", () => {
    const r5 = lines.find((l) => /^FAIL\s+R5 /.test(l)) ?? "";
    expect(r5, show(lines)).toMatch(/R5 7 JobPostings: 6 problem\(s\)/);
    // The line names the first three; the full set is asserted through a run per defect below.
    expect(r5).toMatch(/acme\/1 title carries a store code/);
    expect(r5).toMatch(/acme\/4 title carries pay/);
    expect(r5).toMatch(/acme\/5 is an open application/);
  });
  it("R5 names a locality \"Client\", a paragraph printed twice and one job on two pages", () => {
    const only = (keep: string[]) => runSection(site(bad.filter((p) => keep.includes(p.path))), "");
    const client = only([P("6")]);
    expect(has(client, "FAIL", /R5 1 JobPostings: 2 problem\(s\); e\.g\. .*acme\/6 addressLocality "Client"; .*acme\/6 description repeats 1 paragraph/), show(client)).toBe(true);
    const twice = only([P("7"), P("8")]);
    expect(has(twice, "FAIL", /R5 2 JobPostings: 1 problem\(s\); e\.g\. .*acme\/7 and .*acme\/8 \(one job: descriptions 1\.00 the same\)/), show(twice)).toBe(true);
  });
  it("R7 FAILs a lastmod before the posting date", () => {
    expect(has(lines, "FAIL", new RegExp(`^FAIL\\s+R7 .*acme/9 lastmod ${daysAgo(10)}, datePosted ${posted}`)), show(lines)).toBe(true);
  });
  it("PASSes none of them", () => {
    for (const r of ["R1", "R2", "R4", "R4b", "R5", "R7"]) expect(has(lines, "PASS", new RegExp(`^PASS\\s+${r} `)), `${r}\n${show(lines)}`).toBe(false);
  });
});

describe("the section reads and never writes", () => {
  it("sends only GETs and names no write", () => {
    const src = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/98zzz-seo-1118-bake.sh"), "utf8");
    expect(src).not.toMatch(/method:\s*"(?:POST|PUT|PATCH|DELETE)"|writeFileSync|appendFileSync|curl -X/);
  });
});

// ---- Phase A2: the files a real bake writes ----
const DIST_STUB = `const fs=require("fs"),path=require("path");
const dist=process.env.VD_DIST;
globalThis.fetch=async(url,init)=>{const u=new URL(String(url));
if(init&&init.method&&init.method!=="GET")throw new Error("not a GET: "+init.method+" "+u);
const p=decodeURIComponent(u.pathname).replace(/\\/+$/,"");
const cands=p===""?["index.html"]:[p.slice(1),p.slice(1)+"/index.html"];
for(const c of cands){const f=path.join(dist,c);if(f.startsWith(dist)&&fs.existsSync(f)&&fs.statSync(f).isFile())return new Response(fs.readFileSync(f,"utf8"),{status:200,headers:{"content-type":"text/html"}});}
return new Response("",{status:404,headers:{"content-type":"text/plain"}});};
`;
function runOnDist(dist: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-98zzz-a2-"));
  dirs.push(dir);
  writeFileSync(join(dir, "fetch.cjs"), DIST_STUB);
  writeFileSync(join(dir, "closed.txt"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nSITE=${SITE}; UA=ua\n. ${JSON.stringify(resolve(ROOT, "scripts/verify-deploy.d/98zzz-seo-1118-bake.sh"))}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${ghDir()}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_DIST: dist,
    VD98ZZZ_LIST: join(dir, "closed.txt"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}

const A2 = ["R3", "R6", "R8", "R9", "R10", "R11", "R12"];
let GOOD_DIST = "";
let BAD_DIST = "";
let goodLines: string[] = [];
let badLines: string[] = [];
beforeAll(() => {
  const out = mkdtempSync(join(tmpdir(), "vd-98zzz-bake-"));
  dirs.push(out);
  mkdirSync(join(out, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(out, "dist", "index.html"));
  const at = new Date(Date.now() - 44 * 3_600_000).toISOString();
  const routes = {
    get_public_scan_insights: {},
    get_stats_cache: {
      computed_at: "2026-11-17T06:00:00+00:00",
      ghost_stats: { total_open: 1024429, total_company_names: 31000, closed_90d: 1286209, observed_days: 120, median_days_open: 14, posted_coverage_pct: 99.5, computed_at: "2026-11-17T05:30:00+00:00" },
      entry_stats: { total_entry: 139290, total_open: 1024429, companies_with_entry: 4000, remote_entry: 3000, by_category: { other: 9000, engineering: 4000 } },
      hiring_trends: [
        { week_start: "2026-10-27", new_postings: 280000, closed: 100, closed_flagged: 0, remote_new: 1, entry_new: 1 },
        { week_start: "2026-11-03", new_postings: 288808, closed: 100, closed_flagged: 0, remote_new: 1, entry_new: 1 },
        { week_start: "2026-11-10", new_postings: 1000, closed: 1, remote_new: 1, entry_new: 1 },
      ],
      trending_categories: [{ category: "engineering", last7: 90000, prior7: 80000 }],
    },
    get_transparency_cache: { computed_at: "2026-11-17T06:10:00+00:00", pay: { overall: { pay_pct: 33.3, total: 1045070 }, categories: [], top_companies: [] }, coverage: { overall: { mode_pct: 40 } } },
    get_audit_result: { at, sampled: 114, decided: 113, live: 112, gone: 1, unknown: 1, accuracyPct: 99.1 },
  };
  const stub = join(out, "stub-fetch.cjs");
  writeFileSync(stub, `
const routes = ${JSON.stringify(routes)};
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /\\/rest\\/v1\\/rpc\\/([a-z_0-9]+)$/.exec(url);
  if (m && routes[m[1]]) return new Response(JSON.stringify(routes[m[1]]), { status: 200, headers: { "content-type": "application/json" } });
  throw new Error("stubbed network: " + url);
};`);
  execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: out, PRERENDER_OFFLINE: "", VITE_SUPABASE_URL: "https://stub.supabase.test", VITE_SUPABASE_PUBLISHABLE_KEY: "stub-key", NODE_OPTIONS: `--require ${stub}` },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  GOOD_DIST = join(out, "dist");
  goodLines = runOnDist(GOOD_DIST);

  // The same files with each defect the audit found written back into them.
  BAD_DIST = join(out, "bad");
  cpSync(GOOD_DIST, BAD_DIST, { recursive: true });
  const edit = (rel: string, f: (s: string) => string) => { const file = join(BAD_DIST, rel); writeFileSync(file, f(readFileSync(file, "utf8"))); };
  const selfCanonical = (rel: string, p: string) => edit(rel, (h) => h.replace(/<link rel="canonical" href="[^"]+"/, `<link rel="canonical" href="https://resumebooster.work${p}"`));
  selfCanonical("roles/rn/index.html", "/roles/rn");
  edit("roles/registered-nurse/index.html", (h) => h.replace("Other titles in the", "Adjacent titles recruiters search alongside the"));
  selfCanonical("cv-standards/qatar/index.html", "/cv-standards/qatar");
  edit("sitemap.xml", (x) => x.replace("</urlset>", "<url><loc>https://resumebooster.work/roles/rn</loc></url><url><loc>https://resumebooster.work/cv-standards/qatar</loc></url></urlset>"));
  edit("explore/index.html", (h) => h.replace(/<section[^>]*data-field-roles=""[^>]*>[\s\S]*?<\/section>/, ""));
  edit("vs/chatgpt/index.html", (h) => h.replace("ChatGPT &amp; Claude are trademarks of their owners", "ChatGPT &amp; Claude is a trademark of its owner").replace(/ChatGPT &amp; Claude are genuinely stronger/g, "ChatGPT &amp; Claude is genuinely stronger"));
  edit("changelog/index.html", (h) => {
    const newest = (/<h2[^>]*>([^<]+)<\/h2>/.exec(h) || [])[1] ?? "";
    return h.replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="What changed and when, newest first — including honest postmortems. Latest (2026-11-17): ${newest.slice(0, 11)}…"`);
  });
  edit("data-api/index.html", (h) => h.replace("a sample is re-checked against them, scheduled daily", "a daily sample is re-checked against them"));
  edit("llms.txt", (t) => t.replace(/(When the employer uses )[^;]*?(, your AI can read the employer's published application form)/, "$1Greenhouse, Ashby, Recruitee, Breezy or Pinpoint$2"));
  edit("llms-full.txt", (t) => t.replace(/\n## Board figures[^\n]*\n(?:- [^\n]*\n)+/, "\n"));
  const role = (/<loc>https:\/\/resumebooster\.work(\/roles\/[^<]+)<\/loc>/.exec(readFileSync(join(BAD_DIST, "sitemap.xml"), "utf8")) || [])[1] ?? "/roles/registered-nurse";
  edit(`${role.slice(1)}/index.html`, (h) => h.replace("<head>", '<head><link rel="preconnect" href="https://bwhdazbotpblihdxcmho.supabase.co" crossorigin />'));
  badLines = runOnDist(BAD_DIST);
}, 300_000);

describe("phase A2, on the files this branch bakes", () => {
  it("PASSes R3, R6, R8, R9, R10, R11 and R12, and FAILs none of them", () => {
    for (const r of A2) expect(has(goodLines, "PASS", new RegExp(`^PASS\\s+${r} `)), `${r}\n${show(goodLines)}`).toBe(true);
    expect(goodLines.filter((l) => new RegExp(`^FAIL\\s+(?:${A2.join("|")}) |^FAIL\\s+98zzz`).test(l)), show(goodLines)).toEqual([]);
    expect(has(goodLines, "PASS", /^PASS\s+R10 the re-check of \d{4}-\d{2}-\d{2} was over 36 hours old at bake time \(the page says so\): neither page says "daily"/), show(goodLines)).toBe(true);
    expect(has(goodLines, "PASS", /^PASS\s+R11 llms-full carries 4 of 4 data pages/), show(goodLines)).toBe(true);
    expect(has(goodLines, "INFO", /^INFO\s+R12 control: \/jobs keeps its preconnect/), show(goodLines)).toBe(true);
  });
});

describe("phase A2, with each defect the audit found", () => {
  it("R3 FAILs a self-canonical short name, a listed short name and a recruiter-search heading", () => {
    const r3 = badLines.find((l) => /^FAIL\s+R3 /.test(l)) ?? "";
    expect(r3, show(badLines)).toMatch(/\/roles\/rn names \/roles\/rn, not \/roles\/registered-nurse/);
    expect(r3).toMatch(/the sitemap lists 167 \/roles pages, not 166/);
    expect(r3).toMatch(/the sitemap lists 1 short name\(s\) that defer: rn/);
    expect(r3).toMatch(/\/roles\/registered-nurse say recruiters search/);
  });
  it("R6 FAILs an /explore that names no role", () => {
    expect(has(badLines, "FAIL", /^FAIL\s+R6 \/explore serves no field-roles section: 0 of the 116 role names/), show(badLines)).toBe(true);
  });
  it("R8 FAILs a GCC page that names itself and sits in the sitemap", () => {
    expect(has(badLines, "FAIL", /^FAIL\s+R8 \/cv-standards\/qatar names \/cv-standards\/qatar; \/cv-standards\/qatar is in the sitemap/), show(badLines)).toBe(true);
  });
  it("R9 FAILs 'is' of two products and a snippet cut mid-word", () => {
    const r9 = badLines.find((l) => /^FAIL\s+R9 /.test(l)) ?? "";
    expect(r9, show(badLines)).toMatch(/\/vs\/chatgpt says "ChatGPT & Claude is"/);
    expect(r9).toMatch(/\/vs\/chatgpt does not name two owners/);
    expect(r9).toMatch(/\/changelog's description ends mid-word/);
  });
  it("R10 FAILs 'daily' said of a stale re-check", () => {
    expect(has(badLines, "FAIL", /^FAIL\s+R10 the re-check of \d{4}-\d{2}-\d{2} was over 36 hours old at bake time \(the page says so\): "daily" is said 1 time\(s\): \/data-api: ".*a daily sample is re-checked/), show(badLines)).toBe(true);
  });
  it("R11 FAILs five vendors against ten, and an llms-full with no board figures", () => {
    expect(has(badLines, "FAIL", /^FAIL\s+R11 llms\.txt names 5 form vendors, \/agents 10: llms\.txt lacks .*Paylocity/), show(badLines)).toBe(true);
    expect(has(badLines, "FAIL", /^FAIL\s+R11 llms-full carries 0 of 4 data pages' figures/), show(badLines)).toBe(true);
  });
  it("R12 FAILs a sampled role page that preconnects", () => {
    expect(has(badLines, "FAIL", /^FAIL\s+R12 \/roles\/[^ ]+ preconnects/), show(badLines)).toBe(true);
  });
  it("PASSes none of them", () => {
    for (const r of A2) expect(has(badLines, "PASS", new RegExp(`^PASS\\s+${r} `)), `${r}\n${show(badLines)}`).toBe(false);
  });
});
