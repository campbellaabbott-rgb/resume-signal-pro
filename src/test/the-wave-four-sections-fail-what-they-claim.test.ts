// @vitest-environment node
/**
 * THE WAVE-4 VERIFY SECTIONS FAIL WHAT THEY CLAIM.
 *
 * scripts/verify-deploy.d/82, 84, 85 and 86 are what the owner reads after
 * the wave-4 deploy: the keyless surface, applying yourself, the allowance
 * and the protocol fixes, and job-board .93. A PASS is worth something only
 * if a regression could have turned it into a FAIL (verify-deploy.d/README),
 * so each section runs here in bash against a fake curl, with the real J, R,
 * MC, probe and build_ge cut from the verifier, and:
 *   - a healthy deploy is all PASS. The free connector answers (initialize,
 *     tools/list as each caller, prompts/list, the guide, the preflight, a
 *     null body, the protected-resource document, board_stats, a counted
 *     search and a malformed id) are the REAL agent-mcp handler's, run here
 *     with only its network faked, so the sections are judged against what
 *     the shipped server says rather than against a copy of it;
 *   - each claim's regression reads FAIL (or INFO where the section cannot
 *     judge), and an older bundle is never asked to spend a lookup.
 * Sections 73, 73w and the 5n block were written for the wave-3 agent; with a
 * wave-4 build serving they judge what replaced it instead of failing on it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const section = (f: string) => readFileSync(resolve(ROOT, "scripts/verify-deploy.d", f), "utf8");
const cut = (re: RegExp, what: string) => { const m = re.exec(SCRIPT); if (!m) throw new Error(`${what} is gone from verify-deploy.sh`); return m[0]; };
const HELPERS = [
  cut(/^J\(\) \{.*\}$/m, "J"),
  cut(/^R\(\) \{.*\}$/m, "R"),
  cut(/^MC\(\) \{.*\}$/m, "MC"),
  cut(/^probe\(\) \{[\s\S]*?esac; \}$/m, "probe"),
  cut(/^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge"),
].join("\n");

// ── the fake curl: routes on method, URL, user agent and body ───────────────
const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null,ua="";
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-A")ua=a[++i];else if(["-H","-m"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const key=method+" "+url+" ua="+ua+(data!==null?" "+data:"");
fs.appendFileSync(process.env.VD_CALLS,key+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st)).replace(/\\\\n/g,"\\n");
process.stdout.write(out);
`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(files: string[], routes: Route[], opts: { rb?: string } = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-w4-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=pk_test; RB=${JSON.stringify(opts.rb ?? "")}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${HELPERS}\n`;
  const body = files.map((f) => section(f)).join("\n");
  writeFileSync(join(dir, "run.sh"), prelude + body.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 110_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l));
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => `\n${lines.join("\n")}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── the real connector, its network faked ───────────────────────────────────
let handler: EdgeHandler;
const MCP = "https://p.supabase.co/functions/v1/agent-mcp";
const real: Record<string, { status: number; headers: Record<string, string>; body: string }> = {};

function chain(result: unknown): unknown {
  const p: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(result).then(ok, no);
      if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(result);
      return () => p;
    },
  });
  return p;
}

async function callReal(name: string, init: { method?: string; body?: string; ua?: string; path?: string }) {
  const res = await handler(new Request(`https://harness.supabase.co/functions/v1/agent-mcp${init.path ?? ""}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "203.0.113.7",
      ...(init.ua ? { "user-agent": init.ua } : {}),
      ...(init.method === "OPTIONS" ? { origin: "https://claude.ai", "access-control-request-method": "POST" } : {}),
    },
    ...(init.body !== undefined ? { body: init.body } : {}),
  }));
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  real[name] = { status: res.status, headers, body: await res.text() };
}
const rpcBody = (method: string, params: Record<string, unknown> = {}) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
const GPT_UA = "ChatGPT-User/1.0; +https://openai.com/bot";

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      return new Response(JSON.stringify({
        jobs: [
          { id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme Health", title: "Registered Nurse", location: "Austin, TX" },
          { id: "lever:beta:2", source: "lever", token: "beta", company: "Beta Care", title: "Nurse", location: "Dallas, TX" },
        ],
        total: 2, hasMore: false,
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ error_code: "feature_disabled" }), { status: 404 });
  };
  g.__mcpDb = {
    rpc: (name: string, args: Record<string, unknown>) => {
      const data = name === "mcp_anon_check_v2"
        ? { allowed: true, refused_by: null, bucket_used: 3, bucket_cap: Number(args.p_bucket_cap), share_used: 40, share_cap: Number(args.p_global_cap), overall_used: 90, overall_cap: Number(args.p_overall_cap ?? 0), minute_used: 1, minute_cap: Number(args.p_minute_cap ?? 0) }
        : null;
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r, single: () => r });
    },
    from: () => chain({ data: null, error: null }),
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
  await callReal("options", { method: "OPTIONS" });
  await callReal("init", { body: rpcBody("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-deploy-82", version: "1" } }) });
  await callReal("tools", { body: rpcBody("tools/list") });
  await callReal("toolsGpt", { body: rpcBody("tools/list"), ua: GPT_UA });
  await callReal("prompts", { body: rpcBody("prompts/list") });
  await callReal("guide", { body: rpcBody("resources/read", { uri: "resumebooster://guide" }) });
  await callReal("stats", { body: rpcBody("tools/call", { name: "board_stats", arguments: {} }) });
  await callReal("search", { body: rpcBody("tools/call", { name: "search_jobs", arguments: { query: "nurse", location: "Texas", limit: 10 } }) });
  await callReal("badid", { body: rpcBody("tools/call", { name: "fetch", arguments: { id: "not a job id" } }) });
  await callReal("null", { body: "null" });
  await callReal("prm", { method: "GET", path: "/.well-known/oauth-protected-resource" });
}, 180_000);

const fromReal = (name: string, match: string): Route => ({ match, status: real[name].status, headers: real[name].headers, body: real[name].body });
const tool = (name: string) => `^POST ${esc(MCP)} ua=[^ ]* .*"method":"tools/call".*"name":"${name}"`;
const okResult = (_sc: Record<string, unknown>, left = "97"): Record<string, string> => ({ "x-unkeyed-remaining": left });
const result = (sc: Record<string, unknown>, isError = false) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(sc) }], structuredContent: sc, isError } });
const UNKEYED = { callsLeftToday: 97, ipCap: 100, allowance: "connection", partition: "other", partitionLeftToday: 3960, partitionCap: 4000, globalLeftToday: 19910, globalCap: 20000, note: "keyless: 97 of 100 lookups left today for this connection; resets at midnight UTC" };
const FORM_UNKEYED = { callsLeftToday: 98, ipCap: 100, allowance: "connection", pool: "forms", partition: "other", globalCap: 5000 };
const GH_FORM = {
  jobId: "greenhouse:acme:1", state: "open", title: "Registered Nurse", company: "Acme Health", applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
  form: {
    source: "employer-published", vendor: "greenhouse", readAt: "2026-10-12T08:00:00Z",
    questions: [
      { n: 1, label: "First Name", required: true, type: "input_text", answeredBy: "your_details" },
      { n: 2, label: "Resume/CV", required: true, type: "input_file", answeredBy: "your_documents" },
      { n: 3, label: "Are you legally authorized to work in the US?", required: true, type: "multi_value_single_select", options: ["Yes", "No"], answeredBy: "you", topic: "authorisation" },
      { n: 4, label: "Describe a time you led a clinical team.", required: false, type: "textarea", answeredBy: "draft_from_your_cv" },
    ],
    documents: [{ name: "Resume/CV", required: true }], alsoOnForm: [],
  },
  route: { submitter: "you", needsEmployerAccount: false, captchaLikely: false, attachFilesYourself: true },
  postingTerms: ["nursing", "triage"],
  unkeyed: FORM_UNKEYED,
};
const MD = "## The posting\n\nx\n\n## Questions you answer yourself\n\nx\n\n## Questions your AI may draft from your CV\n\nx\n\n## Documents to attach\n\nx\n\n## Where to apply\n\nx";
const job = (body: string, j: Record<string, unknown>): Route => ({ match: `^POST https://p\\.supabase\\.co/functions/v1/job-board ua= .*${body}`, body: JSON.stringify(j) });
const STEPS = ["serve", "kicks", "hygiene", "sweep", "capacity", "names"];
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const finishedPassEnd = () => ({
  startedAt: ago(40), doneAt: ago(31), next: null,
  steps: Object.fromEntries(STEPS.map((s, i) => [s, { startedAt: ago(40 - i), doneAt: ago(39 - i), ms: 60_000, ok: true }])),
});

function healthy(over: Record<string, Route | null> = {}): Route[] {
  const base: Record<string, Route> = {
    "opt:mcp": fromReal("options", `^OPTIONS ${esc(MCP)} `),
    "opt:jb": { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/job-board ", headers: { "x-fn-build": "job-board.2026-09-09.93" } },
    "opt:api": { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/public-api ", headers: { "x-fn-build": "public-api.2026-10-11.2" } },
    "opt:gaa": { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/generate-application-answers ", headers: { "x-fn-build": "generate-application-answers.2026-10-11.1" } },
    "opt:gap": { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/generate-apply-package ", headers: { "x-fn-build": "generate-apply-package.2026-10-11.1" } },
    "opt:akr": { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/api-key-request ", headers: { "x-fn-build": "api-key-request.2026-10-11.1" } },
    init: fromReal("init", `^POST ${esc(MCP)} ua= .*"method":"initialize"`),
    toolsGpt: fromReal("toolsGpt", `^POST ${esc(MCP)} ua=ChatGPT.*"method":"tools/list"`),
    tools: fromReal("tools", `^POST ${esc(MCP)} ua= .*"method":"tools/list"`),
    prompts: fromReal("prompts", `^POST ${esc(MCP)} ua= .*"method":"prompts/list"`),
    guide: fromReal("guide", `^POST ${esc(MCP)} ua= .*"method":"resources/read".*guide`),
    "null": fromReal("null", `^POST ${esc(MCP)} ua= null$`),
    prm: fromReal("prm", `^GET ${esc(MCP)}/\\.well-known/oauth-protected-resource `),
    stats: fromReal("stats", tool("board_stats")),
    badid: fromReal("badid", `${tool("fetch")}.*not a job id`),
    gptSearch: { match: `^POST ${esc(MCP)} ua=ChatGPT.*"name":"search_jobs"`, body: result({ jobs: [], total: 0, unkeyed: UNKEYED }) },
    search: fromReal("search", tool("search_jobs")),
    fetch: { match: tool("fetch"), headers: okResult({}), body: result({ id: "greenhouse:acme:1", title: "Registered Nurse", text: "We are hiring a nurse.", url: "https://resumebooster.work/jobs?job=greenhouse%3Aacme%3A1", metadata: {}, unkeyed: UNKEYED }) },
    getjobs: { match: tool("get_jobs"), headers: okResult({}), body: result({ jobs: [{ id: "greenhouse:acme:1" }], unavailable: [{ id: "lever:beta:2", reason: "closed" }], requested: 2, returned: 1, unkeyed: UNKEYED }) },
    open: { match: tool("check_jobs_open"), headers: okResult({}), body: result({ open: { "greenhouse:acme:1": true, "lever:beta:2": false }, closed: ["lever:beta:2"], basis: "the board's index of what each employer's feed lists", unkeyed: UNKEYED }) },
    record: { match: tool("employer_hiring_record"), headers: okResult({}), body: result({ employers: [{ company_token: "acme", open_roles: 3 }], basis: "x", layoff_basis: "x", layoff_read: "x", unkeyed: UNKEYED }) },
    growth: { match: tool("employer_growth"), headers: okResult({}), body: result({ employers: [{ company_token: "acme", verdict: "unknown", unknown_reason: "too_small" }], bars: {}, basis: "x", unkeyed: UNKEYED }) },
    "am:md": { match: `${tool("apply_myself")}.*"format":"markdown"`, body: result({ jobId: "greenhouse:acme:1", state: "open", form: { source: "employer-published", vendor: "greenhouse" }, route: { submitter: "you" }, postingTerms: [], markdown: MD, unkeyed: FORM_UNKEYED }) },
    "am:wd": { match: `${tool("apply_myself")}.*workday:`, body: result({ jobId: "workday:tysonfoods~wd5~TSN:9", state: "open", applyUrl: "https://tysonfoods.wd5.myworkdayjobs.com/x", form: { source: "not-published", vendor: "workday", readAt: null, questions: [], documents: [], alsoOnForm: [], note: "x" }, route: { submitter: "you" }, postingTerms: [], unkeyed: FORM_UNKEYED }) },
    "am:sr": { match: `${tool("apply_myself")}.*smartrecruiters:`, body: result({ jobId: "smartrecruiters:acme:3", state: "restricted", note: "withheld", unkeyed: FORM_UNKEYED }) },
    "am:gh": { match: tool("apply_myself"), headers: { "x-unkeyed-remaining": "98" }, body: result(GH_FORM) },
    "jb:status": job('"action":"status"', { passEnd: finishedPassEnd() }),
    "jb:nolog": job('"noLog":true', { jobs: [{ id: "greenhouse:acme:1" }], total: 1 }),
    "jb:gh": job('"vendor":"greenhouse"', { jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", token: "acme" }] }),
    "jb:wd": job('"vendor":"workday"', { jobs: [{ id: "workday:tysonfoods~wd5~TSN:9", source: "workday", token: "tysonfoods~wd5~TSN" }] }),
    "jb:sr": job('"vendor":"smartrecruiters"', { jobs: [{ id: "smartrecruiters:acme:3", source: "smartrecruiters", token: "acme" }] }),
    "jb:q1": job('"q":"nurse jobs in Texas"', { jobs: [{ id: "x" }], total: 1584, intentFilters: ["location: Texas (from \"in Texas\")"] }),
    "jb:l1": job('"q":"nurse","location":"Texas"', { jobs: [{ id: "x" }], total: 1592 }),
    "jb:q2": job('"q":"software engineer jobs in new york"', { jobs: [{ id: "x" }], total: 437, intentFilters: ["location: new york (from \"in new york\")"] }),
    "jb:l2": job('"q":"software engineer","location":"new york"', { jobs: [{ id: "x" }], total: 439 }),
    "jb:name": job('"companies":\\["Humana"\\]', { jobs: [{ id: "x" }], total: 410, companiesResolved: [{ asked: "Humana", name: "Humana", tokens: ["humana~wd5~Humana_External_Career_Site"] }] }),
    "jb:nurse": job('"q":"nurse","limit":5', { jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", token: "acme" }, { id: "lever:beta:2", source: "lever", token: "beta" }], total: 2 }),
    "v1:gh": { match: "^GET https://p\\.supabase\\.co/functions/v1/public-api/v1/jobs/greenhouse:acme:1/application ", body: JSON.stringify({ form: { source: "employer-published", questions: GH_FORM.form.questions }, route: { submitter: "you" } }) },
    "v1:sr": { match: "^GET https://p\\.supabase\\.co/functions/v1/public-api/v1/jobs/smartrecruiters:acme:3/application ", status: 451, body: JSON.stringify({ error: { code: "withheld" } }) },
    rpc: { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 401, body: JSON.stringify({ code: "42501", message: "permission denied" }) },
    table: { match: "^GET https://p\\.supabase\\.co/rest/v1/", status: 401, body: JSON.stringify({ code: "42501" }) },
  };
  const merged = { ...base, ...over };
  return Object.values(merged).filter((r): r is Route => r !== null);
}
const parse = (s: string) => JSON.parse(s) as Record<string, any>;

describe("the free answers the sections read are the shipped connector's", () => {
  it("the real handler served every fixture the healthy run is built on", () => {
    for (const k of ["options", "init", "tools", "toolsGpt", "prompts", "guide", "stats", "search", "badid", "null", "prm"]) expect(real[k], k).toBeTruthy();
    expect(real.options.headers["x-fn-build"]).toMatch(/^agent-mcp\.2026-10-11\./);
    expect(parse(real.search.body).result.structuredContent.unkeyed).toMatchObject({ partition: "other", allowance: "connection", ipCap: 100, partitionCap: 4000, globalCap: 20000 });
    expect(real.search.headers["x-unkeyed-remaining"]).toBeTruthy();
    expect(real.prm.status).toBe(404);
  });
});

describe("82: the keyless surface", () => {
  it("a healthy deploy is all PASS, the six keyless lookups made once each", () => {
    const { lines, calls } = run(["82-wave4-keyless-surface.sh"], healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    for (const re of [
      /agent-mcp preflight x-fn-build = agent-mcp\.2026-10-11\./, /instructions open with search_jobs/, /six apply rules/, /no price and no Agent plan/,
      /names the ten keyless tools/, /no oauth2 scheme/, /bytes \(want 25,000 or less\)/, /four explicit boolean hints/, /no retired apply-agent tool/,
      /read as ChatGPT names no price/, /Greenhouse and Recruitee only/, /four keyless prompts/, /takes no CV argument/,
      /board_stats answers and is never counted/, /malformed id is refused in band before anything is counted/,
      /keyless search_jobs answers/, /keyless fetch answers/, /keyless get_jobs answers/, /keyless check_jobs_open answers/,
      /keyless employer_hiring_record answers/, /keyless employer_growth answers/,
    ]) expect(has(lines, "PASS", re), `${re}${show(lines)}`).toBe(true);
    const counted = ["search_jobs", "get_jobs", "check_jobs_open", "employer_hiring_record", "employer_growth"].map((n) => calls.filter((c) => c.includes(`"name":"${n}"`)).length);
    expect(counted).toEqual([1, 1, 1, 1, 1]);
  });

  it("an older bundle FAILs its build and is never asked to spend a lookup", () => {
    const { lines, calls } = run(["82-wave4-keyless-surface.sh"], healthy({ "opt:mcp": { match: `^OPTIONS ${esc(MCP)} `, headers: { "x-fn-build": "agent-mcp.2026-10-09.71" } } }));
    expect(has(lines, "FAIL", /agent-mcp preflight x-fn-build = agent-mcp\.2026-10-09\.71/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /keyless tool calls were not made/), show(lines)).toBe(true);
    expect(calls.filter((c) => c.includes('"method":"tools/call"'))).toEqual([]);
  });

  it("a list that still shows a retired tool or an oauth2 scheme, instructions that sell, and a prompt that takes a CV each FAIL", () => {
    const tools = parse(real.tools.body);
    tools.result.tools.push({ name: "request_application", title: "Apply", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }, securitySchemes: [{ type: "oauth2" }] });
    const init = parse(real.init.body);
    init.result.instructions = `${init.result.instructions} Buy the Agent Pass for $29.`;
    const prompts = parse(real.prompts.body);
    prompts.result.prompts.find((p: { name: string }) => p.name === "find_roles_for_my_cv").arguments.push({ name: "resume_text", required: false });
    const { lines } = run(["82-wave4-keyless-surface.sh"], healthy({
      tools: { match: `^POST ${esc(MCP)} ua= .*"method":"tools/list"`, body: JSON.stringify(tools) },
      init: { match: `^POST ${esc(MCP)} ua= .*"method":"initialize"`, body: JSON.stringify(init) },
      prompts: { match: `^POST ${esc(MCP)} ua= .*"method":"prompts/list"`, body: JSON.stringify(prompts) },
    }));
    for (const re of [/names the ten keyless tools/, /no oauth2 scheme/, /no retired apply-agent tool/, /no price and no Agent plan/, /takes no CV argument/]) {
      expect(has(lines, "FAIL", re), `${re}${show(lines)}`).toBe(true);
    }
  });

  it("a counted board_stats, a tool that refuses with no key, and a malformed id that was counted each FAIL", () => {
    const stats = parse(real.stats.body);
    stats.result.structuredContent.unkeyed = { ...UNKEYED };
    const { lines } = run(["82-wave4-keyless-surface.sh"], healthy({
      stats: { match: tool("board_stats"), headers: { "x-unkeyed-remaining": "96" }, body: JSON.stringify(stats) },
      getjobs: { match: tool("get_jobs"), body: result({ error: "Sign in to use this tool." }, true) },
      badid: { match: `${tool("fetch")}.*not a job id`, headers: { "x-unkeyed-remaining": "95" }, body: result({ error: "That is not a job id from this board.", unkeyed: UNKEYED }, true) },
    }));
    expect(has(lines, "FAIL", /board_stats answers and is never counted/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /keyless get_jobs answers/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /malformed id is refused in band before anything is counted/), show(lines)).toBe(true);
  });
});

describe("84: applying yourself", () => {
  it("a healthy deploy is all PASS, the keyed /v1 twin included", () => {
    const { lines } = run(["84-wave4-apply-myself.sh"], healthy(), { rb: "rb_live_test" });
    expect(fails(lines), show(lines)).toEqual([]);
    for (const re of [
      /public-api preflight x-fn-build = public-api\.2026-10-11\.2/, /generate-application-answers preflight x-fn-build = generate-application-answers\.2026-10-11\.1/,
      /generate-apply-package preflight x-fn-build = generate-apply-package\.2026-10-11\.1/,
      /returns the employer-published Greenhouse form/, /every question says who answers it/, /draft_from_your_cv \(default-deny/,
      /each choice question carries its options/, /route\.submitter is "you"/, /forms pool, never the lookups/, /five headings/,
      /Workday posting answers not-published/, /SmartRecruiters posting is restricted/, /\/v1\/jobs\/\{id\}\/application -> 200/,
      /SmartRecruiters id\}\/application -> 451/, /application_form_cache SELECT as anon -> 401/, /application_form_cache_put as anon -> 42501/,
    ]) expect(has(lines, "PASS", re), `${re}${show(lines)}`).toBe(true);
  });

  it("a choice question marked for the AI to draft, a guessed form, a lookup spent instead of a form read and a sent application each FAIL", () => {
    const bad = JSON.parse(JSON.stringify(GH_FORM));
    bad.form.questions[2].answeredBy = "draft_from_your_cv";
    bad.form.questions.push({ n: 5, label: "Pick one", required: false, type: "multi_value_single_select", answeredBy: "you" });
    bad.route.submitter = "resume-booster";
    bad.unkeyed = UNKEYED;
    const { lines } = run(["84-wave4-apply-myself.sh"], healthy({ "am:gh": { match: tool("apply_myself"), headers: { "x-unkeyed-remaining": "97" }, body: result(bad) } }));
    expect(has(lines, "FAIL", /draft_from_your_cv \(default-deny/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /each choice question carries its options/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /route\.submitter is "you"/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /forms pool, never the lookups/), show(lines)).toBe(true);

    const guessed = { ...GH_FORM, form: { ...GH_FORM.form, source: "not-published", questions: [] } };
    const g = run(["84-wave4-apply-myself.sh"], healthy({ "am:gh": { match: tool("apply_myself"), headers: { "x-unkeyed-remaining": "98" }, body: result(guessed) } })).lines;
    expect(has(g, "FAIL", /returns the employer-published Greenhouse form/), show(g)).toBe(true);
  });

  it("a generator still on the wave-3 classifier FAILs its build", () => {
    const { lines } = run(["84-wave4-apply-myself.sh"], healthy({
      "opt:gaa": { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/generate-application-answers ", headers: { "x-fn-build": "generate-application-answers.2026-10-10.62" } },
    }));
    expect(has(lines, "FAIL", /generate-application-answers preflight x-fn-build = generate-application-answers\.2026-10-10\.62/), show(lines)).toBe(true);
  });

  it("a markdown packet missing a heading, a readable cache and a callable writer FAIL; no key is INFO", () => {
    const { lines } = run(["84-wave4-apply-myself.sh"], healthy({
      "am:md": { match: `${tool("apply_myself")}.*"format":"markdown"`, body: result({ jobId: "greenhouse:acme:1", state: "open", markdown: "## The posting\n\n## Where to apply", unkeyed: FORM_UNKEYED }) },
      table: { match: "^GET https://p\\.supabase\\.co/rest/v1/application_form_cache", status: 200, body: "[]" },
      rpc: { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 400, body: JSON.stringify({ code: "25006", message: "read-only transaction" }) },
    }));
    expect(has(lines, "FAIL", /five headings/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /application_form_cache SELECT as anon -> 200/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /application_form_cache_put is CALLABLE as anon/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /RB_API_KEY missing/), show(lines)).toBe(true);
  });
});

describe("85: the allowance and the protocol fixes", () => {
  it("a healthy deploy is all PASS (run after 82, whose search it reads)", () => {
    const { lines } = run(["82-wave4-keyless-surface.sh", "85-wave4-allowance.sh"], healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    for (const re of [
      /api-key-request preflight x-fn-build = api-key-request\.2026-10-11\.1/,
      /counted as one connection in the other share/, /the day and its split/, /ChatGPT per person and without an id/, /everyone else per connection/,
      /the per-minute caps/, /the forms pool/, /the keyless page/, /guide names no price/,
      /CORS allows mcp-session-id/, /CORS exposes WWW-Authenticate/, /null JSON-RPC body answers -32600/, /protected-resource document answers 404 while sign-in is off/,
      /mcp_anon_check_v2 as anon -> 42501/, /mcp_anon_refund as anon -> 42501/, /mcp_count_call as anon -> 42501/, /api_key_fit_allowance as anon -> 42501/,
      /mcp_calls_daily SELECT as anon -> 401/, /mcp_allowance_alerts SELECT as anon -> 401/,
    ]) expect(has(lines, "PASS", re), `${re}${show(lines)}`).toBe(true);
  });

  it("a guide without the per-minute caps, a call counted in the wrong share, a null body that crashes and a PRM served while sign-in is off each FAIL", () => {
    const guide = parse(real.guide.body);
    guide.result.contents[0].text = String(guide.result.contents[0].text).replace(/- Per minute:[^\n]*\n/, "");
    const search = parse(real.search.body);
    search.result.structuredContent.unkeyed = { ...search.result.structuredContent.unkeyed, partition: "claude", ipCap: 10_000, partitionCap: 10_000 };
    const { lines } = run(["82-wave4-keyless-surface.sh", "85-wave4-allowance.sh"], healthy({
      guide: { match: `^POST ${esc(MCP)} ua= .*"method":"resources/read".*guide`, body: JSON.stringify(guide) },
      search: { match: tool("search_jobs"), headers: { "x-unkeyed-remaining": "9000" }, body: JSON.stringify(search) },
      "null": { match: `^POST ${esc(MCP)} ua= null$`, status: 500, body: "Internal Server Error" },
      prm: { match: `^GET ${esc(MCP)}/\\.well-known/oauth-protected-resource `, status: 200, body: JSON.stringify({ resource: MCP }) },
    }));
    for (const re of [/the per-minute caps/, /counted as one connection in the other share/, /null JSON-RPC body answers -32600/, /protected-resource document answers 200 while sign-in is off/]) {
      expect(has(lines, "FAIL", re), `${re}${show(lines)}`).toBe(true);
    }
  });
});

describe("86: job-board .93", () => {
  it("a healthy deploy is all PASS, with the owner's no-log SQL naming this run's nonce", () => {
    const { lines } = run(["86-wave4-job-board.sh"], healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    for (const re of [
      /job-board preflight x-fn-build = job-board\.2026-09-09\.93/, /last pass-end tail finished/, /noLog without the reader proof is answered as before/,
      /a search read as ChatGPT answers/, /"nurse jobs in Texas" returns 1584 of the location form's 1592/, /"software engineer jobs in new york" returns 437/,
      /companies:\["Humana"\] resolves by name/,
    ]) expect(has(lines, "PASS", re), `${re}${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", /job_board_search_events WHERE q = 'vdnolog\d+' must be 0/), show(lines)).toBe(true);
  });

  it("a tail with an open step past 30 minutes FAILs naming it; one in flight is INFO", () => {
    const dead = finishedPassEnd();
    delete (dead as Record<string, unknown>).doneAt;
    (dead as Record<string, unknown>).next = "sweep";
    delete (dead.steps as Record<string, Record<string, unknown>>).sweep.doneAt;
    const d = run(["86-wave4-job-board.sh"], healthy({ "jb:status": job('"action":"status"', { passEnd: dead }) })).lines;
    expect(has(d, "FAIL", /never finished: step sweep has no receipt of its own/), show(d)).toBe(true);

    const flying = { startedAt: ago(5), next: "kicks", steps: { serve: { startedAt: ago(5), doneAt: ago(4), ok: true } } };
    const f = run(["86-wave4-job-board.sh"], healthy({ "jb:status": job('"action":"status"', { passEnd: flying }) })).lines;
    expect(has(f, "INFO", /in flight/), show(f)).toBe(true);
    expect(has(f, "FAIL", /pass-end/), show(f)).toBe(false);
  });

  it("a place left in the words, a name that resolves to nothing and an older board each FAIL", () => {
    const { lines } = run(["86-wave4-job-board.sh"], healthy({
      "jb:q1": job('"q":"nurse jobs in Texas"', { jobs: [{ id: "x" }], total: 104 }),
      "jb:name": job('"companies":\\["Humana"\\]', { jobs: [], total: 0 }),
    }));
    expect(has(lines, "FAIL", /"nurse jobs in Texas" returns 104 of the location form's 1592/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /companies:\["Humana"\] resolves by name/), show(lines)).toBe(true);

    const old = run(["86-wave4-job-board.sh"], healthy({ "opt:jb": { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/job-board ", headers: { "x-fn-build": "job-board.2026-09-09.92" } } })).lines;
    expect(has(old, "FAIL", /job-board preflight x-fn-build = job-board\.2026-09-09\.92/), show(old)).toBe(true);
    expect(has(old, "INFO", /not judged: \.93 is not serving/), show(old)).toBe(true);
  });
});

describe("the wave-3 agent lines judge what replaced the agent once a wave-4 build serves", () => {
  it("73w: with agent-mcp 2026-10-11 serving, the retired tool's absence PASSes and the pass-rule line is not asked", () => {
    const opts = (fn: string, build: string): Route => ({ match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn} `, headers: { "x-fn-build": build } });
    const routes: Route[] = [
      opts("agent-mcp", "agent-mcp.2026-10-11.2"),
      { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/([a-z-]+) ", headers: { "x-fn-build": "x.2026-10-11.99" } },
      fromReal("tools", `^POST ${esc(MCP)} ua= .*"method":"tools/list"`),
      { match: "send-agent-digest\\?action=unsubscribe", status: 303, headers: { location: "https://resumebooster.work/email/unsubscribe#list=agent-digest" } },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 401, body: JSON.stringify({ code: "42501" }) },
    ];
    const { lines } = run(["73w-w31-agents.sh"], routes);
    expect(has(lines, "PASS", /request_application is listed to nobody/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /pass rule|names the Agent plan/), show(lines)).toBe(false);
  });

  it("73: with agent-mcp 2026-10-11 serving, the retired tool's absence and a guide with no pass link PASS, and the wave-3 allowance line is not asked", () => {
    const routes: Route[] = [
      { match: `^OPTIONS ${esc(MCP)} `, headers: { "x-fn-build": "agent-mcp.2026-10-11.2" } },
      { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/([a-z-]+) ", headers: { "x-fn-build": "x.2026-10-11.99" } },
      { match: "^GET https://p\\.supabase\\.co/functions/v1/public-api/v1 ", body: JSON.stringify({ apiVersion: "2026-10-11.1", restrictions: { excludedSources: ["usajobs", "smartrecruiters"] } }) },
      fromReal("init", `^POST ${esc(MCP)} ua= .*"method":"initialize"`),
      fromReal("tools", `^POST ${esc(MCP)} ua= .*"method":"tools/list"`),
      fromReal("guide", `^POST ${esc(MCP)} ua=[^ ]* .*"method":"resources/read".*guide`),
      fromReal("search", tool("search_jobs")),
      { match: "^POST https://p\\.supabase\\.co/functions/v1/job-board ", body: JSON.stringify({ jobs: [] }) },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 401, body: JSON.stringify({ code: "42501" }) },
      // The crawler copy after the wave-4 frontend publish: the count-free allowance sentence.
      { match: "^GET https://site\\.test/agents ", body: "<p>withheld until SmartRecruiters (SAP) permits it.</p><p>Free with no key and no account, within a daily allowance that resets at midnight UTC. Claude users share one allowance.</p>" },
      { match: "^GET https://site\\.test/data-api ", body: "<p>withheld until SmartRecruiters (SAP) permits it.</p>" },
      { match: "^GET https://site\\.test/ ", body: "<p>apply yourself on the employer's own site with your AI's help, within a free daily allowance.</p>" },
      { match: "^GET https://site\\.test/llms\\.txt ", body: "Claude's users share one allowance, because Claude's servers carry every one of them." },
    ];
    const { lines } = run(["73-wave3-agents-api.sh"], routes);
    expect(has(lines, "PASS", /request_application is listed to nobody since wave 4/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /the guide names no pass link: the Agent Pass is retired/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /\/agents crawler copy states the host allowance/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /llms\.txt states the host allowance/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /request_application|host allowance|pass is bought|pass link/), show(lines)).toBe(false);
    // ... and a copy that states neither sentence still FAILs.
    const blank = run(["73-wave3-agents-api.sh"], routes.map((r) => (r.match.includes("site\\.test/agents ") ? { ...r, body: "<p>withheld until SmartRecruiters (SAP) permits it.</p>" } : r))).lines;
    expect(has(blank, "FAIL", /\/agents crawler copy states the host allowance/), show(blank)).toBe(true);
  });

  it("5n: a wave-4 prompt set is INFO, the retired tool's answer PASSes, and the PRM's 404 while sign-in is off PASSes", () => {
    const block = /echo "== 5n\/5q\.[\s\S]*?(?=\necho "== 5p\.)/.exec(SCRIPT)?.[0] ?? "";
    expect(block, "the 5n block is gone from verify-deploy.sh").toContain("prompts/list");
    const retired = (() => { const r = parse(real.badid.body); r.result.content[0].text = JSON.stringify({ error: "The apply agent is switched off and this tool is retired: request_application belonged to it." }); r.result.isError = true; return JSON.stringify(r); })();
    const dir = mkdtempSync(join(tmpdir(), "vd-w4-5n-"));
    dirs.push(dir);
    writeFileSync(join(dir, "5n.sh"), block);
    const routes: Route[] = [
      fromReal("init", `^POST ${esc(MCP)} ua= .*"method":"initialize"`),
      fromReal("tools", `^POST ${esc(MCP)} ua= .*"method":"tools/list"`),
      fromReal("prompts", `^POST ${esc(MCP)} ua= .*"method":"prompts/list"`),
      fromReal("stats", tool("board_stats")),
      { match: `${tool("request_application")}`, body: retired },
      fromReal("prm", `^GET ${esc(MCP)}/\\.well-known/oauth-protected-resource `),
      { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/", status: 401, body: JSON.stringify({ code: "42501" }) },
      { match: "^GET https://p\\.supabase\\.co/rest/v1/", status: 401, body: JSON.stringify({ code: "42501" }) },
      { match: "^POST https://p\\.supabase\\.co/functions/v1/agent-mcp ua= .*resources/list", body: JSON.stringify({ result: { resources: [{}, {}, {}] } }) },
    ];
    const prelude = `set -u\nK=pk_test; RB=""; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${HELPERS}\n`;
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
    chmodSync(join(dir, "bin", "curl"), 0o755);
    writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
    writeFileSync(join(dir, "calls.log"), "");
    writeFileSync(join(dir, "run.sh"), prelude + block);
    let out = "";
    try {
      out = execFileSync("bash", [join(dir, "run.sh")], {
        env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
        encoding: "utf8", timeout: 110_000, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
    const lines = out.split("\n").filter(Boolean);
    expect(has(lines, "INFO", /the wave-4 keyless prompt set, judged in section 82/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /keyless request_application refused in band/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /PRM answers 404 in words while sign-in is off/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /prompts\/list|request_application|PRM/), show(lines)).toBe(false);
  });
});
