// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * SEO CHECK 2026-11-15, F22: VERIFY SECTION 98zz READS THE SITEMAP'S
 * NON-POSTING PAGES AS A CRAWLER, AND CAN FAIL EVERY CLAIM IT MAKES.
 *
 * Before this section no post-publish check read the ~870 non-posting pages
 * the sitemap advertises (company pages, roles, industries, CV standards, the
 * translated pages, the changelog, the legal pages, /agents, the data pages),
 * beyond a fixed handful. scripts/verify-deploy.d/98zz-seo-non-posting-pages.sh
 * reads the sitemap and a sample of those pages, and judges: the sitemap names
 * the pages it must (N0), each answers 200 itself (N1), names one canonical,
 * its own (N2), is not noindex (N3), has a body (N4), a data page prints
 * figures (N5), and no two share a title (N7). Run here against a fake curl:
 *   - a sound site prints PASS for every claim and no FAIL;
 *   - each regression prints FAIL: a sitemap that does not answer, leaves out
 *     a named page or the company or role pages, or names another host; a
 *     404, a redirect, a page that never answers; no canonical, a canonical
 *     to the homepage, two canonicals; a noindex by meta tag or by header; a
 *     shell with no text; a data page that baked unread, a data page with
 *     only dates in it, a Dataset page with no figure; two pages with one
 *     title;
 *   - it reads every one-segment page, six company pages (shifted each day,
 *     plus the first host-name token) and six role pages, never a posting
 *     page, follows a sitemap index, and stops after five unanswered GETs;
 *   - every request is a GET of the site, and every line is a verdict.
 * Against production on 2026-11-15 (read-only, 62 pages) it printed no FAIL.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/98zz-seo-non-posting-pages.sh"), "utf8");
const SITE = "https://site.test";

