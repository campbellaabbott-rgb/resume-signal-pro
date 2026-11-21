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
 *   - FED6, the site's AI line in the live llms.txt: naming USAJOBS among
 *     what stays on the website passes (INFO before the deploy), and says
 *     when it may stop; counting the federal postings fails before the
 *     deploy, and after it unless the labelled rows are at the board's
 *     federal count;
 *   - FED7, the /v1/jobs coverage note: the old promise that every row is
 *     live in the employer's feed fails; FED8, the change feed: a body
 *     without federalCoverage fails, and so do a federal closure served raw
 *     (first_seen kept, no federal block), a federal row with no credit in
 *     the body and a credit with no retrieval date; a page with no federal
 *     row is INFO for the shape and never a pass of it;
 *   - FED9, the /agents bake: saying federal announcements are handed on
 *     before OD16 serves fails (the site published ahead of the functions);
 *     the old wording is INFO in both states, never a pass;
 *   - every call is an OPTIONS or a GET (the site's llms.txt, homepage and
 *     /agents among them), a job-board list read under
 *     x-rb-budget: probe, or (only with VERIFY_KEYLESS_CALLS=1) a search_jobs
 *     or get_job tool call; no key is ever printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MCP_WITHHELD_NOTE } from "../config/mcp-tools";

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
  /** The live llms.txt and the homepage bake, for FED6. */
  llms: string; home: string;
  /** The /agents bake, for FED9. */
  agents: string;
  index: Record<string, unknown>;
  page: [number, Record<string, unknown>];
  /** The change-feed page, for FED8. */
  changes: [number, Record<string, unknown>];
  one: Record<string, [number, Record<string, unknown>]>;
  search: Record<string, unknown>;
  srJob: Record<string, unknown>;
};

/** The AI line as the site prints it: every federal posting subtracted and named (FEDERAL_ROWS_IN_REACH false). */
const LLMS_HELD = "- [Connect your agent](https://resumebooster.work/agents): Your AI searches 908,491 of the 998,218 open postings: USAJOBS and SmartRecruiters postings (89,727) stay on this website. Counted 8 Nov 2026, 09:52 UTC. MCP server address ...";
/** The line once the flag flips: the federal postings counted as searchable. */
const LLMS_COUNTED = "- [Connect your agent](https://resumebooster.work/agents): Your AI searches 926,285 of the 998,218 open postings: SmartRecruiters postings (71,933) stay on this website. Counted 8 Nov 2026, 09:52 UTC. MCP server address ...";
/** The homepage bake's hiring-system table, with the board's federal count. */
const homeWith = (federal: number) => `<table><tr><td class="py-1.5">Workday</td><td class="py-1.5 text-right">400,000</td></tr><tr><td class="py-1.5">USAJOBS <span class="text-muted-foreground">(the federal government&#39;s listing site)</span></td><td class="py-1.5 text-right">${federal.toLocaleString("en-US")}</td></tr></table>`;

/** coverage.note as public-api 2026-11-19.1 says it (COVERAGE_NOTE), and as every build before it did. */
const NOTE_NEW = "Only postings still live in the employer's own feed within the last 30 days, except U.S. federal announcements (source usajobs): one read of that feed returns at most 10,000 of them, so our last read may not have listed a federal row, and each is open until the agency's closing date (closes_at) unless the agency withdraws it sooner. Withdrawn postings are excluded, never re-dated.";
const NOTE_OLD = "Only postings still live in the employer's own feed within the last 30 days. Withdrawn postings are excluded, never re-dated.";
const FED_COVERAGE = {
  opened: "A U.S. federal announcement (source usajobs) is in opened[] only once the agency's who-may-apply statement is stored, and opened[] is keyed on first_seen. So an announcement whose statement was stored after a sync's cursor passed its first_seen never appears in opened[].",
  closed: "closed[] carries every U.S. federal closure, including announcements never handed on for want of a who-may-apply statement.",
};
/** A federal closure as /v1/changes shapes it (v1Closure): no first_seen, the federal block. */
const fedClosure = (extra: Record<string, unknown> = {}) => ({
  event_id: 7001, posting_id: "usajobs:usajobs:881700002", source: "usajobs", company_token: "usajobs", company: "Veterans Health Administration",
  title: "Police Officer", category: "security", first_seen: null, posted_at: ago(60 * 24 * 9), closed_at: ago(60 * 20), superseded: false, absence_basis: null,
  outcome: "closed", suspectBatch: false, closedAtIsObservation: false,
  federal: { agency: "Veterans Health Administration", official_url: "https://www.usajobs.gov/job/881700002", on_board_since: ago(60 * 24 * 9), notice: OPM },
  ...extra,
});
const GH_CLOSURE = { event_id: 7002, posting_id: "greenhouse:acme:9", source: "greenhouse", company_token: "acme", company: "Acme", title: "Nurse", first_seen: ago(60 * 24 * 12), closed_at: ago(60 * 19), outcome: "closed" };
const GH_OPENED = { id: "greenhouse:acme:1", source: "greenhouse", company_token: "acme", company: "Acme", title: "Security Officer", first_seen: ago(60 * 30), who_may_apply: null };
const changesWith = (opened: unknown[], closed: unknown[], credit: boolean): Record<string, unknown> => ({
  apiVersion: "2026-11-19.1",
  ...(credit ? { meta: { attribution: { required: true, federal: { source: "usajobs", notice: OPM, officialSite: "https://www.usajobs.gov", retrievedAt: ago(45) } } } } : {}),
  since: ago(60 * 48), opened, closed, federalCoverage: FED_COVERAGE,
});

