// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 97 CAN FAIL EVERY CLAIM IT MAKES, AND SENDS NO RÉSUMÉ.
 *
 * scripts/verify-deploy.d/97-resume-match.sh is the post-deploy proof for
 * résumé matching's phase 0. A PASS is worth something only if a regression
 * could have turned it into a FAIL (verify-deploy.d/README.md), and a line
 * computed over nothing is INFO. The section runs here against a fake curl
 * that answers from routes (matched on method, URL and body; a route may
 * answer only its first N calls) and logs every call:
 *   - a good deploy prints only PASS lines, one per claim;
 *   - nothing deployed prints FAIL for the build and INFO for the rest, and
 *     sends no synthetic profile;
 *   - the build serving over missing migrations is a FAIL per object;
 *   - slow walls, a slow candidates statement, an unread row tiered strong
 *     or unlabelled, an echoed canary, a Columbus, GA row, a Westerville-less
 *     ring, a banned word, a readable table, a callable function, and a
 *     bucket that never answers 429 each print FAIL;
 *   - a bucket spent by an earlier run makes the timings INFO and judges the
 *     429 at once; the board meter refusing first is INFO;
 *   - the publishable key is never printed, every RPC but the cron-health
 *     reader is a GET, and no POST carries more than the synthetic profiles.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { FOOTER, REQUIREMENTS_NOT_READ } from "../../supabase/functions/_shared/match-tiers";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/97-resume-match.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const PROBE = /^probe\(\) \{[\s\S]*?esac; \}$/m.exec(SCRIPT)?.[0] ?? "";
