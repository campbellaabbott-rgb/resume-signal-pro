// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process (the harness of
// seo-check-f22-the-non-posting-sitemap-pages-section-fails-what-it-claims).
/**
 * SEO AUDIT 2026-11-18, CRAWL-8 (with CRAWL-6, CRAWL-4 and OFFSITE-2): VERIFY
 * SECTION 98zz JUDGES HREFLANG, ROBOTS.TXT AND THE SITE NAME, AND CAN FAIL
 * EACH CLAIM.
 *
 * No post-publish check read rel=alternate hreflang: a template change that
 * broke reciprocity on the 104 pages in hreflang clusters would have passed
 * every verify run, and Google ignores an annotation the other page does not
 * return. Lane C of the audit also changes robots.txt (no group opens with a
 * line allowing the whole site; every group disallows /admin/) and gives the
 * WebSite node the domain as its alternateName, and nothing served checked
 * either. scripts/verify-deploy.d/98zz-seo-non-posting-pages.sh now judges:
 *   N8  every sampled page in an hreflang cluster names itself and an
 *       x-default, one address a language, none on another host; each
 *       alternate answers 200 itself, names its own canonical, says its
 *       code's language and returns the same set; a page in another
 *       language with no alternates FAILs;
 *   N9  robots.txt, read by the longest match and by the first, opens no
 *       group with the whole site allowed and disallows /admin/claims, /auth
 *       and /account in every group;
 *   N10 the homepage's one WebSite node names the site's host as its
 *       alternateName.
 * Run here against a fake curl, with the repo's own public/robots.txt and the
 * WebSite block of the repo's own index.html (through the bake's
 * withWebsiteGraph) as the sound site, so the section passes what ships and
 * fails the files as they were before this change (N8 PASS, N9 FAIL, N10
 * FAIL: what a dry run against production printed before the publish).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { withWebsiteGraph } from "../../scripts/prerender-copy.mjs";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/98zz-seo-non-posting-pages.sh"), "utf8");
const SITE = "https://site.test";
const HOST = "site.test";

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
  const dir = mkdtempSync(join(tmpdir(), "vd98zz-n8-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "site.json"), JSON.stringify(site));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  writeFileSync(join(dir, "run.sh"), `set -u\nSITE=${SITE}; UA=ua\n` + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_SITE: join(dir, "site.json"), VD_CALLS: join(dir, "calls.log"),
    VD98ZZ_DAY: String(opts.day ?? 0), VD98ZZ_NOW_MS: String(Date.parse("2026-11-18T18:00:00Z")),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? "") + String((e as { stderr?: string }).stderr ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// ── what ships: the repo's robots.txt and its template's WebSite block ──────
const ROBOTS = readFileSync(resolve(ROOT, "public/robots.txt"), "utf8");
/** robots.txt as it stood before 2026-11-18: every group but meta-externalagent opened with the whole site allowed, and none named /admin/. */
const ROBOTS_BEFORE = ROBOTS.replace(/^Disallow: \/admin\/\n/gm, "").replace(/^(User-agent: (?!meta-externalagent)[^\n]+\n)/gm, "$1Allow: /\n");
const TEMPLATE = readFileSync(resolve(ROOT, "index.html"), "utf8").split("resumebooster.work").join(HOST);
const ldOf = (html: string) => /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(withWebsiteGraph(html, SITE))?.[1] ?? "";
const WEBSITE_LD = ldOf(TEMPLATE);
const TEMPLATE_BEFORE = TEMPLATE.replace(/\n\s*"alternateName": \["site\.test"\],/, "");
const WEBSITE_LD_BEFORE = ldOf(TEMPLATE_BEFORE);

