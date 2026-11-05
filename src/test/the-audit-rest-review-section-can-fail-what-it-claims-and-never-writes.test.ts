// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE AUDIT-REST REVIEW SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzz-audit-rest-review.sh).
 *
 * The section is run against a fake curl that answers from routes and logs every
 * call. The chunk texts below were read off one real `vite build` of the branch,
 * so the patterns are the minifier's forms and not the source's:
 *   - a good publish passes every claim and fails none;
 *   - the frontend live at c4a29736 fails R1 to R6, and only the guard passes;
 *   - each claim fails alone when its own text is gone;
 *   - a baked total fails, whether it is today's or a stale one, and "7 scans" in
 *     a page's prose does not;
 *   - the font line is INFO whatever it finds;
 *   - nothing is written, the key is never printed, and every test file an INFO
 *     line names exists.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-audit-rest-review.sh"), "utf8");
const KEY = "pk_test_SECRET_marker_review";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")i++;
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdreview-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nset -o pipefail\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${SECTION}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

type Chunks = { Success: string; ProductSuccess: string; DataApi: string; Jobs: string; AnalyticsDashboard: string; helper: string };
const NEW: Chunks = {
  Success: 'x("success.sharedViewDeleteNote","Only the buyer can delete this analysis, and this shared link cannot. If you bought it, ...")',
  ProductSuccess: 'const m={busy:!0,unknown:!0,refunded:!1,withdrawn:!1,sign_in_again:!1,not_found:!0};x("body","If you just paid, wait a moment and try again. Otherwise paste ...")',
  DataApi: 'await k.functions.invoke("api-key-request",{body:{email:y,name:l,language:t.language,...j?{termsVersion:j}:{}}})',
  Jobs: 'import{P as w}from"./board-facets-abc.js";import{Q as q}from"./card-def.js";await Z.functions.invoke("company-claim",{body:{action:"request",companyToken:e,companyName:o,workEmail:C.trim(),language:h.language}})',
  AnalyticsDashboard: 'return"Hit the 50,000-event read cap, which reads oldest first: the newest days are cut"',
  helper: 'async function P(e,t){const a=j(e);if(!a)return t({});const o=await t({locale:a});return o!=null&&o.error&&/locale/.test(o.error.message??"")?t({}):o}',
};
const LIVE: Chunks = {
  Success: 'x("success.sharedViewDeleteNote","Only the buyer can delete this analysis, from the link in their purchase email.")',
  ProductSuccess: 'const m={busy:!0,unknown:!0,refunded:!1,withdrawn:!1,sign_in_again:!1,not_found:!1};x("body","The link may be cut short or expired.")',
  DataApi: 'await k.functions.invoke("api-key-request",{body:{email:y,name:l,...j?{termsVersion:j}:{}}})',
  Jobs: 'import{Q as q}from"./card-def.js";await Z.functions.invoke("company-claim",{body:{action:"request",companyToken:e,companyName:o,workEmail:C.trim()}})',
  AnalyticsDashboard: 'return"The read ran out of time and earlier days are a FLOOR"',
  helper: "",
};
const BAKED = "<html><body><h1>Free scan</h1><p>Your first 7 scans are free to read.</p></body></html>";
const site = (c: Chunks, pages: Partial<Record<string, string>> = {}, font: Route = { match: "^GET https://site\\.test/fonts/", headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000" } }): Route[] => [
  { match: "^GET https://site\\.test/$", body: pages["/"] ?? `${BAKED}<script src="/assets/index-main.js"></script>` },
  { match: "^GET https://site\\.test/trust$", body: pages["/trust"] ?? BAKED },
  { match: "^GET https://site\\.test/methodology$", body: pages["/methodology"] ?? BAKED },
  { match: "^GET https://site\\.test/assets/index-main\\.js$", body: '"./Success-s1.js";"./ProductSuccess-p1.js";"./DataApi-d1.js";"./Jobs-j1.js";"./AnalyticsDashboard-a1.js";' },
  { match: "^GET https://site\\.test/assets/Success-s1\\.js$", body: c.Success },
  { match: "^GET https://site\\.test/assets/ProductSuccess-p1\\.js$", body: c.ProductSuccess },
  { match: "^GET https://site\\.test/assets/DataApi-d1\\.js$", body: c.DataApi },
  { match: "^GET https://site\\.test/assets/Jobs-j1\\.js$", body: c.Jobs },
  { match: "^GET https://site\\.test/assets/AnalyticsDashboard-a1\\.js$", body: c.AnalyticsDashboard },
  { match: "^GET https://site\\.test/assets/board-facets-abc\\.js$", body: c.helper },
  { match: "^GET https://site\\.test/assets/card-def\\.js$", body: "const a=1" },
  { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/get_scan_totals$", body: '{"countries": 24, "total_scans": 1123}' },
  font,
];
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));

