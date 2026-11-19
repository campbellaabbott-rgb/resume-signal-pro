// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE OD16 FEDERAL SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS BEFORE THE
 * DEPLOY, AND NEVER WRITES (scripts/verify-deploy.d/99zzzzzzzzzz-api4-od16-federal.sh).
 *
 * Run against a fake curl that answers from routes (matched on the method,
 * the URL, any body and which key the call carried) and logs every call:
 *   - before the deploy (today's live answers: public-api.2026-11-18.2 and
 *     agent-mcp.2026-11-18.2, usajobs withheld) every line is INFO, and no
 *     keyed or keyless call is spent, with or without a key;
 *   - with only one of the two builds serving, still INFO;
 *   - after a good deploy every claim passes (FED0 to FED5), and a later
 *     build passes too;
 *   - after the deploy each broken claim fails: usajobs still withheld, a
 *     row without who_may_apply, USAJOBS credited as the employer, no OPM
 *     credit, a first sighting handed on, an id served without its statement,
 *     a federal card with a posting date, a SmartRecruiters posting handed
 *     on, and the federal feed still refused;
 *   - a page with no labelled row yet is INFO, not FAIL;
 *   - every call is an OPTIONS or a GET, a job-board list read under
 *     x-rb-budget: probe, or (only with VERIFY_KEYLESS_CALLS=1) a search_jobs
 *     or get_job tool call; no key is ever printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzzzzz-api4-od16-federal.sh"), "utf8");
const def = (re: RegExp, what: string) => { const m = re.exec(SCRIPT); if (!m) throw new Error(`no ${what} in the verifier`); return m[0]; };
const BUILD_GE = def(/^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge");
const J_FN = def(/^J\(\) \{.*\}$/m, "J");
const MC_FN = def(/^MC\(\) \{.*\}$/m, "MC");
const KEY = "pk_test_SECRET_marker_od16_federal";
const FRESH = "rb_live_FRESH_marker_od16_federal";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

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
const who=!auth?"NONE":auth===process.env.VD_K?"ANON":auth===process.env.VD_FRESH?"FRESH":"OTHER";
const budget=(H.find((h)=>/^x-rb-budget:/i.test(h))||"").replace(/^x-rb-budget:\\s*/i,"");
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+" WHO:"+who+(budget?" BUDGET:"+budget:"")+(data!==null?" DATA:"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?" "+data:"")+" WHO:"+who;
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,r.body??"");else if(!o)out+=r.body??"";
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], opts: { fresh?: boolean; keyless?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vdod16-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua; RB=rb_live_REVOKED\n${BUILD_GE}\n${J_FN}\n${MC_FN}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VD_K: KEY, VD_FRESH: FRESH,
  };
  delete env.RB_API_KEY_FRESH;
  delete env.VERIFY_KEYLESS_CALLS;
  if (opts.fresh) env.RB_API_KEY_FRESH = FRESH;
  if (opts.keyless) env.VERIFY_KEYLESS_CALLS = "1";
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

// ── the world, before and after ─────────────────────────────────────────────

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const P = "https://p.supabase.co";
const PA = `${P}/functions/v1/public-api`;
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const OPM = "Not an official copy; resumebooster.work is not operated, sponsored, approved or endorsed by OPM.";
const SR_ID = "smartrecruiters:acme1:744000012345";
const IDS = { a: "usajobs:usajobs:850123456", b: "usajobs:usajobs:850123457", held: "usajobs:usajobs:881700001" };

const fedRow = (id: string, company: string, extra: Record<string, unknown> = {}) => ({
  id, source: "usajobs", company_token: "usajobs", company, title: "Transportation Security Officer", posted_at: ago(60 * 24),
  first_seen: null, closes_at: ago(-60 * 24 * 20), who_may_apply: "United States Citizens", hiring_paths: ["public"],
  federal: { agency: company, official_url: `https://www.usajobs.gov/job/${id.split(":")[2]}`, on_board_since: ago(60 * 24 * 12), open_until: "Open until the agency's closing date (closes_at).", notice: OPM },
  ...extra,
});

type World = {
  apiBuild: string; mcpBuild: string;
  index: Record<string, unknown>;
  page: [number, Record<string, unknown>];
  one: Record<string, [number, Record<string, unknown>]>;
  search: Record<string, unknown>;
  srJob: Record<string, unknown>;
};