// ── a site with hreflang clusters ────────────────────────────────────────────
const PROSE = "This page is written for people looking for work, and it says what the board holds and how it was read. ".repeat(4);
type Alt = [code: string, path: string];
function page(path: string, o: { title?: string; canon?: string[] | null; lang?: string; alts?: Alt[]; body?: string; ld?: string[] } = {}): string {
  const canon = o.canon === null ? [] : (o.canon ?? [`${SITE}${path}`]);
  return `<!doctype html><html lang="${o.lang ?? "en"}"><head><meta charset="utf-8"><title>${o.title ?? `Page ${path}`}</title>`
    + canon.map((c) => `<link rel="canonical" href="${c}" />`).join("")
    + (o.alts ?? []).map(([code, p]) => `<link rel="alternate" hreflang="${code}" href="${/^https?:/.test(p) ? p : SITE + p}" />`).join("")
    + `<meta name="robots" content="index, follow">`
    + (o.ld ?? []).map((l) => `<script type="application/ld+json">${l}</script>`).join("")
    + `</head><body><div id="root"><main>${o.body ?? `<h1>${path}</h1><p>${PROSE}</p>`}</main></div></body></html>`;
}
const DATA = ["/ghost-job-index", "/pay-transparency", "/hiring-trends", "/entry-level-index"];
const FIGURES = `<p>In the daily re-check on 2026-11-17, 96.6% of 117 sampled postings were still live.</p><ul><li><b>985,179</b> — open roles</li></ul><p>${PROSE}</p>`;
const SINGLES = ["/", "/pricing", "/changelog", "/privacy", "/agents", "/jobs", ...DATA];
const COMPANIES = Array.from({ length: 8 }, (_, i) => `/jobs/company/co${i}`);
const ROLES = Array.from({ length: 8 }, (_, i) => `/roles/role-${i}`);
const INDUSTRIES = ["sales", "legal", "retail", "finance"];
/** Each cluster: its members as [code, path], x-default on the English page; a member's <html lang> is its code. */
const CLUSTERS: Alt[][] = [
  ...INDUSTRIES.map((x): Alt[] => [["en", `/industries/${x}`], ["es", `/es/industrias/${x}`]]),
  [["en", "/cv-standards/switzerland"], ["fr", "/fr/normes-cv/suisse"], ["de", "/de/lebenslauf-standards/schweiz"]],
  [["en", "/cv-standards/france"], ["fr", "/fr/normes-cv/france"]],
  [["en", "/cv-standards/united-states"]],
];
const altsOf = (c: Alt[]): Alt[] => [...c, ["x-default", c[0][1]]];
// The sitemap lists the Spanish pages in another order than the English ones,
// so on day 0 the sample reads /industries/sales and /industries/retail but
// /es/industrias/legal and /es/industrias/finance, and N8 reads the other four
// as alternates. Of /cv-standards it reads switzerland and france (two of
// three); every /fr and /de page is read.
const ES_ORDER = ["legal", "sales", "finance", "retail"];
const CLUSTER_PAGES = [
  ...INDUSTRIES.map((x) => `/industries/${x}`), ...ES_ORDER.map((x) => `/es/industrias/${x}`),
  "/cv-standards/switzerland", "/cv-standards/france", "/cv-standards/united-states",
  "/fr/normes-cv/suisse", "/fr/normes-cv/france", "/de/lebenslauf-standards/schweiz",
];
const ALL = [...SINGLES, ...COMPANIES, ...ROLES, ...CLUSTER_PAGES];
const READ_AS_ALTERNATES = ["/es/industrias/sales", "/es/industrias/retail", "/industries/legal", "/industries/finance"];

