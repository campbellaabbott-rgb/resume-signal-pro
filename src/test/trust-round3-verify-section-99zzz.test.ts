// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzz CAN FAIL EVERY CLAIM IT MAKES, AND WAITS FOR WHAT IT NEEDS.
 *
 * scripts/verify-deploy.d/99zzz-trust-round-3.sh is the post-deploy proof of
 * trust round 3: renamed boards print their employers' names, the employers'
 * own boards carry no agency label and Jobandtalent's do, each shared iCIMS
 * feed is read once, the Oracle pool sites hand their requisitions to the
 * communities' own boards, and US towns named after countries are filed in
 * the US. A PASS is worth something only if a regression could have turned it
 * into a FAIL (verify-deploy.d/README.md), so the section runs here against a
 * fake curl that answers from routes and logs every call:
 *   - a good deploy prints PASS for every claim, and INFO only for the publish
 *     it detected;
 *   - each claim prints FAIL when its rows or page are wrong once what it
 *     waits for has happened (the board's read by .96, or the deadline after
 *     the first slice; the publish carrying the mirror for the pages), and
 *     INFO before;
 *   - before .96 serves, no board call is made;
 *   - the key is never printed, every board call carries x-rb-budget: probe
 *     and is a status, list or detail read, and every page is read as Googlebot.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzz-trust-round-3.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_HELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_99zzz";
const UA = "Googlebot-test-ua";
const FB = "https://p\\.supabase\\.co/functions/v1/job-board";
const SITE = "https://site\\.test";
const NAMES = JSON.parse(/VDZ3_NAMES='(\[[\s\S]*?\])'/.exec(SECTION)?.[1] ?? "[]") as Array<[string, string, string, string]>;
const CLEARED = JSON.parse(/VDZ3_CLEARED='(\[[\s\S]*?\])'/.exec(SECTION)?.[1] ?? "[]") as string[];

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
  const dir = mkdtempSync(join(tmpdir(), "vd99zzz-"));
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
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const H = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const company = (name: string, count: number, agency = false) =>
  `<html><head><title>${name} jobs: ${count} open roles from their own hiring system</title>` +
  `<script type="module" crossorigin src="/assets/index-AAAA.js"></script><link rel="modulepreload" href="/assets/CompanyPage-CCCC.js">` +
  ld({ "@context": "https://schema.org", "@type": "CollectionPage", name: `Open roles at ${name}`, about: { "@type": "Organization", name } }) +
  `</head><body><h1>${agency ? `Roles listed by ${name}` : `Open roles at ${name}`}</h1>${agency ? "<p>This is a staffing agency's board. Roles here are usually for its clients.</p>" : ""}</body></html>`;
const MIRROR = 'const m=new Map([["fa-ewqq-saasfaprod1~ocs~CX_1","Hong Kong Baptist University"],["eexs~us2~CX_3001","LCS"]]);';
const HUDSON = "bb661c48-7edc-400c-adfb-40f8f7743374";
const CONVERGINT = "recruiting2~CON1074CVTG~1831b61a-1945-44fa-afd8-624795c9b30d";
const sitemap = (paths: string[]) => `<?xml version="1.0"?><urlset>${paths.map((x) => `<url><loc>https://resumebooster.work${x}</loc></url>`).join("")}</urlset>`;
const SITEMAP = sitemap(["/jobs/company/eexs~us2~CX_3001", `/jobs/company/${HUDSON}`, `/jobs/company/${CONVERGINT}`, "/jobs/company/dominos"]);

