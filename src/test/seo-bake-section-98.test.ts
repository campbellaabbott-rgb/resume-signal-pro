// @vitest-environment node
/**
 * SECTION 98 CAN FAIL (SEO round, 2026-10-18).
 *
 * scripts/verify-deploy.d/98-seo-round.sh judges the deploy on the served
 * documents. Each line below is run twice against a stubbed site: once with
 * the defect the before-audit measured (the 1200x675 card, no 180 px icon, a
 * company page linking /jobs?job=, a page with no #org, "No aggregators") and
 * once fixed. A line that passes on both would be a line that cannot fail.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://site.test";
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Route = { match: string; status?: number; body?: string; b64?: string; type?: string };
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
globalThis.fetch=async(url)=>{const u=String(url);
const r=routes.find((x)=>new RegExp(x.match).test(u));
if(!r)return new Response("",{status:404,headers:{"content-type":"text/plain"}});
const body=r.b64?Buffer.from(r.b64,"base64"):(r.body??"");
return new Response(body,{status:r.status??200,headers:{"content-type":r.type??"text/html"}});};
`;

function runSection(routes: Route[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-98-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "run.sh"), `set -u\nSITE=${SITE}; UA=ua\n. ${JSON.stringify(resolve(ROOT, "scripts/verify-deploy.d/98-seo-round.sh"))}\n`);
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
const route = (path: string, body: string, extra: Partial<Route> = {}): Route => ({ match: `^${esc(SITE + path)}$`, body, ...extra });
/** A PNG of the given size: the signature and the IHDR chunk are all the section reads. */
const png = (w: number, h: number, pad = 0) => {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b.toString("base64");
};
const ORG = `<script type="application/ld+json">{"@type":"Organization","@id":"${SITE}/#org","name":"Resume Booster"}</script><script type="application/ld+json">{"@type":"WebSite","@id":"${SITE}/#website","publisher":{"@id":"${SITE}/#org"}}</script>`;
const head = (ogH: number, apple: string) => `<html><head><meta property="og:image:width" content="1200"><meta property="og:image:height" content="${ogH}"><link rel="apple-touch-icon" href="${apple}">${ORG}</head><body><p>Live jobs.</p></body></html>`;
const has = (lines: string[], level: string, re: RegExp) => lines.some((l) => l.startsWith(level) && re.test(l));
const show = (lines: string[]) => lines.join("\n");

function site(fixed: boolean): Route[] {
  const company = fixed
    ? `<html><head>${ORG}</head><body><ul><li>Driver — Ann Arbor</li></ul><p>read from its own hiring system (SmartRecruiters); the live board re-checks a posting when you open it, where the employer's system allows it.</p></body></html>`
    : `<html><head></head><body><ul><li><a href="/jobs?job=smartrecruiters%3Adominos%3A1">Driver</a></li></ul><p>(one of Workday, SmartRecruiters, Breezy, JazzHR)</p><p>No aggregators.</p></body></html>`;
  return [
    route("/", head(fixed ? 630 : 675, fixed ? "/apple-touch-icon.png" : "/favicon.png")),
    route("/og-image.png", "", { b64: png(1200, fixed ? 630 : 675), type: "image/png" }),
    route("/favicon.png", "", { b64: png(fixed ? 64 : 512, fixed ? 64 : 512, fixed ? 0 : 80_000), type: "image/png" }),
    ...(fixed ? [route("/apple-touch-icon.png", "", { b64: png(180, 180), type: "image/png" })] : []),
    route("/favicon.ico", "", { b64: Buffer.from("icon").toString("base64"), type: "image/x-icon" }),
    route("/sitemap.xml", `<urlset><url><loc>${SITE}/jobs/company/dominos</loc></url><url><loc>${SITE}/about</loc></url><url><loc>${SITE}/jobs/posting/workday/alation~wd503~ExternalSite/R10000775</loc></url><url><loc>${SITE}/jobs/posting/workday/grpr~wd3~parques_reunidos/JR108112</loc></url></urlset>`, { type: "application/xml" }),
    route("/jobs/company/dominos", company),
    route("/jobs", fixed ? `<html><head>${ORG}</head><body>read from employers' own hiring systems, not copied from other job boards</body></html>` : "<html><head></head><body>No aggregators: each opening is read from the hiring system.</body></html>"),
    route("/companies", fixed
      ? `<html><head>${ORG}</head><body><p>Every posting is read from the hiring system that published it: an employer's own or the federal listing site (labelled).</p><ul><li>USAJOBS (the federal listing site)</li></ul></body></html>`
      : `<html><head>${ORG}</head><body><p>Every posting comes from the company's own hiring system.</p><ul><li>USAJOBS</li></ul></body></html>`),
    fixed
      ? route("/landers.json", JSON.stringify(Object.fromEntries([["dominos", "dominos"], ...Array.from({ length: 450 }, (_, i) => [`board${i}`, `board${i}`])])), { type: "application/json" })
      : route("/landers.json", "<!doctype html><html><head><title>Resume Booster</title></head></html>"),
    // A sitemap posting page: the bad one carries the review's two localities.
    route("/jobs/posting/workday/alation~wd503~ExternalSite/R10000775", `<html><head>${ORG}<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", datePosted: "2026-10-24", validThrough: fixed ? "2026-11-23T23:59:59+00:00" : "2026-11-24T23:59:59+00:00", jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "US", ...(fixed ? {} : { addressLocality: "USA-" }) } } })}</script></head><body>Posted 2026-10-25, as stated by the employer.</body></html>`),
    route("/jobs/posting/workday/grpr~wd3~parques_reunidos/JR108112", `<html><head>${ORG}<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", datePosted: "2026-10-20", validThrough: "2026-11-19T23:59:59+00:00", jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "DE", addressLocality: fixed ? "Bottrop-Kirchhellen" : "Movie Park Germany" } } })}</script></head><body></body></html>`),
  ];
}