describe("the audit-rest review section", () => {
  it("a good publish passes every claim and fails none", () => {
    const { lines, out } = run(site(NEW));
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines), out).toHaveLength(7);
  });

  it("the frontend live at c4a29736 fails R1 to R6, and only the regression guard passes, saying so", () => {
    const { lines, out } = run(site(LIVE));
    for (const claim of [/real ways/, /no Try again on not_found/, /no language with a key request/, /no language with a claim/, /retries a saved search without its language/, /wrong end of the range/]) {
      expect(fails(lines).some((l) => claim.test(l)), `${claim}\n${out}`).toBe(true);
    }
    expect(fails(lines), out).toHaveLength(6);
    expect(passes(lines), out).toEqual([expect.stringMatching(/^PASS {2}regression guard, true before this deploy as well/)]);
  });

  it.each<[keyof Chunks, RegExp]>([
    ["Success", /real ways/],
    ["ProductSuccess", /no Try again on not_found/],
    ["DataApi", /no language with a key request/],
    ["AnalyticsDashboard", /wrong end of the range/],
  ])("%s without its own text fails that claim alone", (chunk, claim) => {
    const { lines, out } = run(site({ ...NEW, [chunk]: LIVE[chunk] }));
    expect(fails(lines), out).toEqual([expect.stringMatching(claim)]);
  });

  it("a board that lost the claim's language fails that claim alone", () => {
    const { lines, out } = run(site({ ...NEW, Jobs: NEW.Jobs.replace(",language:h.language", "") }));
    expect(fails(lines), out).toEqual([expect.stringMatching(/no language with a claim/)]);
  });

  it("a helper that lost the retry fails that claim alone, and one moved into the board's own chunk still passes", () => {
    const lost = run(site({ ...NEW, helper: "const a=1" }));
    expect(fails(lost.lines), lost.out).toEqual([expect.stringMatching(/retries a saved search without its language/)]);
    const moved = run(site({ ...NEW, Jobs: `${NEW.Jobs};${NEW.helper}`, helper: "const a=1" }));
    expect(fails(moved.lines), moved.out).toEqual([]);
  });

  it("a product page that retries but no longer says to try again fails", () => {
    const { lines, out } = run(site({ ...NEW, ProductSuccess: NEW.ProductSuccess.replace("If you just paid, wait a moment and try again", "The link may be cut short") }));
    expect(fails(lines), out).toEqual([expect.stringMatching(/no longer says to try again/)]);
  });

  it("no readable chunk fails, naming the chunk", () => {
    const { lines, out } = run(site(NEW).map((r) => (r.match.includes("index-main") ? { ...r, body: "" } : r)));
    for (const name of ["Success", "ProductSuccess", "DataApi", "Jobs", "AnalyticsDashboard"]) {
      expect(fails(lines).some((l) => l.includes(`no readable ${name} chunk`)), `${name}\n${out}`).toBe(true);
    }
  });

  it.each([
    ["/trust", "<p>1,123 Resumes Analyzed</p>"],
    ["/methodology", "<p>1,090 resumes processed</p>"],
    ["/", '<p class="x">1,123</p><script src="/assets/index-main.js"></script>'],
    ["/", '<p>the scanner has completed 1,090 scans</p><script src="/assets/index-main.js"></script>'],
  ])("%s baking %s fails the guard, whether the figure is today's or a stale one", (path, html) => {
    const { lines, out } = run(site(NEW, { [path]: html }));
    expect(fails(lines), out).toEqual([expect.stringMatching(new RegExp(`a baked page now prints a scan total: ${path.replace("/", "\\/")} `))]);
  });

  it("a number in a page's prose beside the word scans is not a scan total", () => {
    const { lines, out } = run(site(NEW));
    expect(lines.some((l) => /regression guard/.test(l)), out).toBe(true);
    expect(BAKED).toMatch(/7 scans/);
  });

  it("an unreadable baked page is not judged and says so", () => {
    const { lines, out } = run(site(NEW, { "/trust": "" }));
    expect(fails(lines), out).toEqual([]);
    expect(lines.some((l) => /^INFO {2}could not read \/trust/.test(l)), out).toBe(true);
    expect(lines.some((l) => /regression guard/.test(l)), out).toBe(false);
  });

  it("the font line is INFO whatever it finds, and says which", () => {
    const immutable = run(site(NEW));
    expect(immutable.lines.some((l) => /^INFO {2}\/fonts\/inter-latin\.woff2 carries Cache-Control: public, max-age=31536000/.test(l)), immutable.out).toBe(true);
    const none = run(site(NEW, {}, { match: "^GET https://site\\.test/fonts/", headers: { "content-type": "font/woff2", etag: "x" } }));
    expect(none.lines.some((l) => /^INFO {2}\/fonts\/inter-latin\.woff2 carries no Cache-Control/.test(l)), none.out).toBe(true);
    const spa = run(site(NEW, {}, { match: "^GET https://site\\.test/fonts/", headers: { "content-type": "text/html" } }));
    expect(spa.lines.some((l) => /^INFO {2}\/fonts\/inter-latin\.woff2 is not a font here/.test(l)), spa.out).toBe(true);
    const missing = run(site(NEW, {}, { match: "^GET https://site\\.test/fonts/", status: 404, headers: { "content-type": "text/plain; charset=UTF-8" } }));
    expect(missing.lines.some((l) => /^INFO {2}\/fonts\/inter-latin\.woff2 is not a font here \(HTTP 404/.test(l)), missing.out).toBe(true);
    for (const r of [immutable, none, spa, missing]) expect(fails(r.lines), r.out).toEqual([]);
  });

  it("never writes, never prints the key, and names only test files that exist", () => {
    const { calls, out, lines } = run(site(NEW));
    expect(calls.length).toBeGreaterThan(8);
    for (const c of calls) expect(c, c).toMatch(/^GET /);
    expect(out).not.toContain(KEY);
    const named = lines.flatMap((l) => l.match(/[a-z0-9-]+\.test\.tsx?/g) ?? []);
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const f of named) expect(existsSync(resolve(ROOT, "src/test", f)), f).toBe(true);
  });
});
