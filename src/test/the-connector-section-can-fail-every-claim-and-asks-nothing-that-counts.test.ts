// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE CONNECTOR SECTION CAN FAIL EVERY CLAIM, AND ASKS NOTHING THAT COUNTS.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-connector.sh is bug round A's
 * post-deploy proof of the connector lane. A PASS is worth something only if
 * a regression could have turned it into a FAIL (verify-deploy.d/README.md),
 * so the section runs here against a fake curl that logs every call and
 * answers from routes. The agent-mcp answers of a good deploy are the SHIPPED
 * handler's own answers on this branch, so the section's expectations cannot
 * drift from the code; the /agents chunk and bake of a good deploy are built
 * from src/config/mcp-tools.ts, so they cannot drift from the copy.
 *   - a good deploy prints PASS for every claim, and INFO only for the latent
 *     sign-in line while sign-in is off and the keyless calls not asked for;
 *   - each claim prints FAIL when its answer is the old behaviour or broken;
 *   - before agent-mcp.2026-11-12.1 no agent-mcp POST is made and its lines
 *     are INFO; before public-api.2026-11-12.1 the form reader's are; before
 *     the frontend publish the page's lines are INFO; the install README is
 *     INFO owner pending until ownerDecided names S14X-056;
 *   - each owner key (OD14-REDIST-1, OD14-ASHBY-1, HO-1) is INFO owner
 *     pending until ownerDecided names it, INFO for a choice that ships
 *     nothing, waits for the build or publish that carries it, and then can
 *     PASS or FAIL; a choice that withholds a form reader takes it out of
 *     SEO-F15's list. OWNER_SHIPPED names the choices this branch's code
 *     carries, so a good deploy of the owner branch is judged on them;
 *   - the key is never printed, no job-board or PostgREST call is made, and
 *     every agent-mcp POST is one the server never counts, unless
 *     VERIFY_KEYLESS_CALLS=1 asks for the four keyless tool calls.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { bootKeylessMcp } from "./helpers/keyless-mcp";
import type { EdgeHandler } from "./helpers/edge-harness";
import { AUTHORIZATION_SERVER_METADATA_URL } from "../../supabase/functions/agent-mcp/as-probe";
import { AUTH_ISSUER } from "../../supabase/functions/agent-mcp/oauth";
import { BUNDLED_CHATGPT_EGRESS_AT, BUNDLED_CHATGPT_EGRESS_V4 } from "../../supabase/functions/agent-mcp/chatgpt-egress";
import { MCP_ADDRESS_GLOSS, MCP_FORM_VENDORS, MCP_HOSTS, MCP_MORE_HOSTS, MCP_OWN_CONNECTION_GLOSS, MCP_TOOLS, MCP_TROUBLESHOOTING, MCP_WITHHELD_NOTE } from "../config/mcp-tools";

vi.setConfig({ testTimeout: 600_000, hookTimeout: 300_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-connector.sh"), "utf8");
const helper = (name: string) => new RegExp(`^${name}\\(\\) \\{.*\\}$`, "m").exec(SCRIPT)?.[0] ?? "";
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_99bc";
const B = "https://p\\.supabase\\.co";
const SITE = "https://resumebooster.work";
const S = "https://resumebooster\\.work";
const MCP = `${B}/functions/v1/agent-mcp`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
type Answer = { status: number; headers: Record<string, string>; body: string };

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

/**
 * The owner choices this branch's code carries. Empty on the lane branch;
 * each commit on bugs/a-connector-owner adds the key and option it builds,
 * and a good deploy is judged with them recorded, as the integrator records
 * them before merging that commit.
 */
const OWNER_SHIPPED: Record<string, string> = {};

function run(routes: Route[], o: { keylessCalls?: boolean; decided?: Record<string, string> } = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd99bc-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided: o.decided ?? OWNER_SHIPPED } } }));
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=${SITE}; UA=Googlebot-test\n${BUILD_GE}\n${helper("J")}\n${helper("R")}\n${helper("MC")}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    VDBC_LEDGER: join(dir, "ledger.json"), VERIFY_KEYLESS_CALLS: o.keylessCalls ? "1" : "0",
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// ── The shipped handler's own answers ─────────────────────────────────────
const HANDLER_URL = "https://harness.supabase.co/functions/v1/agent-mcp";
const FULL_DOCUMENT = { issuer: AUTH_ISSUER, registration_endpoint: `${AUTH_ISSUER}/oauth/clients/register`, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] };
const rpcBody = (id: number, method: string, params: Record<string, unknown>) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

async function answer(h: EdgeHandler, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<Answer> {
  const res = await h(new Request(HANDLER_URL, { method: init.method, headers: { "x-forwarded-for": "203.0.113.7", ...(init.headers ?? {}) }, body: init.body }));
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: await res.text() };
}

type Answers = Record<"init" | "tools" | "keyed" | "prompt" | "guide" | "fit" | "evil" | "own" | "plain" | "foreign" | "us" | "ni" | "mo", Answer>;

