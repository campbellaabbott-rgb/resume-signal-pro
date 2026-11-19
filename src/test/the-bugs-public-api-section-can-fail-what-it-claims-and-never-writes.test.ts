// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND PUBLIC-API SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS BEFORE
 * THE PASTE, AND NEVER WRITES (scripts/verify-deploy.d/99zzzzzzz-bugs-public-api.sh).
 *
 * Run against a fake curl that answers from routes (matched on the method,
 * the URL, any body and which key the call carried) and logs every call, with
 * a ledger fixture standing in for docs/deploy-ledger.json:
 *   - before the paste (today's live answers) it prints INFO and no FAIL,
 *     with or without a fresh key, and both owner keys print owner pending;
 *   - after a good paste every claim passes;
 *   - after the paste each broken claim fails, and a migration callable by
 *     anon or a withheld feed handed on fails even before it;
 *   - a decided owner key judges what its decision ships;
 *   - SH1 (the shared Ashby stop) passes only on the build that carries it:
 *     the same unread Ashby form on the build before it is INFO, a read or
 *     an unreachable form on it is a FAIL, and no served Ashby posting is
 *     reported, not judged;
 *   - every call is an OPTIONS or a GET, except job-board list reads under
 *     x-rb-budget: probe, and no key is ever printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-public-api.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bugs_public_api";
const FRESH = "rb_live_FRESH_marker_bugs_public_api";
const REVOKED = "rb_live_REVOKED_marker_bugs_public_api";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string; bodies?: string[]; time?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const H=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")H.push(a[++i]);
  else if(["-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const auth=(H.find((h)=>/^authorization:/i.test(h))||"").replace(/^authorization:\\s*bearer\\s*/i,"");
const who=!auth?"NONE":auth===process.env.VD_K?"ANON":auth===process.env.VD_FRESH?"FRESH":auth===process.env.VD_REVOKED?"REVOKED":"OTHER";
const budget=(H.find((h)=>/^x-rb-budget:/i.test(h))||"").replace(/^x-rb-budget:\\s*/i,"");
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+" WHO:"+who+(budget?" BUDGET:"+budget:"")+(data!==null?" DATA:"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?" "+data:"")+" WHO:"+who;
const idx=routes.findIndex((x)=>new RegExp(x.match).test(key));
const r=idx<0?{status:404,body:""}:routes[idx];
let body=r.body??"";
if(r.bodies){const cf=process.env.VD_CALLS+".n"+idx;let n=0;try{n=Number(fs.readFileSync(cf,"utf8"))}catch{}
  body=r.bodies[Math.min(n,r.bodies.length-1)];fs.writeFileSync(cf,String(n+1));}
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st)).replace("%{time_total}",r.time??"0.4");
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], opts: { fresh?: boolean; ownerDecided?: Record<string, unknown> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vdbugsapi-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided: opts.ownerDecided ?? {} } } }));
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua; RB=${REVOKED}\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`).split(`node - /tmp <<`).join(`node - ${dir} <<`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDBA_LEDGER: join(dir, "ledger.json"),
    VD_K: KEY, VD_FRESH: FRESH, VD_REVOKED: REVOKED,
  };
  delete env.RB_API_KEY_FRESH;
  delete env.RB_REVOKED_KEY;
  delete env.VERIFY_BURST;
  if (opts.fresh) env.RB_API_KEY_FRESH = FRESH;
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

// ── the world, before and after ─────────────────────────────────────────────

const P = "https://p\\.supabase\\.co";
const PA = `${P}/functions/v1/public-api`;
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const GHOST_AT = ago(80), ROOT_AT = ago(58), PASS_AT = ago(30), COUNTED_AT = ago(400), COV_AT = ago(30);
const OLD_REASON = "Two hiring systems are shown on resumebooster.work but not handed on by this API: the U.S. federal job feed, whose terms of use forbid redistributing it as a data feed, and SmartRecruiters, withheld until SmartRecruiters (SAP) permits it.";
const NEW_REASON = "Two hiring systems are shown on resumebooster.work but are not available through this API: the U.S. federal job feed (USAJOBS), which this API does not hand on at present, and SmartRecruiters, withheld until SmartRecruiters (SAP) permits it.";
const FORMS_WITH_ASHBY = "GET /v1/jobs/{id}/application — the employer's own application form (Ashby, BambooHR, Breezy or Greenhouse).";
const ASHBY_ID = "ashby:acme:5f2c9a1e-1b2c-4d3e-8f90-0a1b2c3d4e5f";
const ASHBY_LIST = { data: [{ id: ASHBY_ID, source: "ashby", title: "Platform Engineer" }] };
const ashbyForm = (form: Record<string, unknown>) => ({ data: { id: ASHBY_ID, source: "ashby",
  form: { vendor: "ashby", readAt: null, questions: [], documents: [], alsoOnForm: [], ...form } } });
// What the shared stop serves: nothing read, on this surface.
const ASHBY_NOT_READ: [number, Record<string, unknown>] = [200, ashbyForm({ source: "not-read-on-this-surface", note: "This surface does not read this hiring system's form. Apply at apply_url." })];
// What round A serves today: /v1 reads Ashby's form.
const ASHBY_READ: [number, Record<string, unknown>] = [200, ashbyForm({ source: "employer-published", readAt: ago(60),
  questions: [{ label: "Do you require visa sponsorship?", required: true, answeredBy: "you" }] })];

type World = {
  build: string | null;
  m1: Route; m2: Route; m3: Route;
  revoked: Route; fitKeyless: number; index: Record<string, unknown>;
  stats: Record<string, unknown>; companies: Record<string, unknown>; jobsal: Record<string, unknown>;
  changes: Record<string, unknown>; usage: [number, number]; fitKeyed: number;
  page1: string; deep: [number, string]; nb30: [number, Record<string, unknown>]; nb27: [number, Record<string, unknown>];
  cron: string;
  ashbyList: Record<string, unknown>; ashbyForm: [number, Record<string, unknown>];
};

const cache = { computed_at: ROOT_AT, stale_parts: [], ghost_stats: { closed_90d: 9, computed_at: GHOST_AT },
  fill_curve: { computed_at: ROOT_AT, rows: [{ category: "nursing", admitted_boards_14: 3, admitted_boards_30: 1 }] } };
const closure = (id: number, minutesAgo: number) => ({ event_id: id, closed_at: ago(minutesAgo) });

const NEW_STATS = () => ({ basis: "feedFreshness and bySource come from a rollup and each carries its own asOf.", data: {
  companiesAsOf: PASS_AT, companiesCarried: false,
  lifecycle: { asOf: GHOST_AT, carriedForward: false, closuresLogged90dBasis: "Closure events over the window (a posting that came down more than once counts each time): ...",
    fillCurve: { basis: "only roles on job boards read in full that have a watch floor ...", data: [{ category: "nursing", admittedBoards14: 3, admittedBoards30: 1 }] } } } });
const OLD_STATS = () => ({ basis: "feedFreshness and bySource come from a rollup recomputed every 30 minutes and each carries its own asOf.", data: {
  lifecycle: { asOf: ROOT_AT, closuresLogged90dBasis: "Roles an employer took down, over the window: ...",
    fillCurve: { basis: "Aalen-Johansen cumulative incidence of a genuine fill by day 14 ...", data: [{ category: "nursing" }] } } } });

const after = (): World => ({
  build: "public-api.2026-11-18.2",
  m1: { match: "", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for function api_key_fit_unscored" }) },
  m2: { match: "", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for table api_fit_unscored" }) },
  m3: { match: "", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied for function api_key_fit_allowance" }) },
  revoked: { match: "", status: 403, headers: { "x-ratelimit-remaining": "60" }, body: JSON.stringify({ error: { code: "key_revoked" } }) },
  fitKeyless: 405,
  index: { restrictions: { excludedSources: ["usajobs", "smartrecruiters"], reason: NEW_REASON }, modes: { applicationForm: FORMS_WITH_ASHBY } },
  stats: NEW_STATS(),
  companies: { asOf: PASS_AT, countsCarried: false },
  jobsal: { coverage: { statedPayShare: 0.281, statedPayShareAt: COV_AT, statedPayShareCarried: false } },
  changes: { closed: [closure(1, 90), closure(2, 40)], page: { closedReturned: 2, closed: { hasMore: false, nextCursor: null, resumeCursor: "abc", settledThrough: ago(15) } } },
  usage: [3, 3], fitKeyed: 405, page1: "0.5", deep: [200, "0.9"],
  nb30: [400, { error: { code: "bad_cursor" } }], nb27: [400, { error: { code: "invalid_value", message: 'country takes ISO-3166-1 alpha-2 codes. Not a code: "EU".' } }],
  cron: "*/15 * * * *",
  ashbyList: ASHBY_LIST, ashbyForm: ASHBY_NOT_READ,
});
const before = (): World => ({
  ...after(),
  build: "public-api.2026-11-09.1",
  m1: { match: "", status: 404, body: JSON.stringify({ code: "PGRST202", message: "Could not find the function public.api_key_fit_unscored" }) },
  m2: { match: "", status: 404, body: JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.api_fit_unscored'" }) },
  revoked: { match: "", status: 403, headers: { "x-ratelimit-remaining": "60", "x-quota-remaining": "1000" }, body: JSON.stringify({ error: { code: "key_revoked" } }) },
  fitKeyless: 401,
  index: { restrictions: { excludedSources: ["usajobs", "smartrecruiters"], reason: OLD_REASON }, modes: { applicationForm: FORMS_WITH_ASHBY } },
  stats: OLD_STATS(),
  companies: { asOf: ago(5) },
  jobsal: { coverage: { statedPayShare: 0.237, statedPayShareBasis: "salary_rank_usd IS NOT NULL, counted 2026-09-27T02:07:00Z" } },
  changes: { closed: [closure(1, 90), closure(2, 3)], page: { closedReturned: 2, closed: { hasMore: false, nextCursor: null } } },
  usage: [3, 4], fitKeyed: 405, deep: [200, "4.8"],
  nb30: [500, { error: { code: "query_failed" } }], nb27: [200, { data: [] }],
  ashbyForm: ASHBY_READ,
});

function routes(w: World): Route[] {
  return [
    { match: `^OPTIONS ${PA}/v1/stats WHO:NONE$`, headers: w.build ? { "x-fn-build": w.build } : {} },
    { ...w.m1, match: `^GET ${P}/rest/v1/rpc/api_key_fit_unscored\\?` },
    { ...w.m2, match: `^GET ${P}/rest/v1/api_fit_unscored\\?select=key_id&limit=1 WHO:ANON$` },
    { ...w.m3, match: `^GET ${P}/rest/v1/rpc/api_key_fit_allowance\\?` },
    { ...w.revoked, match: `^GET ${PA}/v1/stats WHO:REVOKED$` },
    { match: `^GET ${PA}/v1/fit WHO:NONE$`, status: w.fitKeyless, body: "{}" },
    { match: `^GET ${PA}/v1 WHO:NONE$`, body: JSON.stringify(w.index) },
    { match: `^GET ${P}/rest/v1/rpc/get_stats_cache WHO:ANON$`, body: JSON.stringify(cache) },
    { match: `^GET ${P}/rest/v1/rpc/get_cron_health WHO:ANON$`, body: JSON.stringify([{ ch_jobname: "job-board-stats-rollup", ch_schedule: w.cron }]) },
    { match: `^POST ${P}/functions/v1/job-board \\{"action":"list","limit":1,"salaryFloor":50000\\} WHO:ANON$`, body: JSON.stringify({ filterCoverage: { salaryFloor: 0.281 }, filterCoverageAt: COV_AT, refreshedAt: PASS_AT }) },
    { match: `^POST ${P}/functions/v1/job-board \\{"action":"list","limit":1\\} WHO:ANON$`, body: JSON.stringify({ refreshedAt: PASS_AT }) },
    { match: `^GET ${PA}/v1/stats WHO:FRESH$`, body: JSON.stringify(w.stats) },
    { match: `^GET ${PA}/v1/companies\\?limit=1 WHO:FRESH$`, body: JSON.stringify(w.companies) },
    { match: `^GET ${PA}/v1/jobs\\?salary_min=50000&limit=1 WHO:FRESH$`, body: JSON.stringify(w.jobsal) },
    { match: `^GET ${PA}/v1/changes\\?since=[^&]+&limit=100 WHO:FRESH$`, body: JSON.stringify(w.changes) },
    { match: `^GET ${PA}/v1/changes\\?since=[^&]+&closed_cursor=\\S+ WHO:FRESH$`, status: w.nb30[0], body: JSON.stringify(w.nb30[1]) },
    { match: `^GET ${PA}/v1/usage WHO:FRESH$`, bodies: w.usage.map((u) => JSON.stringify({ fit: { usedToday: u } })) },
    { match: `^GET ${PA}/v1/fit WHO:FRESH$`, status: w.fitKeyed, body: "{}" },
    { match: `^GET ${PA}/v1/jobs\\?limit=25 WHO:FRESH$`, time: w.page1, body: "{}" },
    { match: `^GET ${PA}/v1/jobs\\?limit=25&cursor=\\S+ WHO:FRESH$`, status: w.deep[0], time: w.deep[1], body: "{}" },
    { match: `^GET ${PA}/v1/jobs\\?country=EU&limit=1 WHO:FRESH$`, status: w.nb27[0], body: JSON.stringify(w.nb27[1]) },
    { match: `^GET ${PA}/v1/jobs\\?source=ashby&limit=1 WHO:FRESH$`, body: JSON.stringify(w.ashbyList) },
    { match: `^GET ${PA}/v1/jobs/ashby%3A[^/ ]+/application WHO:FRESH$`, status: w.ashbyForm[0], headers: w.build ? { "x-fn-build": w.build } : {}, body: JSON.stringify(w.ashbyForm[1]) },
  ];
}

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const has = (lines: string[], re: RegExp) => lines.some((l) => re.test(l));

describe("the bug round public-api section", () => {
  it("before the paste says INFO and fails nothing, with or without a fresh key", () => {
    for (const fresh of [false, true]) {
      const { lines, out } = run(routes(before()), { fresh });
      expect(fails(lines), out).toEqual([]);
      expect(has(lines, /^INFO {2}B public-api preflight x-fn-build = public-api\.2026-11-09\.1/), out).toBe(true);
      expect(has(lines, /^INFO {2}M1 api_key_fit_unscored\(uuid, text\) does not exist/), out).toBe(true);
      expect(has(lines, /^INFO {2}M2 public\.api_fit_unscored does not exist/), out).toBe(true);
      expect(has(lines, /^PASS {2}M3 /), out).toBe(true);
      expect(has(lines, /^INFO {2}R a revoked key's 403 carries X-Quota-Remaining: 1000/), out).toBe(true);
      expect(has(lines, /^INFO {2}F GET \/v1\/fit with no key -> HTTP 401/), out).toBe(true);
      expect(has(lines, /^INFO {2}U the withholding reason still says/), out).toBe(true);
      expect(has(lines, /^INFO {2}OD14-REDIST-2 owner pending/), out).toBe(true);
      expect(has(lines, /^INFO {2}OD14-ASHBY-2 owner pending/), out).toBe(true);
      if (!fresh) expect(has(lines, /^INFO {2}K RB_API_KEY_FRESH is not set/), out).toBe(true);
      else {
        for (const k of ["S14X-160", "S14X-192", "S14X-277", "NB-32", "S14X-274", "S14X-276", "S14X-065", "S14X-132", "S14X-037", "NB-30", "NB-27", "SH1"]) {
          expect(has(lines, new RegExp(`^INFO {2}${k} .*\\(not pasted yet\\)$`)), `${k}\n${out}`).toBe(true);
        }
      }
    }
  });

  it("after a good paste every claim passes", () => {
    const { lines, out } = run(routes(after()), { fresh: true });
    expect(fails(lines), out).toEqual([]);
    for (const id of ["B", "M1", "M2", "M3", "R", "F", "U", "S14X-160", "S14X-192", "S14X-277", "NB-32", "S14X-274", "S14X-276", "S14X-065", "S14X-132", "S14X-037", "NB-30", "NB-27", "SH1"]) {
      expect(has(lines, new RegExp(`^PASS {2}${id} `)), `${id}\n${out}`).toBe(true);
    }
  });

  it("after the paste each broken claim fails", () => {
    const w = after();
    const broken: World = {
      ...w,
      m1: before().m1, m2: before().m2, revoked: before().revoked, fitKeyless: 401,
      index: before().index, stats: OLD_STATS(), companies: { asOf: ago(5), countsCarried: false },
      jobsal: { coverage: { statedPayShare: 0.237, statedPayShareAt: COV_AT } },
      changes: before().changes, usage: [3, 4], fitKeyed: 200, deep: [200, "4.8"], nb30: before().nb30, nb27: before().nb27,
      ashbyForm: ASHBY_READ,
    };
    const { lines, out } = run(routes(broken), { fresh: true });
    for (const id of ["M1", "M2", "R", "F", "U", "S14X-160", "S14X-192", "S14X-277", "NB-32", "S14X-274", "S14X-276", "S14X-065", "S14X-132", "S14X-037", "NB-30", "NB-27", "SH1"]) {
      expect(has(lines, new RegExp(`^FAIL {2}${id} `)), `${id}\n${out}`).toBe(true);
    }
  });

  it("a typed cadence fails against the live schedule in both directions once pasted, and an anon-callable give-back fails even before", () => {
    const w = after();
    w.stats = { ...NEW_STATS(), basis: "feedFreshness and bySource come from a rollup recomputed every 15 minutes." };
    w.cron = "*/30 * * * *";
    expect(fails(run(routes(w), { fresh: true }).lines).some((l) => /^FAIL {2}NB-32 .*a false statement live/.test(l))).toBe(true);
    w.cron = "*/15 * * * *";
    expect(fails(run(routes(w), { fresh: true }).lines).some((l) => /^FAIL {2}NB-32 .*true today, false the day a migration re-times it/.test(l))).toBe(true);
    const b = before();
    b.m1 = { match: "", status: 200, body: "false" };
    b.index = { restrictions: { excludedSources: ["smartrecruiters"], reason: NEW_REASON } };
    const { lines, out } = run(routes(b));
    expect(has(lines, /^FAIL {2}M1 .*answered anon HTTP 200/), out).toBe(true);
    expect(has(lines, /^FAIL {2}U the \/v1 index no longer withholds usajobs/), out).toBe(true);
  });

  it("a decided owner key judges what its decision ships", () => {
    const decided = { "OD14-REDIST-2": "withhold", "OD14-ASHBY-2": "stop" };
    let r = run(routes(after()), { ownerDecided: decided });
    expect(has(r.lines, /^FAIL {2}OD14-REDIST-2 \(withhold\) \/v1 still hands on ukg, adp, breezy/), r.out).toBe(true);
    expect(has(r.lines, /^FAIL {2}OD14-ASHBY-2 \(stop\) \/v1's form reader still names Ashby/), r.out).toBe(true);
    const w = after();
    w.index = { restrictions: { excludedSources: ["usajobs", "smartrecruiters", "ukg", "adp", "breezy"], reason: NEW_REASON },
      modes: { applicationForm: "GET /v1/jobs/{id}/application — the employer's own form (BambooHR or Greenhouse)." } };
    r = run(routes(w), { ownerDecided: decided });
    expect(fails(r.lines), r.out).toEqual([]);
    expect(has(r.lines, /^PASS {2}OD14-REDIST-2 /), r.out).toBe(true);
    expect(has(r.lines, /^PASS {2}OD14-ASHBY-2 /), r.out).toBe(true);
    r = run(routes(before()), { ownerDecided: decided });
    expect(fails(r.lines), "a decision is judged only once the round is live").toEqual([]);
  });

  it("an owner who kept UKG, ADP and Breezy is judged on /v1 still handing them on, never as a withhold", () => {
    // 2026-11-18 the owner kept them (no letters will be sent). Before this
    // case the judge read ANY recorded choice as withhold, so recording
    // "keep" would have printed a FAIL against the owner's own decision.
    const kept = { "OD14-REDIST-2": "keep" };
    let r = run(routes(after()), { ownerDecided: kept });
    expect(has(r.lines, /^PASS {2}OD14-REDIST-2 \(keep\) \/v1 still hands on ukg, adp and breezy/), r.out).toBe(true);
    expect(r.lines.some((l) => /^FAIL {2}OD14-REDIST-2/.test(l)), r.out).toBe(false);
    // TEETH: a build that withholds one of them anyway fails the kept decision.
    const w = after();
    w.index = { restrictions: { excludedSources: ["usajobs", "smartrecruiters", "breezy"], reason: NEW_REASON }, modes: (after().index as { modes?: unknown }).modes };
    r = run(routes(w), { ownerDecided: kept });
    expect(has(r.lines, /^FAIL {2}OD14-REDIST-2 \(keep\) \/v1 withholds breezy although the owner kept them/), r.out).toBe(true);
    // A choice naming neither is reported, not judged.
    r = run(routes(after()), { ownerDecided: { "OD14-REDIST-2": "later" } });
    expect(has(r.lines, /^INFO {2}OD14-REDIST-2 recorded as "later"/), r.out).toBe(true);
  });

  it("SH1 passes only on the build that carries the shared stop, asking for the form by its encoded id under the fresh key", () => {
    // The build before the shared stop answers the same unread form through
    // /v1's own list (round B's integration branch carries it without the
    // stop): the stamp is all that tells them apart, so it is INFO there.
    const w = after();
    w.build = "public-api.2026-11-18.1";
    let r = run(routes(w), { fresh: true });
    expect(has(r.lines, /^INFO {2}SH1 ashby:acme:\S+: \/v1 application -> HTTP 200, form\.source not-read-on-this-surface, readAt null, x-fn-build public-api\.2026-11-18\.1: .*not live yet$/), r.out).toBe(true);
    expect(r.lines.some((l) => /^(PASS|FAIL) {2}SH1 /.test(l)), r.out).toBe(false);
    // On the build that carries it, the form must be unread.
    r = run(routes(after()), { fresh: true });
    expect(has(r.lines, /^PASS {2}SH1 ashby:acme:\S+: .*x-fn-build public-api\.2026-11-18\.2: not read, on public-api\.2026-11-18\.2 or later/), r.out).toBe(true);
    expect(r.calls.filter((c) => /\/application /.test(c))).toEqual([`GET https://p.supabase.co/functions/v1/public-api/v1/jobs/${encodeURIComponent(ASHBY_ID)}/application WHO:FRESH`]);
  });

  it("SH1 fails a read or an unreachable form on the build that carries the stop, and reports an empty Ashby list without asking for a form", () => {
    let w = after();
    w.ashbyForm = [503, { error: { code: "form_unreachable" } }];
    let r = run(routes(w), { fresh: true });
    expect(has(r.lines, /^FAIL {2}SH1 ashby:acme:\S+: \/v1 application -> HTTP 503, form\.source none/), r.out).toBe(true);
    w = after();
    w.ashbyForm = [200, ashbyForm({ source: "not-read-on-this-surface", readAt: ago(5) })];
    r = run(routes(w), { fresh: true });
    expect(has(r.lines, /^FAIL {2}SH1 .*readAt \d{4}-/), "an unread source with a read time is a read").toBe(true);
    // No served Ashby posting: reported, not judged, and no form is asked for.
    w = after();
    w.ashbyList = { data: [] };
    r = run(routes(w), { fresh: true });
    expect(has(r.lines, /^INFO {2}SH1 \/v1\/jobs\?source=ashby served no Ashby posting/), r.out).toBe(true);
    expect(r.calls.some((c) => /\/application /.test(c)), r.calls.join("\n")).toBe(false);
  });

  it("sends only OPTIONS and GETs, and job-board list reads under the probe budget, and never prints a key", () => {
    for (const w of [before(), after()]) {
      const { calls, out } = run(routes(w), { fresh: true });
      expect(calls.length).toBeGreaterThan(20);
      for (const c of calls) {
        if (c.startsWith("POST ")) {
          expect(c, c).toMatch(/^POST https:\/\/p\.supabase\.co\/functions\/v1\/job-board WHO:ANON BUDGET:probe DATA:\{"action":"list"/);
        } else expect(c, c).toMatch(/^(GET|OPTIONS) /);
      }
      for (const k of [KEY, FRESH, REVOKED]) expect(out).not.toContain(k);
    }
  });
});
