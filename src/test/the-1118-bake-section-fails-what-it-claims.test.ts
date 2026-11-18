// @vitest-environment node
/**
 * SECTION 98zzz CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES (SEO audit
 * 2026-11-18, lane A, phase A1: R1, R2, R4, R5, R7).
 *
 * The section is sourced against a stubbed site (every request a GET, or the
 * stub throws): once as the bake now serves it, where each claim PASSes, and
 * once with each defect the audit found, where each claim FAILs naming it.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
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
  it("PASSes R1, R2, R4, R5 and R7, and FAILs nothing", () => {
    for (const r of ["R1", "R2", "R4", "R5", "R7"]) expect(has(lines, "PASS", new RegExp(`^PASS\\s+${r} `)), `${r}\n${show(lines)}`).toBe(true);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
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
    for (const r of ["R1", "R2", "R4", "R5", "R7"]) expect(has(lines, "PASS", new RegExp(`^PASS\\s+${r} `)), `${r}\n${show(lines)}`).toBe(false);
  });
});

describe("the section reads and never writes", () => {
  it("sends only GETs and names no write", () => {
    const src = require("node:fs").readFileSync(resolve(ROOT, "scripts/verify-deploy.d/98zzz-seo-1118-bake.sh"), "utf8") as string;
    expect(src).not.toMatch(/method:\s*"(?:POST|PUT|PATCH|DELETE)"|writeFileSync|appendFileSync|curl -X/);
  });
});