const GOOD = (): World => ({
  apiBuild: "public-api.2026-11-19.1",
  mcpBuild: "agent-mcp.2026-11-19.1",
  index: {
    apiVersion: "2026-11-19.1",
    restrictions: { excludedSources: ["smartrecruiters"], reason: "One hiring system is shown on resumebooster.work but is not available through this API: SmartRecruiters." },
    federal: { notice: OPM, gate: "A U.S. federal announcement is served only once the agency's who-may-apply statement (who_may_apply) is stored." },
  },
  page: [200, {
    apiVersion: "2026-11-19.1",
    meta: { attribution: { required: true, federal: { source: "usajobs", notice: OPM, officialSite: "https://www.usajobs.gov", retrievedAt: ago(45) } } },
    data: [fedRow(IDS.a, "Transportation Security Administration"), fedRow(IDS.b, "Veterans Health Administration")],
  }],
  one: {
    // Asked for only when the page did not serve them.
    [IDS.a]: [200, { data: { id: IDS.a, who_may_apply: "United States Citizens" } }],
    [IDS.b]: [200, { data: { id: IDS.b, who_may_apply: "United States Citizens" } }],
    [IDS.held]: [404, { error: { code: "not_found", message: "No live posting with that id. A U.S. federal announcement that is still open is also absent until the agency's statement of who may apply to it is stored." } }],
  },
  search: {
    jobs: [
      { id: IDS.a, company: "Transportation Security Administration", title: "Transportation Security Officer", federal: { whoMayApply: "United States Citizens", notice: OPM } },
      { id: "greenhouse:acme:1", company: "Acme", title: "Security Officer", postedAt: ago(600) },
    ],
    federalAttribution: { notice: OPM, retrievedAt: ago(45) },
  },
  srJob: { id: SR_ID, job: null, restricted: true, note: "One hiring system is shown on resumebooster.work but not handed on by this connector: SmartRecruiters." },
});

const BEFORE = (): World => ({
  ...GOOD(),
  apiBuild: "public-api.2026-11-18.2",
  mcpBuild: "agent-mcp.2026-11-18.2",
  index: { apiVersion: "2026-10-11.1", restrictions: { excludedSources: ["usajobs", "smartrecruiters"], reason: "Two hiring systems..." } },
  page: [451, { error: { code: "source_not_redistributable", message: "withheld" } }],
});

const BOARD_FED = { jobs: [IDS.a, IDS.b, IDS.held].map((id) => ({ id, source: "usajobs", token: "usajobs" })), total: 3 };
const BOARD_SR = { jobs: [{ id: SR_ID, source: "smartrecruiters", token: "acme1" }], total: 1 };
const mcpResult = (sc: Record<string, unknown>) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: false, structuredContent: sc, content: [{ type: "text", text: JSON.stringify(sc) }] } });

function routes(w: World): Route[] {
  const r: Route[] = [
    { match: `^OPTIONS ${esc(PA)}/v1 `, headers: { "x-fn-build": w.apiBuild } },
    { match: `^OPTIONS ${esc(P)}/functions/v1/agent-mcp `, headers: { "x-fn-build": w.mcpBuild } },
    { match: `^GET ${esc(PA)}/v1 WHO:NONE$`, body: JSON.stringify(w.index) },
    { match: `^GET ${esc(PA)}/v1/jobs\\?source=usajobs&limit=25 WHO:FRESH$`, status: w.page[0], body: JSON.stringify(w.page[1]) },
    { match: `^GET ${esc(PA)}/v1/companies\\?q=usajobs&limit=1 WHO:FRESH$`, body: JSON.stringify({ data: [], federalAgencies: { agencies: [{ company: "Transportation Security Administration", open_postings: 4100 }, { company: "Veterans Health Administration", open_postings: 2200 }], complete: true, asOf: ago(20) } }) },
    { match: `^POST ${esc(P)}/functions/v1/job-board \\{"action":"list","vendor":"usajobs","limit":40\\} WHO:ANON$`, body: JSON.stringify(BOARD_FED) },
    { match: `^POST ${esc(P)}/functions/v1/job-board \\{"action":"list","vendor":"smartrecruiters","limit":1\\} WHO:ANON$`, body: JSON.stringify(BOARD_SR) },
    { match: `^POST ${esc(P)}/functions/v1/agent-mcp .*"name":"search_jobs"`, body: mcpResult(w.search) },
    { match: `^POST ${esc(P)}/functions/v1/agent-mcp .*"name":"get_job"`, body: mcpResult(w.srJob) },
  ];
  for (const [id, [status, body]] of Object.entries(w.one)) {
    r.unshift({ match: `^GET ${esc(PA)}/v1/jobs/${esc(id)} WHO:FRESH$`, status, body: JSON.stringify(body) });
  }
  return r;
}

const verdicts = (lines: string[], v: "PASS" | "FAIL" | "INFO") => lines.filter((l) => l.startsWith(`${v}  `));
const has = (lines: string[], v: "PASS" | "FAIL" | "INFO", id: string) => lines.some((l) => l.startsWith(`${v}  ${id} `));

