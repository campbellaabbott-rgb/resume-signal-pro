// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zz CAN FAIL EVERY CLAIM IT MAKES, AND WAITS FOR WHAT IT NEEDS.
 *
 * scripts/verify-deploy.d/99zz-trusted-pages.sh is the post-deploy proof that
 * the six D7 pages (docs/company-profiles/name-gate-dry-run.md, table 1) are
 * named by their employer, filed in the country they are in, and carry the
 * JobPosting the gate now allows. A PASS is worth something only if a
 * regression could have turned it into a FAIL (verify-deploy.d/README.md), so
 * the section runs here against a fake curl that answers from routes and logs
 * every call:
 *   - a good deploy prints PASS for every claim and INFO only for the publish
 *     it detected;
 *   - each claim prints FAIL when its page or row is wrong, once what it waits
 *     for has happened, and INFO before (the publish carrying the names for
 *     the page lines; job-board .95 and the board's read by it for the API
 *     lines; a later bake for a page's country markup; the name-sync lane for
 *     the stored names);
 *   - the key is never printed, every board call carries x-rb-budget: probe
 *     and is a status, list or detail read, and every page is read as Googlebot.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zz-trusted-pages.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_HELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_99zz";
const UA = "Googlebot-test-ua";
const FB = "https://p\\.supabase\\.co/functions/v1/job-board";
const SITE = "https://site\\.test";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null,ua=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(x==="-A")ua=a[++i];else if(["-m","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\tua:"+(ua||"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd99zz-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=${UA}\n${BUILD_GE}\n${J_HELPER}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const AXIA = "recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522";
const H = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const today = new Date().toISOString().slice(0, 10);
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const shell = (o: { title: string; h1: string; robots?: string; body?: string; lds?: unknown[] }) =>
  `<html><head><title>${o.title}</title><meta name="robots" content="${o.robots ?? "index, follow"}" />` +
  `<script type="module" crossorigin src="/assets/index-AAAA.js"></script><link rel="modulepreload" href="/assets/PostingDetail-BBBB.js">` +
  `${(o.lds ?? []).map(ld).join("")}</head><body><h1>${o.h1}</h1>${o.body ?? ""}</body></html>`;
const posting = (name: string | null, country: string | null, built = today) => shell({
  title: "A role — somewhere", h1: "A role",
  lds: name ? [{ "@context": "https://schema.org", "@type": "JobPosting", title: "A role", hiringOrganization: { "@type": "Organization", name }, jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: country } } }] : [],
  body: `<p>this page was checked against the board when it was built, ${built}; the board itself asks again</p>`,
});
const company = (name: string, count: number, robots?: string) => shell({
  title: `${name} jobs: ${count} open roles from their own hiring system`, h1: `Open roles at ${name}`, robots,
  lds: [{ "@context": "https://schema.org", "@type": "CollectionPage", name: `Open roles at ${name}`, about: { "@type": "Organization", name } }],
});
const NAMES = 'const m=new Map([["eexs~us2~CX_11009","LCS"],["eexs~us2~CX_3001","LCS"],["icfcjb~ocs~CX_1","Honeywell Aerospace"],["birch~wd1~FusionCareers","Fusion Connect"]]);';
const RULE = 'const p=new Set(["eexs~us2~CX_11009","eexs~us2~CX_3001"]);';
const MIRROR = NAMES + RULE;
const sitemap = (paths: string[]) => `<?xml version="1.0"?><urlset>${paths.map((x) => `<url><loc>https://resumebooster.work${x}</loc></url>`).join("")}</urlset>`;
const SITEMAP = sitemap(["/jobs/company/eexs~us2~CX_3001", "/jobs/posting/oracle/icfcjb~ocs~CX_1/99123249", "/jobs/posting/ukg/" + "recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522/238cdd44-9089-429c-a963-8de91422a9af"]);

type Over = {
  build?: string | null; pub?: boolean; axia?: string; honeywell?: string; lcs?: string; talent?: string; mb?: string; place?: string; bms?: string;
  asset?: string; sitemap?: string; buildSince?: string; placeRows?: unknown[]; bmsCa?: unknown[]; bmsNb?: unknown[]; placeDetail?: unknown; bmsDetail?: unknown;
  talentRows?: unknown[]; mbRows?: unknown[]; newRows?: unknown[]; unknownNew?: string[]; nameRows?: unknown[]; namesDetail?: string;
};
const place = (id: string, country: string, read: string) => ({ id: `smartrecruiters:ThePlace1:${id}`, token: "ThePlace1", company: "The Place", location: "Lagos, LA, Nigeria", country, recheckedAt: read });
const bms = (id: string, country: string, cur: string | null, read: string) => ({ id: `workday:bristolmyerssquibb~wd5~BMS:${id}`, token: "bristolmyerssquibb~wd5~BMS", location: "New Brunswick - NJ - US", country, salaryCurrency: cur, recheckedAt: read });
const icims = (token: string, req: number, host: string, read: string) => ({ id: `icims:${token}:${req}`, token, applyUrl: `https://${host}/jobs/${req}/job`, recheckedAt: read });

function routes(o: Over = {}): Route[] {
  const build = o.build === undefined ? "job-board.2026-09-09.95" : o.build;
  const since = o.buildSince ?? iso(6 * H);
  const read = iso(1 * H);
  const status = JSON.stringify({ version: "2026-09-09.95", sliceStats: { build: "2026-09-09.95", buildSince: since }, passEnd: { steps: { names: { detail: o.namesDetail ?? "name sync v5 done" } } } });
  const list = (jobs: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ jobs, total: jobs.length, hasMore: false, ...extra });
  const T = o.talentRows ?? [icims("talent.reyesholdings.com", 1, "careers-reyesbeveragegroup.icims.com", read)];
  const M = o.mbRows ?? [icims("jobportal.martinbrower.com", 3, "careers-martinbrower.icims.com", read), icims("jobportal.martinbrower.com", 5, "nzcareers-reyesholdings.icims.com", read)];
  const N = o.newRows ?? ["jobportal.reyescocacola.com", "jobportal.reyesfleet.com", "jobportal.reyesholdings.com"].map((t, i) => icims(t, 10 + i, "x.icims.com", read));
  const names = o.nameRows ?? [{ token: AXIA, company: "Axia Women's Health" }, { token: "icfcjb~ocs~CX_1", company: "Honeywell Aerospace" }, { token: "eexs~us2~CX_3001", company: "LCS" }];
  return [
    { match: `^OPTIONS ${FB}$`, status: 204, headers: build ? { "x-fn-build": build } : {} },
    { match: `^GET ${SITE}/jobs/posting/ukg/`, body: o.axia ?? posting("Axia Women's Health", "US") },
    { match: `^GET ${SITE}/jobs/company/icfcjb~ocs~CX_1$`, body: o.honeywell ?? company("Honeywell Aerospace", 716) },
    { match: `^GET ${SITE}/jobs/company/eexs~us2~CX_3001$`, body: o.lcs ?? company("LCS", 592) },
    { match: `^GET ${SITE}/jobs/company/talent\\.reyesholdings\\.com/$`, body: o.talent ?? company("Reyes Beverage Group", 265) },
    { match: `^GET ${SITE}/jobs/company/jobportal\\.martinbrower\\.com/$`, body: o.mb ?? company("Martin Brower", 111) },
    { match: `^GET ${SITE}/jobs/posting/smartrecruiters/`, body: o.place ?? posting("The Place", "NG") },
    { match: `^GET ${SITE}/jobs/posting/workday/`, body: o.bms ?? posting("Bristol Myers Squibb", "US") },
    { match: `^GET ${SITE}/assets/PostingDetail-BBBB\\.js$`, body: o.asset ?? (o.pub === false ? "const m=new Map([]);" : MIRROR) },
    { match: `^GET ${SITE}/sitemap\\.xml$`, body: o.sitemap ?? SITEMAP },
    { match: `^GET ${SITE}/assets/index-AAAA\\.js$`, body: "console.log(1)" },
    { match: `^POST ${FB}\\t\\{"action":"status"\\}`, body: status },
    { match: `^POST ${FB}\\t.*"action":"list".*"ThePlace1"`, body: list(o.placeRows ?? [place("744000154839819", "NG", read), place("744000152481767", "NG", read)]) },
    { match: `^POST ${FB}\\t.*"action":"list".*"bristolmyerssquibb~wd5~BMS".*"country":"CA"`, body: list(o.bmsCa ?? []) },
    { match: `^POST ${FB}\\t.*"action":"list".*"bristolmyerssquibb~wd5~BMS".*"location":"New Brunswick"`, body: list(o.bmsNb ?? [...(o.bmsCa ?? []), bms("R1607072-1", "US", "USD", read)]) },
    { match: `^POST ${FB}\\t.*"action":"detail".*ThePlace1`, body: JSON.stringify(o.placeDetail ?? { job: place("744000154839819", "NG", read) }) },
    { match: `^POST ${FB}\\t.*"action":"detail".*bristolmyerssquibb`, body: JSON.stringify(o.bmsDetail ?? { job: bms("R1607072-1", "US", "USD", read) }) },
    { match: `^POST ${FB}\\t.*"action":"list".*"talent\\.reyesholdings\\.com"`, body: list(T) },
    { match: `^POST ${FB}\\t.*"action":"list".*"jobportal\\.martinbrower\\.com"`, body: list(M) },
    { match: `^POST ${FB}\\t.*"action":"list".*"jobportal\\.reyescocacola\\.com"`, body: list(N, o.unknownNew ? { unknownCompanies: o.unknownNew } : {}) },
    { match: `^POST ${FB}\\t.*"action":"list".*"icfcjb~ocs~CX_1"`, body: list(names) },
  ];
}
const verdicts = (lines: string[], v: "PASS" | "FAIL" | "INFO") => lines.filter((l) => l.startsWith(`${v}  `));
const show = (lines: string[]) => lines.join("\n");
const has = (lines: string[], v: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${v}  `) && re.test(l));

describe("section 99zz: the six D7 pages", () => {
  it("a good deploy prints a PASS for every claim, and INFO only for the publish it found", () => {
    const { lines } = run(routes());
    expect(lines[0]).toMatch(/^== 99zz\. /);
    expect(verdicts(lines, "FAIL"), show(lines)).toEqual([]);
    expect(verdicts(lines, "INFO"), show(lines)).toEqual([expect.stringMatching(/the served app carries the employer names/)]);
    for (const re of [/x-fn-build = job-board\.2026-09-09\.95/, /Axia posting page carries a JobPosting naming Axia Women's Health/, /icfcjb~ocs~CX_1 names Honeywell Aerospace/, /eexs~us2~CX_3001 names LCS/,
      /icfcjb~ocs~CX_1 answers 200 with robots "index, follow"/, /talent\.reyesholdings\.com\/ answers 200/, /ThePlace1 rows .*all filed NG/, /ThePlace1 .* page carries a JobPosting with addressCountry NG/,
      /Bristol Myers Squibb .*all filed US and none with the old currency/, /Bristol Myers Squibb .* page carries a JobPosting with addressCountry US/, /0 off Reyes Beverage Group's portal; .* 0 on another brand's portal; 0 requisition/,
      /three new Reyes brand boards are carried and each serves rows/, /different open counts \(265 and 111\)/, /stored rows read the employer names/,
      /served app carries the rule that LCS's two sites .* name no hirer/, /sitemap lists no posting page of LCS's two sites/]) {
      expect(has(lines, "PASS", re), `${re}\n${show(lines)}`).toBe(true);
    }
  });

  it("an older build: the page lines still run, and no board call is made; no build header is a FAIL", () => {
    const old = run(routes({ build: "job-board.2026-09-09.93" }));
    expect(has(old.lines, "INFO", /2026-09-09\.95 is not serving yet/), show(old.lines)).toBe(true);
    expect(old.calls.filter((c) => /^curl\tPOST /.test(c)), old.calls.join("\n")).toEqual([]);
    expect(has(old.lines, "PASS", /names Honeywell Aerospace/), show(old.lines)).toBe(true);
    expect(has(old.lines, "INFO", /waits for job-board \.95/)).toBe(true);
    const none = run(routes({ build: null }));
    expect(has(none.lines, "FAIL", /carries no x-fn-build/), show(none.lines)).toBe(true);
  });

  it("N1: logo text or no JobPosting on the Axia page is a FAIL once the names are published, INFO before; a gone page is not judged", () => {
    const bad = shell({ title: "CMA II — Bridgewater, NJ", h1: "CMA II", body: "Axia Logo Horizontal" });
    expect(has(run(routes({ axia: bad })).lines, "FAIL", /Axia posting page still prints "Axia Logo Horizontal"; carries no JobPosting/)).toBe(true);
    expect(has(run(routes({ axia: posting("Axia Logo Horizontal", "US") })).lines, "FAIL", /JobPosting naming "Axia Logo Horizontal"/)).toBe(true);
    const before = run(routes({ axia: bad, pub: false }));
    expect(has(before.lines, "INFO", /Axia posting page still prints .*before the publish that carries the names/), show(before.lines)).toBe(true);
    expect(has(before.lines, "INFO", /does not carry the employer names yet/)).toBe(true);
    expect(has(run(routes({ axia: shell({ title: "gone", h1: "gone", robots: "noindex" }) })).lines, "INFO", /Axia posting page is gone or noindex/)).toBe(true);
  });

  it("N2, N3: a company page still printing 'Aerospace' or 'All' is a FAIL once published", () => {
    const r = run(routes({ honeywell: company("Aerospace", 716), lcs: company("All", 592) }));
    expect(has(r.lines, "FAIL", /icfcjb~ocs~CX_1 prints title "Aerospace jobs.*want Honeywell Aerospace, not the refused "Aerospace"/), show(r.lines)).toBe(true);
    expect(has(r.lines, "FAIL", /eexs~us2~CX_3001 prints title "All jobs.*want LCS, not the refused "All"/)).toBe(true);
    expect(has(run(routes({ honeywell: company("Aerospace", 716), pub: false })).lines, "INFO", /icfcjb~ocs~CX_1 prints title "Aerospace jobs/)).toBe(true);
  });

  it("N5: the names published without the rule, or a posting page of an LCS site in the sitemap, is a FAIL; INFO before the publish", () => {
    const norule = run(routes({ asset: NAMES }));
    expect(has(norule.lines, "FAIL", /does not carry the rule that LCS's two sites name no hirer/), show(norule.lines)).toBe(true);
    const listed = run(routes({ sitemap: sitemap(["/jobs/posting/oracle/eexs~us2~CX_3001/41168", "/jobs/posting/oracle/eexs~us2~CX_11009/40001"]) }));
    expect(has(listed.lines, "FAIL", /sitemap lists 2 posting page\(s\) of LCS's two sites/), show(listed.lines)).toBe(true);
    const before = run(routes({ pub: false, sitemap: sitemap(["/jobs/posting/oracle/eexs~us2~CX_3001/41168"]) }));
    expect(has(before.lines, "INFO", /does not carry the rule .*before the publish that carries the names/), show(before.lines)).toBe(true);
    expect(has(before.lines, "INFO", /sitemap lists 1 posting page\(s\) of LCS's two sites.*before the publish/), show(before.lines)).toBe(true);
    // The override map alone is not the rule: "LCS" sits between the two keys there.
    expect(has(run(routes({ asset: NAMES + 'const q=["eexs~us2~CX_3001","LCS"];' })).lines, "PASS", /carries the rule/)).toBe(false);
    expect(has(run(routes({ sitemap: "" })).lines, "FAIL", /the sitemap did not answer/)).toBe(true);
  });

  it("N4: a D7 company page marked noindex is a FAIL whatever was published", () => {
    const r = run(routes({ mb: company("Martin Brower", 111, "noindex, follow"), pub: false }));
    expect(has(r.lines, "FAIL", /jobportal\.martinbrower\.com\/ answers 200 with robots "noindex, follow"/), show(r.lines)).toBe(true);
  });

  it("C1: a Nigerian row still filed US is a FAIL once this build read the board, INFO before it did", () => {
    const read = iso(1 * H);
    const after = run(routes({ placeRows: [place("744000154839819", "US", read)], placeDetail: { job: place("744000154839819", "US", read) }, place: posting(null, null) }));
    expect(has(after.lines, "FAIL", /ThePlace1 rows .*1 of 1 still filed US after this build read the board/), show(after.lines)).toBe(true);
    const early = iso(10 * H);
    const before = run(routes({ placeRows: [place("744000154839819", "US", early)], placeDetail: { job: place("744000154839819", "US", early) }, place: posting(null, null) }));
    expect(has(before.lines, "INFO", /ThePlace1 rows .*not been read by this build yet/), show(before.lines)).toBe(true);
    const stale = run(routes({ buildSince: iso(30 * H), placeRows: [place("744000154839819", "US", iso(40 * H))], place: posting(null, null) }));
    expect(has(stale.lines, "FAIL", /ThePlace1 rows .*more than 24 h after the first slice/), show(stale.lines)).toBe(true);
  });

  it("C2: a 'New Brunswick - NJ - US' row left in CA, or its pay left in CAD, is a FAIL once read", () => {
    const read = iso(1 * H);
    const ca = run(routes({ bmsCa: [bms("R1607661", "CA", "CAD", read)] }));
    expect(has(ca.lines, "FAIL", /Bristol Myers Squibb .*1 of 2 still filed CA .*1 with pay in CAD after this build read the board/), show(ca.lines)).toBe(true);
    const cad = run(routes({ bmsDetail: { job: bms("R1607072-1", "US", "CAD", read) } }));
    expect(has(cad.lines, "FAIL", /Bristol Myers Squibb .*1 with pay in CAD/), show(cad.lines)).toBe(true);
  });

  it("C2 reads every New Brunswick row whatever its country: one filed US with its pay still CAD is a FAIL, which a CA-filtered list never returns", () => {
    const read = iso(1 * H);
    const r = run(routes({ bmsNb: [bms("R1606976-1", "US", "CAD", read), bms("R1607072-1", "US", "USD", read)] }));
    expect(has(r.lines, "FAIL", /Bristol Myers Squibb .*1 with pay in CAD after this build read the board/), show(r.lines)).toBe(true);
    expect(r.calls.some((c) => /"bristolmyerssquibb~wd5~BMS".*"location":"New Brunswick"/.test(c)), r.calls.join("\n")).toBe(true);
    expect(r.calls.some((c) => /"bristolmyerssquibb~wd5~BMS".*"country":"CA"/.test(c)), "a CA filter hides the rows .95 refiles").toBe(false);
    const nocountry = run(routes({ bmsNb: [bms("R1607660", null as unknown as string, "USD", read), bms("R1607072-1", "US", "USD", read)] }));
    expect(has(nocountry.lines, "FAIL", /Bristol Myers Squibb .*1 of 2 still filed \(none\)/), show(nocountry.lines)).toBe(true);
    const clean = run(routes({ bmsNb: [bms("R1606976-1", "US", "USD", read), bms("R1607072-1", "US", "USD", read)] }));
    expect(has(clean.lines, "PASS", /Bristol Myers Squibb .*2 row\(s\), all filed US and none with the old currency/), show(clean.lines)).toBe(true);
  });

  it("C3: a page whose JobPosting states the old country is a FAIL; no JobPosting is a FAIL only after a later bake", () => {
    expect(has(run(routes({ place: posting("The Place", "US") })).lines, "FAIL", /ThePlace1 .* page carries a JobPosting with addressCountry US, want NG/)).toBe(true);
    const readOld = iso(30 * H);
    const late = run(routes({ buildSince: iso(40 * H), placeRows: [place("744000154839819", "NG", readOld)], placeDetail: { job: place("744000154839819", "NG", readOld) }, place: posting(null, null, today) }));
    expect(has(late.lines, "FAIL", /ThePlace1 .* page \(built \d{4}-\d{2}-\d{2}\) carries no JobPosting although the row reads NG since/), show(late.lines)).toBe(true);
    // Built the same day the board was read: the bake may predate the read, so it waits.
    const readNow = iso(1 * H);
    const sameDay = run(routes({ placeRows: [place("744000154839819", "NG", readNow)], placeDetail: { job: place("744000154839819", "NG", readNow) }, place: posting(null, null, readNow.slice(0, 10)) }));
    expect(has(sameDay.lines, "INFO", /ThePlace1 .* page carries no JobPosting yet/), show(sameDay.lines)).toBe(true);
  });

  it("R1: a row on another brand's portal after both boards were read is a FAIL; a new brand board the catalogue lacks is a FAIL", () => {
    const read = iso(1 * H);
    const r = run(routes({ talentRows: [icims("talent.reyesholdings.com", 1, "careers-reyesbeveragegroup.icims.com", read), icims("talent.reyesholdings.com", 2, "careers-reyescocacola.icims.com", read)] }));
    expect(has(r.lines, "FAIL", /talent\.reyesholdings\.com serves 2 row\(s\), 1 off Reyes Beverage Group's portal.*after this build read both boards/), show(r.lines)).toBe(true);
    const shared = run(routes({ mbRows: [icims("jobportal.martinbrower.com", 1, "careers-martinbrower.icims.com", read)] }));
    expect(has(shared.lines, "FAIL", /1 requisition\(s\) on both/), show(shared.lines)).toBe(true);
    const missing = run(routes({ unknownNew: ["jobportal.reyesfleet.com"] }));
    expect(has(missing.lines, "FAIL", /does not carry jobportal\.reyesfleet\.com/), show(missing.lines)).toBe(true);
    const slow = run(routes({ buildSince: iso(13 * H), newRows: [icims("jobportal.reyescocacola.com", 10, "x.icims.com", read)] }));
    expect(has(slow.lines, "FAIL", /only 1 of the three new Reyes brand boards serve rows/), show(slow.lines)).toBe(true);
  });

  it("R2: the two Reyes pages printing one count once the boards are clean and published is a FAIL", () => {
    const r = run(routes({ talent: company("Reyes Beverage Group", 497), mb: company("Martin Brower", 497) }));
    expect(has(r.lines, "FAIL", /still print the same open count \(497\)/), show(r.lines)).toBe(true);
    expect(has(run(routes({ talent: company("Reyes Beverage Group", 497), mb: company("Martin Brower", 497), pub: false })).lines, "INFO", /print 497 and 497 open roles/)).toBe(true);
  });

  it("S1: a stored row with the old name after the lane reports version 5 done is a FAIL, INFO while it runs", () => {
    const stale = [{ token: "icfcjb~ocs~CX_1", company: "Aerospace" }];
    expect(has(run(routes({ nameRows: stale })).lines, "FAIL", /icfcjb~ocs~CX_1 = Aerospace\) after the name-sync lane reported version 5 done/)).toBe(true);
    expect(has(run(routes({ nameRows: stale, namesDetail: "name sync v5: 3 renamed, 0 already correct, 0 failed, 40 waiting" })).lines, "INFO", /has not reported version 5 done/)).toBe(true);
  });

  it("never prints the key; every board call carries x-rb-budget: probe and is a status, list or detail read; every page is read as Googlebot", () => {
    const { out, calls } = run(routes());
    expect(out).not.toContain(KEY);
    const board = calls.filter((c) => c.includes("functions/v1/job-board"));
    expect(board.length).toBeGreaterThan(5);
    for (const c of board) expect(c, c).toContain("x-rb-budget: probe");
    for (const c of board.filter((x) => x.startsWith("curl\tPOST "))) expect(c, c).toMatch(/\t\{"action":"(?:status|list|detail)"/);
    const pages = calls.filter((c) => /^curl\tGET https:\/\/site\.test\/jobs\//.test(c));
    expect(pages.length).toBe(7);
    for (const c of pages) expect(c, c).toContain(`ua:${UA}`);
    const maps = calls.filter((c) => /^curl\tGET https:\/\/site\.test\/sitemap\.xml/.test(c));
    expect(maps.length).toBe(1);
    expect(maps[0]).toContain(`ua:${UA}`);
    expect(calls.filter((c) => /^curl\t(?:PUT|DELETE|PATCH) /.test(c))).toEqual([]);
  });
});