type Page = { status?: number; headers?: Record<string, string>; body?: string; dead?: boolean };
type Site = Record<string, Page>;

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data"){method="POST";i++}else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+"\\t"+hs.join("|")+"\\n");
const site=JSON.parse(fs.readFileSync(process.env.VD_SITE,"utf8"));
const r=site[url]||{status:404,body:"<html><head><title>Not found</title></head><body>Not found</body></html>"};
if(r.dead)process.exit(28);
const hdr="HTTP/2 "+(r.status??200)+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
if(D==="-")process.stdout.write(hdr);else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,r.body??"");else if(!o)process.stdout.write(r.body??"");
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(site: Site, opts: { day?: number } = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd98zz-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "site.json"), JSON.stringify(site));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nSITE=${SITE}; UA=ua\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_SITE: join(dir, "site.json"), VD_CALLS: join(dir, "calls.log"),
    VD98ZZ_DAY: String(opts.day ?? 0), VD98ZZ_NOW_MS: String(Date.parse("2026-11-15T18:00:00Z")),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? "") + String((e as { stderr?: string }).stderr ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const PROSE = "This page is written for people looking for work, and it says what the board holds and how it was read. ".repeat(4);
function page(path: string, o: { title?: string; canon?: string[] | null; robots?: string; body?: string; ld?: string } = {}): string {
  const canon = o.canon === null ? [] : (o.canon ?? [`${SITE}${path}`]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${o.title ?? `Page ${path}`}</title>`
    + canon.map((c) => `<link rel="canonical" href="${c}" />`).join("")
    + `<meta name="robots" content="${o.robots ?? "index, follow"}">`
    + (o.ld ? `<script type="application/ld+json">${o.ld}</script>` : "")
    + `</head><body><div id="root"><main>${o.body ?? `<h1>${path}</h1><p>${PROSE}</p>`}</main></div><script>window.x=1</script></body></html>`;
}
const DATA = ["/ghost-job-index", "/pay-transparency", "/hiring-trends", "/entry-level-index"];
const FIGURES = `<p>In the daily re-check on 2026-11-14, 96.6% of 117 sampled postings were still live.</p><ul><li><b>985,179</b> — open roles</li><li><b>12.7 days</b> — median age</li></ul><p>${PROSE}</p>`;
const SINGLES = ["/", "/pricing", "/changelog", "/privacy", "/agents", "/jobs", ...DATA];
const COMPANIES = Array.from({ length: 20 }, (_, i) => `/jobs/company/co${String(i).padStart(2, "0")}`);
const DOTTED = "/jobs/company/careers.example.com/";
const ROLES = Array.from({ length: 12 }, (_, i) => `/roles/role-${String(i).padStart(2, "0")}`);
const OTHERS = ["/industries/sales", "/industries/legal", "/industries/retail", "/fr/normes-cv/france", "/research/ats-score-benchmarks"];
const POSTING = "/jobs/posting/greenhouse/acme/123";
const ALL = [...SINGLES, ...COMPANIES, DOTTED, ...ROLES, ...OTHERS, POSTING];

const sitemapOf = (paths: string[], host = SITE) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url>\n    <loc>${host}${p}</loc>\n    <lastmod>2026-11-15</lastmod>\n  </url>`).join("\n")}\n</urlset>`;
function goodSite(paths = ALL): Site {
  const site: Site = { [`${SITE}/sitemap.xml`]: { body: sitemapOf(paths) } };
  for (const p of paths) {
    const data = DATA.includes(p) || p === "/research/ats-score-benchmarks";
    site[`${SITE}${p}`] = { body: page(p, { body: data ? `<h1>${p}</h1>${FIGURES}` : undefined, ld: p === "/research/ats-score-benchmarks" ? '{"@context":"https://schema.org","@type":"Dataset","name":"x"}' : undefined }) };
  }
  return site;
}
const withPage = (path: string, p: Page, base = goodSite()): Site => ({ ...base, [`${SITE}${path}`]: p });
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => lines.join("\n");
const reads = (calls: string[]) => calls.map((c) => c.split("\t")[0].replace(/^GET /, "").replace(SITE, ""));

describe("a sound site", () => {
  const { lines, calls, out } = run(goodSite());
  it("prints PASS for every claim and no FAIL", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of ["N0", "N1", "N2", "N3", "N4", "N5", "N7"]) expect(has(lines, "PASS", new RegExp(`^PASS {2}${c} `)), `${c}\n${show(lines)}`).toBe(true);
    expect(has(lines, "PASS", /^PASS {2}N5 5 of 5 data pages/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}N6 \/ghost-job-index dates its re-check 2026-11-14, about 30 h before this run$/), show(lines)).toBe(true);
  });
  it("every line is a verdict or the header, and nothing crashed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) {2}/.test(l) || /^== 98zz\. /.test(l)), out).toBe(true);
  });
  it("asks only with GET, only of the site, and never sends a key", () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c, c).toMatch(new RegExp(`^GET ${SITE.replace(/\./g, "\\.")}/`));
      expect(c, c).not.toMatch(/apikey|Authorization/i);
    }
  });
  it("reads every one-segment page, six company pages plus the host-name token, six role pages, two of every other group, and no posting page", () => {
    const r = reads(calls).filter((p) => p !== "/sitemap.xml");
    for (const p of SINGLES) expect(r, p).toContain(p);
    expect(r.filter((p) => COMPANIES.includes(p))).toHaveLength(6);
    expect(r).toContain(DOTTED);
    expect(r.filter((p) => ROLES.includes(p))).toHaveLength(6);
    expect(r.filter((p) => p.startsWith("/industries/"))).toHaveLength(2);
    expect(r).toContain("/research/ats-score-benchmarks");
    expect(r).not.toContain(POSTING);
    expect(new Set(r).size).toBe(r.length);
  });
  it("reads other company and role pages on another day", () => {
    const a = reads(run(goodSite(), { day: 0 }).calls), b = reads(run(goodSite(), { day: 1 }).calls);
    const co = (r: string[]) => r.filter((p) => COMPANIES.includes(p)).join(",");
    expect(co(a)).not.toBe(co(b));
  });
  it("follows a sitemap index to its children", () => {
    const site = goodSite();
    const half = Math.floor(ALL.length / 2);
    site[`${SITE}/sitemap.xml`] = { body: `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${SITE}/sitemap-a.xml</loc></sitemap><sitemap><loc>${SITE}/sitemap-b.xml</loc></sitemap></sitemapindex>` };
    site[`${SITE}/sitemap-a.xml`] = { body: sitemapOf(ALL.slice(0, half)) };
    site[`${SITE}/sitemap-b.xml`] = { body: sitemapOf(ALL.slice(half)) };
    const { lines } = run(site);
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "PASS", new RegExp(`^PASS {2}N0 the sitemap names ${ALL.length} URLs`)), show(lines)).toBe(true);
  });
});

describe("N0: the sitemap", () => {
  it("FAILs when it does not answer, and reads no page", () => {
    const { lines, calls } = run({ [`${SITE}/sitemap.xml`]: { status: 404, body: "Not found" } });
    expect(has(lines, "FAIL", /^FAIL {2}N0 .*sitemap\.xml answered HTTP 404/), show(lines)).toBe(true);
    expect(calls).toHaveLength(1);
  });
  it("FAILs when it leaves out /privacy, or a data page", () => {
    const { lines } = run(goodSite(ALL.filter((p) => p !== "/privacy" && p !== "/hiring-trends")));
    expect(has(lines, "FAIL", /^FAIL {2}N0 .*leaves out \/privacy, \/hiring-trends/), show(lines)).toBe(true);
  });
  it("FAILs when it names no role page or no company page", () => {
    expect(has(run(goodSite(ALL.filter((p) => !p.startsWith("/roles/")))).lines, "FAIL", /^FAIL {2}N0 .*names no \/roles\/ page/)).toBe(true);
    expect(has(run(goodSite(ALL.filter((p) => !p.startsWith("/jobs/company/")))).lines, "FAIL", /^FAIL {2}N0 .*names no \/jobs\/company\/ page/)).toBe(true);
  });
  it("FAILs when it names a URL on another host", () => {
    const site = goodSite();
    site[`${SITE}/sitemap.xml`] = { body: sitemapOf(ALL).replace("</urlset>", "<url><loc>https://elsewhere.test/x</loc></url></urlset>") };
    expect(has(run(site).lines, "FAIL", /^FAIL {2}N0 .*1 URL\(s\) on another host \(https:\/\/elsewhere\.test\/x\)/)).toBe(true);
  });
});

describe("N1: every page answers 200 itself", () => {
  it("FAILs on a 404 and on a redirect", () => {
    const site = withPage("/privacy", { status: 404, body: "gone" }, withPage("/roles/role-00", { status: 301, headers: { location: `${SITE}/roles` }, body: "" }));
    const { lines } = run(site);
    expect(has(lines, "FAIL", /^FAIL {2}N1 .*\/privacy \(HTTP 404\)/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /^FAIL {2}N1 .*\/roles\/role-00 \(HTTP 301\)/), show(lines)).toBe(true);
  });
  it("stops after five unanswered GETs in a row, and FAILs every page it could not read", () => {
    const site: Site = { [`${SITE}/sitemap.xml`]: { body: sitemapOf(ALL) } };
    for (const p of ALL) site[`${SITE}${p}`] = { dead: true };
    const { lines, calls } = run(site);
    expect(calls).toHaveLength(1 + 5);
    expect(has(lines, "FAIL", /^FAIL {2}N1 0 of \d+ .*\/ \(HTTP no answer\)/), show(lines)).toBe(true);
  });
});

describe("N2: one canonical, the page's own", () => {
  it("FAILs on no canonical, a canonical to the homepage, and two canonicals", () => {
    let site = withPage("/agents", { body: page("/agents", { canon: null }) });
    site = withPage("/roles/role-00", { body: page("/roles/role-00", { canon: [`${SITE}/`] }) }, site);
    site = withPage("/changelog", { body: page("/changelog", { canon: [`${SITE}/changelog`, `${SITE}/`] }) }, site);
    const { lines } = run(site);
    const n2 = lines.find((l) => l.startsWith("FAIL  N2")) ?? "";
    expect(n2, show(lines)).toMatch(/\/agents \(no canonical\)/);
    expect(n2).toMatch(/\/roles\/role-00 \(canonical https:\/\/site\.test\/\)/);
    expect(n2).toMatch(/\/changelog \(canonical https:\/\/site\.test\/changelog \+ https:\/\/site\.test\/\)/);
  });
  it("FAILs when the host-name company page drops the slash the sitemap gives it", () => {
    const site = withPage(DOTTED, { body: page(DOTTED, { canon: [`${SITE}/jobs/company/careers.example.com`] }) });
    expect(has(run(site).lines, "FAIL", /^FAIL {2}N2 .*careers\.example\.com\/ \(canonical https:\/\/site\.test\/jobs\/company\/careers\.example\.com\)/)).toBe(true);
  });
});

describe("N3: no noindex inside the sitemap", () => {
  it("FAILs on a robots meta noindex and on an X-Robots-Tag header", () => {
    let site = withPage("/privacy", { body: page("/privacy", { robots: "noindex, follow" }) });
    site = withPage("/roles/role-00", { headers: { "x-robots-tag": "noindex" }, body: page("/roles/role-00") }, site);
    const { lines } = run(site);
    const n3 = lines.find((l) => l.startsWith("FAIL  N3")) ?? "";
    expect(n3, show(lines)).toMatch(/\/privacy \(meta "noindex, follow"\)/);
    expect(n3).toMatch(/\/roles\/role-00 \(meta "index, follow", X-Robots-Tag "noindex"\)/);
  });
});

describe("N4: a body", () => {
  it("FAILs on the app shell with nothing in it", () => {
    const shell = `<!doctype html><html lang="en"><head><title>Agents</title><link rel="canonical" href="${SITE}/agents" /></head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`;
    const { lines } = run(withPage("/agents", { body: shell }));
    expect(has(lines, "FAIL", /^FAIL {2}N4 .*\/agents \(0 characters of text\)/), show(lines)).toBe(true);
  });
});

describe("N5: a data page prints figures", () => {
  it("FAILs on a page the bake wrote without its measurements", () => {
    const unread = page("/hiring-trends", { body: `<h1>Weekly Hiring Trends</h1><p>${PROSE}</p><p class="text-sm">This build could not read the board&#39;s own measurements, so this page states no figure rather than one it cannot source. The live page reads them when it opens in a browser.</p>` });
    const { lines } = run(withPage("/hiring-trends", { body: unread }));
    expect(has(lines, "FAIL", /^FAIL {2}N5 .*\/hiring-trends \(says the build could not read its measurements\)/), show(lines)).toBe(true);
  });
  it("FAILs on a data page whose only numbers are dates and times, and on a Dataset page with no figure", () => {
    let site = withPage("/pay-transparency", { body: page("/pay-transparency", { body: `<h1>Pay</h1><p>Measured 2026-11-15 17:05 UTC. Postings older than 30 days are dropped.</p><p>${PROSE}</p>` }) });
    site = withPage("/research/ats-score-benchmarks", { body: page("/research/ats-score-benchmarks", { ld: '{"@type":["Dataset"],"name":"x"}', body: `<h1>Benchmarks</h1><p>${PROSE}</p>` }) }, site);
    const { lines } = run(site);
    const n5 = lines.find((l) => l.startsWith("FAIL  N5")) ?? "";
    expect(n5, show(lines)).toMatch(/\/pay-transparency \(no figure in its text\)/);
    expect(n5).toMatch(/\/research\/ats-score-benchmarks \(no figure in its text\)/);
  });
});

describe("N6 and N7", () => {
  it("N6 names a re-check over 36 hours old, as INFO", () => {
    const old = page("/ghost-job-index", { body: `<h1>Ghost</h1><p>In the daily re-check on 2026-11-07, 96.6% of 117 sampled postings were still live.</p><p>${PROSE}</p>` });
    const { lines } = run(withPage("/ghost-job-index", { body: old }));
    expect(has(lines, "INFO", /^INFO {2}N6 .*2026-11-07, about 198 h before this run: over 36 h/), show(lines)).toBe(true);
    expect(fails(lines), show(lines)).toEqual([]);
  });
  it("N7 FAILs when two pages share a title", () => {
    // Day 0 reads roles 00, 02, 04 ... (twelve role pages, six read).
    const site = withPage("/roles/role-02", { body: page("/roles/role-02", { title: "Page /roles/role-00" }) });
    const { lines } = run(site, { day: 0 });
    expect(has(lines, "FAIL", /^FAIL {2}N7 .*"Page \/roles\/role-00" on \/roles\/role-00 and \/roles\/role-02/), show(lines)).toBe(true);
  });
});