describe("section 98 judges what it says it judges", () => {
  const bad = runSection(site(false));
  const good = runSection(site(true));
  it("I1: the share card, the favicon and the apple-touch-icon, by type, size and dimensions", () => {
    expect(has(bad, "FAIL", /I1 \/og-image\.png: 1200x675, want 1200x630/), show(bad)).toBe(true);
    expect(has(bad, "FAIL", /I1 \/favicon\.png: .*KB over 10 KB.*512x512/), show(bad)).toBe(true);
    expect(has(bad, "FAIL", /I1 \/apple-touch-icon\.png: HTTP 404/), show(bad)).toBe(true);
    expect(has(bad, "FAIL", /I1 the head links apple-touch-icon at \/favicon\.png/), show(bad)).toBe(true);
    expect(has(good, "PASS", /I1 \/og-image\.png: 200 image\/png, .*1200x630/), show(good)).toBe(true);
    expect(has(good, "PASS", /I1 \/favicon\.png: 200 image\/png, .*64x64/), show(good)).toBe(true);
    expect(has(good, "PASS", /I1 \/apple-touch-icon\.png: 200 image\/png, .*180x180/), show(good)).toBe(true);
    expect(has(good, "PASS", /I1 the head says og:image 1200x630, the file is 1200x630/), show(good)).toBe(true);
    expect(has(good, "PASS", /I1 the head links its apple-touch-icon at \/apple-touch-icon\.png/), show(good)).toBe(true);
  });
  it("C1: a company page linking /jobs?job=, naming all nineteen systems or re-checking unconditionally fails", () => {
    expect(has(bad, "FAIL", /C1 \/jobs\/company\/dominos: links \/jobs\?job=; \/jobs\/company\/dominos: names all nineteen hiring systems/), show(bad)).toBe(true);
    expect(has(good, "PASS", /C1 1 sampled company pages: no \/jobs\?job= link/), show(good)).toBe(true);
  });
  it("C4: a /landers.json served as the homepage's HTML fails, a JSON manifest naming dominos passes", () => {
    expect(has(bad, "FAIL", /C4 \/landers\.json: HTTP 200 "text\/html", not a JSON object/), show(bad)).toBe(true);
    expect(has(good, "PASS", /C4 \/landers\.json: 200 application\/json, 451 boards, dominos -> dominos/), show(good)).toBe(true);
  });
  it("P1: a locality ending in a dash or carrying a country, and a 31-day window, fail", () => {
    expect(has(bad, "FAIL", /P1 .*locality "USA-" \(a dash or a mark at one end\)/), show(bad)).toBe(true);
    expect(has(bad, "FAIL", /P1 .*locality "Movie Park Germany" \(a country.s name\)/), show(bad)).toBe(true);
    expect(has(bad, "FAIL", /P1 .*validThrough 2026-11-24 more than 30 days past datePosted 2026-10-24/), show(bad)).toBe(true);
    expect(has(good, "PASS", /P1 2 of 2 sampled posting pages carry job markup/), show(good)).toBe(true);
  });
  it("G3: the blanket source sentence on /companies fails", () => {
    expect(has(bad, "FAIL", /G3 .*\/companies: "Every posting comes from the company's own hiring system"/), show(bad)).toBe(true);
    expect(has(good, "FAIL", /G3 .*\/companies:/), show(good)).toBe(false);
  });
  it("G3: 'No aggregators' on a sampled page fails", () => {
    expect(has(bad, "FAIL", /G3 .*\/jobs: "No aggregators"/), show(bad)).toBe(true);
    expect(has(good, "FAIL", /G3 .*\/jobs: "No aggregators"/), show(good)).toBe(false);
  });
});
