// @vitest-environment node
/**
 * SECTION 98-r2 CAN FAIL EACH CLAIM IT PRINTS (seo-connect, fe track, B01).
 *
 * scripts/verify-deploy.d/98-seo-r2.sh prints the closed-but-baked share from
 * a live run of the daily check, and judges the STOP switch and the
 * employer-closed stubs on the served documents. Each claim is run against a
 * stubbed site and stubbed employer systems twice: once with the defect it
 * exists to catch (a posting its employer closed still baked live, a posting
 * page serving no job markup with the switch on, an employer-closed stub left
 * in the sitemap serving markup, a JobPosting naming its employer by a logo
 * caption, a company page titled by its tenant code, a raw vendor key in the
 * pay table) and once fixed. A line that passes on both could not fail.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://site.test";
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Route = { match: string; status?: number; body?: string; type?: string };
/** Every fetch of the section and of the check it starts is answered from the routes; anything else is a 404. */
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url,init)=>{const u=String(url);
if(init&&init.method&&init.method!=="GET")throw new Error("not a GET: "+init.method+" "+u);
const r=routes.find((x)=>new RegExp(x.match).test(u));
if(!r)return new Response("",{status:404,headers:{"content-type":"text/plain"}});
return new Response(r.body??"",{status:r.status??200,headers:{"content-type":r.type??"text/html"}});};
`;

function runSection(routes: Route[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-98r2-"));
  dirs.push(dir);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "run.sh"), `set -u\nSITE=${SITE}; UA=ua\n. ${JSON.stringify(resolve(ROOT, "scripts/verify-deploy.d/98-seo-r2.sh"))}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
const esc = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (lines: string[], level: string, re: RegExp) => lines.some((l) => l.startsWith(level) && re.test(l));
const show = (lines: string[]) => lines.join("\n");

const A = "/jobs/posting/greenhouse/acme/1001";
const B = "/jobs/posting/greenhouse/acme/1002";
const C = "/jobs/posting/greenhouse/acme/1003";
const jp = (path: string, org?: string) => `<script type="application/ld+json" id="rb-posting-ld">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", url: `${SITE}${path}`, ...(org ? { hiringOrganization: { "@type": "Organization", name: org } } : {}) })}</script>`;
/** The company pages G5 reads, with the code they were titled by and the name they must print. */
const NAMED: ReadonlyArray<[string, string, string]> = [
  ["nyuhs~wd12~nyuhscareers1", "Nyuhs", "United Health Services"],
  ["papajohns~wd1~PapaJohnsCareers", "Papajohns", "Papa John&#39;s"],
  ["ssctech~wd1~ssctechnologies", "Ssctech", "SS&amp;C Technologies"],
  ["hubinternational~wd1~HUBInternational", "Hubinternational", "HUB International"],
];
const page = (head: string) => `<!doctype html><html><head>${head}</head><body><h1>Job</h1></body></html>`;

