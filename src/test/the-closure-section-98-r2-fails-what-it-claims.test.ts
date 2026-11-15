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
