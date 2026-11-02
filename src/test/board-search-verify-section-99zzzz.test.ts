// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzz CAN FAIL EVERY CLAIM IT MAKES, AND WAITS FOR ITS BUILD.
 *
 * scripts/verify-deploy.d/99zzzz-board-search.sh is the post-deploy proof of
 * branch fix/bs-search (job-board 2026-09-09.100, agent-mcp and public-api
 * 2026-11-02.1, migration 20261102100000). A PASS is worth something only if
 * a regression could have turned it into a FAIL (verify-deploy.d/README.md).
 * The section runs here against a fake curl that answers from routes (matched
 * on method, URL and body, with a per-route sequence for asks repeated across
 * isolates) and logs every call:
 *   - a good deploy prints only PASS lines, one per claim;
 *   - an older job-board build prints one INFO and asks the board nothing
 *     else; a preflight with no build is a FAIL; an older agent-mcp or
 *     public-api is INFO, and one with no build a FAIL;
 *   - each claim's own regression, as job-board.2026-09-09.96 answered it live
 *     on 2026-11-01, prints FAIL: the phrase split ("team"), the verb excluded
 *     ("requiring"), "no" dropped with remote nurses served, "first" left as a
 *     NOT (a total that differs from "remote engineer" even when asked again),
 *     filler searched, the ZIP unnamed, one cold isolate's SIMPLE route in four
 *     asks, Vienna VA under Wien on either path, a ranked Wien search with no
 *     anchored arm, and the 7-card page at offset 174;
 *   - a total that drifted between two asks and agrees when asked again is a
 *     PASS, an unstated total is INFO, and an empty phrase page is INFO;
 *   - an unreadable answer is a FAIL that shows it, never silence;
 *   - the key is never printed, every call to a function carries x-rb-budget:
 *     probe, every POST is a job-board list read, and the seam walk follows
 *     nextOffset and stops at the seam.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-board-search.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_HELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_99zzzz";
const FN = "https://p\\.supabase\\.co/functions/v1/";
const FB = `${FN}job-board`;

/** A route answers `body`, or the next of `bodies` on each repeated ask (the last one repeats). */
type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string; bodies?: string[] };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"");
const at=routes.findIndex((x)=>new RegExp(x.match).test(key));
const r=at>=0?routes[at]:{status:404,body:""};
let body=r.body??"";
if(Array.isArray(r.bodies)){let n={};try{n=JSON.parse(fs.readFileSync(process.env.VD_SEQ,"utf8"))}catch{}const k=String(at);const i=n[k]??0;n[k]=i+1;fs.writeFileSync(process.env.VD_SEQ,JSON.stringify(n));body=r.bodies[Math.min(i,r.bodies.length-1)];}
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd99zzzz-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${J_HELPER}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VD_SEQ: join(dir, "seq.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

type Job = Record<string, unknown>;
/** What a ranked answer carries: the flag, and search_jobs among the phases timed. */
const RANKED = { ranked: true, phaseMs: { meta_read: 20, search_jobs: 120, head_ring: 30 } };
let n = 0;
const job = (title: string, over: Job = {}): Job => ({ id: `greenhouse:t:${++n}`, title, company: "Acme", location: "Austin, TX", country: "US", ...over });
const list = (jobs: Job[], over: Record<string, unknown> = {}) => JSON.stringify({ jobs, total: jobs.length, hasMore: false, nextOffset: jobs.length, ...over });
const page = (count: number, prefix: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ jobs: Array.from({ length: count }, (_, i) => job("Registered Nurse", { id: `${prefix}-${i}` })), hasMore: true, ...over });
const routed = (route: string, company: string | null) =>
  JSON.stringify({ jobs: [job("Pharmacist", { company: company ?? "Someone" })], searchRoute: route, ...(company ? { companyMatched: company } : {}), searchRouteReason: route === "EMPLOYER" ? `whole query matches employer ${company}` : "query contains a token the english index discards" });