type Row = Record<string, unknown>;
type Over = {
  build?: string | null; pub?: boolean; buildSince?: string; read?: string; sitemap?: string; hudson?: string; convergint?: string;
  nameRows?: Record<string, Row[]>; namesDetail?: string; cleared?: Row[]; jt?: Row[]; icims?: Record<string, Row[]>;
  pruned?: { jobs: Row[]; unknownCompanies?: string[] }; brands?: { jobs: Row[]; unknownCompanies?: string[] };
  oracle?: Record<string, number>; places?: Record<string, Row[]>; details?: Record<string, unknown>;
};
const OWN_PORTAL: Record<string, string> = {
  "careers.delmarva.com": "careers-exeloncorp.icims.com", "careers.comed.com": "careers-comed.icims.com",
  "careers.baycenterfoods.com": "careers-chickfila.icims.com", "careers.chick-fil-a.com": "careers-cfasupply.icims.com",
  "careers.ynvgroup.com": "careers-ynvgroup.icims.com", "careers.monifai.com": "careers-teknowledge.icims.com",
};
const icims = (token: string, req: number, host: string, read: string) => ({ id: `icims:${token}:${req}`, token, applyUrl: `https://${host}/jobs/${req}/job`, recheckedAt: read });
const placed = (location: string, country: string | null, read: string) => ({ id: `workday:x:${location}`, token: "x", location, country, recheckedAt: read });