const sitemapOf = (paths: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url>\n    <loc>${SITE}${p}</loc>\n    <lastmod>2026-11-18</lastmod>\n  </url>`).join("\n")}\n</urlset>`;
function goodSite(o: { robots?: string; homeLd?: string[] } = {}): Site {
  const site: Site = { [`${SITE}/sitemap.xml`]: { body: sitemapOf(ALL) }, [`${SITE}/robots.txt`]: { headers: { "content-type": "text/plain" }, body: o.robots ?? ROBOTS } };
  for (const p of [...SINGLES, ...COMPANIES, ...ROLES]) {
    site[`${SITE}${p}`] = { body: page(p, { body: DATA.includes(p) ? `<h1>${p}</h1>${FIGURES}` : undefined, ld: p === "/" ? (o.homeLd ?? [WEBSITE_LD]) : undefined }) };
  }
  for (const c of CLUSTERS) for (const [code, p] of c) site[`${SITE}${p}`] = { body: page(p, { lang: code, alts: altsOf(c) }) };
  return site;
}
const withPage = (path: string, p: Page, base = goodSite()): Site => ({ ...base, [`${SITE}${path}`]: p });
const line = (lines: string[], claim: string) => lines.find((l) => new RegExp(`^(PASS|FAIL|INFO) {2}${claim} `).test(l)) ?? "";
const verdicts = (lines: string[], claim: string) => lines.filter((l) => new RegExp(`^(PASS|FAIL|INFO) {2}${claim} `).test(l)).map((l) => l.slice(0, 4));
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => lines.join("\n");
const reads = (calls: string[]) => calls.map((c) => c.split("\t")[0].replace(/^GET /, "").replace(SITE, ""));

describe("the files as they ship: N8, N9 and N10 PASS, and nothing FAILs", () => {
  const { lines, calls } = run(goodSite());
  it("prints PASS for N8, N9 and N10 and no FAIL anywhere", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of ["N8", "N9", "N10"]) expect(verdicts(lines, c), `${c}\n${show(lines)}`).toEqual(["PASS"]);
    expect(line(lines, "N9")).toMatch(/none of its 16 groups opens with a line allowing the whole site, and every one disallows \/admin\/claims, \/auth, \/account/);
    expect(line(lines, "N10")).toMatch(/"Resume Booster", gives site\.test as its alternateName/);
  });
  it("reads every alternate of every sampled cluster page, each once, robots.txt once, and only with GETs of the site", () => {
    const r = reads(calls);
    expect(new Set(r).size, show(r)).toBe(r.length);
    expect(r.filter((p) => p === "/robots.txt")).toHaveLength(1);
    const sampledClusterPages = CLUSTERS.flat().map(([, p]) => p).filter((p) => r.includes(p));
    expect(sampledClusterPages.length).toBeGreaterThan(4);
    for (const c of CLUSTERS) {
      if (!c.some(([, p]) => r.includes(p))) continue;
      for (const [, p] of c) expect(r, `${p}, an alternate of a page that was read`).toContain(p);
    }
    for (const c of calls) {
      expect(c, c).toMatch(new RegExp(`^GET ${SITE.replace(/\./g, "\\.")}/`));
      expect(c, c).not.toMatch(/apikey|Authorization/i);
    }
    for (const p of READ_AS_ALTERNATES) expect(r, p).toContain(p);
    expect(line(lines, "N8"), show(lines)).toMatch(/^PASS {2}N8 9 sampled page\(s\) in hreflang clusters, 4 alternate\(s\) read beside them: /);
  });
});