/** The /agents bake's withheld note: as this lane publishes it (MCP_WITHHELD_NOTE), and as the live page said it on 2026-11-19. */
const AGENTS_NEW = `<html><body><h1>Connect your AI</h1><p>${MCP_WITHHELD_NOTE}</p></body></html>`;
const AGENTS_OLD = "<html><body><h1>Connect your AI</h1><p>Two hiring systems on the job board are not handed on by this server or the data API: the U.S. federal job feed, which we choose not to redistribute for now, and SmartRecruiters, withheld until SmartRecruiters (SAP) permits it.</p></body></html>";

const GOOD = (): World => ({
  apiBuild: "public-api.2026-11-19.1",
  mcpBuild: "agent-mcp.2026-11-19.1",
  llms: LLMS_HELD,
  home: homeWith(17_794),
  agents: AGENTS_NEW,
  index: {
    apiVersion: "2026-11-19.1",
    restrictions: { excludedSources: ["smartrecruiters"], reason: "One hiring system is shown on resumebooster.work but is not available through this API: SmartRecruiters." },
    federal: { notice: OPM, gate: "A U.S. federal announcement is served only once the agency's who-may-apply statement (who_may_apply) is stored." },
  },
  page: [200, {
    apiVersion: "2026-11-19.1",
    meta: { attribution: { required: true, federal: { source: "usajobs", notice: OPM, officialSite: "https://www.usajobs.gov", retrievedAt: ago(45) } } },
    data: [fedRow(IDS.a, "Transportation Security Administration"), fedRow(IDS.b, "Veterans Health Administration")],
    coverage: { freshnessWindowDays: 30, note: NOTE_NEW },
  }],
  // An opened federal row keeps first_seen here: it is the event's own stamp, never an age.
  changes: [200, changesWith([GH_OPENED, fedRow(IDS.a, "Transportation Security Administration", { first_seen: ago(60 * 20) })], [fedClosure(), GH_CLOSURE], true)],
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
  agents: AGENTS_OLD,
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
    { match: "^GET https://site\\.test/llms\\.txt WHO:NONE$", body: w.llms },
    { match: "^GET https://site\\.test/ WHO:NONE$", body: w.home },
    { match: "^GET https://site\\.test/agents WHO:NONE$", body: w.agents },
    { match: `^GET ${esc(PA)}/v1/jobs\\?source=usajobs&limit=25 WHO:FRESH$`, status: w.page[0], body: JSON.stringify(w.page[1]) },
    { match: `^GET ${esc(PA)}/v1/changes\\?since=\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z&limit=100 WHO:FRESH$`, status: w.changes[0], body: JSON.stringify(w.changes[1]) },
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
      expect(has(r.lines, "INFO", "FED6"), r.out).toBe(true);
      // No keyed /v1 call, no board read, no tool call: the keyless index and the site's own pages only.
      const SITE_READ = /^GET https:\/\/site\.test\/(llms\.txt|agents)? WHO:NONE$/;
      expect(r.lines.some((l) => /^INFO  FED9 .*withheld by our own choice, as the connector still does/.test(l)), r.out).toBe(true);
      expect(r.calls.filter((c) => !/^OPTIONS /.test(c) && !/^GET https:\/\/p\.supabase\.co\/functions\/v1\/public-api\/v1 WHO:NONE$/.test(c) && !SITE_READ.test(c)), r.calls.join("\n")).toEqual([]);
    });
  }

  it("one of the two builds serving is still INFO, and still spends nothing", () => {
    // The site is not published yet (the functions go first), so its page still says the old wording.
    const r = run(routes({ ...GOOD(), mcpBuild: "agent-mcp.2026-11-18.2", agents: AGENTS_OLD }), { fresh: true, keyless: true });
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    expect(has(r.lines, "INFO", "FED0")).toBe(true);
    expect(r.calls.some((c) => /WHO:FRESH|agent-mcp WHO:NONE DATA|job-board/.test(c))).toBe(false);
  });
});