type Over = {
  build?: string | null; mcp?: string | null; api?: string | null;
  phrase?: string; verb?: string; noremote?: string; rf?: string[]; rp?: string[]; nearme?: string; zip?: string;
  participle?: string; hh?: string; hp?: string; career?: string; iso?: string;
  cvs?: string[]; m3?: string[]; browse?: string; ranked?: string; walk?: Record<number, string>;
};
const q = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function routes(o: Over = {}): Route[] {
  const build = o.build === undefined ? "job-board.2026-09-09.100" : o.build;
  const mcp = o.mcp === undefined ? "agent-mcp.2026-11-02.1" : o.mcp;
  const api = o.api === undefined ? "public-api.2026-11-02.1" : o.api;
  const walk = { 0: page(50, "w0", { nextOffset: 57 }), 57: page(50, "w57", { nextOffset: 109 }), 109: page(50, "w109", { nextOffset: 174 }), 174: page(50, "w174", { nextOffset: 243 }), ...(o.walk ?? {}) };
  const ask = (needle: string) => `^POST ${FB}\\t\\{"action":"list","q":"${q(needle)}"`;
  return [
    { match: `^OPTIONS ${FB}$`, status: 204, headers: build ? { "x-fn-build": build } : {} },
    { match: `^OPTIONS ${FN}agent-mcp$`, status: 204, headers: mcp ? { "x-fn-build": mcp } : {} },
    { match: `^OPTIONS ${FN}public-api$`, status: 204, headers: api ? { "x-fn-build": api } : {} },
    { match: ask('supervisor -\\"team lead\\"'), body: o.phrase ?? list([job("Supervisor, Lead Generation"), job("Shift Supervisor")], { excludedTerms: ["team lead"] }) },
    { match: ask("nurse not requiring travel"), body: o.verb ?? list([job("Registered Nurse"), job("Nurse Practitioner")], { excludedTerms: ["travel"] }) },
    { match: ask("cdl not required driver"), body: o.participle ?? list([job("CDL Driver")], { excludedTerms: ["required"] }) },
    { match: ask("medical coder-remote"), body: o.hh ?? list([job("Medical Coder")], { intentFilters: ["remote"], total: 412 }) },
    { match: ask("medical coder remote"), body: o.hp ?? list([job("Medical Coder")], { intentFilters: ["remote"], total: 412 }) },
    { match: ask("career"), body: o.career ?? list([job("Career Advisor"), job("Career Coach")]) },
    { match: ask("quality engineer iso 13485"), body: o.iso ?? list([job("Quality Engineer - ISO 13485")]) },
    { match: ask("no remote nurse"), body: o.noremote ?? list([job("Registered Nurse"), job("Charge Nurse")], { excludedTerms: ["remote"] }) },
    { match: ask("remote-first engineer"), bodies: o.rf ?? [list([job("Platform Engineer")], { intentFilters: ["remote"], total: 8628 })] },
    { match: ask("remote engineer"), bodies: o.rp ?? [list([job("Platform Engineer")], { intentFilters: ["remote"], total: 8628 })] },
    { match: ask("jobs near me"), body: o.nearme ?? list([job("Cashier")], { ignoredFilters: ["q"] }) },
    { match: ask("nurse 94105"), body: o.zip ?? list([job("Registered Nurse")], { droppedTerms: ["94105"] }) },
    { match: ask("cvs"), bodies: o.cvs ?? [routed("EMPLOYER", "CVS Health")] },
    { match: ask("3m"), bodies: o.m3 ?? [routed("EMPLOYER", "3M")] },
    { match: `^POST ${FB}\\t\\{"action":"list","q":"","location":"Wien"`, body: o.browse ?? list([job("Data Analyst", { location: "Vienna", country: "AT" }), job("SEO Manager", { location: "Wien, Austria", country: "AT" })]) },
    { match: `^POST ${FB}\\t\\{"action":"list","q":"engineer","location":"Wien"`, body: o.ranked ?? list([job("Software Engineer", { location: "Vienna, Austria", country: "AT" }), job("Engineer", { location: "Wien", country: "AT" }), job("Engineer", { location: "Vienna HQ", country: null })], RANKED) },
    ...Object.entries(walk).map(([off, body]) => ({ match: `^POST ${FB}\\t\\{"action":"list","q":"nurse","limit":50,"offset":${off},`, body })),
  ];
}
const verdicts = (lines: string[], v: "PASS" | "FAIL" | "INFO") => lines.filter((l) => l.startsWith(`${v}  `));
const show = (lines: string[]) => lines.join("\n");
const hasLine = (lines: string[], v: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${v}  `) && re.test(l));
const failsWith = (o: Over, re: RegExp) => {
  const { lines } = run(routes(o));
  expect(hasLine(lines, "FAIL", re), `${re}\n${show(lines)}`).toBe(true);
};

describe("section 99zzzz: the search reads what was typed", () => {
  it("a good deploy prints one PASS per claim and nothing else", () => {
    const { lines } = run(routes());
    expect(verdicts(lines, "FAIL"), show(lines)).toEqual([]);
    expect(verdicts(lines, "INFO"), show(lines)).toEqual([]);
    const pass = verdicts(lines, "PASS");
    for (const re of [/x-fn-build = job-board\.2026-09-09\.100/, /x-fn-build = agent-mcp\.2026-11-02\.1/, /x-fn-build = public-api\.2026-11-02\.1/,
      /supervisor -"team lead" excludes \["team lead"\] and none of its 2 titles/, /nurse not requiring travel excludes \["travel"\]/, /no remote nurse excludes remote/,
      /cdl not required driver excludes \["required"\] only/, /medical coder-remote lifts the remote filter and counts 412/, /career keeps main.s title search/, /quality engineer iso 13485 keeps 13485 searched/,
      /remote-first engineer lifts the remote filter and counts 8628, exactly what remote engineer counts/, /jobs near me searches no words/, /nurse 94105 drops the ZIP/,
      /cvs and 3m route to CVS Health and 3M on all 6 asks/, /location Wien browses 2 rows/, /engineer in Wien ranks 3 rows, .* 1 of them named Vienna/,
      /seam walk for nurse \(limit 50\) served 4 full pages to nextOffset 243/]) {
      expect(pass.some((l) => re.test(l)), `${re}\n${show(lines)}`).toBe(true);
    }
    expect(pass.length).toBe(17);
    expect(lines[0]).toMatch(/^== 99zzzz\. /);
  });

  it("an older job-board build is one INFO and the board is asked nothing else; a preflight with no build is a FAIL", () => {
    const old = run(routes({ build: "job-board.2026-09-09.96" }));
    expect(hasLine(old.lines, "INFO", /job-board preflight x-fn-build = job-board\.2026-09-09\.96: .*not serving yet/), show(old.lines)).toBe(true);
    expect(verdicts(old.lines, "FAIL"), show(old.lines)).toEqual([]);
    expect(old.calls.filter((c) => /^curl\tPOST /.test(c)), old.calls.join("\n")).toEqual([]);
    const none = run(routes({ build: null }));
    expect(hasLine(none.lines, "FAIL", /job-board preflight carries no x-fn-build/), show(none.lines)).toBe(true);
    expect(none.calls.filter((c) => /^curl\tPOST /.test(c))).toEqual([]);
    const later = run(routes({ build: "job-board.2026-11-20.1" }));
    expect(hasLine(later.lines, "PASS", /job-board\.2026-11-20\.1 \(job-board\.2026-09-09\.100 or later/), show(later.lines)).toBe(true);
  });

  it("an older agent-mcp or public-api is INFO, and one with no build a FAIL", () => {
    const old = run(routes({ mcp: "agent-mcp.2026-10-11.38", api: "public-api.2026-10-11.37" }));
    expect(hasLine(old.lines, "INFO", /agent-mcp preflight x-fn-build = agent-mcp\.2026-10-11\.38: .*not serving yet/), show(old.lines)).toBe(true);
    expect(hasLine(old.lines, "INFO", /public-api preflight x-fn-build = public-api\.2026-10-11\.37: .*not serving yet/), show(old.lines)).toBe(true);
    expect(verdicts(old.lines, "FAIL"), show(old.lines)).toEqual([]);
    const none = run(routes({ mcp: null, api: null }));
    expect(hasLine(none.lines, "FAIL", /agent-mcp preflight carries no x-fn-build/), show(none.lines)).toBe(true);
    expect(hasLine(none.lines, "FAIL", /public-api preflight carries no x-fn-build/), show(none.lines)).toBe(true);
  });

  it("FAILs a phrase split into words, and a phrase served across a hyphen; an empty page is INFO", () => {
    failsWith({ phrase: list([job("Lead Supervisor I")], { excludedTerms: ["team"] }) }, /supervisor -"team lead" excludes \["team"\] \(want \["team lead"\]/);
    failsWith({ phrase: list([job("Team-Lead Supervisor")], { excludedTerms: ["team lead"] }) }, /names the phrase excluded but serves \["Team-Lead Supervisor"\]/);
    const empty = run(routes({ phrase: list([], { excludedTerms: ["team lead"] }) }));
    expect(hasLine(empty.lines, "INFO", /served no row/), show(empty.lines)).toBe(true);
  });

  it("FAILs the verb excluded in place of its object, and a served travel title", () => {
    failsWith({ verb: list([job("Travel Nurse RN")], { excludedTerms: ["requiring"] }) }, /excludes \["requiring"\] \(want \["travel"\]/);
    failsWith({ verb: list([job("Registered Nurse Travel RN")], { excludedTerms: ["travel"] }) }, /names travel excluded but serves \["Registered Nurse Travel RN"\]/);
  });

  it("FAILs a negated remote dropped as filler with remote nurses served; a title that says it is not remote passes", () => {
    failsWith({ noremote: list([job("Triage Nurse | Remote")], { droppedTerms: ["no"] }) }, /no remote nurse: excludedTerms is null, not naming remote/);
    failsWith({ noremote: list([job("Nurse Practitioner (Remote)")], { excludedTerms: ["remote"] }) }, /names remote excluded but serves \["Nurse Practitioner \(Remote\)"\]/);
    failsWith({ noremote: list([job("RN (Not Remote)"), job("Remote RN Case Manager")], { excludedTerms: ["remote"] }) }, /serves \["Remote RN Case Manager"\]/);
    const kept = run(routes({ noremote: list([job("Staff Nurse I (Not Remote)"), job("NON-REMOTE Charge Nurse"), job("Nurse - Remote: No")], { excludedTerms: ["remote"] }) }));
    expect(hasLine(kept.lines, "PASS", /no remote nurse excludes remote and none of its 3 titles says remote/), show(kept.lines)).toBe(true);
  });

  it("FAILs a participle's next word excluded, a head word dropped before a hyphened mode, a title word cleared as filler, and a held number dropped as a ZIP", () => {
    failsWith({ participle: list([job("CDL Instructor")], { excludedTerms: ["driver"] }) }, /cdl not required driver excludes \["driver"\] \(want \["required"\]/);
    failsWith({ hh: list([job("Medical Biller")], { intentFilters: ["remote"], total: 9120 }) }, /medical coder-remote counts 9120 and medical coder remote 412/);
    failsWith({ hh: list([job("Medical Coder")], { total: 3 }) }, /medical coder-remote lifts null \(want the remote filter\)/);
    failsWith({ career: list([job("Cashier")], { ignoredFilters: ["q"] }) }, /career: ignoredFilters names q/);
    failsWith({ career: list([]) }, /career keeps q but served no row/);
    failsWith({ iso: list([job("Quality Engineer")], { droppedTerms: ["13485"] }) }, /quality engineer iso 13485 drops 13485 as a ZIP/);
  });

  it("FAILs a hyphened word left as a NOT, judged by the two totals asked twice; a drift that agrees on the second ask is a PASS", () => {
    failsWith({ rf: [list([job("Engineer")], { total: 10 })] }, /remote-first engineer lifts null \(want the remote filter\)/);
    failsWith({ rf: [list([job("Engineer")], { intentFilters: ["remote"], excludedTerms: ["first"], total: 8628 })] }, /excludes \["first"\]: the hyphened word was left behind as a NOT/);
    const differ = run(routes({ rf: [list([job("Engineer")], { intentFilters: ["remote"], total: 8621 })] }));
    expect(hasLine(differ.lines, "FAIL", /remote-first engineer counts 8621 and remote engineer 8628, asked twice/), show(differ.lines)).toBe(true);
    expect(differ.calls.filter((c) => /"q":"remote-first engineer"/.test(c)).length, "asked again before failing").toBe(2);
    const drift = run(routes({ rf: [list([job("E")], { intentFilters: ["remote"], total: 8621 }), list([job("E")], { intentFilters: ["remote"], total: 8630 })], rp: [list([job("E")], { intentFilters: ["remote"], total: 8628 }), list([job("E")], { intentFilters: ["remote"], total: 8630 })] }));
    expect(hasLine(drift.lines, "PASS", /counts 8630, exactly what remote engineer counts/), show(drift.lines)).toBe(true);
    const agree = run(routes());
    expect(agree.calls.filter((c) => /"q":"remote-first engineer"/.test(c)).length, "no second ask when the first agrees").toBe(1);
    const unstated = run(routes({ rf: [list([job("E")], { intentFilters: ["remote"], total: null })] }));
    expect(hasLine(unstated.lines, "INFO", /a total is unstated/), show(unstated.lines)).toBe(true);
    expect(verdicts(unstated.lines, "FAIL"), show(unstated.lines)).toEqual([]);
  });

  it("FAILs filler searched with nothing said, and a ZIP left unnamed", () => {
    failsWith({ nearme: list([job("Cashier")], { total: 2 }) }, /jobs near me: ignoredFilters is null, not naming q/);
    failsWith({ zip: list([job("Registered Nurse")]) }, /nurse 94105: droppedTerms is null, not naming the ZIP/);
  });

  it("FAILs one cold isolate among the asks", () => {
    failsWith({ cvs: [routed("EMPLOYER", "CVS Health"), routed("EMPLOYER", "CVS Health"), routed("SIMPLE", null)] }, /did not route on every ask: \["cvs#3 routed SIMPLE \(query contains a token the english index discards\)"/);
    failsWith({ m3: [routed("EMPLOYER", "3M Company")] }, /3m#1 routed EMPLOYER/);
  });

  it("FAILs Vienna VA under Wien on the browse path and the ranked path, and a ranked Wien with no anchored arm; a US row naming Austria passes", () => {
    failsWith({ browse: list([job("Sales Associate", { location: "Vienna, WV", country: "US" }), job("SEO", { location: "Vienna", country: "AT" })]) }, /location Wien browses 1 of 2 rows placed in the US: \["Vienna, WV"\]/);
    failsWith({ browse: list([]) }, /location Wien browses no row at all/);
    failsWith({ ranked: list([job("Engineer", { location: "Vienna, OH - USA", country: "US" }), job("Engineer", { location: "Vienna", country: "AT" })], RANKED) }, /engineer in Wien ranks 1 of 2 rows placed in the US: \["Vienna, OH - USA"\]/);
    failsWith({ ranked: list([job("Data Engineer", { location: "Wien, Austria", country: "AT" })], RANKED) }, /none named Vienna without Wien: search_jobs has no anchored arm/);
  });

  it("FAILs a ranked Wien whose only Vienna rows the head-term ring could have supplied, and one search_jobs did not answer", () => {
    // A title that starts with the query word is the head-term ring's to find; only another title is the anchored arm's evidence.
    failsWith({ ranked: list([job("Engineer", { location: "Vienna", country: "AT" }), job("Engineering Manager", { location: "Wien", country: "AT" })], RANKED) },
      /none named Vienna without Wien outside the titles the head-term ring finds/);
    failsWith({ ranked: list([job("Software Engineer", { location: "Vienna, Austria", country: "AT" })], { phaseMs: { search_jobs: 120 } }) },
      /engineer in Wien was not ranked/);
    failsWith({ ranked: list([job("Software Engineer", { location: "Vienna, Austria", country: "AT" })], { ranked: true, phaseMs: { head_ring: 30 } }) },
      /search_jobs did not run/);
    failsWith({ ranked: list([job("Software Engineer", { location: "Vienna, Austria", country: "AT" })], { ranked: true }) },
      /search_jobs did not run/);
    const named = run(routes({ browse: list([job("Analyst", { location: "Vienna, Austria; New York, NY", country: "US" })]) }));
    expect(hasLine(named.lines, "PASS", /location Wien browses 1 rows, none placed in the US without naming Austria/), show(named.lines)).toBe(true);
  });

  it("FAILs the 7-card seam page and a card served twice, and follows nextOffset to the seam", () => {
    const short = run(routes({ walk: { 174: page(7, "w174", { nextOffset: 400 }) } }));
    expect(hasLine(short.lines, "FAIL", /served short pages that had more: \["offset 174 served 7 cards"\] over \["0:50","57:50","109:50","174:7"\]/), show(short.lines)).toBe(true);
    failsWith({ walk: { 57: page(50, "w0", { nextOffset: 109 }) } }, /seam walk for nurse served a card twice: \["w0-0"/);
    const { calls } = run(routes());
    const offs = calls.filter((c) => /"q":"nurse","limit":50/.test(c)).map((c) => /"offset":(\d+)/.exec(c)?.[1]);
    expect(offs).toEqual(["0", "57", "109", "174"]);
    const ended = run(routes({ walk: { 57: page(30, "w57", { hasMore: false, nextOffset: 87 }) } }));
    expect(hasLine(ended.lines, "PASS", /served 2 full pages/), show(ended.lines)).toBe(true);
    const stuck = run(routes({ walk: { 0: page(50, "a", { nextOffset: 1 }), 1: page(50, "b", { nextOffset: 2 }), 2: page(50, "c", { nextOffset: 3 }), 3: page(50, "d", { nextOffset: 4 }), 4: page(50, "e", { nextOffset: 5 }), 5: page(50, "f", { nextOffset: 6 }) } }));
    expect(stuck.calls.filter((c) => /"q":"nurse","limit":50/.test(c)).length, "at most six pages").toBe(6);
    expect(hasLine(stuck.lines, "INFO", /stopped after 6 full pages without reaching the seam/), show(stuck.lines)).toBe(true);
  });

  it("FAILs every unreadable answer, never crashing into silence", () => {
    const html = "<html>gateway</html>";
    const { lines } = run(routes({ phrase: html, verb: html, noremote: html, rf: [html], nearme: html, zip: html, cvs: [html], browse: html, ranked: html, walk: { 0: html } }));
    for (const re of [/supervisor -"team lead": the list is unreadable: <html>gateway/, /nurse not requiring travel: the list is unreadable/, /no remote nurse: the list is unreadable/,
      /remote-first engineer: a list is unreadable/, /jobs near me: the list is unreadable/, /nurse 94105: the list is unreadable/, /cvs#1 unreadable: <html>gateway/,
      /location Wien \(browse\): the list is unreadable/, /engineer in Wien \(ranked\): the list is unreadable/, /seam walk for nurse: page 0 is unreadable: <html>gateway/]) {
      expect(hasLine(lines, "FAIL", re), `${re}\n${show(lines)}`).toBe(true);
    }
    expect(lines.some((l) => /judge threw/.test(l)), show(lines)).toBe(false);
  });

  it("never prints the key, sends x-rb-budget: probe on every call, and POSTs only job-board list reads", () => {
    const { out, calls } = run(routes());
    expect(out).not.toContain(KEY);
    const fns = calls.filter((c) => /functions\/v1\//.test(c));
    expect(fns.length).toBe(3 + 12 + 6 + 2 + 4);
    for (const c of fns) expect(c, c).toMatch(/headers:.*x-rb-budget: probe/);
    const posts = calls.filter((c) => /^curl\tPOST /.test(c));
    for (const p of posts) expect(p, p).toMatch(new RegExp(`^curl\\tPOST ${FB}\\t\\{"action":"list"`));
    expect(calls.filter((c) => !/^curl\t(OPTIONS|POST) https:\/\/p\.supabase\.co\/functions\/v1\/(job-board|agent-mcp|public-api)(\t|$)/.test(c))).toEqual([]);
  });
});