async function answersOf(signIn: "on" | "off"): Promise<Answers> {
  const m = await bootKeylessMcp();
  const h = (globalThis as Record<string, unknown>).__edgeHandler as EdgeHandler;
  if (signIn === "on") {
    const inner = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) =>
      String(url) === AUTHORIZATION_SERVER_METADATA_URL
        ? new Response(JSON.stringify(FULL_DOCUMENT), { status: 200, headers: { "Content-Type": "application/json" } })
        : inner(url as string, init)) as typeof fetch;
  }
  const json = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
  const post = (body: string, extra: Record<string, string> = {}) => answer(h, { method: "POST", headers: { ...json, ...extra }, body });
  const out = {
    init: await post(rpcBody(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify-deploy", version: "1" } })),
    tools: await post(rpcBody(2, "tools/list", {})),
    keyed: await post(rpcBody(3, "tools/list", {}), { authorization: "Bearer x" }),
    prompt: await post(rpcBody(4, "prompts/get", { name: "browse_jobs", arguments: { what: "nurse", where: "United States" } })),
    guide: await post(rpcBody(5, "resources/read", { uri: "resumebooster://guide" })),
    fit: await post(rpcBody(6, "tools/call", { name: "fit_resume", arguments: {} })),
    evil: await answer(h, { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" } }),
    own: await answer(h, { method: "OPTIONS", headers: { origin: SITE, "access-control-request-method": "POST", "access-control-request-headers": "content-type, mcp-protocol-version" } }),
    plain: await post(rpcBody(7, "tools/list", {}), { "content-type": "text/plain;charset=UTF-8", origin: "https://evil.example" }),
    foreign: await post(rpcBody(8, "tools/list", {}), { origin: "https://evil.example" }),
    counted: m.rpcs.filter((r) => r.name === "mcp_anon_check_v2").length,
    us: await post(rpcBody(11, "tools/call", { name: "search_jobs", arguments: { query: "registered nurse", location: "United States", limit: 1 } })),
    ni: await post(rpcBody(12, "tools/call", { name: "search_jobs", arguments: { query: "nurse in N. Ireland", limit: 1 } })),
    mo: await post(rpcBody(13, "tools/call", { name: "search_jobs", arguments: { query: "nurse in Mexico Missouri", limit: 1 } })),
  };
  // Nothing the section asks by default was counted; the three searches (of the opt-in four) each were.
  expect(out.counted).toBe(0);
  expect(m.rpcs.filter((r) => r.name === "mcp_anon_check_v2").length).toBe(3);
  const { counted: _counted, ...answers } = out;
  return answers;
}

// ── The /agents page, built from the copy module ──────────────────────────
const getJob = MCP_TOOLS.find((t) => t.name === "get_job")!.body;
const applyMyself = MCP_TOOLS.find((t) => t.name === "apply_myself")!.body;
const claude = MCP_HOSTS.find((h) => h.id === "claude")!;
const claudeCode = MCP_HOSTS.find((h) => h.id === "claude-code")!;
const gemini = MCP_MORE_HOSTS.find((h) => h.id === "gemini-cli")!;
const quotaFix = MCP_TROUBLESHOOTING.find((r) => r.id === "quota-used")!.fix;
const copies = (steps: Array<{ text: string; copy?: string }>) => steps.map((s) => `${s.text} ${s.copy ?? ""}`).join("\n");
const ctx = { url: "https://x.supabase.co/functions/v1/agent-mcp", key: "" };
const VENDOR_ARRAY = `[${MCP_FORM_VENDORS.map((v) => `{key:"${v.key}",label:"${v.label}"}`).join(",")}]`;
const claudeSteps = [copies(claude.steps({ ...ctx, addToClaude: true })), copies(claude.fallbackSteps!(ctx))].join("\n");
const NEW_MT = [
  VENDOR_ARRAY, MCP_ADDRESS_GLOSS, MCP_OWN_CONNECTION_GLOSS, getJob, applyMyself, claude.signIn("on"), MCP_WITHHELD_NOTE,
  claudeCode.keyed!.title, copies(claudeCode.keyed!.steps(ctx)), copies(gemini.keyed!.steps(ctx)), quotaFix, claudeSteps,
].join("\n");
const NEW_AC = `function HostPanel(e){return n("p",{className:"text-xs","data-allowance":!0,children:e.host.allowance??Ad})} import("./mcp-tools-mt1.js")`;
// The prerender hands no Add-to-Claude flag in, so the bake carries Claude's manual steps.
const NEW_BAKE = `<html><body><h1>Connect your AI</h1><p>${getJob}</p><p>${applyMyself}</p><p>${MCP_WITHHELD_NOTE}</p><ol>${copies(claude.fallbackSteps!(ctx))}</ol><h4>${claudeCode.keyed!.title}</h4><td>${quotaFix}</td></body></html>`;
// The strings this round replaced, as the live chunk and bake carried them on 2026-11-16.
const OLD_MT_STRINGS = [
  "With a free key (optional — opens every read tool: ${P()}; ${b.toLocaleString(\"en-US\")} calls a day)",
  "when the employer's feed last confirmed it open.",
  "The first time Claude needs your account — to open a posting in full or to check a shortlist — a **Connect** card appears",
  "the U.S. federal job feed, whose terms forbid redistributing it as a data feed",
  "[{key:\"greenhouse\",label:\"Greenhouse\"},{key:\"ashby\",label:\"Ashby\"},{key:\"recruitee\",label:\"Recruitee\"},{key:\"breezy\",label:\"Breezy\"},{key:\"pinpoint\",label:\"Pinpoint\"}]",
  "Wait for midnight UTC; the unkeyed tools still answer.",
  MCP_ADDRESS_GLOSS,
];
const OLD_MT = OLD_MT_STRINGS.join("\n");
const OLD_AC = `function HostPanel(e){return n("p",{className:"text-xs",children:Ad})} import("./mcp-tools-mt1.js")`;
const OLD_BAKE = `<html><body><p>Full detail for one job id, including the complete description text and when the employer's feed last confirmed it open.</p><p>When the employer uses Greenhouse, Ashby, Recruitee, Breezy or Pinpoint, it returns the employer's real application form</p><p>the U.S. federal job feed, whose terms forbid redistributing it as a data feed</p><h4>With a free key (optional — opens every read tool: key_status, debug_search; 1,000 calls a day)</h4><td>Wait for midnight UTC; the unkeyed tools still answer.</td></body></html>`;

const OPENAI = (extra: string[] = []) => JSON.stringify({ creationTime: BUNDLED_CHATGPT_EGRESS_AT, prefixes: [...BUNDLED_CHATGPT_EGRESS_V4, ...extra].map((p) => ({ ipv4Prefix: p })) });
const README_SYNCED = "# resumebooster-mcp\n\nThe Resume Booster job board for your AI. Applying stays with you: apply_myself reads the employer's form.\n";
const README_PAID = "# resumebooster-mcp\n\nThe Resume Booster job board for your AI. Applying is paid: the apply agent sends it for you.\n";
const HIRING = JSON.stringify({ jsonrpc: "2.0", id: 14, result: { content: [{ type: "text", text: "{}" }], structuredContent: { employers: [
  { company_token: "centriaautism", record: "observed", open_roles: 12, tracking_days: 80, feed_total: 12, gate: { counts: "lap_read", median: "lap_read", sentence: "Counts need a full read of this board." }, basis: "one board", layoff_filing: null },
  { company_token: "generalmotors~wd5~Careers_GM", record: "observed", open_roles: 900, filled_roles_90d: 120, relisted_roles_90d: 30, median_days_to_fill: 41, gate: { counts: "ok", median: "ok", sentence: null }, basis: "one board", layoff_filing: null },
], asked: 2, window_days: 90 } } });

// ── Routes ────────────────────────────────────────────────────────────────
type Over = {
  am?: string | null; pa?: string | null;
  a?: Partial<Record<keyof Answers, Answer>>;
  mt?: string; ac?: string | null; bake?: string;
  openai?: { status?: number; body: string };
  readme?: string; hiring?: string;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toolsListed = (name: "tools" | "keyed", a: Answers) => a[name];
function routes(base: Answers, o: Over = {}): Route[] {
  const a = { ...base, ...(o.a ?? {}) } as Answers;
  const am = o.am === undefined ? "agent-mcp.2026-11-12.1" : o.am;
  const pa = o.pa === undefined ? "public-api.2026-11-12.1" : o.pa;
  const r = (x: Answer): Pick<Route, "status" | "headers" | "body"> => ({ status: x.status, headers: x.headers, body: x.body });
  const post = (what: string) => `^POST ${MCP}\\t[^\\t]*${what}`;
  return [
    { match: `^OPTIONS ${MCP}\\theaders:.*[Oo]rigin: https://evil\\.example`, ...r(a.evil) },
    { match: `^OPTIONS ${MCP}\\theaders:.*[Oo]rigin: ${S}`, ...r(a.own) },
    { match: `^OPTIONS ${MCP}\\t`, status: 204, headers: am ? { "x-fn-build": am } : {} },
    { match: `^OPTIONS ${B}/functions/v1/public-api\\t`, status: 204, headers: pa ? { "x-fn-build": pa } : {} },
    { match: `${post('"method":"tools/list"')}[^\\t]*\\theaders:.*Content-Type: text/plain`, ...r(a.plain) },
    { match: `${post('"method":"tools/list"')}[^\\t]*\\theaders:.*Origin: https://evil\\.example`, ...r(a.foreign) },
    { match: `${post('"method":"tools/list"')}[^\\t]*\\theaders:.*Authorization: Bearer x`, ...r(toolsListed("keyed", a)) },
    { match: post('"method":"tools/list"'), ...r(toolsListed("tools", a)) },
    { match: post('"method":"initialize"'), ...r(a.init) },
    { match: post('"method":"prompts/get"'), ...r(a.prompt) },
    { match: post('"method":"resources/read"'), ...r(a.guide) },
    { match: post('"name":"fit_resume"'), ...r(a.fit) },
    { match: post('"location":"United States"'), ...r(a.us) },
    { match: post(esc('"query":"nurse in N. Ireland"')), ...r(a.ni) },
    { match: post('"query":"nurse in Mexico Missouri"'), ...r(a.mo) },
    { match: post('"name":"employer_hiring_record"'), body: o.hiring ?? HIRING },
    { match: `^GET https://openai\\.com/chatgpt-connectors\\.json\\t`, status: o.openai?.status ?? 200, body: o.openai?.body ?? OPENAI() },
    { match: `^GET ${S}/\\t`, body: `<html><head><script type="module" src="/assets/index-abc123.js"></script></head></html>` },
    { match: `^GET ${S}/assets/index-abc123\\.js\\t`, body: `const r=[()=>import("./AgentConnect-ac1.js")];` },
    ...(o.ac === null ? [] : [{ match: `^GET ${S}/assets/AgentConnect-ac1\\.js\\t`, body: o.ac ?? NEW_AC }]),
    { match: `^GET ${S}/assets/mcp-tools-mt1\\.js\\t`, body: o.mt ?? NEW_MT },
    { match: `^GET ${S}/agents\\t`, body: o.bake ?? NEW_BAKE },
    { match: `^GET https://raw\\.githubusercontent\\.com/campbellaabbott-rgb/resumebooster-mcp/main/README\\.md\\t`, body: o.readme ?? README_SYNCED },
  ];
}

const verdicts = (lines: string[]) => lines.filter((l) => /^(PASS|FAIL|INFO)/.test(l));
const lineOf = (lines: string[], id: string, extra?: RegExp) => verdicts(lines).find((l) => l.slice(6).startsWith(`${id} `) && (!extra || extra.test(l))) ?? "";
const json = (s: string) => JSON.parse(s) as Record<string, unknown>;
/** An answer with its JSON body changed. */
const edit = (x: Answer, f: (j: Record<string, unknown>) => void): Answer => { const j = json(x.body); f(j); return { ...x, body: JSON.stringify(j) }; };
const toolsOf = (j: Record<string, unknown>) => (j.result as { tools: Array<Record<string, unknown>> }).tools;

let OFF: Answers;
let ON: Answers;
beforeAll(async () => {
  OFF = await answersOf("off");
  ON = await answersOf("on");
});

const MCP_LINES = ["S14X-091", "S14X-263", "S14X-052", "S14X-260", "RC-S9-002", "M2-01", "USAJOBS-COPY-1", "NB-31"];
const RIDES = ["RC-S13-041", "S14X-016", "S14X-133", "S14X-134", "S14X-135", "S14X-264", "S14X-275", "S14X-132/agent-mcp", "GP-NOLOG-1", "NB-28"];
const PAGE = ["S14X-259", "S14X-260", "S14X-261", "S14X-262", "SEO-F15", "USAJOBS-COPY-1"];

describe("a good deploy, sign-in off", () => {
  let r: ReturnType<typeof run>;
  beforeAll(() => { r = run(routes(OFF)); });

  it("prints PASS for every claim, and INFO only for the latent sign-in line, the keyless calls not asked for and the owner keys still pending", () => {
    const v = verdicts(r.lines);
    expect(v.filter((l) => l.startsWith("FAIL")), r.out).toEqual([]);
    const pending = (id: string) => (id in OWNER_SHIPPED ? [] : [expect.stringMatching(new RegExp(`^${esc(id)} owner pending`))]);
    expect(v.filter((l) => l.startsWith("INFO")).map((l) => l.slice(6, 40)), r.out).toEqual([
      expect.stringMatching(/^S14X-262 sign-in is off/),
      ...pending("OD14-REDIST-1"),
      ...pending("OD14-ASHBY-1"),
      expect.stringMatching(/^K the keyless tool calls/),
      ...pending("HO-1"),
    ]);
    for (const id of Object.keys(OWNER_SHIPPED)) expect(v.some((l) => l.startsWith(`PASS  ${id} decided`)), `${id}\n${r.out}`).toBe(true);
    for (const id of [...MCP_LINES, ...RIDES, "S14X-056-install"]) expect(lineOf(v, id), `${id}\n${r.out}`).toMatch(/^PASS/);
    for (const id of PAGE) expect(v.some((l) => l.startsWith(`PASS  ${id} `) && !/\(bake\)/.test(l)), `${id} (chunk)\n${r.out}`).toBe(true);
    for (const id of ["S14X-260", "S14X-261", "SEO-F15", "USAJOBS-COPY-1"]) expect(v.some((l) => l.startsWith(`PASS  ${id} (bake)`)), `${id} (bake)\n${r.out}`).toBe(true);
    expect(lineOf(v, "V0", /agent-mcp/)).toMatch(/^PASS/);
    expect(lineOf(v, "V0", /public-api/)).toMatch(/^PASS/);
  });

  it("never prints the key; asks job-board and PostgREST nothing; every agent-mcp POST is one the server never counts", () => {
    expect(r.out).not.toContain(KEY);
    expect(r.calls.filter((c) => /\/functions\/v1\/job-board|\/rest\/v1\//.test(c))).toEqual([]);
    const posts = r.calls.filter((c) => c.startsWith("POST "));
    expect(posts.every((c) => c.includes("/functions/v1/agent-mcp\t"))).toBe(true);
    const methods = posts.map((c) => /"method":"([^"]+)"/.exec(c)?.[1]);
    expect(methods.sort()).toEqual(["initialize", "prompts/get", "resources/read", "tools/call", "tools/list", "tools/list", "tools/list", "tools/list"]);
    expect(posts.filter((c) => c.includes('"method":"tools/call"')).every((c) => c.includes('"name":"fit_resume","arguments":{}') && !/Authorization/i.test(c.split("\theaders:")[1]))).toBe(true);
    expect(posts.find((c) => c.includes('"method":"resources/read"'))).toContain("resumebooster://guide");
    expect(r.calls.filter((c) => !/^(GET|OPTIONS|POST) /.test(c))).toEqual([]);
  });
});

describe("sign-in on", () => {
  it("an unsigned listing shows fit_resume and key_status oauth2-only, and the no-key fit call is challenged", () => {
    const r = run(routes(ON));
    expect(lineOf(r.lines, "S14X-262", /sign-in is on/), r.out).toMatch(/^PASS/);
    expect(lineOf(r.lines, "S14X-263"), r.out).toMatch(/^PASS .*HTTP 401 with the sign-in challenge/);
    expect(lineOf(r.lines, "S14X-260", /a key adds/), r.out).toMatch(/^PASS/);
    expect(verdicts(r.lines).filter((l) => l.startsWith("FAIL")), r.out).toEqual([]);
  });

  it("FAILs when an unsigned listing marks fit_resume keyless too", () => {
    const tools = edit(ON.tools, (j) => { for (const t of toolsOf(j)) if (t.name === "fit_resume") t.securitySchemes = [{ type: "noauth" }, { type: "oauth2" }]; });
    expect(lineOf(run(routes(ON, { a: { tools } })).lines, "S14X-262")).toMatch(/^FAIL/);
  });
});

describe("the four keyless calls, when asked for", () => {
  it("run only with VERIFY_KEYLESS_CALLS=1, and PASS on the shipped handler's answers", () => {
    const r = run(routes(OFF), { keylessCalls: true });
    for (const [id, re] of [["RC-S9-002", /^PASS .*K location/], ["RC-S13-041", /^PASS .*K "nurse in N\. Ireland"/], ["M2-01", /^PASS .*K 2 rows/]] as const) {
      expect(verdicts(r.lines).some((l) => re.test(l) && l.includes(id)), `${id}\n${r.out}`).toBe(true);
    }
    const calls = r.calls.filter((c) => c.includes('"method":"tools/call"')).map((c) => /"name":"([^"]+)"/.exec(c)?.[1]).sort();
    expect(calls).toEqual(["employer_hiring_record", "fit_resume", "search_jobs", "search_jobs", "search_jobs"]);
  });

  it.each([
    ["RC-S9-002", () => ({ a: { us: edit(OFF.us, (j) => { delete (j.result as { structuredContent: Record<string, unknown> }).structuredContent.locationNote; }) } })],
    ["RC-S13-041", () => ({ a: { ni: edit(OFF.ni, (j) => { (j.result as { structuredContent: Record<string, unknown> }).structuredContent.locationInterpreted = { location: "N.", country: null }; }) } })],
    ["RC-S13-041", () => ({ a: { mo: edit(OFF.mo, (j) => { (j.result as { structuredContent: Record<string, unknown> }).structuredContent.locationInterpreted = { country: "MX", from: "Mexico" }; }) } })],
    ["M2-01", () => ({ hiring: HIRING.replace('"open_roles":900', '"open_roles":900,"closed_90d":203') })],
    ["M2-01", () => ({ hiring: HIRING.replace('"layoff_filing":null}]', '"layoff_filing":null,"layoff_read":"unread: ERROR: permission denied for table layoff_filings"}]') })],
  ] as Array<[string, () => Over]>)("%s K can FAIL", (id, over) => {
    const r = run(routes(OFF, over()), { keylessCalls: true });
    expect(verdicts(r.lines).find((l) => l.includes(` ${id} K `)) ?? "", r.out).toMatch(/^FAIL/);
  });
});

describe("each claim can FAIL", () => {
  const sj = (j: Record<string, unknown>) => toolsOf(j).find((t) => t.name === "search_jobs")! as { outputSchema: { properties: Record<string, unknown> } };
  const ehrRow = (j: Record<string, unknown>) => (toolsOf(j).find((t) => t.name === "employer_hiring_record")! as { outputSchema: { properties: { employers: { items: { properties: Record<string, unknown> } } } } }).outputSchema.properties.employers.items.properties;
  it.each([
    ["S14X-091", /preflight from/, () => ({ a: { evil: { ...OFF.evil, headers: { ...OFF.evil.headers, "access-control-allow-origin": "*" } } } })],
    ["S14X-091", /preflight from/, () => ({ a: { own: { ...OFF.own, headers: Object.fromEntries(Object.entries(OFF.own.headers).filter(([k]) => k !== "access-control-allow-origin")) } } })],
    ["S14X-091", /text\/plain POST/, () => ({ a: { plain: { ...OFF.tools } } })],
    ["S14X-091", /text\/plain POST/, () => ({ a: { foreign: { ...OFF.tools } } })],
    ["S14X-091", /positive control/, () => ({ a: { tools: { ...OFF.tools, body: "<html>gateway</html>" } } })],
    ["S14X-263", undefined, () => ({ a: { fit: { ...OFF.fit, body: JSON.stringify({ jsonrpc: "2.0", id: 6, result: { isError: true, content: [{ type: "text", text: "resumeText must be the CV as plain text, at least 100 characters. Send {resumeText: '...'} with the whole CV." }] } }) } } })],
    ["S14X-262", undefined, () => ({ a: { tools: edit(OFF.tools, (j) => { toolsOf(j).push({ name: "fit_resume", description: "x", inputSchema: {} }); }) } })],
    ["S14X-052", undefined, () => ({ a: { keyed: edit(OFF.keyed, (j) => { const t = toolsOf(j).find((x) => x.name === "fit_resume")!; t.description = "Score a CV. A null fit means the posting has no stored text to score. Needs a key or a sign-in."; }) } })],
    ["S14X-260", /a key adds/, () => ({ a: { keyed: edit(OFF.keyed, (j) => { toolsOf(j).push({ name: "debug_search", description: "x", inputSchema: {} }); }) } })],
    ["RC-S9-002", undefined, () => ({ a: { tools: edit(OFF.tools, (j) => { delete sj(j).outputSchema.properties.locationNote; }) } })],
    ["RC-S9-002", undefined, () => ({ a: { prompt: { ...OFF.prompt, body: OFF.prompt.body.split("locationNote").join("note") } } })],
    ["M2-01", undefined, () => ({ a: { tools: edit(OFF.tools, (j) => { ehrRow(j).closed_90d = { type: "integer" }; }) } })],
    ["M2-01", undefined, () => ({ a: { tools: edit(OFF.tools, (j) => { delete ehrRow(j).gate; }) } })],
    ["USAJOBS-COPY-1", /the guide/, () => ({ a: { guide: { ...OFF.guide, body: OFF.guide.body.replace("which we choose not to redistribute for now", "whose terms of use forbid redistributing it as a data feed") } } })],
    ["NB-31", undefined, () => ({ openai: { body: OPENAI(["203.0.113.0/24"]) } })],
  ] as Array<[string, RegExp | undefined, () => Over]>)("%s (%s)", (id, extra, over) => {
    const r = run(routes(OFF, over()));
    expect(lineOf(r.lines, id, extra), r.out).toMatch(/^FAIL/);
  });

  it("a ride FAILs, and so does V0, when a preflight carries no x-fn-build", () => {
    const r = run(routes(OFF, { am: null }));
    expect(lineOf(r.lines, "V0", /agent-mcp/)).toMatch(/^FAIL/);
    for (const id of RIDES) expect(lineOf(r.lines, id), `${id}\n${r.out}`).toMatch(/^FAIL/);
    const p = run(routes(OFF, { pa: null }));
    expect(lineOf(p.lines, "S14X-134")).toMatch(/^FAIL/);
    expect(lineOf(p.lines, "S14X-264")).toMatch(/^FAIL/);
    expect(lineOf(p.lines, "S14X-016")).toMatch(/^PASS/);
  });

  // The page: one string this round replaced, served again, FAILs its own line and no other.
  it.each([
    ["S14X-259", /own internet connection/, () => NEW_MT.split(MCP_OWN_CONNECTION_GLOSS).join("")],
    ["S14X-260", /the keyed steps/, () => `${NEW_MT}\nWith a free key (optional — opens every read tool: key_status, debug_search; 1,000 calls a day)`],
    ["S14X-260", /the keyed steps/, () => NEW_MT.split("claude mcp remove").join("claude mcp add")],
    ["S14X-260", /the keyed steps/, () => `${NEW_MT}\nWait for midnight UTC; the unkeyed tools still answer.`],
    ["S14X-261", /get_job on \/agents/, () => `${NEW_MT}\nwhen the employer's feed last confirmed it open.`],
    ["S14X-262", /sign-in line/, () => NEW_MT.replace("to score your CV against postings or to show your key's status", "to open a posting in full or to check a shortlist")],
    ["SEO-F15", /form readers/, () => NEW_MT.replace(VENDOR_ARRAY, OLD_MT_STRINGS[4])],
    ["USAJOBS-COPY-1", /\/agents says/, () => NEW_MT.replace("which we choose not to redistribute for now", "whose terms forbid redistributing it as a data feed")],
  ] as Array<[string, RegExp, () => string]>)("%s on the chunk (%s)", (id, re, mt) => {
    const r = run(routes(OFF, { mt: mt() }));
    const v = verdicts(r.lines).filter((l) => !/\(bake\)/.test(l));
    expect(v.find((l) => l.slice(6).startsWith(`${id} `) && re.test(l)) ?? "", r.out).toMatch(/^FAIL/);
    expect(v.filter((l) => l.startsWith("FAIL")), r.out).toHaveLength(1);
  });

  it("S14X-259 FAILs when the panel renders no allowance line of its own", () => {
    const r = run(routes(OFF, { ac: OLD_AC }));
    expect(lineOf(r.lines, "S14X-259"), r.out).toMatch(/^FAIL/);
  });

  it("the page FAILs when /agents ships no AgentConnect chunk", () => {
    const r = run(routes(OFF, { ac: null }));
    expect(r.lines.some((l) => /^FAIL  C \/agents ships no AgentConnect chunk/.test(l)), r.out).toBe(true);
  });

  it.each([
    ["S14X-260", () => NEW_BAKE.replace("</body>", "<td>Wait for midnight UTC; the unkeyed tools still answer.</td></body>")],
    ["S14X-261", () => NEW_BAKE.replace(getJob, "Full detail for one job id, including when the employer's feed last confirmed it open.")],
    ["SEO-F15", () => NEW_BAKE.replace(applyMyself, "When the employer uses Greenhouse, Ashby, Recruitee, Breezy or Pinpoint, it returns the form.")],
    ["USAJOBS-COPY-1", () => NEW_BAKE.replace("which we choose not to redistribute for now", "whose terms forbid redistributing it as a data feed")],
  ] as Array<[string, () => string]>)("%s on the bake", (id, bake) => {
    const r = run(routes(OFF, { bake: bake() }));
    expect(verdicts(r.lines).find((l) => l.startsWith(`FAIL  ${id} (bake)`)) ?? "", r.out).toMatch(/^FAIL/);
  });

  it("S14X-056-install FAILs once the owner's decision is recorded and the README still says applying is paid", () => {
    const r = run(routes(OFF, { readme: README_PAID }), { decided: { ...OWNER_SHIPPED, "S14X-056": "owner pushed the install repo" } });
    expect(lineOf(r.lines, "S14X-056-install"), r.out).toMatch(/^FAIL/);
  });
});

// ── The owner keys ──────────────────────────────────────────────────────
/** The shipped answers as the "withhold" option serves them (a no-op on a branch that carries it). */
const withRedist = (a: Answers): Partial<Answers> => ({
  tools: edit(a.tools, (j) => {
    for (const t of toolsOf(j)) {
      if (t.name === "apply_myself") t.description = String(t.description).split("Breezy, ").join("");
      if (t.name === "search_jobs") (t.inputSchema as { properties: Record<string, { description?: string }> }).properties.vendor.description = "Comma list of hiring systems (greenhouse, lever, …), max 8; not served here: usajobs, smartrecruiters, ukg, adp, breezy.";
    }
  }),
  init: edit(a.init, (j) => {
    const r = j.result as { instructions: string };
    r.instructions = r.instructions.split("Breezy, ").join("").replace("SmartRecruiters and USAJOBS postings are not served here", "SmartRecruiters, USAJOBS, UKG, ADP and Breezy postings are not served here");
  }),
  guide: { ...a.guide, body: a.guide.body.replace("(SmartRecruiters, USAJOBS)", "(SmartRecruiters, USAJOBS, UKG, ADP, Breezy)") },
});
/** The shipped answers as the "stop" option serves them. */
const withoutAshby = (a: Answers): Partial<Answers> => ({
  tools: edit(a.tools, (j) => { for (const t of toolsOf(j)) if (t.name === "apply_myself") t.description = String(t.description).split("Ashby, ").join(""); }),
  init: edit(a.init, (j) => { const r = j.result as { instructions: string }; r.instructions = r.instructions.split("Ashby, ").join(""); }),
});
const dropLabel = (mt: string, label: string) => mt.split(`{key:"${label.toLowerCase()}",label:"${label}"},`).join("").split(`,{key:"${label.toLowerCase()}",label:"${label}"}`).join("");
const KEEP_STEP = "Claude shows the authentication settings it detected. Keep them as they are and click **Continue**.";
const naming = (s: string, choice: string) => s.split("Keep them as they are").join(`Choose **${choice}**`);

describe("the owner keys", () => {
  it("OD14-REDIST-1 \"withhold\": PASS on answers that withhold UKG, ADP and Breezy, and SEO-F15 then wants no Breezy reader", () => {
    const r = run(routes(OFF, { a: withRedist(OFF), mt: dropLabel(NEW_MT, "Breezy") }), { decided: { ...OWNER_SHIPPED, "OD14-REDIST-1": "withhold" } });
    expect(lineOf(r.lines, "OD14-REDIST-1"), r.out).toMatch(/^PASS  OD14-REDIST-1 decided \(withhold\)/);
    expect(lineOf(r.lines, "SEO-F15", /form readers the connector uses/), r.out).toMatch(/^PASS .* of the 9 form readers/);
  });

  it.each([
    ["apply_myself names Breezy", (a: Answers) => ({ ...withRedist(a), tools: edit(withRedist(a).tools!, (j) => { for (const t of toolsOf(j)) if (t.name === "apply_myself") t.description = `${t.description} Breezy`; }) })],
    ["the vendor filter withholds only two", (a: Answers) => ({ ...withRedist(a), tools: edit(withRedist(a).tools!, (j) => { for (const t of toolsOf(j)) if (t.name === "search_jobs") (t.inputSchema as { properties: Record<string, { description?: string }> }).properties.vendor.description = "usajobs and smartrecruiters are not served here."; }) })],
    ["the guide names two", (a: Answers) => ({ ...withRedist(a), guide: { ...a.guide, body: a.guide.body.split("UKG, ADP, Breezy").join("").split("UKG").join("") } })],
  ] as Array<[string, (a: Answers) => Partial<Answers>]>)("OD14-REDIST-1 \"withhold\" FAILs when %s", (_what, f) => {
    const r = run(routes(OFF, { a: f(OFF), mt: dropLabel(NEW_MT, "Breezy") }), { decided: { ...OWNER_SHIPPED, "OD14-REDIST-1": "withhold" } });
    expect(lineOf(r.lines, "OD14-REDIST-1"), r.out).toMatch(/^FAIL/);
  });

  it("SEO-F15 FAILs when the choice withholds Breezy and the page still names it", () => {
    const r = run(routes(OFF, { a: withRedist(OFF), mt: `${NEW_MT}\n{key:"breezy",label:"Breezy"}` }), { decided: { ...OWNER_SHIPPED, "OD14-REDIST-1": "withhold" } });
    expect(lineOf(r.lines, "SEO-F15", /form readers the connector uses/), r.out).toMatch(/^FAIL .*names Breezy/);
  });

  it("OD14-ASHBY-1 \"stop\": PASS when apply_myself names no Ashby reader, FAIL when it does", () => {
    const decided = { ...OWNER_SHIPPED, "OD14-ASHBY-1": "stop" };
    const good = run(routes(OFF, { a: withoutAshby(OFF), mt: dropLabel(NEW_MT, "Ashby") }), { decided });
    expect(lineOf(good.lines, "OD14-ASHBY-1"), good.out).toMatch(/^PASS  OD14-ASHBY-1 decided \(stop\)/);
    expect(lineOf(good.lines, "SEO-F15", /form readers the connector uses/), good.out).toMatch(/^PASS/);
    const bad = run(routes(OFF, { a: { ...withoutAshby(OFF), tools: edit(withoutAshby(OFF).tools!, (j) => { for (const t of toolsOf(j)) if (t.name === "apply_myself") t.description = `${t.description} Ashby`; }) }, mt: dropLabel(NEW_MT, "Ashby") }), { decided });
    expect(lineOf(bad.lines, "OD14-ASHBY-1"), bad.out).toMatch(/^FAIL/);
  });

  it("HO-1: PASS when the Claude steps name the recorded choice, FAIL while they still say keep the detected settings, on the chunk and the bake", () => {
    const decided = { ...OWNER_SHIPPED, "HO-1": "Sign in when needed" };
    const good = run(routes(OFF, { mt: naming(NEW_MT, "Sign in when needed"), bake: naming(NEW_BAKE, "Sign in when needed") }), { decided });
    expect(lineOf(good.lines, "HO-1", /decided/), good.out).toMatch(/^PASS  HO-1 decided .*name "Sign in when needed"/);
    expect(verdicts(good.lines).find((l) => l.slice(6).startsWith("HO-1 (bake)")) ?? "", good.out).toMatch(/^PASS/);
    const bad = run(routes(OFF, { mt: `${NEW_MT}\n${KEEP_STEP}`, bake: NEW_BAKE.replace("</ol>", `${KEEP_STEP}</ol>`) }), { decided });
    expect(lineOf(bad.lines, "HO-1", /decided/), bad.out).toMatch(/^FAIL/);
    expect(verdicts(bad.lines).find((l) => l.slice(6).startsWith("HO-1 (bake)")) ?? "", bad.out).toMatch(/^FAIL/);
    const other = run(routes(OFF, { mt: naming(NEW_MT, "Sign in when needed") }), { decided: { ...OWNER_SHIPPED, "HO-1": "No sign in" } });
    expect(lineOf(other.lines, "HO-1", /decided/), other.out).toMatch(/^FAIL .*name no authentication choice \(No sign in\)/);
  });

  it("a choice that ships nothing is INFO, and so is every key before the build or publish that carries it", () => {
    const keep = run(routes(OFF), { decided: { "OD14-REDIST-1": "keep serving", "OD14-ASHBY-1": "keep reading" } });
    expect(lineOf(keep.lines, "OD14-REDIST-1"), keep.out).toMatch(/^INFO  OD14-REDIST-1 decided \(keep serving\)/);
    expect(lineOf(keep.lines, "OD14-ASHBY-1"), keep.out).toMatch(/^INFO  OD14-ASHBY-1 decided \(keep reading\)/);
    const decided = { "OD14-REDIST-1": "withhold", "OD14-ASHBY-1": "stop", "HO-1": "Sign in when needed" };
    const early = run(routes(OFF, { am: "agent-mcp.2026-11-09.2", mt: OLD_MT, ac: OLD_AC, bake: OLD_BAKE }), { decided });
    for (const id of ["OD14-REDIST-1", "OD14-ASHBY-1"]) expect(lineOf(early.lines, id), `${id}\n${early.out}`).toMatch(new RegExp(`^INFO  ${id} decided .*waits for agent-mcp\\.2026-11-12\\.1`));
    expect(early.lines.some((l) => l.startsWith("INFO  HO-1 waits for the frontend publish")), early.out).toBe(true);
    expect(early.lines.some((l) => l.startsWith("INFO  HO-1 (bake) waits for the frontend publish")), early.out).toBe(true);
    expect(early.calls.filter((c) => c.startsWith("POST "))).toEqual([]);
    expect(verdicts(early.lines).filter((l) => l.startsWith("FAIL")), early.out).toEqual([]);
  });
});

describe("what waits for what", () => {
  it("before agent-mcp.2026-11-12.1, its lines and rides are INFO and no agent-mcp POST is made", () => {
    const r = run(routes(OFF, { am: "agent-mcp.2026-11-09.2" }));
    expect(lineOf(r.lines, "V0", /agent-mcp/)).toMatch(/^INFO/);
    expect(r.lines.some((l) => /^INFO  S14X-091, S14X-263, S14X-262, S14X-052, S14X-260, RC-S9-002, M2-01, USAJOBS-COPY-1 and NB-31 wait for agent-mcp\.2026-11-12\.1/.test(l)), r.out).toBe(true);
    for (const id of RIDES) expect(lineOf(r.lines, id), id).toMatch(/^INFO/);
    expect(r.calls.filter((c) => c.startsWith("POST "))).toEqual([]);
    expect(r.calls.some((c) => c.includes("openai.com"))).toBe(false);
    expect(verdicts(r.lines).filter((l) => l.startsWith("FAIL")), r.out).toEqual([]);
  });

  it("the keyless calls wait for the build even when asked for", () => {
    const r = run(routes(OFF, { am: "agent-mcp.2026-11-09.2" }), { keylessCalls: true });
    expect(r.calls.filter((c) => c.startsWith("POST "))).toEqual([]);
  });

  it("before public-api.2026-11-12.1, only the shared form reader's rides wait", () => {
    const r = run(routes(OFF, { pa: "public-api.2026-11-09.1" }));
    expect(lineOf(r.lines, "V0", /public-api/)).toMatch(/^INFO/);
    expect(lineOf(r.lines, "S14X-134")).toMatch(/^INFO/);
    expect(lineOf(r.lines, "S14X-264")).toMatch(/^INFO/);
    for (const id of RIDES.filter((x) => !["S14X-134", "S14X-264"].includes(x))) expect(lineOf(r.lines, id), id).toMatch(/^PASS/);
    expect(verdicts(r.lines).filter((l) => l.startsWith("FAIL")), r.out).toEqual([]);
  });

  it("before the frontend publish, the page's lines are INFO, on the chunk and on the bake", () => {
    const r = run(routes(OFF, { mt: OLD_MT, ac: OLD_AC, bake: OLD_BAKE }));
    for (const id of PAGE) expect(r.lines.some((l) => l.startsWith(`INFO  ${id} waits for the frontend publish`)), `${id}\n${r.out}`).toBe(true);
    for (const id of ["S14X-260", "S14X-261", "SEO-F15", "USAJOBS-COPY-1"]) expect(r.lines.some((l) => l.startsWith(`INFO  ${id} (bake) waits for the frontend publish`)), id).toBe(true);
    expect(verdicts(r.lines).filter((l) => l.startsWith("FAIL")), r.out).toEqual([]);
  });

  it("the install README is INFO owner pending until ownerDecided names S14X-056", () => {
    const r = run(routes(OFF, { readme: README_PAID }));
    expect(lineOf(r.lines, "S14X-056-install"), r.out).toMatch(/^INFO  S14X-056-install owner pending/);
  });

  it("an OpenAI list that cannot be read is INFO, never a PASS over nothing", () => {
    const r = run(routes(OFF, { openai: { status: 403, body: "<html>blocked</html>" } }));
    expect(lineOf(r.lines, "NB-31"), r.out).toMatch(/^INFO/);
  });
});