describe("after a good deploy every claim passes", () => {
  it("FED0 to FED8 pass with a key and keyless calls, the count is INFO, and nothing FAILs", () => {
    const r = run(routes(GOOD()), { fresh: true, keyless: true });
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    for (const id of ["FED0", "FED1", "FED2", "FED3", "FED4", "FED5", "FED6", "FED7", "FED8", "FED9"]) expect(has(r.lines, "PASS", id), `${id}\n${r.out}`).toBe(true);
    // FED8 is two claims: what the feed says it cannot open, and the shape and credit of the federal rows it carries.
    expect(r.lines.filter((l) => l.startsWith("PASS  FED8 "))).toHaveLength(2);
    expect(r.lines.some((l) => /^PASS  FED8 1 federal closures .* and 1 opened federal rows/.test(l)), r.out).toBe(true);
    // One change-feed page, asked for once, with the fresh key.
    expect(r.calls.filter((c) => /\/v1\/changes\?/.test(c))).toHaveLength(1);
    // The labelled rows are far below the board's federal count: no word about flipping the line.
    expect(r.lines.some((l) => /^INFO  FED6 .*may now count them/.test(l)), r.out).toBe(false);
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
    expect(r.lines.some((l) => /^INFO  FED2, FED3, FED4, FED7, FED8 .*RB_API_KEY_FRESH/.test(l))).toBe(true);
    expect(r.lines.some((l) => /^INFO  FED5 .*VERIFY_KEYLESS_CALLS=1/.test(l))).toBe(true);
    expect(r.calls.some((c) => /WHO:FRESH|agent-mcp WHO:NONE DATA/.test(c))).toBe(false);
  });

  it("a page with no labelled row yet is INFO for FED2 and FED3, not FAIL", () => {
    const w = GOOD();
    w.page = [200, { apiVersion: "2026-11-19.1", data: [], coverage: { freshnessWindowDays: 30, note: NOTE_NEW } }];
    const r = run(routes(w), { fresh: true });
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    expect(has(r.lines, "INFO", "FED2")).toBe(true);
    expect(has(r.lines, "INFO", "FED3")).toBe(true);
    // The note is said on every page, so it is judged on an empty one too.
    expect(has(r.lines, "PASS", "FED7"), r.out).toBe(true);
  });

  it("a change-feed page with no federal row passes what it says and is INFO, never a pass, for the shape and the credit", () => {
    const w = GOOD();
    w.changes = [200, changesWith([GH_OPENED], [GH_CLOSURE], false)];
    const r = run(routes(w), { fresh: true });
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    expect(r.lines.filter((l) => l.startsWith("PASS  FED8 "))).toHaveLength(1);
    expect(r.lines.some((l) => /^INFO  FED8 .*carried no federal row/.test(l)), r.out).toBe(true);
  });

  it("a page holding only a federal closure is judged, and passes with the credit and its retrieval date", () => {
    const w = GOOD();
    w.changes = [200, changesWith([GH_OPENED], [fedClosure()], true)];
    const r = run(routes(w), { fresh: true });
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    expect(r.lines.some((l) => /^PASS  FED8 1 federal closures .* and 0 opened federal rows/.test(l)), r.out).toBe(true);
  });
});