/** Every call the section made is a read: an OPTIONS or GET, a probe-budget board list, or (asked for) a reading tool call. */
function writes(calls: string[]): string[] {
  return calls.filter((c) => {
    if (/^(OPTIONS|GET) /.test(c)) return false;
    if (/^POST https:\/\/p\.supabase\.co\/functions\/v1\/job-board WHO:ANON BUDGET:probe DATA:\{"action":"list",/.test(c)) return false;
    if (/^POST https:\/\/p\.supabase\.co\/functions\/v1\/agent-mcp WHO:NONE DATA:\{"jsonrpc":"2\.0","id":\d+,"method":"tools\/call","params":\{"name":"(search_jobs|get_job)"/.test(c)) return false;
    return true;
  });
}

describe("before the deploy: INFO only, and nothing spent", () => {
  for (const [label, opts] of [["no key, no keyless calls", {}], ["a fresh key and keyless calls asked for", { fresh: true, keyless: true }]] as const) {
    it(`today's live answers print INFO and no FAIL or PASS (${label})`, () => {
      const r = run(routes(BEFORE()), opts);
      expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
      expect(verdicts(r.lines, "PASS"), r.out).toEqual([]);
      expect(has(r.lines, "INFO", "FED0")).toBe(true);
      expect(r.lines.some((l) => /^INFO  FED1 .*\["usajobs","smartrecruiters"\]/.test(l))).toBe(true);
      // No keyed /v1 call, no board read, no tool call.
      expect(r.calls.filter((c) => !/^OPTIONS /.test(c) && !/^GET https:\/\/p\.supabase\.co\/functions\/v1\/public-api\/v1 WHO:NONE$/.test(c)), r.calls.join("\n")).toEqual([]);
    });
  }

  it("one of the two builds serving is still INFO, and still spends nothing", () => {
    const r = run(routes({ ...GOOD(), mcpBuild: "agent-mcp.2026-11-18.2" }), { fresh: true, keyless: true });
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    expect(has(r.lines, "INFO", "FED0")).toBe(true);
    expect(r.calls.some((c) => /WHO:FRESH|agent-mcp WHO:NONE DATA|job-board/.test(c))).toBe(false);
  });
});

describe("after a good deploy every claim passes", () => {
  it("FED0 to FED5 pass with a key and keyless calls, the count is INFO, and nothing FAILs", () => {
    const r = run(routes(GOOD()), { fresh: true, keyless: true });
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    for (const id of ["FED0", "FED1", "FED2", "FED3", "FED4", "FED5"]) expect(has(r.lines, "PASS", id), `${id}\n${r.out}`).toBe(true);
    expect(r.lines.filter((l) => l.startsWith("PASS  FED1 "))).toHaveLength(2);
    expect(r.lines.filter((l) => l.startsWith("PASS  FED5 "))).toHaveLength(2);
    expect(r.lines.some((l) => /^INFO  FED count 6,300 labelled federal rows served across 2 agencies .*18,505/.test(l)), r.out).toBe(true);
    // FED4 asked about the id the page did not serve, and only that one.
    expect(r.calls.filter((c) => /\/v1\/jobs\/usajobs:/.test(c))).toEqual([`GET ${PA}/v1/jobs/${IDS.held} WHO:FRESH`]);
  });

  it("a later build on either function passes FED0 as well", () => {
    const r = run(routes({ ...GOOD(), apiBuild: "public-api.2026-11-21.3", mcpBuild: "agent-mcp.2026-12-02.1" }), { fresh: true });
    expect(has(r.lines, "PASS", "FED0"), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("without a key or keyless calls the live section says what it skipped, and fails nothing", () => {
    const r = run(routes(GOOD()));
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    expect(r.lines.some((l) => /^INFO  FED2, FED3, FED4 .*RB_API_KEY_FRESH/.test(l))).toBe(true);
    expect(r.lines.some((l) => /^INFO  FED5 .*VERIFY_KEYLESS_CALLS=1/.test(l))).toBe(true);
    expect(r.calls.some((c) => /WHO:FRESH|agent-mcp WHO:NONE DATA/.test(c))).toBe(false);
  });

  it("a page with no labelled row yet is INFO for FED2 and FED3, not FAIL", () => {
    const w = GOOD();
    w.page = [200, { apiVersion: "2026-11-19.1", data: [] }];
    const r = run(routes(w), { fresh: true });
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    expect(has(r.lines, "INFO", "FED2")).toBe(true);
    expect(has(r.lines, "INFO", "FED3")).toBe(true);
  });
});

describe("after the deploy each broken claim fails", () => {
  const broken: Array<[string, string, (w: World) => void]> = [
    ["FED1", "usajobs still withheld", (w) => { w.index = { ...w.index, restrictions: { excludedSources: ["usajobs", "smartrecruiters"], reason: "x" } }; }],
    ["FED1", "no federal block in the index", (w) => { const { federal: _f, ...rest } = w.index; w.index = rest; }],
    ["FED2", "the federal feed still refused", (w) => { w.page = [451, { error: { code: "source_not_redistributable", message: "withheld" } }]; }],
    ["FED2", "a row without who_may_apply", (w) => { (w.page[1].data as Array<Record<string, unknown>>)[1].who_may_apply = null; }],
    ["FED2", "USAJOBS credited as the employer", (w) => { const row = (w.page[1].data as Array<Record<string, unknown>>)[0]; row.company = "USAJOBS"; (row.federal as Record<string, unknown>).agency = "USAJOBS"; }],
    ["FED2", "no OPM credit in the body", (w) => { delete w.page[1].meta; }],
    ["FED2", "no retrieval date in the credit", (w) => { ((w.page[1].meta as Record<string, Record<string, Record<string, unknown>>>).attribution.federal).retrievedAt = null; }],
    ["FED2", "an official link off usajobs.gov", (w) => { ((w.page[1].data as Array<Record<string, unknown>>)[0].federal as Record<string, unknown>).official_url = "https://jobs.example/850123456"; }],
    ["FED3", "our first sighting handed on as first_seen", (w) => { (w.page[1].data as Array<Record<string, unknown>>)[0].first_seen = ago(60 * 24 * 12); }],
    ["FED3", "an age field on the row", (w) => { (w.page[1].data as Array<Record<string, unknown>>)[0].posted_days_ago = 3; }],
    ["FED4", "an unlabelled id served without its statement", (w) => { w.one[IDS.held] = [200, { data: { id: IDS.held, who_may_apply: null } }]; }],
    ["FED4", "a 404 that says nothing about who may apply", (w) => { w.one[IDS.held] = [404, { error: { code: "not_found", message: "No live posting with that id." } }]; }],
    ["FED5", "a federal card with a posting date", (w) => { (w.search.jobs as Array<Record<string, unknown>>)[0].postedAt = ago(600); }],
    ["FED5", "a federal card without who may apply", (w) => { (w.search.jobs as Array<Record<string, unknown>>)[0].federal = { notice: OPM }; }],
    ["FED5", "no OPM credit on the search", (w) => { delete w.search.federalAttribution; }],
    ["FED5", "a SmartRecruiters posting handed on", (w) => { w.srJob = { id: SR_ID, job: { id: SR_ID, title: "Engineer" } }; }],
  ];
  for (const [id, what, breakIt] of broken) {
    it(`${id} fails on ${what}`, () => {
      const w = GOOD();
      breakIt(w);
      const r = run(routes(w), { fresh: true, keyless: true });
      expect(has(r.lines, "FAIL", id), r.out).toBe(true);
      // Only the broken claim fails.
      expect(verdicts(r.lines, "FAIL").every((l) => l.startsWith(`FAIL  ${id} `)), r.out).toBe(true);
    });
  }
});

describe("the section never writes and never prints a key", () => {
  it("every call is a read, a probe-budget board list, or a reading tool call asked for", () => {
    for (const w of [BEFORE(), GOOD()]) {
      for (const opts of [{}, { fresh: true }, { fresh: true, keyless: true }]) {
        const r = run(routes(w), opts);
        expect(writes(r.calls), r.calls.join("\n")).toEqual([]);
        expect(r.out).not.toContain(KEY);
        expect(r.out).not.toContain(FRESH);
      }
    }
  });

  it("TEETH: the call filter catches a write the section never makes", () => {
    expect(writes([`POST ${P}/rest/v1/rpc/api_key_issue WHO:ANON DATA:{}`])).toHaveLength(1);
    expect(writes([`POST ${P}/functions/v1/job-board WHO:ANON DATA:{"action":"refresh"}`])).toHaveLength(1);
    expect(writes([`POST ${P}/functions/v1/agent-mcp WHO:NONE DATA:{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"apply_for_me"}}`])).toHaveLength(1);
  });

  it("the section name sorts after every other section, so it reads last", () => {
    const names = ["99zzzzzzz-bugs-public-api.sh", "99zzzzzzz-hotfix-nb1.sh", "99zzzzzzzzzz-api4-od16-federal.sh"];
    expect([...names].sort()).toEqual(names);
    expect([...names].sort((a, b) => a.localeCompare(b, "en-US"))).toEqual(names);
  });
});
