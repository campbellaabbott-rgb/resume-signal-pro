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
 * in the sitemap serving markup) and once fixed. A line that passes on both
 * could not fail.
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
const jp = (path: string) => `<script type="application/ld+json" id="rb-posting-ld">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", url: `${SITE}${path}` })}</script>`;
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
    { match: `^${esc(`${SITE}${A}`)}$`, body: page(jp(A)) },
    // Unfixed: a posting page that serves no JobPosting while the switch is on.
    { match: `^${esc(`${SITE}${B}`)}$`, body: page(fixed ? jp(B) : "") },
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

  it("sends only GETs, to the site and the employers' own systems", () => {
    expect(show(bad) + show(good)).not.toMatch(/not a GET/);
  });
});