describe("FED6: the site's AI line never counts a federal posting the AI cannot reach", () => {
  it("a site that counts the federal postings before OD16 serves fails, even before the deploy", () => {
    const r = run(routes({ ...BEFORE(), llms: LLMS_COUNTED }));
    expect(has(r.lines, "FAIL", "FED6"), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL").every((l) => l.startsWith("FAIL  FED6 ")), r.out).toBe(true);
    expect(r.lines.some((l) => /^FAIL  FED6 .*926,285 of 998,218.*the AI reaches none of them/.test(l)), r.out).toBe(true);
  });

  it("after the deploy, counting them fails while the labelled rows are short of the board's federal count", () => {
    const r = run(routes({ ...GOOD(), llms: LLMS_COUNTED, home: homeWith(18_505) }), { fresh: true });
    expect(r.lines.some((l) => /^FAIL  FED6 .*6,300 labelled of the board's 18,505.*about 12,205 above what the AI can reach/.test(l)), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL").every((l) => l.startsWith("FAIL  FED6 ")), r.out).toBe(true);
  });

  it("after the deploy, counting them passes once the labelled rows are at least 98% of the board's federal count", () => {
    const r = run(routes({ ...GOOD(), llms: LLMS_COUNTED, home: homeWith(6_400) }), { fresh: true });
    expect(has(r.lines, "PASS", "FED6"), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("counting them without a key to read the labelled rows is INFO, not a pass", () => {
    const r = run(routes({ ...GOOD(), llms: LLMS_COUNTED }));
    expect(r.lines.some((l) => /^INFO  FED6 .*RB_API_KEY_FRESH/.test(l)), r.out).toBe(true);
    expect(has(r.lines, "PASS", "FED6")).toBe(false);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("a line that still subtracts them passes, and says it may stop once the labelled rows catch up", () => {
    const r = run(routes({ ...GOOD(), home: homeWith(6_400) }), { fresh: true });
    expect(has(r.lines, "PASS", "FED6"), r.out).toBe(true);
    expect(r.lines.some((l) => /^INFO  FED6 .*6,300.*6,400.*may now count them \(set FEDERAL_ROWS_IN_REACH/.test(l)), r.out).toBe(true);
  });

  it("a site with no AI line is INFO, never a pass", () => {
    const r = run(routes({ ...GOOD(), llms: "# Resume Booster" }), { fresh: true });
    expect(r.lines.some((l) => /^INFO  FED6 .*no AI reach line/.test(l)), r.out).toBe(true);
    expect(has(r.lines, "PASS", "FED6")).toBe(false);
  });
});

describe("FED9: the site says federal announcements are handed on only while the connector hands them on", () => {
  it("the note this lane publishes is the wording the line looks for", () => {
    expect(MCP_WITHHELD_NOTE).toContain("U.S. federal announcements are handed on once");
    expect(MCP_WITHHELD_NOTE).not.toContain("which we choose not to redistribute for now");
  });

  it("a site published before the two functions fails: it says the connector hands on what it still refuses", () => {
    const r = run(routes({ ...BEFORE(), agents: AGENTS_NEW }));
    expect(r.lines.some((l) => /^FAIL  FED9 .*OD16 is not serving \(FED0\).*Publish the site after public-api and agent-mcp/.test(l)), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL").every((l) => l.startsWith("FAIL  FED9 ")), r.out).toBe(true);
  });

  it("one of the two builds serving is not enough: the published note still fails", () => {
    const r = run(routes({ ...GOOD(), mcpBuild: "agent-mcp.2026-11-18.2" }));
    expect(has(r.lines, "FAIL", "FED9"), r.out).toBe(true);
  });

  it("after the functions and before the site publish, the old wording is INFO and says what it waits for", () => {
    const r = run(routes({ ...GOOD(), agents: AGENTS_OLD }), { fresh: true });
    expect(r.lines.some((l) => /^INFO  FED9 .*waits for the frontend publish/.test(l)), r.out).toBe(true);
    expect(has(r.lines, "PASS", "FED9")).toBe(false);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("a bake with neither wording is INFO, never a pass", () => {
    const r = run(routes({ ...GOOD(), agents: "<html><body>Connect your AI</body></html>" }), { fresh: true });
    expect(r.lines.some((l) => /^INFO  FED9 .*neither federal wording/.test(l)), r.out).toBe(true);
    expect(has(r.lines, "PASS", "FED9")).toBe(false);
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
    ["FED7", "the old promise that every row is live in the employer's feed", (w) => { w.page[1].coverage = { freshnessWindowDays: 30, note: NOTE_OLD }; }],
    ["FED7", "no coverage note at all", (w) => { delete w.page[1].coverage; }],
    ["FED8", "a change feed that never says what opened[] cannot show", (w) => { delete w.changes[1].federalCoverage; }],
    ["FED8", "a federal closure served raw: our first sighting as first_seen and no federal block", (w) => { w.changes = [200, changesWith([GH_OPENED], [{ ...fedClosure(), first_seen: ago(60 * 24 * 9), federal: undefined }, GH_CLOSURE], true)]; }],
    ["FED8", "a federal closure with no link to the official announcement", (w) => { w.changes = [200, changesWith([], [fedClosure({ federal: { agency: "Veterans Health Administration", official_url: null, on_board_since: ago(600), notice: OPM } })], true)]; }],
    ["FED8", "a page whose only federal row is a closure, with no credit in the body", (w) => { w.changes = [200, changesWith([GH_OPENED], [fedClosure()], false)]; }],
    ["FED8", "a credit with no retrieval date", (w) => { ((w.changes[1].meta as Record<string, Record<string, Record<string, unknown>>>).attribution.federal).retrievedAt = null; }],
    ["FED8", "an opened federal row with no who_may_apply", (w) => { w.changes = [200, changesWith([fedRow(IDS.a, "Transportation Security Administration", { who_may_apply: null })], [], true)]; }],
    ["FED8", "the change feed answering an error", (w) => { w.changes = [500, { error: { code: "query_failed", message: "The query could not be completed." } }]; }],
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
    for (const w of [BEFORE(), GOOD(), { ...GOOD(), llms: LLMS_COUNTED }, { ...BEFORE(), agents: AGENTS_NEW }]) {
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