const R_HELPER = /^R\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_97";
const RM = "resume-match.2026-10-16.1";
const FN = "https://p\\.supabase\\.co/functions/v1/resume-match";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string; time?: number; max?: number };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const usedFile=process.env.VD_ROUTES+".used";let used={};try{used=JSON.parse(fs.readFileSync(usedFile,"utf8"))}catch{}
const key=method+" "+url+(data!==null?"\\t"+data:"");
let idx=routes.findIndex((x,i)=>new RegExp(x.match).test(key)&&(x.max===undefined||(used[i]||0)<x.max));
if(idx>=0){used[idx]=(used[idx]||0)+1;fs.writeFileSync(usedFile,JSON.stringify(used))}
const r=idx>=0?routes[idx]:{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st)).replace("%{time_total}",String(r.time??0.5));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd97-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${PROBE}\n${R_HELPER}\n`;
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

type Row = Record<string, unknown>;
const unreadRow = (over: Row = {}): Row => ({
  id: "u1", title: "Staff Accountant", company: "Acme", location: "Westerville, OH", country: "US", tier: "good",
  gaps: [REQUIREMENTS_NOT_READ], requirements: "not read", postingTerms: "pending", placeLine: "in your Columbus commute area (40 km)",
  sourceNote: null, facets: { requirements: "not read", rowStates: ["OH"] }, ...over,
});
const readRow = (over: Row = {}): Row => ({
  id: "r1", title: "Accountant", company: "Bolt", location: "Columbus, OH", country: "US", tier: "strong",
  gaps: [], requirements: { minYears: 2, must: ["Prepare monthly reconciliations"] }, postingTerms: ["gaap"],
  placeLine: "in your Columbus commute area (40 km)", sourceNote: null, facets: { requirements: { minYears: 2 } }, ...over,
});
function answer(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    build: RM, surface: "site", family: { key: "accountant", label: "Accountant" },
    searched: { titles: ["Accountant"], places: ["Columbus", "Westerville", "Dublin", "Hilliard"], ringSource: "geonames", radiusKm: 40, countries: ["US"], lanes: ["ring"], order: "rank", excludedSources: [] },
    rows: [readRow(), unreadRow()], more: 0,
    setAside: { beyond_commute: { count: 3, basis: "of the 120 postings found", label: "Beyond your commute area and where you'd move" } },
    setAsideRows: [], summary: "3 beyond your commute area", steps: [{ step: 0, label: "exact titles", added: 5 }],
    nextWiden: 1, thin: false, notes: [], basis: { found: 120, passed: 40, read: 20, walked: 6, pending: 0 },
    deadlineMissed: null, phaseMs: { anon: 40, ring: 30, candidates: 420, requirements: 300, terms: 60, total: 1100 }, cpuMs: 140,
    footer: FOOTER, followUp: "v1.1790000000000.0123456789abcdef0123456789abcdef", ...over,
  });
}
const denied = () => JSON.stringify({ code: "42501", message: "permission denied" });
const CRON = JSON.stringify([
  { ch_jobname: "purge-job-posting-requirements", ch_schedule: "41 4 * * *", ch_active: true, ch_timeout: "120s", ch_last_status: "succeeded" },
  { ch_jobname: "refresh-stats-cache", ch_schedule: "*/5 * * * *", ch_active: true, ch_timeout: "110s" },
]);
const RATE_LIMITED = JSON.stringify({ error: "rate_limited", message: "This network has made 30 matches this hour.", limit: 30, window: "1h", scope: "network" });
const H = { "x-fn-build": RM };

/** Everything but the profile POSTs. */
const BASE: Route[] = [
  { match: `^OPTIONS ${FN}$`, status: 204, headers: { ...H, "access-control-allow-origin": "*" } },
  { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 401, body: denied() },
  { match: "^GET https://p\\.supabase\\.co/rest/v1/(geo_places|job_posting_requirements)\\?", status: 401, body: denied() },
  { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health", body: CRON },
  { match: `^POST ${FN}\\t.*"surface":"mcp"`, status: 403, headers: H, body: JSON.stringify({ error: "server_surface", message: "The mcp and v1 surfaces answer only our own servers." }) },
  { match: `^POST ${FN}\\t.*"resumeText"`, status: 400, headers: H, body: JSON.stringify({ error: "resume_text_refused", message: "Résumé text is accepted only from our own servers." }) },
];
/** The ten profiles: the canary (Accountant, Columbus) first so a later catch-all does not shadow it, then a 429 after `okCalls` of the rest. */
function profiles(o: { canary?: string; other?: string; time?: number; okCalls?: number; after?: Route } = {}): Route[] {
  const ok: Route = { match: `^POST ${FN}\\t`, headers: H, body: o.other ?? answer(), time: o.time ?? 1.1, ...(o.okCalls !== undefined ? { max: o.okCalls } : {}) };
  return [
    { match: `^POST ${FN}\\t.*"Accountant"`, headers: H, body: o.canary ?? answer(), time: o.time ?? 1.1 },
    ok,
    o.after ?? { match: `^POST ${FN}\\t`, status: 429, headers: { ...H, "retry-after": "3600" }, body: RATE_LIMITED },
  ];
}
/** A good deploy: the ten timed calls answer, three more of the first profile answer, and the fourteenth call of the run is refused by the bucket. */
const GOOD = (o: Parameters<typeof profiles>[0] = {}): Route[] => [...BASE, ...profiles({ okCalls: 12, ...o })];

const statuses = (lines: string[]) => lines.map((l) => l.slice(0, 4));
const show = (lines: string[]) => `\n${lines.join("\n")}`;
const has = (lines: string[], s: string, re: RegExp) => lines.some((l) => l.startsWith(s) && re.test(l));
const profilePosts = (calls: string[]) => calls.filter((c) => /functions\/v1\/resume-match\t/.test(c) && !/resumeText/.test(c));

describe("verify section 97", () => {
  it("a good deploy prints only PASS lines, one per claim, and the 429 comes from the function's own bucket", () => {
    const { lines, calls, out } = run(GOOD());
    expect(lines[0]).toMatch(/^== 97\./);
    const body = lines.slice(1);
    expect(statuses(body).every((s) => s === "PASS"), show(lines)).toBe(true);
    for (const re of [
      /preflight x-fn-build = resume-match\.2026-10-16\.1/, /access-control-allow-origin = \*/,
      /match_candidates as anon -> 42501/, /match_candidates_query as anon -> 42501/, /match_candidates_explain as anon -> 42501/, /metro_ring as anon -> 42501/, /geo_places as anon -> 401 42501/, /job_posting_requirements as anon -> 401 42501/,
      /purge-job-posting-requirements sets its own timeout in the command: 120s/,
      /resume text from a site caller -> 400 resume_text_refused/, /mcp surface without the service key -> 403 server_surface/,
      /wall p50 = 1\.10 s/, /wall p90 = 1\.10 s/, /phaseMs\.candidates p90 = 420 ms/, /cpuMs p50 140/,
      /10 answers carry phaseMs/, /20 rows over 10 answers, every one tiered/, /10 of 20 rows have requirements not read: each capped at good/,
      /canary profile .* is not echoed/, /Columbus, OH ring \(4 places\) contains Westerville: true; rows in Georgia: 0/, /Columbus, OH: 2 rows, 0 in Georgia/,
      /served match sentences hold none of the \d+ banned patterns/,
      /call \d+ of this run -> 429 rate_limited limit 30 scope network, Retry-After 3600, from resume-match\.2026-10-16\.1/,
    ]) expect(body.some((l) => re.test(l)), re + show(lines)).toBe(true);
    expect(body.length, show(lines)).toBe(23);
    expect(out).not.toContain(KEY);
    // Every RPC is a GET but the cron-health reader; every function POST is a synthetic profile or one of the two refusals.
    expect(calls.filter((c) => /^curl\tPOST https:\/\/p\.supabase\.co\/rest\/v1\/rpc\//.test(c)).map((c) => c.split("\t")[1])).toEqual(["POST https://p.supabase.co/rest/v1/rpc/get_cron_health"]);
    expect(profilePosts(calls).length).toBe(14);
    expect(profilePosts(calls).every((c) => /"profile":\{"roles":\[/.test(c) && !/resumeText/.test(c))).toBe(true);
  });

  it("nothing deployed: the build FAILs, the rest is INFO, and no synthetic profile is sent", () => {
    const { lines, calls } = run([
      { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 404, body: JSON.stringify({ code: "PGRST202", message: "Could not find the function" }) },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/", status: 404, body: JSON.stringify({ code: "PGRST205", message: "Could not find the table" }) },
      { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health", body: CRON.replace("purge-job-posting-requirements", "something-else") },
    ]);
    expect(has(lines, "FAIL", /resume-match preflight carries no x-fn-build/), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toHaveLength(1);
    expect(lines.filter((l) => /^INFO .*PGRST202 .*judged once resume-match serves/.test(l))).toHaveLength(4);
    expect(lines.filter((l) => /^INFO .*not applied yet/.test(l)).length, show(lines)).toBe(3);
    expect(has(lines, "INFO", /refusals judged once/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /./), show(lines)).toBe(false);
    expect(profilePosts(calls)).toEqual([]);
  });

  it("the build serving over MISSING migrations is a FAIL for each object (every match would answer 500)", () => {
    const { lines } = run([
      BASE[0],
      { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 404, body: JSON.stringify({ code: "PGRST202", message: "Could not find the function" }) },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/", status: 404, body: JSON.stringify({ code: "PGRST205", message: "Could not find the table" }) },
      { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health", body: "[]" },
      ...BASE.slice(4),
      { match: `^POST ${FN}\\t`, status: 500, headers: H, body: JSON.stringify({ error: "match_unavailable", message: "Matching failed. Please try again." }) },
    ]);
    for (const fn of ["match_candidates", "match_candidates_query", "match_candidates_explain", "metro_ring"]) expect(has(lines, "FAIL", new RegExp(`^FAIL {2}${fn} -> PGRST202 while resume-match serves`)), fn + show(lines)).toBe(true);
    for (const t of ["geo_places", "job_posting_requirements"]) expect(has(lines, "FAIL", new RegExp(`${t} as anon -> 404 PGRST205 while resume-match serves`)), t + show(lines)).toBe(true);
    expect(lines.filter((l) => /^FAIL {2}timed match \d+ -> 500 match_unavailable/.test(l))).toHaveLength(10);
    expect(has(lines, "PASS", /wall p50/), show(lines)).toBe(false);
  });

  it("a readable table, a callable function and a purge without its own timeout each FAIL", () => {
    const { lines } = run([
      BASE[0],
      { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/metro_ring", status: 400, body: JSON.stringify({ code: "25006", message: "cannot execute in a read-only transaction" }) },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 401, body: denied() },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/geo_places", body: JSON.stringify([{ geonameid: 1 }]) },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/job_posting_requirements", status: 401, body: denied() },
      { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health", body: CRON.replace('"ch_timeout":"120s"', '"ch_timeout":null') },
      ...BASE.slice(4), ...profiles({ okCalls: 12 }),
    ]);
    expect(has(lines, "FAIL", /metro_ring is CALLABLE as anon/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /geo_places is READABLE as anon/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /purge-job-posting-requirements sets its own timeout in the command: none/), show(lines)).toBe(true);
  });

  it("the purge missing while its table exists is a FAIL", () => {
    const { lines } = run([...BASE.slice(0, 3), { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health", body: CRON.replace("purge-job-posting-requirements", "x") }, ...BASE.slice(4), ...profiles({ okCalls: 12 })]);
    expect(has(lines, "FAIL", /purge-job-posting-requirements is not scheduled though job_posting_requirements exists/), show(lines)).toBe(true);
  });

  it("refusals that do not come from resume-match's own code FAIL", () => {
    const { lines } = run([
      ...BASE.slice(0, 4),
      { match: `^POST ${FN}\\t.*"surface":"mcp"`, status: 401, body: JSON.stringify({ msg: "Invalid JWT" }) },
      { match: `^POST ${FN}\\t.*"resumeText"`, status: 200, headers: H, body: answer() },
      ...profiles({ okCalls: 12 }),
    ]);
    expect(has(lines, "FAIL", /resume text from a site caller -> 200/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /mcp surface without the service key -> 401/), show(lines)).toBe(true);
  });

  it("walls over the gate, a slow candidates statement and CPU over the cap FAIL", () => {
    const slow = answer({ phaseMs: { anon: 40, ring: 30, candidates: 900, requirements: 300, terms: 60, total: 3100 }, cpuMs: 2400 });
    const { lines } = run(GOOD({ time: 4.5, canary: slow, other: slow }));
    expect(has(lines, "FAIL", /wall p50 = 4\.50 s \(gate 2\.5 s\)/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /wall p90 = 4\.50 s \(gate 4 s\)/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /phaseMs\.candidates p90 = 900 ms/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /cpuMs .* max 2400 ms/), show(lines)).toBe(true);
  });

  it("an unread row tiered strong, an unread row without the label, and a label on a read row each FAIL", () => {
    for (const rows of [[unreadRow({ tier: "strong" })], [unreadRow({ gaps: [] })], [readRow({ gaps: [REQUIREMENTS_NOT_READ] })]]) {
      const { lines } = run(GOOD({ other: answer({ rows }) }));
      expect(has(lines, "FAIL", /rows have requirements not read: each capped at good/), JSON.stringify(rows) + show(lines)).toBe(true);
    }
  });

  it("no unread row at all leaves the cap INFO, not PASS; an unknown tier FAILs", () => {
    const all = answer({ rows: [readRow()] });
    const { lines } = run(GOOD({ other: all, canary: all }));
    expect(has(lines, "INFO", /no row came back with its requirements unread/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /capped at good/), show(lines)).toBe(false);
    const odd = run(GOOD({ other: answer({ rows: [readRow({ tier: "94%" })] }) })).lines;
    expect(has(odd, "FAIL", /every one tiered strong, good or stretch \(others: \["94%"\]\)/), show(odd)).toBe(true);
  });

  it("an echoed canary FAILs: the former job's text, or a reader key", () => {
    for (const leak of [{ notes: ["Your former job: Zqcanary Lamplighter"] }, { searched: { titles: ["Accountant"], places: ["Columbus", "Westerville"], ringSource: "geonames", workAuth: { status: "work_visa" } } }]) {
      const { lines } = run(GOOD({ canary: answer(leak) }));
      expect(has(lines, "FAIL", /canary profile .* is not echoed/), JSON.stringify(leak) + show(lines)).toBe(true);
    }
  });

  it("a Columbus, GA row and a ring without Westerville FAIL; a city-only ring is INFO and the Georgia check still runs", () => {
    const ga = run(GOOD({ canary: answer({ rows: [readRow({ location: "Columbus, GA" })] }) })).lines;
    expect(has(ga, "FAIL", /Columbus, OH: 1 rows, 1 in Georgia/), show(ga)).toBe(true);
    expect(has(ga, "FAIL", /Columbus, OH ring .* rows in Georgia: 1/), show(ga)).toBe(true);
    const noW = run(GOOD({ canary: answer({ searched: { titles: ["Accountant"], places: ["Columbus", "Dublin"], ringSource: "geonames" } }) })).lines;
    expect(has(noW, "FAIL", /contains Westerville: false/), show(noW)).toBe(true);
    const city = run(GOOD({ canary: answer({ searched: { titles: ["Accountant"], places: ["Columbus"], ringSource: "city-only" }, notes: ["Only Columbus itself was searched: the commute area around it is not available yet."] }) })).lines;
    expect(has(city, "INFO", /ring source = city-only .* GeoNames seed is not applied/), show(city)).toBe(true);
    expect(has(city, "PASS", /Columbus, OH: 2 rows, 0 in Georgia/), show(city)).toBe(true);
  });

  it("a banned word in a served sentence FAILs (positive control on the list read from the source)", () => {
    const { lines } = run(GOOD({ other: answer({ notes: ["You have a good chance at these."] }) }));
    expect(has(lines, "FAIL", /served match sentences hold none of the \d+ banned patterns: \["You have a good chance/), show(lines)).toBe(true);
  });

  it("31 calls and no 429 FAIL: the bucket is not enforced", () => {
    const { lines, calls } = run([...BASE, ...profiles({ after: { match: `^POST ${FN}\\t`, headers: H, body: answer() } })]);
    expect(has(lines, "FAIL", /31 matches from this network in one hour and no 429/), show(lines)).toBe(true);
    expect(profilePosts(calls)).toHaveLength(31);
  });

  it("a 429 without the bucket's shape FAILs; the board meter refusing first is INFO", () => {
    const wrong = run([...BASE, ...profiles({ okCalls: 12, after: { match: `^POST ${FN}\\t`, status: 429, headers: H, body: JSON.stringify({ error: "rate_limited", limit: 60, scope: "address" }) } })]).lines;
    expect(has(wrong, "FAIL", /-> 429 rate_limited limit 60 scope address, Retry-After absent/), show(wrong)).toBe(true);
    const board = run([...BASE, ...profiles({ okCalls: 12, after: { match: `^POST ${FN}\\t`, status: 429, headers: H, body: JSON.stringify({ error: "board_budget", code: "address", limit: 10000, used: 10000 }) } })]).lines;
    expect(has(board, "INFO", /refused by the board meter first \(code address\)/), show(board)).toBe(true);
    const down = run([...BASE, ...profiles({ okCalls: 12, after: { match: `^POST ${FN}\\t`, status: 503, headers: H, body: JSON.stringify({ error: "limiter_unavailable" }) } })]).lines;
    expect(has(down, "FAIL", /call 14 -> 503 limiter_unavailable/), show(down)).toBe(true);
  });

  it("a bucket spent by an earlier run: the timings are INFO and the 429 is judged at once", () => {
    const { lines, calls } = run([...BASE, ...profiles({ okCalls: 4 })]);
    expect(has(lines, "INFO", /only 5 of 10 timed matches answered: this network spent its 30 an hour/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /wall p50/), show(lines)).toBe(false);
    expect(has(lines, "PASS", /call \d+ of this run -> 429 rate_limited limit 30 scope network/), show(lines)).toBe(true);
    expect(profilePosts(calls)).toHaveLength(10);
  });
});
