// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzz CAN FAIL EVERY CLAIM IT MAKES, AND WAITS FOR WHAT IT NEEDS.
 *
 * scripts/verify-deploy.d/99zzzz-board-mcp.sh is the post-deploy proof of the
 * board-stream MCP group (S9-002, S13-103, S13-121). A PASS is worth something
 * only if a regression could have turned it into a FAIL
 * (verify-deploy.d/README.md), so the section runs here against a fake curl
 * that answers from routes and logs every call:
 *   - a good deploy prints PASS for every claim and nothing else;
 *   - each claim prints FAIL when its answer is the old behaviour or broken;
 *   - before job-board .100 no list read is made and P1-P3 are INFO; before
 *     agent-mcp.2026-11-02.1 no tool is called (K1 would spend a counted call
 *     on the old build) and M1, M2, K1 are INFO;
 *   - the key is never printed, every board call carries x-rb-budget: probe
 *     and is a list read, and the two writers are only ever asked with a GET.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 600_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-board-mcp.sh"), "utf8");
const helper = (name: string) => new RegExp(`^${name}\\(\\) \\{.*\\}$`, "m").exec(SCRIPT)?.[0] ?? "";
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_99zzzz";
const B = "https://p\\.supabase\\.co";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(x==="-A")i++;else if(["-m","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|");
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
  const dir = mkdtempSync(join(tmpdir(), "vd99zzzz-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=Googlebot-test\n${BUILD_GE}\n${helper("J")}\n${helper("R")}\n${helper("MC")}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SEARCHED: Record<string, string[]> = {
  "Austin, TX 78701": ["Austin, TX", "Austin, Texas", "Austin,TX"],
  "New York NY": ["New York, NY", "New York, New York", "New York,NY", "New York NY"],
  "Washington, D.C.": ["Washington, DC", "Washington, District of Columbia", "Washington,DC", "Washington, D.C."],
};
type Over = {
  jb?: string | null; mcp?: string | null; ep?: string | null;
  place?: Record<string, Record<string, unknown>>;
  m1?: unknown; schema?: Record<string, unknown>; prompt?: string; prompts?: string; k1?: unknown;
  codes?: Partial<Record<"v1" | "v2" | "v3" | "v4", string>>; perks?: string;
};
const rpcResult = (structuredContent: unknown) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{}" }], structuredContent } });
const codeBody = (code: string) => (code === "ROWS" ? "[]" : JSON.stringify({ code, message: code }));

function routes(o: Over = {}): Route[] {
  const jb = o.jb === undefined ? "job-board.2026-09-09.100" : o.jb;
  const mcp = o.mcp === undefined ? "agent-mcp.2026-11-02.1" : o.mcp;
  const ep = o.ep === undefined ? "employer-profiles.2026-11-02.1" : o.ep;
  const placeRoutes: Route[] = Object.entries(SEARCHED).map(([typed, terms]) => ({
    match: `^POST ${B}/functions/v1/job-board\\t\\{"action":"list","q":"software engineer","location":"${esc(typed)}","limit":1\\}`,
    body: JSON.stringify({ jobs: [{ id: "x" }], total: 96, locationExpandedFrom: typed, locationSearched: terms, ...(o.place?.[typed] ?? {}) }),
  }));
  const codes = { v1: "42501", v2: "PGRST202", v3: "42501", v4: "PGRST202", ...(o.codes ?? {}) };
  return [
    { match: `^OPTIONS ${B}/functions/v1/job-board\\t?`, status: 204, headers: jb ? { "x-fn-build": jb } : {} },
    { match: `^OPTIONS ${B}/functions/v1/agent-mcp\\t?`, status: 204, headers: mcp ? { "x-fn-build": mcp } : {} },
    { match: `^OPTIONS ${B}/functions/v1/employer-profiles\\t?`, status: 204, headers: ep ? { "x-fn-build": ep } : {} },
    ...placeRoutes,
    { match: `^POST ${B}/functions/v1/agent-mcp\\t[^\\t]*"location":"United States"`, body: rpcResult(o.m1 !== undefined ? o.m1 : { jobs: [{}], total: 1959 }) },
    { match: `^POST ${B}/functions/v1/agent-mcp\\t[^\\t]*"method":"tools/list"`, body: JSON.stringify({ result: { tools: [{ name: "search_jobs", outputSchema: { properties: o.schema ?? { jobs: {}, locationInterpreted: {} } } }] } }) },
    { match: `^POST ${B}/functions/v1/agent-mcp\\t[^\\t]*"method":"prompts/get"`, body: JSON.stringify({ result: { messages: [{ role: "user", content: { type: "text", text: o.prompt ?? "1) Call search_jobs with query = \"nurse\", location = \"Texas\", limit = 10. Show the jobs." } }] } }) },
    { match: `^POST ${B}/functions/v1/agent-mcp\\t[^\\t]*"method":"prompts/list"`, body: o.prompts ?? JSON.stringify({ result: { prompts: [{ name: "browse_jobs", arguments: [{ name: "where", description: "City, state, country or 'remote'." }] }] } }) },
    { match: `^POST ${B}/functions/v1/agent-mcp\\t[^\\t]*"offset":9000[^\\t]*\\theaders:.*Authorization: Bearer x`, body: rpcResult(o.k1 !== undefined ? o.k1 : { jobs: [], pageLimitReached: true, pageLimitNote: "A keyless search pages to offset 200." }) },
    { match: `^GET ${B}/rest/v1/rpc/employer_perk_audit_draw\\?p_perk=health&p_version=2&p_rows=1\\t`, status: 401, body: codeBody(codes.v1) },
    { match: `^GET ${B}/rest/v1/rpc/employer_perk_audit_draw\\?p_perk=health&p_rows=1\\t`, status: 404, body: codeBody(codes.v2) },
    { match: `^GET ${B}/rest/v1/rpc/employer_perk_audit_record\\?[^\\t]*p_draw_id=1&p_version=2`, status: 401, body: codeBody(codes.v3) },
    { match: `^GET ${B}/rest/v1/rpc/employer_perk_audit_record\\?p_perk=health&p_mode=launch&p_judged=60&p_correct=60&p_note=verify\\t`, status: 404, body: codeBody(codes.v4) },
    { match: `^POST ${B}/rest/v1/rpc/get_employer_perks\\t`, body: o.perks ?? JSON.stringify({ token: "ramp", perks: [], withheld: [], collision: false, expiry_days: 45, published_keys: [] }) },
  ];
}

const verdicts = (lines: string[]) => lines.filter((l) => /^(PASS|FAIL|INFO)/.test(l));
const line = (lines: string[], id: string) => lines.find((l) => l.includes(` ${id} `) || l.includes(`  ${id} `)) ?? "";

describe("a good deploy", () => {
  const r = run(routes());
  it("prints PASS for every claim and nothing else", () => {
    const v = verdicts(r.lines);
    expect(v.filter((l) => !l.startsWith("PASS")), r.out).toEqual([]);
    for (const id of ["P1", "P2", "P3", "M1", "M2", "K1", "V1", "V2", "V3", "V4", "V5"]) expect(line(v, id), `${id}\n${r.out}`).toMatch(/^PASS/);
    expect(v).toHaveLength(14);
  });

  it("never prints the key; every board call is a probe list read; the writers are asked only with a GET", () => {
    expect(r.out).not.toContain(KEY);
    const board = r.calls.filter((c) => c.includes("/functions/v1/job-board"));
    expect(board.filter((c) => !c.startsWith("OPTIONS")).every((c) => c.includes('"action":"list"') && c.includes("x-rb-budget: probe"))).toBe(true);
    const writers = r.calls.filter((c) => /employer_perk_audit_(draw|record)/.test(c));
    expect(writers).toHaveLength(4);
    expect(writers.every((c) => c.startsWith("GET "))).toBe(true);
  });
});

describe("each claim can FAIL", () => {
  it.each([
    ["P1", { place: { "Austin, TX 78701": { locationSearched: ["Austin, TX 78701"], locationExpandedFrom: null } } }],
    ["P1", { place: { "Austin, TX 78701": { total: 0 } } }],
    ["P2", { place: { "New York NY": { locationSearched: ["New York, NY", "New York, New York", "New York,NY"] } } }],
    ["P3", { place: { "Washington, D.C.": { locationSearched: ["Washington, D.C."], locationExpandedFrom: null } } }],
    ["M1", { m1: { jobs: [{}], total: 6550, locationReadAs: { sent: "United States", country: "US" } } }],
    ["M1", { m1: { jobs: [], total: 0 } }],
    ["M2", { schema: { jobs: {}, locationInterpreted: {}, locationReadAs: {} } }],
    ["M2", { prompt: "1) Call search_jobs with query = \"nurse\", location = \"Texas\", limit = 10; a place that is only a country goes in country as its ISO-2 code instead, and only 'remote' as remote = true." }],
    ["M2", { prompts: JSON.stringify({ result: { prompts: [{ name: "browse_jobs", arguments: [{ name: "where", description: "A city, state or metro (e.g. 'Austin, TX'), a country, or 'remote'." }] }] } }) }],
    ["K1", { k1: { jobs: [{ id: "x" }], total: 12000 } }],
    ["V1", { codes: { v1: "PGRST202" } }],
    ["V1", { codes: { v1: "25006" } }],
    ["V2", { codes: { v2: "42501" } }],
    ["V3", { codes: { v3: "PGRST202" } }],
    ["V4", { codes: { v4: "42501" } }],
    ["V5", { perks: "[]" }],
    ["V5", { perks: "<html>gateway</html>" }],
  ] as Array<[string, Over]>)("%s", (id, over) => {
    const r = run(routes(over));
    expect(line(verdicts(r.lines), id), r.out).toMatch(/^FAIL/);
  });

  it("an employer-profiles build that still calls the removed signatures FAILs, and so does a missing one", () => {
    expect(run(routes({ ep: "employer-profiles.2026-10-12.2" })).lines.some((l) => /^FAIL  employer-profiles preflight x-fn-build = employer-profiles\.2026-10-12\.2/.test(l))).toBe(true);
    expect(run(routes({ ep: null })).lines.some((l) => /^FAIL  employer-profiles preflight carries no x-fn-build/.test(l))).toBe(true);
  });
});

describe("what waits for what", () => {
  it("before job-board .100, P1-P3 are INFO and no list read is made", () => {
    const r = run(routes({ jb: "job-board.2026-09-09.98" }));
    expect(r.lines.some((l) => /^INFO  P1-P3 wait for job-board 2026-09-09\.100/.test(l))).toBe(true);
    expect(r.lines.some((l) => /^(PASS|FAIL)  P[123] /.test(l))).toBe(false);
    expect(r.calls.filter((c) => c.includes("/functions/v1/job-board") && !c.startsWith("OPTIONS"))).toEqual([]);
  });

  it("before agent-mcp.2026-11-02.1, M1, M2 and K1 are INFO and no tool is called", () => {
    const r = run(routes({ mcp: "agent-mcp.2026-10-11.38" }));
    expect(r.lines.some((l) => /^INFO  M1, M2 and K1 wait for agent-mcp\.2026-11-02\.1/.test(l))).toBe(true);
    expect(r.lines.some((l) => /^(PASS|FAIL)  (M[12]|K1) /.test(l))).toBe(false);
    expect(r.calls.filter((c) => c.includes("/functions/v1/agent-mcp") && !c.startsWith("OPTIONS"))).toEqual([]);
  });
});