function routes(o: Over = {}): Route[] {
  const build = o.build === undefined ? "job-board.2026-09-09.96" : o.build;
  const since = o.buildSince ?? iso(6 * H);
  const read = o.read ?? iso(1 * H);
  const status = JSON.stringify({ version: "2026-09-09.96", sliceStats: { build: "2026-09-09.96", buildSince: since }, passEnd: { steps: { names: { detail: o.namesDetail ?? "name sync v6 done" } } } });
  const list = (jobs: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ jobs, total: jobs.length, hasMore: false, ...extra });
  const nameRoutes: Route[] = NAMES.map(([v, t, , nw]) => ({
    match: `^POST ${FB}\\t\\{"action":"list","companies":\\["${esc(t)}"\\],"vendor":\\["${v}"\\]`,
    body: list(o.nameRows?.[t] ?? [{ id: `${v}:${t}:1`, token: t, company: nw, recheckedAt: read }]),
  }));
  const icimsRoutes: Route[] = Object.keys(OWN_PORTAL).map((t) => ({
    match: `^POST ${FB}\\t\\{"action":"list","companies":\\["${esc(t)}"\\],"vendor":\\["icims"\\]`,
    body: list(o.icims?.[t] ?? [icims(t, 1, OWN_PORTAL[t], read), icims(t, 2, OWN_PORTAL[t], read)]),
  }));
  const ORA = { "eexs~us2~CX_3001": 12, "eexs~us2~CX_10013": 6, "erhk~us2~CX_1001": 0, "erhk~us2~CX_1": 150, ...(o.oracle ?? {}) };
  const oracleRoutes: Route[] = Object.entries(ORA).map(([t, n]) => ({
    match: `^POST ${FB}\\t\\{"action":"list","companies":\\["${esc(t)}"\\],"vendor":\\["oracle"\\]`,
    body: JSON.stringify({ jobs: n ? [{ token: t, recheckedAt: read }] : [], total: n, hasMore: false }),
  }));
  const P = { lakewales: [placed("Lake Wales, FL", "US", read), placed("FL - Lake Wales", "US", read)], greece: [placed("Greece, NY #0185", "US", read)], peru: [placed("IN - Peru", "US", read), placed("Lima, Peru", "PE", read)], cardiff: [placed("Cardiff, Wales", "GB", read)], ...(o.places ?? {}) };
  const D: Record<string, unknown> = {
    cvs: { job: { id: "workday:cvshealth~wd1~CVS_Health_Careers:R1075322", location: "NY - Greece", country: "US", recheckedAt: read } },
    bjs: { job: { id: "workday:bjswholesaleclub~wd1~BJsCareers:R255468", location: "Greece, NY #0185", country: "US", recheckedAt: read } },
    kohls: { job: { id: "workday:kohls~wd504~kohlscareers:R504030", location: "Lake Wales (1250)", country: "US" } },
    ...(o.details ?? {}),
  };
  return [
    { match: `^OPTIONS ${FB}$`, status: 204, headers: build ? { "x-fn-build": build } : {} },
    { match: `^GET ${SITE}/sitemap\\.xml$`, body: o.sitemap ?? SITEMAP },
    { match: `^GET ${SITE}/jobs/company/eexs~us2~CX_3001$`, body: company("LCS", 12) },
    { match: `^GET ${SITE}/jobs/company/${HUDSON}$`, body: o.hudson ?? company("Hudson Regional Health", 148) },
    { match: `^GET ${SITE}/jobs/company/${esc(CONVERGINT)}$`, body: o.convergint ?? company("Convergint", 228) },
    { match: `^GET ${SITE}/assets/CompanyPage-CCCC\\.js$`, body: o.pub === false ? "const m=new Map([]);" : MIRROR },
    { match: `^GET ${SITE}/assets/index-AAAA\\.js$`, body: "console.log(1)" },
    { match: `^POST ${FB}\\t\\{"action":"status"\\}`, body: status },
    ...nameRoutes,
    { match: `^POST ${FB}\\t\\{"action":"list","companies":\\["recruiting2~CON1074CVTG`, body: list(o.cleared ?? [{ token: CONVERGINT, agency: false, recheckedAt: read }, { token: "geant", agency: false, recheckedAt: read }]) },
    { match: `^POST ${FB}\\t\\{"action":"list","companies":\\["jobandtalent","multitempo"\\]`, body: list(o.jt ?? [{ token: "jobandtalent", agency: true, recheckedAt: read }, { token: "multitempo", agency: true, recheckedAt: read }]) },
    ...icimsRoutes,
    { match: `^POST ${FB}\\t\\{"action":"list","companies":\\["careers\\.bpas\\.com"`, body: list(o.pruned?.jobs ?? [], { unknownCompanies: o.pruned?.unknownCompanies ?? ["careers.bpas.com", "careers.keysight.com", "careers.goldennugget.com", "talent.lla.com"] }) },
    { match: `^POST ${FB}\\t\\{"action":"list","companies":\\["careers\\.bge\\.com"`, body: list(o.brands?.jobs ?? [icims("careers.bge.com", 1, "careers-bge.icims.com", read), icims("careers.peco.com", 2, "careers-peco.icims.com", read)], { unknownCompanies: o.brands?.unknownCompanies ?? [] }) },
    ...oracleRoutes,
    { match: `^POST ${FB}\\t.*"location":"Lake Wales"`, body: list(P.lakewales) },
    { match: `^POST ${FB}\\t.*"location":"Greece"`, body: list(P.greece) },
    { match: `^POST ${FB}\\t.*"location":"Peru"`, body: list(P.peru) },
    { match: `^POST ${FB}\\t.*"location":"Cardiff"`, body: list(P.cardiff) },
    { match: `^POST ${FB}\\t\\{"action":"detail","id":"workday:cvshealth`, body: JSON.stringify(D.cvs) },
    { match: `^POST ${FB}\\t\\{"action":"detail","id":"workday:bjswholesaleclub`, body: JSON.stringify(D.bjs) },
    { match: `^POST ${FB}\\t\\{"action":"detail","id":"workday:kohls`, body: JSON.stringify(D.kohls) },
  ];
}
const verdicts = (lines: string[], v: "PASS" | "FAIL" | "INFO") => lines.filter((l) => l.startsWith(`${v}  `));
const show = (lines: string[]) => lines.join("\n");
const has = (lines: string[], v: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${v}  `) && re.test(l));

describe("section 99zzz: trust round 3", () => {
  it("reads the lists it judges from the section itself", () => {
    expect(NAMES.length).toBe(38);
    expect(CLEARED.length).toBe(12);
  });

  it("a good deploy prints a PASS for every claim, and INFO only for the publish it found", () => {
    const { lines } = run(routes());
    expect(lines[0]).toMatch(/^== 99zzz\. /);
    expect(verdicts(lines, "FAIL"), show(lines)).toEqual([]);
    expect(verdicts(lines, "INFO"), show(lines)).toEqual([expect.stringMatching(/the served app carries this round's employer names/)]);
    for (const re of [/x-fn-build = job-board\.2026-09-09\.96/, /N1 38 renamed board\(s\) serve their new names/, new RegExp(`N2 /jobs/company/${HUDSON} names Hudson Regional Health and never "HRH Secaucus`),
      /A1 2 row\(s\) on 2 employers' own boards carry agency false/, /A2 2 row\(s\) on Jobandtalent's boards carry agency true/, new RegExp(`A3 /jobs/company/${esc(CONVERGINT)} is an employer's page`),
      /I1 careers\.delmarva\.com serves 2 row\(s\), none on another portal/, /I1 careers\.monifai\.com serves 2/, /I2 the four duplicate hosts are not carried and serve no row/,
      /I3 the four Exelon brand boards are carried; 2 serve rows/, /O1 LCS "All" serves 12/, /C1 2 Lake Wales, FL row\(s\), all filed US/, /C1 1 Greece, NY row\(s\), all filed US/,
      /C1 1 Peru, IN\/IL row\(s\), all filed US/, /C1 control: 1 of 1 "Cardiff, Wales" row\(s\) filed GB/, /C2 CVS Health R1075322 .* is filed US/, /C2 BJ's R255468 .* is filed US/, /C2 Kohl's R504030 .* is filed US/]) {
      expect(has(lines, "PASS", re), `${re}\n${show(lines)}`).toBe(true);
    }
  });

  it("an older build: the page lines still run and no board call is made; no build header is a FAIL", () => {
    const old = run(routes({ build: "job-board.2026-09-09.95" }));
    expect(has(old.lines, "INFO", /2026-09-09\.96 is not serving yet/), show(old.lines)).toBe(true);
    expect(old.calls.filter((c) => /^curl\tPOST /.test(c)), old.calls.join("\n")).toEqual([]);
    expect(verdicts(old.lines, "FAIL"), show(old.lines)).toEqual([]);
    expect(has(old.lines, "PASS", /N2 .* names Hudson Regional Health/), show(old.lines)).toBe(true);
    expect(has(run(routes({ build: null })).lines, "FAIL", /carries no x-fn-build/)).toBe(true);
  });

  it("N1: a renamed board still printing its old label is a FAIL once the lane is done or 48 h passed, INFO while it runs", () => {
    const stale = { [HUDSON]: [{ id: "x", token: HUDSON, company: "HRH Secaucus University Transparent", recheckedAt: iso(1 * H) }] };
    expect(has(run(routes({ nameRows: stale })).lines, "FAIL", /N1 1 renamed board\(s\) still print another name after the name-sync lane reported version 6 done: adp:bb661c48.* serves "HRH Secaucus University Transparent" \(its old label\)/)).toBe(true);
    const running = run(routes({ nameRows: stale, namesDetail: "name sync v6: 3 renamed, 0 already correct, 0 failed, 40 waiting" }));
    expect(has(running.lines, "PASS", /N1 37 renamed board\(s\) serve their new names, 1 still wait for the lane/), show(running.lines)).toBe(true);
    expect(has(running.lines, "INFO", /N1 waiting: adp:bb661c48/), show(running.lines)).toBe(true);
    const late = run(routes({ nameRows: stale, namesDetail: "name sync v6: 1 waiting", buildSince: iso(50 * H) }));
    expect(has(late.lines, "FAIL", /N1 1 renamed board\(s\) still print another name 48 h after the first slice/), show(late.lines)).toBe(true);
  });

  it("N2: a listed page naming the old label is a FAIL once published (and, for a bare token, once the lane is done); INFO before; nothing listed is INFO", () => {
    const old = company("HRH Secaucus University Transparent", 148);
    expect(has(run(routes({ hudson: old })).lines, "FAIL", /N2 .* names the old label "HRH Secaucus University Transparent"/)).toBe(true);
    expect(has(run(routes({ hudson: old, pub: false })).lines, "INFO", /N2 .* waits for the publish that carries this round/)).toBe(true);
    expect(has(run(routes({ hudson: old, namesDetail: "name sync v6: 4 waiting" })).lines, "INFO", /N2 .* waits for the name-sync lane's version 6/)).toBe(true);
    expect(has(run(routes({ sitemap: sitemap(["/jobs/company/dominos"]) })).lines, "INFO", /N2 the sitemap lists no page of a renamed board/)).toBe(true);
    expect(has(run(routes({ sitemap: "" })).lines, "FAIL", /N2 the sitemap did not answer/)).toBe(true);
  });

  it("A1, A2, A3: an employer's own board still labelled, a Jobandtalent board unlabelled, or an agency-variant page is a FAIL once due", () => {
    const read = iso(1 * H);
    expect(has(run(routes({ cleared: [{ token: CONVERGINT, agency: true, recheckedAt: read }] })).lines, "FAIL", /A1 1 row\(s\) on recruiting2~CON1074CVTG.* still carry the agency flag after this build read the board/)).toBe(true);
    expect(has(run(routes({ cleared: [{ token: CONVERGINT, agency: true, recheckedAt: iso(10 * H) }] })).lines, "INFO", /A1 1 row\(s\) still carry the agency flag; the board has not been read by this build yet/)).toBe(true);
    expect(has(run(routes({ jt: [{ token: "multitempo", agency: false, recheckedAt: read }] })).lines, "FAIL", /A2 1 of 1 Jobandtalent row\(s\) carry no agency flag after this build read the board/)).toBe(true);
    expect(has(run(routes({ convergint: company("Convergint", 228, true) })).lines, "FAIL", /A3 .* is still the agency variant/)).toBe(true);
    expect(has(run(routes({ convergint: company("Convergint", 228, true), pub: false })).lines, "INFO", /A3 .* is the agency variant until the publish/)).toBe(true);
  });

  it("I1, I2, I3: a row on another portal of the feed, a duplicate host still carried, or a brand board missing is a FAIL", () => {
    const read = iso(1 * H);
    const r = run(routes({ icims: { "careers.comed.com": [icims("careers.comed.com", 1, "careers-comed.icims.com", read), icims("careers.comed.com", 2, "careers-exeloncorp.icims.com", read)] } }));
    expect(has(r.lines, "FAIL", /I1 careers\.comed\.com serves 1 of 2 row\(s\) on another portal of its feed \(careers-exeloncorp\.icims\.com\)/), show(r.lines)).toBe(true);
    const early = run(routes({ icims: { "careers.ynvgroup.com": [icims("careers.ynvgroup.com", 2, "careers-teknowledge.icims.com", iso(10 * H))] } }));
    expect(has(early.lines, "INFO", /I1 careers\.ynvgroup\.com: 1 of 1 row\(s\) on another portal/), show(early.lines)).toBe(true);
    const unknownHost = run(routes({ icims: { "careers.monifai.com": [icims("careers.monifai.com", 3, "elsewhere.example.com", read)] } }));
    expect(has(unknownHost.lines, "PASS", /I1 careers\.monifai\.com serves 1 row\(s\), none on another portal/), show(unknownHost.lines)).toBe(true);
    expect(has(run(routes({ pruned: { jobs: [], unknownCompanies: ["careers.bpas.com"] } })).lines, "FAIL", /I2 the serving catalogue still carries careers\.keysight\.com, careers\.goldennugget\.com, talent\.lla\.com/)).toBe(true);
    expect(has(run(routes({ pruned: { jobs: [{ token: "careers.bpas.com" }] }, buildSince: iso(30 * H) })).lines, "FAIL", /I2 the four duplicate hosts serve 1 row\(s\) 24 h after the first slice/)).toBe(true);
    expect(has(run(routes({ pruned: { jobs: [{ token: "careers.bpas.com" }] } })).lines, "INFO", /I2 .* wait for the orphan prune/)).toBe(true);
    expect(has(run(routes({ brands: { jobs: [], unknownCompanies: ["careers.pepco.com"] } })).lines, "FAIL", /I3 the serving catalogue does not carry careers\.pepco\.com/)).toBe(true);
    expect(has(run(routes({ brands: { jobs: [icims("careers.bge.com", 1, "careers-comed.icims.com", read)] } })).lines, "FAIL", /I3 1 brand-board row\(s\) apply off their own portal/)).toBe(true);
    expect(has(run(routes({ brands: { jobs: [] }, buildSince: iso(13 * H) })).lines, "FAIL", /I3 Baltimore Gas and Electric Company .* serves no row/)).toBe(true);
  });

  it("O1: LCS's All still holding the communities' postings, or R+L's Default its carrier's, is a FAIL after 72 h, INFO before", () => {
    expect(has(run(routes({ oracle: { "eexs~us2~CX_3001": 580 }, buildSince: iso(80 * H) })).lines, "FAIL", /O1 LCS "All" serves 580 .*72 h after the first slice/)).toBe(true);
    expect(has(run(routes({ oracle: { "erhk~us2~CX_1001": 150, "erhk~us2~CX_1": 0 } })).lines, "INFO", /O1 .* R\+L "Default" 150 .*FAIL after 72 h/)).toBe(true);
  });

  it("C1, C2: a US town still filed abroad is a FAIL once read; the Wales control filed elsewhere is a FAIL; Kohl's waits 48 h for the migration", () => {
    const read = iso(1 * H);
    expect(has(run(routes({ places: { lakewales: [placed("Lake Wales, FL", "GB", read)] } })).lines, "FAIL", /C1 1 of 1 Lake Wales, FL row\(s\) still filed GB .*after this build read the board/)).toBe(true);
    expect(has(run(routes({ places: { greece: [placed("NY - Greece", "GR", iso(10 * H))] } })).lines, "INFO", /C1 1 of 1 Greece, NY row\(s\) still filed otherwise/)).toBe(true);
    expect(has(run(routes({ places: { cardiff: [placed("Cardiff, Wales", null, read)] } })).lines, "FAIL", /C1 control: 0 of 1 "Cardiff, Wales" row\(s\) filed GB/)).toBe(true);
    expect(has(run(routes({ places: { cardiff: [] } })).lines, "INFO", /C1 control: no "Cardiff, Wales" row is served/)).toBe(true);
    const kohlsGb = { kohls: { job: { id: "workday:kohls~wd504~kohlscareers:R504030", location: "Lake Wales (1250)", country: "GB" } } };
    expect(has(run(routes({ details: kohlsGb })).lines, "INFO", /C2 Kohl's R504030 .* is filed GB; .*FAIL after 48 h/)).toBe(true);
    expect(has(run(routes({ details: kohlsGb, buildSince: iso(50 * H) })).lines, "FAIL", /C2 Kohl's R504030 .* is filed GB 48 h after the first slice: apply migration 20261026110000/)).toBe(true);
    expect(has(run(routes({ details: { cvs: { job: { id: "x", country: "GR", recheckedAt: read } } } })).lines, "FAIL", /C2 CVS Health R1075322 .* is filed GR after this build read it/)).toBe(true);
    expect(has(run(routes({ details: { bjs: { gone: true } } })).lines, "INFO", /C2 BJ's R255468 .* is no longer served/)).toBe(true);
  });

  it("no slice of the serving build yet: every API line waits", () => {
    const r = run(routes({ buildSince: "not a date" }));
    expect(verdicts(r.lines, "FAIL").filter((l) => !/^FAIL  N2|^FAIL  A3/.test(l)), show(r.lines)).toEqual([]);
  });

  it("never prints the key; every board call carries x-rb-budget: probe and is a status, list or detail read; every page is read as Googlebot", () => {
    const { out, calls } = run(routes());
    expect(out).not.toContain(KEY);
    const board = calls.filter((c) => c.includes("functions/v1/job-board"));
    expect(board.length).toBeGreaterThan(50);
    for (const c of board) expect(c, c).toContain("x-rb-budget: probe");
    for (const c of board.filter((x) => x.startsWith("curl\tPOST "))) expect(c, c).toMatch(/\t\{"action":"(?:status|list|detail)"/);
    const pages = calls.filter((c) => /^curl\tGET https:\/\/site\.test\/(?:jobs\/|sitemap\.xml)/.test(c));
    expect(pages.length).toBe(4);
    for (const c of pages) expect(c, c).toContain(`ua:${UA}`);
    expect(calls.filter((c) => /^curl\t(?:PUT|DELETE|PATCH) /.test(c))).toEqual([]);
  });
});
