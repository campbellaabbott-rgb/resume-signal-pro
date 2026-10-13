// @vitest-environment node
/**
 * SECTION 92 (WAVE 4 ROUND 2, THE AGENTS API) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/92-w4b-agents-api.sh is what the owner reads after
 * the S12 agents-api fixes deploy. A PASS is worth something only if a
 * regression could have turned it into a FAIL (verify-deploy.d/README), so
 * the section runs here in bash against a fake curl, with the real MC and
 * build_ge cut from the verifier. The keyless tools/list it reads is the REAL
 * agent-mcp handler's, run here with only its network faked; each claim's
 * regression must read FAIL, and an older bundle is never asked to spend a
 * lookup.
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
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-agents-api.sh"), "utf8");
const cut = (re: RegExp, what: string) => { const m = re.exec(SCRIPT); if (!m) throw new Error(`${what} is gone from verify-deploy.sh`); return m[0]; };
const HELPERS = [cut(/^MC\(\) \{.*\}$/m, "MC"), cut(/^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge")].join("\n");

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
const ct=decodeURIComponent((url.match(/company_token=([^&]+)/)||[])[1]||"");
const body=(r.body??"").split("{{CT}}").join(ct);if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[], opts: { rb?: string } = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-92-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=pk_test; RB=${JSON.stringify(opts.rb ?? "")}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${HELPERS}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
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

let handler: EdgeHandler;
let realTools = "";
beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async () => new Response(JSON.stringify({ error_code: "feature_disabled" }), { status: 404 });
  g.__mcpDb = { rpc: () => { const r = Promise.resolve({ data: null, error: null }); return Object.assign(r, { maybeSingle: () => r }); }, from: () => ({}) };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }));
  realTools = await res.text();
}, 180_000);

const MCP = "https://p\\.supabase\\.co/functions/v1/agent-mcp";
const API = "https://p\\.supabase\\.co/functions/v1/public-api";
const AGENT = "https://p\\.supabase\\.co/functions/v1/apply-agent";
const result = (sc: Record<string, unknown>, isError = false) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(sc) }], structuredContent: sc, isError } });
const CVS_REFUSED = { jobs: [], total: 0, unknownCompanies: ["CVS"], companiesUnresolved: [{ asked: "CVS", candidates: [{ token: "cvshealth", name: "CVS Health" }] }] };
const ROW = { id: "greenhouse:acme:1", first_seen: "2026-09-01T00:00:00Z", last_verified_at: "2026-10-12T09:00:00Z", last_seen: "2026-10-12T09:00:00Z" };

function healthy(over: Record<string, Route | null> = {}): Route[] {
  const base: Record<string, Route> = {
    optMcp: { match: `^OPTIONS ${MCP} `, headers: { "x-fn-build": "agent-mcp.2026-10-11.27" } },
    optApi: { match: `^OPTIONS ${API} `, headers: { "x-fn-build": "public-api.2026-10-11.27" } },
    optAgent: { match: `^OPTIONS ${AGENT} `, headers: { "x-fn-build": "apply-agent.2026-10-11.27" } },
    tools: { match: `^POST ${MCP} ua= .*"method":"tools/list"`, body: realTools },
    cvs: { match: `^POST ${MCP} ua= .*"companies":"CVS"`, body: result(CVS_REFUSED) },
    gpt: { match: `^POST ${MCP} ua=openai-mcp.*"name":"search_jobs"`, body: result({ jobs: [], total: 0 }) },
    v1u: { match: `^GET ${API}/v1/jobs\\?company_token=zz-never-carried-`, body: JSON.stringify({ data: [], disclosures: { unknownCompanies: ["{{CT}}"] } }) },
    v1: { match: `^GET ${API}/v1/jobs\\?limit=3`, body: JSON.stringify({ data: [ROW, { ...ROW, id: "lever:b:2" }] }) },
  };
  for (const [k, v] of Object.entries(over)) { if (v === null) delete base[k]; else base[k] = v; }
  return Object.values(base);
}
const runSection = run;

describe("section 92 on a healthy deploy", () => {
  it("reads the builds, the schema and the CVS scope as PASS, and asks the owner for 0 on the nonce", () => {
    const { lines } = runSection(healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "PASS", /agent-mcp preflight x-fn-build = agent-mcp\.2026-10-11\.27/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /apply-agent preflight x-fn-build = apply-agent\.2026-10-11\.27/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /search_jobs declares countCapped, rankedFellBack, unknownCompanies/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /apply_myself route may say null/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /keyless tools\/list is \d+ bytes/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /a search scoped to "CVS" with no rows says why/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /job_board_search_events WHERE q = 'vdgpt92\d+' must be 0/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /RB_API_KEY missing/), show(lines)).toBe(true);
  });

  it("with RB_API_KEY, last_verified_at and last_seen agree on every row", () => {
    const { lines } = runSection(healthy(), { rb: "rb_live_x" });
    expect(has(lines, "PASS", /every \/v1 job object carries last_verified_at/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /last_seen holds the same value/), show(lines)).toBe(true);
  });
});

describe("section 92 fails each regression", () => {
  it("an older bundle: FAIL on the build, and no lookup is spent", () => {
    const { lines, calls } = runSection(healthy({ optMcp: { match: `^OPTIONS ${MCP} `, headers: { "x-fn-build": "agent-mcp.2026-10-11.3" } } }));
    expect(has(lines, "FAIL", /agent-mcp preflight x-fn-build = agent-mcp\.2026-10-11\.3 \(want/), show(lines)).toBe(true);
    expect(calls.filter((c) => /"name":"search_jobs"/.test(c))).toEqual([]);
  });

  it("an apply-agent bundle older than the S12 classifier: FAIL on its build", () => {
    const { lines } = runSection(healthy({ optAgent: { match: `^OPTIONS ${AGENT} `, headers: { "x-fn-build": "apply-agent.2026-10-11.15" } } }));
    expect(has(lines, "FAIL", /apply-agent preflight x-fn-build = apply-agent\.2026-10-11\.15 \(want/), show(lines)).toBe(true);
  });

  it("a schema without countCapped or the employer notes", () => {
    const stripped = JSON.parse(realTools);
    const sj = stripped.result.tools.find((t: { name: string }) => t.name === "search_jobs");
    delete sj.outputSchema.properties.countCapped;
    delete sj.outputSchema.properties.unknownCompanies;
    const { lines } = runSection(healthy({ tools: { match: `^POST ${MCP} ua= .*"method":"tools/list"`, body: JSON.stringify(stripped) } }));
    expect(has(lines, "FAIL", /search_jobs declares .*\(missing: countCapped, unknownCompanies\)/), show(lines)).toBe(true);
  });

  it("a CVS scope answered with the whole board's rows", () => {
    const wide = { jobs: [{ id: "a", companyToken: "acme" }, { id: "b", companyToken: "beta" }], total: 52000 };
    const { lines } = runSection(healthy({ cvs: { match: `^POST ${MCP} ua= .*"companies":"CVS"`, body: result(wide) } }));
    expect(has(lines, "FAIL", /scoped to "CVS" answers only the boards it resolved to .*strays from acme, beta/), show(lines)).toBe(true);
  });

  it("a CVS scope answered with a silent 0", () => {
    const { lines } = runSection(healthy({ cvs: { match: `^POST ${MCP} ua= .*"companies":"CVS"`, body: result({ jobs: [], total: 0 }) } }));
    expect(has(lines, "FAIL", /with no rows says why .*never a silent 0/), show(lines)).toBe(true);
  });

  it("a /v1 row whose last_seen is still the insert time", () => {
    const stale = { data: [{ ...ROW, last_seen: ROW.first_seen }] };
    const { lines } = runSection(healthy({ v1: { match: `^GET ${API}/v1/jobs\\?limit=3`, body: JSON.stringify(stale) } }), { rb: "rb_live_x" });
    expect(has(lines, "FAIL", /last_seen holds the same value/), show(lines)).toBe(true);
  });

  it("a /v1 page for a never-read token that names nothing", () => {
    const { lines } = runSection(healthy({ v1u: { match: `^GET ${API}/v1/jobs\\?company_token=zz-never-carried-`, body: JSON.stringify({ data: [] }) } }), { rb: "rb_live_x" });
    expect(has(lines, "FAIL", /an empty \/v1 page for a company_token the board has never read names it/), show(lines)).toBe(true);
  });
});