function site(fixed: boolean): Route[] {
  const inSitemap = fixed ? [A, B] : [A, B, C];
  const ledger = {
    postings: {
      [A]: { state: "live", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1001" },
      [B]: { state: "live", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1002" },
      [C]: { state: "gone", basis: "employer" },
    },
  };
  return [
    { match: `^${esc(`${SITE}/sitemap.xml`)}$`, body: `<urlset>${inSitemap.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`, type: "application/xml" },
    { match: `^${esc(`${SITE}/prerender-ledger.json`)}$`, body: JSON.stringify(ledger), type: "application/json" },
    // Unfixed: its JobPosting names the employer by an ADP logo file's caption.
    { match: `^${esc(`${SITE}${A}`)}$`, body: page(jp(A, fixed ? "Acme" : "VHB Email Signature")) },
    // Unfixed: a posting page that serves no JobPosting while the switch is on.
    { match: `^${esc(`${SITE}${B}`)}$`, body: page(fixed ? jp(B, "Acme") : "") },
    // Unfixed: company pages titled by their tenant code.
    ...NAMED.map(([t, code, name]) => {
      const shown = fixed ? name : code;
      return { match: `^${esc(`${SITE}/jobs/company/${t}`)}$`, body: page(`<title>${shown} jobs: 12 open roles from their own hiring system</title>`).replace("<h1>Job</h1>", `<h1>Open roles at ${shown}</h1>`) };
    }),
    // Unfixed: the pay table prints a raw vendor key.
    { match: `^${esc(`${SITE}/pay-transparency`)}$`, body: page(`<table><tr><td class="py-1 pr-3">${fixed ? "UKG Pro Recruiting" : "ukg"}</td><td>900</td></tr><tr><td class="py-1 pr-3">Workday</td><td>40</td></tr></table>`) },
    // Unfixed: the employer-closed stub still serves its markup and no noindex.
    { match: `^${esc(`${SITE}${C}`)}$`, body: page(fixed ? `<meta name="robots" content="noindex, follow">` : jp(C)) },
    { match: "^https://boards-api\\.greenhouse\\.io/v1/boards/acme/jobs/1001$", body: "{}", type: "application/json" },
    // Unfixed: the employer closed B, and the site still bakes it live.
    { match: "^https://boards-api\\.greenhouse\\.io/v1/boards/acme/jobs/1002$", status: fixed ? 200 : 404, body: "{}", type: "application/json" },
  ];
}

describe("section 98-r2 judges what it says it judges", () => {
  const bad = runSection(site(false));
  const good = runSection(site(true));

  it("G1 prints the closed share from the live check and FAILs over 5%", () => {
    expect(has(bad, "FAIL", /G1 \d{4}-\d\d-\d\d: 2 live posting pages asked of their employers: 1 open, 1 closed, 0 unknown; closed share 50\.0%/), show(bad)).toBe(true);
    expect(has(bad, "INFO", new RegExp(`G1   closed at the employer: ${esc(B)}`)), show(bad)).toBe(true);
    expect(has(good, "PASS", /G1 .*2 open, 0 closed, 0 unknown; closed share 0\.0% .*the owner line is 5%/), show(good)).toBe(true);
  });

  it("G2 FAILs a sitemap posting page serving no job markup while the switch is on", () => {
    expect(has(bad, "FAIL", new RegExp(`G2 switch ON: .*${esc(B)} \\(HTTP 200, 0 JobPosting, want 1\\)`)), show(bad)).toBe(true);
    expect(has(good, "PASS", /G2 switch ON: 2 of 2 sitemap posting pages serve exactly one JobPosting/), show(good)).toBe(true);
  });

  it("G3 FAILs an employer-closed stub left in the sitemap or serving markup", () => {
    expect(has(bad, "FAIL", /G3 1 postings closed at the employer: 1 still in the sitemap, 1 of the first 1 serving markup or no noindex/), show(bad)).toBe(true);
    expect(has(good, "PASS", /G3 1 postings closed at the employer: 0 still in the sitemap, 0 of the first 1/), show(good)).toBe(true);
  });

  it("G4 FAILs a JobPosting that names its employer by a logo caption, judged by the bake's own gate", () => {
    expect(has(bad, "FAIL", new RegExp(`G4 0 of 1 JobPosting employer names .*${esc(A)} "VHB Email Signature" \\(logo or image text\\)`)), show(bad)).toBe(true);
    expect(has(good, "PASS", /G4 2 of 2 JobPosting employer names on sitemap posting pages are names/), show(good)).toBe(true);
  });

  it("G5 FAILs a company page still titled by its tenant code", () => {
    expect(has(bad, "FAIL", /G5 \/jobs\/company\/nyuhs~wd12~nyuhscareers1 names United Health Services: title "Nyuhs jobs/), show(bad)).toBe(true);
    for (const [t] of NAMED) expect(has(good, "PASS", new RegExp(`G5 /jobs/company/${esc(t)} names `)), show(good)).toBe(true);
    // The served entities are read as the characters they are.
    expect(has(good, "PASS", /G5 \/jobs\/company\/papajohns~wd1~PapaJohnsCareers names Papa John's: title "Papa John's jobs/), show(good)).toBe(true);
    expect(has(good, "PASS", /G5 \/jobs\/company\/ssctech~wd1~ssctechnologies names SS&C Technologies/), show(good)).toBe(true);
  });

  it("G6 FAILs a raw vendor key in the pay table", () => {
    expect(has(bad, "FAIL", /G6 \/pay-transparency prints raw vendor keys in its table: ukg/), show(bad)).toBe(true);
    expect(has(good, "PASS", /G6 \/pay-transparency prints no raw vendor key in its table/), show(good)).toBe(true);
  });

  it("sends only GETs, to the site and the employers' own systems", () => {
    expect(show(bad) + show(good)).not.toMatch(/not a GET/);
  });
});

/**
 * G1 JUDGES THE UNKNOWN SHARE PER VENDOR (SEO check 2026-11-15, F01). The
 * overall unknown share was the only one compared to 20%, so a vendor whose
 * every page was unknown passed whenever the others were many: Oracle, ADP,
 * Breezy and Recruitee were 100% unknown (72 pages) under an overall 15-16%.
 * Here eleven Greenhouse pages are open at the employer, and two more pages
 * belong to a vendor the reader does not read ("unread") or to UKG ("ukg"):
 * 2 of 13 unknown overall either way. "clean" is the eleven alone.
 *
 * UKG WAS READ FOR ITS STATEMENTS ONLY UNTIL seo/1121-bake, which checks it at
 * the employer: STATED_ONLY_VENDORS is empty, so an unknown UKG page now FAILs
 * like any checked vendor's. The section's not-checked (INFO) path has no
 * vendor to show it until the list names one again.
 */
function vendorSite(kind: "unread" | "ukg" | "clean"): Route[] {
  const gh = Array.from({ length: 11 }, (_, i) => `/jobs/posting/greenhouse/acme/${2001 + i}`);
  const other = kind === "ukg"
    ? ["/jobs/posting/ukg/recruiting~ACM1000ACME~0b1e/aa11", "/jobs/posting/ukg/recruiting~ACM1000ACME~0b1e/aa12"]
    : kind === "unread" ? ["/jobs/posting/jazzhr/acme/job_1", "/jobs/posting/jazzhr/acme/job_2"] : [];
  const paths = [...gh, ...other];
  const ledger = { postings: Object.fromEntries(paths.map((p) => [p, { state: "live", applyUrl: p.includes("/greenhouse/") ? `https://job-boards.greenhouse.io/acme/jobs/${p.split("/").pop()}` : null }])) };
  return [
    { match: `^${esc(`${SITE}/sitemap.xml`)}$`, body: `<urlset>${paths.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`, type: "application/xml" },
    { match: `^${esc(`${SITE}/prerender-ledger.json`)}$`, body: JSON.stringify(ledger), type: "application/json" },
    { match: "^https://boards-api\\.greenhouse\\.io/v1/boards/acme/jobs/\\d+$", body: "{}", type: "application/json" },
  ];
}

describe("section 98-r2 G1 names a vendor whose pages are never checked", () => {
  const bad = runSection(vendorSite("unread"));
  const ukg = runSection(vendorSite("ukg"));
  const good = runSection(vendorSite("clean"));

  it("FAILs a vendor whose pages are all unknown, though the overall unknown share is under 20%", () => {
    expect(has(bad, "PASS", /G1 .*11 open, 0 closed, 2 unknown; closed share 0\.0%/), show(bad)).toBe(true);
    expect(has(bad, "FAIL", /G1 jazzhr: 2 of 2 live posting pages unknown at the employer \(100\.0%, over 20%\)/), show(bad)).toBe(true);
  });

  it("FAILs UKG's unknown pages now that the reader checks UKG at the employer, and names no vendor as not checked", async () => {
    const reads = await import("../../scripts/employer-reads.mjs");
    expect(reads.STATED_ONLY_VENDORS, "a vendor is read for its statements only again: show the not-checked INFO here").toEqual([]);
    expect(has(ukg, "FAIL", /G1 ukg: 2 of 2 live posting pages unknown at the employer \(100\.0%, over 20%\)/), show(ukg)).toBe(true);
    expect(ukg.some((l) => /NOT CHECKED/.test(l)), show(ukg)).toBe(false);
    expect(good.filter((l) => l.startsWith("FAIL") && /^FAIL\s+G1/.test(l)), show(good)).toEqual([]);
  });

  it("PASSes the per-vendor judgement when every vendor the reader checks is at most 20% unknown", () => {
    expect(has(good, "PASS", /G1 every vendor checked at the employer is at most 20% unknown \(greenhouse 0 of 11\)/), show(good)).toBe(true);
    expect(has(bad, "PASS", /G1 every vendor checked/), show(bad)).toBe(false);
  });
});

/**
 * G1 COUNTS A VENDOR READ ONCE PER BOARD BY ITS BOARDS (review of
 * 2026-11-15). Breezy, Recruitee and Ashby are read with one list request per
 * board, so one failed GET makes every page of that board unknown: live,
 * Breezy has 7 pages, 4 of them on almentor, and one failed almentor read was
 * 4 of 7 unknown, a FAIL. For those vendors a FAIL needs unknown pages from
 * two boards or more. Here 30 Greenhouse pages are open, and 7 Breezy pages
 * sit on two boards: in the first site the 4-page board's list fails (one
 * board), in the second both boards' lists fail.
 */
function boardVendorSite(failing: 1 | 2): Route[] {
  const gh = Array.from({ length: 30 }, (_, i) => `/jobs/posting/greenhouse/acme/${4001 + i}`);
  const big = ["aaa001-store-lead", "aaa002-cashier", "aaa003-barista", "aaa004-shift-lead"].map((k) => `/jobs/posting/breezy/bigboard/${k}`);
  const small = ["bbb001-analyst", "bbb002-engineer", "bbb003-designer"].map((k) => `/jobs/posting/breezy/smallboard/${k}`);
  const paths = [...gh, ...big, ...small];
  const ledger = { postings: Object.fromEntries(paths.map((p) => [p, { state: "live", applyUrl: p.includes("/greenhouse/") ? `https://job-boards.greenhouse.io/acme/jobs/${p.split("/").pop()}` : null }])) };
  const list = (keys: string[]) => JSON.stringify(keys.map((k) => ({ id: k.split("-")[0], friendly_id: k, name: k })));
  return [
    { match: `^${esc(`${SITE}/sitemap.xml`)}$`, body: `<urlset>${paths.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`, type: "application/xml" },
    { match: `^${esc(`${SITE}/prerender-ledger.json`)}$`, body: JSON.stringify(ledger), type: "application/json" },
    { match: "^https://boards-api\\.greenhouse\\.io/v1/boards/acme/jobs/\\d+$", body: "{}", type: "application/json" },
    { match: "^https://bigboard\\.breezy\\.hr/json$", status: 403, body: "" },
    failing === 2
      ? { match: "^https://smallboard\\.breezy\\.hr/json$", status: 403, body: "" }
      : { match: "^https://smallboard\\.breezy\\.hr/json$", body: list(small.map((p) => p.split("/").pop()!)), type: "application/json" },
  ];
}

describe("section 98-r2 G1 judges a vendor read once per board by its boards", () => {
  const oneBoard = runSection(boardVendorSite(1));
  const twoBoards = runSection(boardVendorSite(2));

  it("one failed board read on a 4-page board is INFO, not a FAIL", () => {
    expect(has(oneBoard, "PASS", /G1 .*33 open, 0 closed, 4 unknown/), show(oneBoard)).toBe(true);
    expect(has(oneBoard, "INFO", /G1 breezy: 4 of 7 live posting pages unknown at the employer \(57\.1%, over 20%\), from 1 board/), show(oneBoard)).toBe(true);
    expect(oneBoard.filter((l) => /^FAIL\s+G1/.test(l)), show(oneBoard)).toEqual([]);
  });

  it("failed reads on two boards are a FAIL", () => {
    expect(has(twoBoards, "PASS", /G1 .*30 open, 0 closed, 7 unknown/), show(twoBoards)).toBe(true);
    expect(has(twoBoards, "FAIL", /G1 breezy: 7 of 7 live posting pages unknown at the employer \(100\.0%, over 20%\), from 2 boards/), show(twoBoards)).toBe(true);
  });
});

/**
 * G7 FAILS JOB MARKUP ON A POSTING ONLY THE EMPLOYER'S OWN PEOPLE MAY APPLY
 * FOR (SEO check 2026-11-15, F02). The live Coupang Internal page carried a
 * JobPosting naming "Coupang Internal" whose description said the posting was
 * exclusively for internal employees. Unfixed, the sitemap names that page
 * and a public board's posting whose text says it is intended for current
 * employees, both marked up; fixed, the bake has retired both to noindex stubs
 * outside the sitemap, and the one page left is open to everyone.
 */
function internalSite(fixed: boolean): Route[] {
  const coupang = "/jobs/posting/greenhouse/coupanginternal/8287892";
  const vf = "/jobs/posting/greenhouse/acme55/5550001";
  const ok = "/jobs/posting/greenhouse/acme/3001";
  const paths = fixed ? [ok] : [coupang, vf, ok];
  const block = (path: string, org: string, title: string, description: string) => `<script type="application/ld+json" id="posting-jsonld">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", url: `${SITE}${path}`, title, description, hiringOrganization: { "@type": "Organization", name: org } })}</script>`;
  const ledger = { postings: Object.fromEntries([coupang, vf, ok].map((p) => [p, { state: paths.includes(p) ? "live" : "retired" }])) };
  return [
    { match: `^${esc(`${SITE}/sitemap.xml`)}$`, body: `<urlset>${paths.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`, type: "application/xml" },
    { match: `^${esc(`${SITE}/prerender-ledger.json`)}$`, body: JSON.stringify(ledger), type: "application/json" },
    { match: `^${esc(`${SITE}${coupang}`)}$`, body: page(block(coupang, "Coupang Internal", "Principal, Real Estate [L6-II]", "This posting is exclusively for internal employees. To apply, please complete the attached Internal Transfer Request Form and submit it via your Coupang email address.")) },
    { match: `^${esc(`${SITE}${vf}`)}$`, body: page(block(vf, "Acme Foods", "Farm Operations Supervisor", "**Internal Job Posting** This posting is intended for current Acme Foods employees. If you are not an employee, please visit our careers page.")) },
    { match: `^${esc(`${SITE}${ok}`)}$`, body: page(block(ok, "Acme", "Account Manager", "Internal candidates are only asked to join on video. This position is open to internal and external candidates.")) },
    { match: "^https://boards-api\\.greenhouse\\.io/v1/boards/[a-z]+/jobs/\\d+$", body: "{}", type: "application/json" },
  ];
}

describe("section 98-r2 G7 fails job markup on a posting only the employer's own people may apply for", () => {
  const bad = runSection(internalSite(false));
  const good = runSection(internalSite(true));

  it("FAILs an internal board's page and a public board's page whose text says it, judged by the bake's own rule", () => {
    expect(has(bad, "FAIL", new RegExp(`G7 1 of 3 JobPostings on sitemap posting pages are open to everyone: .*${esc("/jobs/posting/greenhouse/coupanginternal/8287892")} \\(an internal board: "Coupang Internal"\\)`)), show(bad)).toBe(true);
    expect(has(bad, "FAIL", new RegExp(`G7 .*${esc("/jobs/posting/greenhouse/acme55/5550001")} \\(its text says "This posting is intended for current Acme Foods employees"\\)`)), show(bad)).toBe(true);
  });

  it("PASSes when the only marked-up page is open to everyone, whatever it says to internal candidates", () => {
    expect(has(good, "PASS", /G7 1 of 1 JobPostings on sitemap posting pages are open to everyone/), show(good)).toBe(true);
    expect(good.filter((l) => /^FAIL\s+G7/.test(l)), show(good)).toEqual([]);
  });
});

/**
 * G8 FAILS JOB MARKUP ON A PAID-SURVEY PANEL AD (SEO check 2026-11-15, F03).
 * Unfixed, the sitemap names a posting page from the usasurveyjob feed and a
 * public board's page whose text is the same ad, both marked up; fixed, both
 * are gone and the one page left is a job that speaks of surveys as work.
 */
function surveySite(fixed: boolean): Route[] {
  const feed = "/jobs/posting/lever/usasurveyjob/d60f2773-5722-438d-be70-ddfa533facf8";
  const elsewhere = "/jobs/posting/greenhouse/acme77/7770001";
  const ok = "/jobs/posting/greenhouse/acme/3002";
  const paths = fixed ? [ok] : [feed, elsewhere, ok];
  const block = (path: string, org: string, title: string, description: string) => `<script type="application/ld+json" id="posting-jsonld">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", url: `${SITE}${path}`, title, description, hiringOrganization: { "@type": "Organization", name: org } })}</script>`;
  const ledger = { postings: Object.fromEntries([feed, elsewhere, ok].map((p) => [p, { state: paths.includes(p) ? "live" : "retired" }])) };
  return [
    { match: `^${esc(`${SITE}/sitemap.xml`)}$`, body: `<urlset>${paths.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}</urlset>`, type: "application/xml" },
    { match: `^${esc(`${SITE}/prerender-ledger.json`)}$`, body: JSON.stringify(ledger), type: "application/json" },
    { match: `^${esc(`${SITE}${feed}`)}$`, body: page(block(feed, "Usasurveyjob", "Client Support Representative - Remote Data Entry Clerk", "We provide you the chance to make additional income at home. You will be performing different jobs such as data entry and evaluations.")) },
    { match: `^${esc(`${SITE}${elsewhere}`)}$`, body: page(block(elsewhere, "Acme Panel", "Work at Home Data Entry Agent - Part Time", "Earn money at Home by Participating in Surveys - Data Entry - Customer Service Rep - Part Time. Earn by taking polls.")) },
    { match: `^${esc(`${SITE}${ok}`)}$`, body: page(block(ok, "Acme", "Market Research Analyst", "Design customer surveys, run focus groups and report what the polls show to the product team.")) },
    { match: "^https://boards-api\\.greenhouse\\.io/v1/boards/[a-z]+/jobs/\\d+$", body: "{}", type: "application/json" },
  ];
}

describe("section 98-r2 G8 fails job markup on a paid-survey panel ad", () => {
  const bad = runSection(surveySite(false));
  const good = runSection(surveySite(true));

  it("FAILs a page from the held feed and the same ad on another board, judged by the bake's own rule", () => {
    expect(has(bad, "FAIL", new RegExp(`G8 1 of 3 JobPostings on sitemap posting pages are jobs, not paid-survey panel ads; .*${esc("/jobs/posting/lever/usasurveyjob/d60f2773-5722-438d-be70-ddfa533facf8")} \\(a board held as a paid-survey ad feed\\)`)), show(bad)).toBe(true);
    expect(has(bad, "FAIL", new RegExp(`G8 .*${esc("/jobs/posting/greenhouse/acme77/7770001")} \\(its text says "Earn money at Home by Participating in Surveys"\\)`)), show(bad)).toBe(true);
  });

  it("PASSes a job that speaks of surveys, focus groups and polls as work", () => {
    expect(has(good, "PASS", /G8 1 of 1 JobPostings on sitemap posting pages are jobs, not paid-survey panel ads/), show(good)).toBe(true);
  });
});