describe("the files as they stood before this change: N8 PASS, N9 FAIL, N10 FAIL", () => {
  it("prints what a dry run against production printed before the publish", () => {
    const { lines } = run(goodSite({ robots: ROBOTS_BEFORE, homeLd: [WEBSITE_LD_BEFORE] }));
    expect(ROBOTS_BEFORE).not.toBe(ROBOTS);
    expect(WEBSITE_LD_BEFORE).not.toBe(WEBSITE_LD);
    expect(verdicts(lines, "N8"), show(lines)).toEqual(["PASS"]);
    expect(line(lines, "N9"), show(lines)).toMatch(/^FAIL {2}N9 robots\.txt: 15 of its 16 groups open with a line allowing the whole site \(Googlebot, Bingbot, /);
    expect(line(lines, "N9")).toMatch(/Googlebot allows \/admin\/claims by the longest match/);
    expect(line(lines, "N10"), show(lines)).toMatch(/^FAIL {2}N10 \/'s WebSite node gives no alternateName naming site\.test \(it has null\)/);
  });
});

describe("N8 FAILs each way a cluster can break", () => {
  const n8 = (site: Site) => { const { lines } = run(site); return { v: verdicts(lines, "N8"), l: line(lines, "N8"), lines }; };
  const indSales = CLUSTERS[0];
  const ch = CLUSTERS[4];
  const fr = CLUSTERS[5];
  it("an alternate that does not return the same set (the Spanish page read beside the sample drops the English one)", () => {
    const r = n8(withPage("/es/industrias/sales", { body: page("/es/industrias/sales", { lang: "es", alts: [["es", "/es/industrias/sales"], ["x-default", "/industries/sales"]] }) }));
    expect(r.v, show(r.lines)).toEqual(["FAIL"]);
    expect(r.l).toMatch(/: 1 problem\(s\); e\.g\. \/es\/industrias\/sales \(hreflang es of \/industries\/sales\) does not return the same alternates, lacks en https:\/\/site\.test\/industries\/sales$/);
  });
  it("a page with no x-default", () => {
    const r = n8(withPage("/cv-standards/france", { body: page("/cv-standards/france", { alts: fr }) }));
    expect(r.v, show(r.lines)).toEqual(["FAIL"]);
    expect(r.l).toMatch(/; e\.g\. \/cv-standards\/france \(no x-default\);/);
  });
  it("a code that names two addresses", () => {
    const r = n8(withPage("/cv-standards/switzerland", { body: page("/cv-standards/switzerland", { alts: [...altsOf(ch), ["fr", "/fr/normes-cv/belgique"]] }) }));
    expect(r.v, show(r.lines)).toEqual(["FAIL"]);
    expect(r.l).toMatch(/; e\.g\. \/cv-standards\/switzerland \(hreflang fr names 2 addresses\);/);
  });
  it("an alternate that answers 404, or redirects", () => {
    const r = n8(withPage("/es/industrias/sales", { status: 404, body: "Not found" }));
    expect(r.v, show(r.lines)).toEqual(["FAIL"]);
    expect(r.l).toMatch(/: 1 problem\(s\); e\.g\. \/es\/industrias\/sales \(hreflang es of \/industries\/sales\) answered HTTP 404$/);
    const moved = n8(withPage("/es/industrias/sales", { status: 301, headers: { location: `${SITE}/industries/sales` }, body: "" }));
    expect(moved.l).toMatch(/\/es\/industrias\/sales \(hreflang es of \/industries\/sales\) answered HTTP 301$/);
  });
  it("an alternate whose canonical is another page, and one whose <html lang> is not its code", () => {
    let site = withPage("/es/industrias/retail", { body: page("/es/industrias/retail", { lang: "es", alts: altsOf(CLUSTERS[2]), canon: [`${SITE}/industries/retail`] }) });
    site = withPage("/industries/legal", { body: page("/industries/legal", { lang: "es", alts: altsOf(CLUSTERS[1]) }) }, site);
    const r = n8(site);
    expect(r.v, show(r.lines)).toEqual(["FAIL"]);
    expect(r.l).toMatch(/\/es\/industrias\/retail \(hreflang es of \/industries\/retail\) names canonical https:\/\/site\.test\/industries\/retail/);
    expect(r.l).toMatch(/\/industries\/legal \(hreflang en of \/es\/industrias\/legal\) says <html lang="es">/);
  });
  it("a page in another language with no alternates", () => {
    const r = n8(withPage("/fr/normes-cv/france", { body: page("/fr/normes-cv/france", { lang: "fr" }) }));
    expect(r.v, show(r.lines)).toEqual(["FAIL"]);
    expect(r.l).toMatch(/\/fr\/normes-cv\/france \(in "fr" with no hreflang alternates\)/);
  });
  it("a page that does not name itself", () => {
    const r = n8(withPage("/de/lebenslauf-standards/schweiz", { body: page("/de/lebenslauf-standards/schweiz", { lang: "de", alts: altsOf(ch).filter(([c]) => c !== "de") }) }));
    expect(r.v, show(r.lines)).toEqual(["FAIL"]);
    expect(r.l).toMatch(/\/de\/lebenslauf-standards\/schweiz \(does not name itself among its alternates\)/);
  });
  it("an alternate on another host is a FAIL, and is never read", () => {
    const site = withPage("/industries/sales", { body: page("/industries/sales", { alts: [...altsOf(indSales), ["pt", "https://elsewhere.test/pt/x"]] }) });
    const { lines, calls } = run(site);
    expect(line(lines, "N8"), show(lines)).toMatch(/^FAIL {2}N8 .*\/industries\/sales \(names an alternate on another host: https:\/\/elsewhere\.test\/pt\/x\)/);
    expect(calls.some((c) => c.includes("elsewhere.test"))).toBe(false);
  });
  it("with no page in a cluster and none in another language it is INFO, never a PASS", () => {
    const site: Site = { [`${SITE}/sitemap.xml`]: { body: sitemapOf([...SINGLES, ...COMPANIES, ...ROLES]) }, [`${SITE}/robots.txt`]: { body: ROBOTS } };
    for (const p of [...SINGLES, ...COMPANIES, ...ROLES]) site[`${SITE}${p}`] = { body: page(p, { body: DATA.includes(p) ? `<h1>${p}</h1>${FIGURES}` : undefined, ld: p === "/" ? [WEBSITE_LD] : undefined }) };
    const { lines } = run(site);
    expect(line(lines, "N8"), show(lines)).toMatch(/^INFO {2}N8 no sampled page carries hreflang alternates or is in another language/);
    expect(fails(lines), show(lines)).toEqual([]);
  });
});

describe("N9 FAILs a robots.txt that lets a reader in", () => {
  it("one group that opens with the whole site allowed is named, and the first-match reading of /auth comes out allowed", () => {
    const opened = ROBOTS.replace("User-agent: GPTBot\n", "User-agent: GPTBot\nAllow: /\n");
    expect(opened).not.toBe(ROBOTS);
    const l = line(run(goodSite({ robots: opened })).lines, "N9");
    expect(l).toMatch(/^FAIL {2}N9 robots\.txt: 1 of its 16 groups open with a line allowing the whole site \(GPTBot\), and 3 reading\(s\) of \/admin\/claims, \/auth, \/account come out allowed; e\.g\. GPTBot allows \/admin\/claims by the first match/);
    expect(l).not.toMatch(/by the longest match/);
  });
  it("the * group without /admin/ is caught by both readings", () => {
    const at = ROBOTS.indexOf("User-agent: *\n");
    const noAdmin = ROBOTS.slice(0, at) + ROBOTS.slice(at).replace("Disallow: /admin/\n", "");
    expect(noAdmin).not.toBe(ROBOTS);
    const l = line(run(goodSite({ robots: noAdmin })).lines, "N9");
    expect(l).toMatch(/^FAIL {2}N9 robots\.txt: 0 of its 16 groups .*2 reading\(s\) .*\* allows \/admin\/claims by the longest match; \* allows \/admin\/claims by the first match$/);
  });
  it("a 200 with no User-agent group (the app's page) FAILs; a 404 is INFO, with section 63 named", () => {
    const html = withPage("/robots.txt", { body: page("/robots.txt") });
    expect(line(run(html).lines, "N9")).toMatch(/^FAIL {2}N9 robots\.txt answered 200 with no User-agent group in it/);
    const missing = withPage("/robots.txt", { status: 404, body: "Not found" });
    const { lines } = run(missing);
    expect(line(lines, "N9")).toMatch(/^INFO {2}N9 robots\.txt answered HTTP 404, so no group could be judged here \(section 63 FAILs/);
    expect(fails(lines), show(lines)).toEqual([]);
  });
  it("is not asked for when the sitemap does not answer, and not after the site stops answering", () => {
    const { calls } = run({ [`${SITE}/sitemap.xml`]: { status: 404, body: "Not found" } });
    expect(calls).toHaveLength(1);
    const site: Site = { [`${SITE}/sitemap.xml`]: { body: sitemapOf(ALL) }, [`${SITE}/robots.txt`]: { body: ROBOTS } };
    for (const p of ALL) site[`${SITE}${p}`] = { dead: true };
    const dead = run(site);
    expect(dead.calls).toHaveLength(1 + 5);
    expect(line(dead.lines, "N9")).toMatch(/^INFO {2}N9 robots\.txt was not read: the site stopped answering/);
  });
});

describe("N10 FAILs a homepage whose site name has no domain backup", () => {
  const n10 = (homeLd: string[]) => line(run(goodSite({ homeLd })).lines, "N10");
  it("an alternateName naming another host, two WebSite nodes, and an unparseable block hiding it", () => {
    expect(n10([WEBSITE_LD.replace('"alternateName":["site.test"]', '"alternateName":["resumebooster.io"]')])).toMatch(/^FAIL {2}N10 .*no alternateName naming site\.test \(it has \["resumebooster\.io"\]\)/);
    expect(n10([WEBSITE_LD, '{"@type":"WebSite","name":"Resume Booster","url":"https://site.test"}'])).toMatch(/^FAIL {2}N10 \/ carries 2 WebSite nodes/);
    expect(n10(['{"@type":"WebSite",'])).toMatch(/^FAIL {2}N10 \/ carries 1 JSON-LD block\(s\) that do not parse/);
  });
  it("a WebSite node inside an @graph, with the domain as a plain string, PASSes; a / with no WebSite node is INFO", () => {
    expect(n10(['{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Resume Booster"},{"@type":"WebSite","name":"Resume Booster","alternateName":"site.test","url":"https://site.test"}]}'])).toMatch(/^PASS {2}N10 /);
    expect(n10(['{"@type":"Organization","name":"Resume Booster"}'])).toMatch(/^INFO {2}N10 \/ carries no WebSite node, so its name could not be judged here \(98-seo-round G1/);
  });
  it("the sound site's WebSite block is the template's, so removing the line from index.html fails the sound case", () => {
    expect(WEBSITE_LD).toContain('"alternateName":["site.test"]');
    expect(TEMPLATE_BEFORE).not.toBe(TEMPLATE);
  });
});

describe("every line is a verdict, and nothing is written", () => {
  it("prints only the header and PASS, FAIL or INFO lines, and asks only with GET", () => {
    const { lines, calls, out } = run(goodSite({ robots: ROBOTS_BEFORE }));
    expect(lines.every((l) => /^(PASS|FAIL|INFO) {2}/.test(l) || /^== 98zz\. /.test(l)), out).toBe(true);
    expect(calls.every((c) => c.startsWith(`GET ${SITE}/`))).toBe(true);
  });
});
