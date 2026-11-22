// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE FIX1121 SECTION CAN FAIL EVERY CLAIM AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzzzzzzzzz-fix1121-connector-errors.sh; lane
 * fix/1121-connector-errors, the owner's "people are getting errors when
 * using the mcp and API - lets fix it").
 *
 * Run against a fake curl that answers from routes (matched on the method,
 * the URL, any body, and which key the call carried in Authorization and in
 * x-api-key) and logs every call:
 *   - with today's builds serving (agent-mcp.2026-11-18.2 and
 *     public-api.2026-11-18.2, or the federal lane's 2026-11-19.1) every line
 *     is INFO and only the two build preflights are sent, with every key and
 *     the keyless calls asked for;
 *   - with only one of this lane's builds serving, still INFO;
 *   - with this lane's stamps but the answers the live connector and API gave
 *     on 2026-11-21 (datacircle-2026-11-21/probe-errors.json, probe-tools.json,
 *     probe-diagnose-connector-and-api.json), no line but CE0 passes and every
 *     claim CE1 to CE12 fails;
 *   - after a good deploy every claim passes, and a later build too;
 *   - each broken claim fails, and only it;
 *   - what cannot be judged is INFO, never a pass: no row, an employer name
 *     the board cannot place, sign-in on, no key confirmed revoked, no fresh
 *     key, and a 429 (after which the connector and the board are sent
 *     nothing);
 *   - every call is a read; no counted call is made unless
 *     VERIFY_KEYLESS_CALLS=1, and then four; keys are read only as
 *     RB_API_KEY_FRESH and ${RB_REVOKED_KEY:-${RB}}; the revoked key is sent
 *     only after GET /v1/stats with it answered 403 key_revoked; no key is
 *     ever printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readToolArgs } from "../../supabase/functions/agent-mcp/tool-args.ts";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const NAME = "99zzzzzzzzzzz-fix1121-connector-errors.sh";
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d", NAME), "utf8");
const def = (re: RegExp, what: string) => { const m = re.exec(SCRIPT); if (!m) throw new Error(`no ${what} in the verifier`); return m[0]; };
const BUILD_GE = def(/^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge");
const J_FN = def(/^J\(\) \{.*\}$/m, "J");
const MC_FN = def(/^MC\(\) \{.*\}$/m, "MC");
const KEY = "pk_test_SECRET_marker_fix1121";
const REV = "rb_live_REVOKED_marker_fix1121";
const REV2 = "rb_live_REVOKED_TWO_marker_fix1121";
const FRESH = "rb_live_FRESH_marker_fix1121";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

/** The fake curl: answers from VD_ROUTES, logs every call to VD_CALLS, says which key each header carried. */
const FAKE_CURL = String.raw`#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null,head=false;const H=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")H.push(a[++i]);
  else if(x==="-I"||x==="--head")head=true;
  else if(["-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(head)method="HEAD";
if(data!==null&&method==="GET")method="POST";
const hv=(n)=>{const h=H.find((y)=>y.toLowerCase().startsWith(n+":"));return h===undefined?null:h.slice(h.indexOf(":")+1).trim();};
const E=process.env;
const who=(v)=>v===null?"NONE":v===E.VD_K?"ANON":v===E.VD_REV?"REV":v===E.VD_REV2?"REV2":v===E.VD_FRESH?"FRESH":v==="not-a-key"?"JUNK":"OTHER";
const auth=hv("authorization");
const A=who(auth===null?null:auth.replace(/^bearer\s*/i,""));
const X=who(hv("x-api-key"));
const budget=hv("x-rb-budget");
fs.appendFileSync(E.VD_CALLS,method+" "+url+" AUTH:"+A+" XKEY:"+X+(budget?" BUDGET:"+budget:"")+(data!==null?" DATA:"+data:"")+"\n");
const routes=JSON.parse(fs.readFileSync(E.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?" "+data:"")+" AUTH:"+A+" XKEY:"+X;
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status===undefined?200:r.status;
const hdr="HTTP/2 "+st+"\r\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\r\n").join("")+"\r\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=method==="HEAD"?"":(r.body===undefined?"":r.body);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type RunOpts = { fresh?: boolean; keyless?: boolean; rb?: string; revokedKey?: string };
function run(routes: Route[], opts: RunOpts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vdce-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const rb = opts.rb === undefined ? REV : opts.rb;
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua; RB=${rb}\n${BUILD_GE}\n${J_FN}\n${MC_FN}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    VD_K: KEY, VD_REV: REV, VD_REV2: REV2, VD_FRESH: FRESH,
    VERIFY_CALL_GAP: "0",
  };
  delete env.RB_API_KEY_FRESH;
  delete env.RB_REVOKED_KEY;
  delete env.VERIFY_KEYLESS_CALLS;
  if (opts.fresh) env.RB_API_KEY_FRESH = FRESH;
  if (opts.keyless) env.VERIFY_KEYLESS_CALLS = "1";
  if (opts.revokedKey !== undefined) env.RB_REVOKED_KEY = opts.revokedKey;
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = `${String((e as { stdout?: string }).stdout ?? "")}\n${String((e as { stderr?: string }).stderr ?? "")}`; }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

// ── the world ────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const P = "https://p.supabase.co";
const PA = `${P}/functions/v1/public-api`;
const MCP = `${P}/functions/v1/agent-mcp`;
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const REVISIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2099-01-01"];

type Ans = { status?: number; body: unknown; headers?: Record<string, string> };
const ok = (body: unknown, headers?: Record<string, string>): Ans => ({ status: 200, body, headers });
const at = (status: number, body: unknown, headers?: Record<string, string>): Ans => ({ status, body, headers });
/** A tool's answer as the server sends it: the JSON text block (after any lead lines) and the structured half. */
const toolAns = (sc: Record<string, unknown>, lead?: string, headers?: Record<string, string>): Ans =>
  ok({ jsonrpc: "2.0", id: 1, result: { content: [...(lead ? [{ type: "text", text: lead }] : []), { type: "text", text: JSON.stringify(sc) }], structuredContent: sc } }, headers);
/** A tool's refusal, in band. */
const toolErr = (error: string, fix = "Send it again as the message says.", headers?: Record<string, string>): Ans =>
  ok({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ error, fix }) }], isError: true } }, headers);

const TEN = ["search_jobs", "get_job", "get_jobs", "check_jobs_open", "apply_myself", "board_stats", "employer_hiring_record", "employer_growth", "search", "fetch"];
const TWELVE = [...TEN, "fit_resume", "key_status"];
const FF = { p50Minutes: 42, p95Minutes: 180, asOf: ago(5) };
const COLOUR_LINE = `search_jobs does not take "colour", so it was not applied. It takes: query, location, country, remote, workMode, employmentType, category, department, companies, experience, maxAgeDays, postedAfter, salaryMin, salaryMax, includeUnstatedPay, hasStatedPay, payBasis, maxYears, vendor, excludeAgencies, sort, limit, offset, agentReadyOnly.`;
const REVOKED_NOTE = "The key sent has been revoked (a newer key replaced it, it went unused for 30 days, or it was issued before keys needed a confirmed email); this call ran without it. A new key comes from https://resumebooster.work/data-api.";
const ieRow = (i: number) => ({ id: `greenhouse:acme:${100 + i}`, title: "Recruiter", company: "Acme", companyToken: "acme", country: "IE", location: "Dublin, IE" });
const itRow = (i: number) => ({ id: `lever:beta:it-${i}`, title: "Project Manager", company: "Beta", companyToken: "beta", country: "IT", location: "Milan, IT" });
const usRow = (i: number) => ({ id: `workday:homedepot~wd5~careerdepot:Req${198700 + i}`, title: "Field Sales Consultant", company: "Home Depot", country: "US" });
const GUIDE_GOOD = [
  "- `total` counts postings whose title, employer name or department matched the words; `relatedTotal` counts those matched only in their description.",
  "- `notApplied` opens an answer that was sent a name the tool does not take (or a filter it cannot apply): that name was not applied, so tell the person what the results do not reflect, and resend it under the name `didYouMean` offers when there is one.",
].join("\n");
const GUIDE_TODAY = "- `total` counts postings whose TITLE matched the words; `relatedTotal` counts those matched only in their description.";

type Refusal = "page" | "atlantis" | "georgia" | "type" | "age";
type World = {
  apiBuild: string; mcpBuild: string;
  signIn: "off" | "on";
  init: Record<string, Ans>;
  cors: string;
  discover: Ans; oldmeta: Ans;
  refusals: Record<Refusal, Ans>;
  listNone: Ans; listJunk: Ans;
  keyStatus: Ans;
  guide: Ans;
  revCheck: Ans;
  s5: Ans; s6: Ans; s7: Ans; s11: Ans;
  countAll: Ans; countSr: Ans;
  doc: Ans; nope: Ans; jobs: Ans; root: Ans; head: number; xrev: Ans;
  kIe: Ans; kAt: Ans; kCo: Ans;
};

const initAns = (v: string, signIn: "off" | "on"): Ans => ok({
  jsonrpc: "2.0", id: 11, result: { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "resumebooster", version: "2026-09-04.11" }, _meta: { "work.resumebooster/sign-in": { state: signIn } } },
});
const listAns = (names: string[]): Ans => ok({ jsonrpc: "2.0", id: 41, result: { tools: names.map((name) => ({ name })) } });

const GOOD = (): World => {
  const negotiated = (v: string) => (["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].includes(v) ? v : "2025-11-25");
  return {
    apiBuild: "public-api.2026-11-21.1",
    mcpBuild: "agent-mcp.2026-11-21.1",
    signIn: "off",
    init: Object.fromEntries(REVISIONS.map((v) => [v, initAns(negotiated(v), "off")])),
    cors: "authorization, x-api-key, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id, last-event-id, mcp-method, mcp-name",
    discover: at(400, { jsonrpc: "2.0", id: 21, error: { code: -32600, message: "This server speaks the initialize handshake (protocol 2025-11-25 and earlier): send initialize first.", data: { handshakeVersions: ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] } } }),
    oldmeta: at(400, { jsonrpc: "2.0", id: 22, error: { code: -32022, message: "unsupported" } }),
    refusals: {
      page: toolErr("search_jobs pages by offset: send offset = nextOffset from the previous answer.", "Leave page out; send offset = nextOffset (0 for the first page)."),
      atlantis: toolErr(`country: "Atlantis" is not a country this board knows.`),
      georgia: toolErr(`country: "Georgia" has two readings. Send GE for the country, or US with location Georgia for the state.`),
      type: toolErr(`employmentType "sometimes" is not one this board files postings under. It takes: full_time, part_time, contract, temporary, internship.`),
      age: toolErr("maxAgeDays takes a whole number of days from 1 to 30; for postings dated after a day, send postedAfter."),
    },
    listNone: listAns(TEN),
    listJunk: listAns(TEN),
    keyStatus: toolAns({ key: { tier: "none", state: "none" }, keyless: { lookupsPerDay: 100, sharedPerDay: 4000, perMinute: 15 }, getAKey: "https://resumebooster.work/data-api" }),
    guide: ok({ jsonrpc: "2.0", id: 121, result: { contents: [{ uri: "resumebooster://guide", mimeType: "text/markdown", text: GUIDE_GOOD }] } }),
    revCheck: at(403, { error: { code: "key_revoked", message: "This key has been revoked." } }),
    s5: toolAns({
      notApplied: [COLOUR_LINE],
      jobs: Array.from({ length: 10 }, (_, i) => ieRow(i)),
      total: 412, hasMore: true, nextOffset: 10,
      argumentsRead: { keyword: "query" }, countryRead: { Ireland: "IE" }, ignoredArguments: ["colour"],
      limitAsked: 50, limitApplied: 10, limitNote: "A keyless page holds 10 rows: ask for the next with offset = nextOffset (10).",
      feedFreshness: FF,
    }, COLOUR_LINE),
    s6: toolAns({
      jobs: Array.from({ length: 10 }, (_, i) => itRow(i)),
      total: 108, withheld: 3, withheldTotal: 12, refillReads: 1, hasMore: true, nextOffset: 13,
      unkeyed: { keyNote: REVOKED_NOTE, remaining: 96 },
      feedFreshness: FF,
    }),
    s7: toolAns({ employers: [{ company_token: "anthropic", asked: "Anthropic", resolvedFrom: "name", verdict: "steady" }] }),
    s11: toolAns({ open: { [itRow(0).id]: true, [itRow(1).id]: true }, closed: [], checked: 2, openCount: 2, closedCount: 0 }),
    countAll: ok({ total: 120, hasMore: true }),
    countSr: ok({ total: 12, hasMore: false }),
    doc: ok({ openapi: "3.1.0", info: { title: "Resume Booster data API", version: "2026-11-21.1" }, paths: { "/v1/jobs": { get: {} }, "/v1/stats": { get: {} } } }),
    nope: at(404, { error: { code: "no_such_endpoint", message: "No route /v1/no-such-path. The index at /v1 lists them." } }),
    jobs: at(401, { error: { code: "missing_key", message: "Send your key as Authorization: Bearer <key>, or as x-api-key: <key>." }, getAKey: { url: "https://resumebooster.work/data-api", step: "Confirm your email and copy the key." } }, { "www-authenticate": `Bearer realm="resumebooster.work"` }),
    root: ok({ apiVersion: "2026-11-21.1", getAKey: { url: "https://resumebooster.work/data-api" }, openapi: "/v1/openapi.json", keylessSample: { offered: false } }),
    head: 200,
    xrev: at(403, { error: { code: "key_revoked", message: "This key has been revoked." } }),
    kIe: ok({ data: [ieRow(1), ieRow(2), ieRow(3)], disclosures: { countryRead: { read: { Ireland: "IE" } } }, coverage: { feedFreshness: FF } }),
    kAt: at(400, { error: { code: "bad_parameter", message: `country "Atlantis" is not a country this API knows.` } }),
    kCo: ok({ data: [], page: { maxLimit: 100, limit: 100 }, disclosures: { limitCapped: { requested: 500, applied: 100, reason: "max_limit" } } }),
  };
};

/**
 * TODAY: what the live connector and API answered on 2026-11-21, served under
 * this lane's stamps (so CE0 passes and every claim is judged).
 */
const TODAY_UNDER_NEW_STAMPS = (): World => {
  const counted = { "x-unkeyed-remaining": "97" };
  const page = (rows: unknown[], total: number) => toolAns({ jobs: rows, total, hasMore: true, nextOffset: rows.length }, undefined, counted);
  const whole = Array.from({ length: 10 }, (_, i) => usRow(i));
  return {
    ...GOOD(),
    init: Object.fromEntries(REVISIONS.map((v) => [v, initAns("2025-06-18", "off")])),
    cors: "authorization, x-client-info, apikey, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
    discover: ok({ jsonrpc: "2.0", id: 21, error: { code: -32601, message: "method not found: server/discover — supported: initialize, tools/list, tools/call" } }),
    oldmeta: ok({ jsonrpc: "2.0", id: 22, result: { tools: [] } }),
    refusals: { page: page(whole, 1_014_686), atlantis: page(whole, 1_014_686), georgia: page(whole, 52_000), type: page(whole, 3_100), age: page(whole, 3_100) },
    listNone: listAns(TEN),
    listJunk: listAns(TWELVE),
    keyStatus: toolErr("Sign-in through this server is not switched on yet, so this tool needs a key."),
    guide: ok({ jsonrpc: "2.0", id: 121, result: { contents: [{ uri: "resumebooster://guide", mimeType: "text/markdown", text: GUIDE_TODAY }] } }),
    s5: page(whole, 1_014_686),
    s6: toolErr("The key sent has been revoked.", "Mint a new key at https://resumebooster.work/data-api."),
    s7: toolErr("employer_growth needs companyTokens — an array of companyToken values from job cards (up to 20)."),
    s11: toolAns({ open: { [`${usRow(0).id}, ${usRow(1).id}`]: false }, closed: [`${usRow(0).id}, ${usRow(1).id}`], checked: 1, openCount: 0, closedCount: 1 }),
    doc: at(401, { error: { code: "missing_key", message: "Send your key as: Authorization: Bearer <key>. Request one at https://resumebooster.work/data-api" }, apiVersion: "2026-10-11.1" }),
    nope: at(401, { error: { code: "missing_key", message: "Send your key as: Authorization: Bearer <key>." } }),
    jobs: at(401, { error: { code: "missing_key", message: "Send your key as: Authorization: Bearer <key>. Request one at https://resumebooster.work/data-api" }, apiVersion: "2026-10-11.1" }),
    root: ok({ apiVersion: "2026-10-11.1", docs: "https://resumebooster.work/data-api", endpoints: ["/v1/jobs", "/v1/stats"] }),
    head: 404,
    xrev: at(401, { error: { code: "missing_key", message: "Send your key as: Authorization: Bearer <key>." } }),
    kIe: at(401, { error: { code: "missing_key", message: "Send your key as: Authorization: Bearer <key>." } }),
    kAt: at(401, { error: { code: "missing_key", message: "Send your key as: Authorization: Bearer <key>." } }),
    kCo: at(401, { error: { code: "missing_key", message: "Send your key as: Authorization: Bearer <key>." } }),
  };
};
/** The same answers under the builds live today. */
const TODAY = (): World => ({ ...TODAY_UNDER_NEW_STAMPS(), apiBuild: "public-api.2026-11-18.2", mcpBuild: "agent-mcp.2026-11-18.2" });

const route = (match: string, a: Ans): Route => ({ match, status: a.status ?? 200, headers: a.headers, body: typeof a.body === "string" ? a.body : JSON.stringify(a.body) });
const call = (name: string, args: string) => esc(`"method":"tools/call","params":{"name":"${name}","arguments":${args}`);

function routes(w: World): Route[] {
  return [
    { match: `^OPTIONS ${esc(PA)}/v1 `, headers: { "x-fn-build": w.apiBuild } },
    { match: `^OPTIONS ${esc(MCP)} `, headers: { "x-fn-build": w.mcpBuild, "access-control-allow-headers": w.cors } },
    ...REVISIONS.map((v) => route(`^POST ${esc(MCP)} .*${esc(`"method":"initialize","params":{"protocolVersion":"${v}"`)}`, w.init[v])),
    route(`^POST ${esc(MCP)} .*"method":"server/discover"`, w.discover),
    route(`^POST ${esc(MCP)} .*${esc(`"_meta":{"io.modelcontextprotocol/protocolVersion":"1900-01-01"}`)}`, w.oldmeta),
    route(`^POST ${esc(MCP)} .*"method":"tools/list".* AUTH:JUNK `, w.listJunk),
    route(`^POST ${esc(MCP)} .*"method":"tools/list".* AUTH:NONE `, w.listNone),
    route(`^POST ${esc(MCP)} .*"method":"resources/read"`, w.guide),
    route(`^POST ${esc(MCP)} .*${call("key_status", "{}")}`, w.keyStatus),
    route(`^POST ${esc(MCP)} .*${call("search_jobs", `{"query":"nurse","page":2}`)}`, w.refusals.page),
    route(`^POST ${esc(MCP)} .*${call("search_jobs", `{"query":"nurse","country":"Atlantis"}`)}`, w.refusals.atlantis),
    route(`^POST ${esc(MCP)} .*${call("search_jobs", `{"query":"nurse","location":"Atlanta","country":"Georgia"}`)}`, w.refusals.georgia),
    route(`^POST ${esc(MCP)} .*${call("search_jobs", `{"query":"nurse","employmentType":"sometimes"}`)}`, w.refusals.type),
    route(`^POST ${esc(MCP)} .*${call("search_jobs", `{"query":"nurse","maxAgeDays":0}`)}`, w.refusals.age),
    route(`^POST ${esc(MCP)} .*${call("search_jobs", `{"keyword":"Recruiter"`)}`, w.s5),
    route(`^POST ${esc(MCP)} .*${call("search_jobs", `{"query":"Manager","country":"IT","limit":10}`)}`, w.s6),
    route(`^POST ${esc(MCP)} .*${call("employer_growth", "")}`, w.s7),
    route(`^POST ${esc(MCP)} .*${call("check_jobs_open", "")}`, w.s11),
    route(`^POST ${esc(P)}/functions/v1/job-board ${esc(`{"action":"list","q":"Manager","country":"IT","vendor":"smartrecruiters","countOnly":true}`)} AUTH:ANON `, w.countSr),
    route(`^POST ${esc(P)}/functions/v1/job-board ${esc(`{"action":"list","q":"Manager","country":"IT","countOnly":true}`)} AUTH:ANON `, w.countAll),
    route(`^GET ${esc(PA)}/v1/stats AUTH:(REV|REV2) XKEY:NONE$`, w.revCheck),
    route(`^GET ${esc(PA)}/v1/stats AUTH:NONE XKEY:(REV|REV2)$`, w.xrev),
    route(`^GET ${esc(PA)}/v1/openapi\\.json AUTH:NONE XKEY:NONE$`, w.doc),
    route(`^GET ${esc(PA)}/v1/no-such-path AUTH:NONE XKEY:NONE$`, w.nope),
    route(`^GET ${esc(PA)}/v1/jobs\\?limit=1 AUTH:NONE XKEY:NONE$`, w.jobs),
    { match: `^HEAD ${esc(PA)}/v1 AUTH:NONE XKEY:NONE$`, status: w.head },
    route(`^GET ${esc(PA)}/v1 AUTH:NONE XKEY:NONE$`, w.root),
    route(`^GET ${esc(PA)}/v1/jobs\\?country=Ireland&limit=5 AUTH:NONE XKEY:FRESH$`, w.kIe),
    route(`^GET ${esc(PA)}/v1/jobs\\?country=Atlantis&limit=5 AUTH:NONE XKEY:FRESH$`, w.kAt),
    route(`^GET ${esc(PA)}/v1/companies\\?limit=500 AUTH:NONE XKEY:FRESH$`, w.kCo),
  ];
}

type Verdict = "PASS" | "FAIL" | "INFO";
const verdicts = (lines: string[], v: Verdict) => lines.filter((l) => l.startsWith(`${v}  `));
const has = (lines: string[], v: Verdict, id: string) => lines.some((l) => l.startsWith(`${v}  ${id} `));
/** The claim keys that printed a verdict (CE3, CE5d, CE5+6, ...). */
const keysOf = (lines: string[], v: Verdict) => [...new Set(verdicts(lines, v).map((l) => l.slice(v.length + 2).split(" ")[0]))].sort();
const ALL_KEYS = ["CE0", "CE1", "CE2", "CE3", "CE4", "CE5", "CE5+6", "CE5d", "CE6", "CE7", "CE8", "CE9", "CE11", "CE12"].sort();

/** The tool calls the shared keyless allowance pays for: every tools/call but key_status and the five in-band refusals. */
const REFUSED_ARGS = [`"page":2`, `"country":"Atlantis"`, `"country":"Georgia"`, `"employmentType":"sometimes"`, `"maxAgeDays":0`];
function counted(calls: string[]): string[] {
  return calls.filter((c) => c.startsWith(`POST ${MCP} `) && c.includes(`"method":"tools/call"`) && !c.includes(`"name":"key_status"`) && !REFUSED_ARGS.some((a) => c.includes(a)));
}
/** Every call that is not a read: anything but OPTIONS, GET or HEAD, a probe-budget board count, or a reading JSON-RPC method or tool. */
function writes(calls: string[]): string[] {
  return calls.filter((c) => {
    if (/^(OPTIONS|GET|HEAD) /.test(c)) return false;
    if (/^POST https:\/\/p\.supabase\.co\/functions\/v1\/job-board AUTH:ANON XKEY:NONE BUDGET:probe DATA:\{"action":"list",[^}]*"countOnly":true\}$/.test(c)) return false;
    const m = /^POST https:\/\/p\.supabase\.co\/functions\/v1\/agent-mcp AUTH:(NONE|JUNK|REV|REV2) XKEY:NONE BUDGET:probe DATA:(\{.*\})$/.exec(c);
    if (!m) return true;
    let j: { method?: string; params?: { name?: string } };
    try { j = JSON.parse(m[2]); } catch { return true; }
    if (["initialize", "tools/list", "server/discover", "resources/read"].includes(String(j.method))) return false;
    if (j.method === "tools/call" && ["search_jobs", "key_status", "employer_growth", "check_jobs_open"].includes(String(j.params?.name))) return false;
    return true;
  });
}
const keyed = (calls: string[], who: string) => calls.filter((c) => new RegExp(` AUTH:${who} | XKEY:${who}( |$)`).test(c));

// ── before the deploy ────────────────────────────────────────────────────────

describe("before the deploy: INFO only, and nothing but the two build preflights is sent", () => {
  for (const [label, w] of [["today's live builds", TODAY()], ["the federal lane's builds", { ...TODAY(), apiBuild: "public-api.2026-11-19.1", mcpBuild: "agent-mcp.2026-11-19.1" }]] as const) {
    it(`${label}: every line is INFO with every key and keyless calls asked for`, () => {
      const r = run(routes(w), { fresh: true, keyless: true });
      expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
      expect(verdicts(r.lines, "PASS"), r.out).toEqual([]);
      expect(has(r.lines, "INFO", "CE0"), r.out).toBe(true);
      expect(r.lines.some((l) => /^INFO  CE1-CE13 not run/.test(l)), r.out).toBe(true);
      expect(r.calls.map((c) => c.split(" ").slice(0, 2).join(" ")), r.calls.join("\n")).toEqual([`OPTIONS ${PA}/v1`, `OPTIONS ${MCP}`]);
    });
  }

  it("only one of the two builds serving is still INFO, and spends nothing", () => {
    for (const w of [{ ...GOOD(), mcpBuild: "agent-mcp.2026-11-19.1" }, { ...GOOD(), apiBuild: "public-api.2026-11-18.2" }]) {
      const r = run(routes(w), { fresh: true, keyless: true });
      expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
      expect(verdicts(r.lines, "PASS"), r.out).toEqual([]);
      expect(r.calls.filter((c) => !c.startsWith("OPTIONS ")), r.calls.join("\n")).toEqual([]);
    }
  });
});

// ── today's answers under the new stamps ─────────────────────────────────────

describe("this lane's stamps answering as the connector and the API answered on 2026-11-21: every claim fails", () => {
  it("no line but CE0 passes, and each of CE1 to CE12 fails", () => {
    const r = run(routes(TODAY_UNDER_NEW_STAMPS()), { fresh: true, keyless: true });
    expect(keysOf(r.lines, "PASS"), r.out).toEqual(["CE0"]);
    expect(keysOf(r.lines, "FAIL"), r.out).toEqual(ALL_KEYS.filter((k) => k !== "CE0"));
    // Each of the five refusals fails on its own line, and so does each /v1 read.
    expect(r.lines.filter((l) => l.startsWith("FAIL  CE3 "))).toHaveLength(5);
    expect(r.lines.filter((l) => l.startsWith("FAIL  CE8 "))).toHaveLength(6);
    expect(r.lines.filter((l) => l.startsWith("FAIL  CE9 "))).toHaveLength(3);
    expect(r.lines.filter((l) => l.startsWith("FAIL  CE12 "))).toHaveLength(2);
  });
});

// ── after a good deploy ──────────────────────────────────────────────────────

describe("after a good deploy every claim passes", () => {
  it("CE0 to CE12 pass with a fresh key, a confirmed revoked key and the keyless calls, and nothing fails", () => {
    const r = run(routes(GOOD()), { fresh: true, keyless: true });
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    expect(keysOf(r.lines, "PASS"), r.out).toEqual(ALL_KEYS);
    expect(r.lines.filter((l) => l.startsWith("PASS  CE1 "))).toHaveLength(2);
    expect(r.lines.filter((l) => l.startsWith("PASS  CE3 "))).toHaveLength(5);
    expect(r.lines.filter((l) => l.startsWith("PASS  CE4 "))).toHaveLength(2);
    expect(r.lines.filter((l) => l.startsWith("PASS  CE8 "))).toHaveLength(6);
    expect(r.lines.filter((l) => l.startsWith("PASS  CE9 "))).toHaveLength(3);
    expect(r.lines.filter((l) => l.startsWith("PASS  CE12 "))).toHaveLength(2);
    expect(r.lines.filter((l) => l.startsWith("INFO  CE13 "))).toHaveLength(2);
  });

  it("the four counted calls are the four the section names, and CE11 checks the first two ids of CE6's page as one string", () => {
    const r = run(routes(GOOD()), { fresh: true, keyless: true });
    const c = counted(r.calls);
    expect(c, r.calls.join("\n")).toHaveLength(4);
    expect(c[0]).toContain(`"keyword":"Recruiter","country":"Ireland","limit":50,"location":null,"sort":"","colour":"red"`);
    expect(c[1]).toContain(`"query":"Manager","country":"IT","limit":10`);
    expect(c[2]).toContain(`"name":"employer_growth","arguments":{"company":"Anthropic"}`);
    expect(c[3]).toContain(`"ids":"${itRow(0).id}, ${itRow(1).id}"`);
  });

  it("a later build on either function passes CE0 too", () => {
    const r = run(routes({ ...GOOD(), apiBuild: "public-api.2026-11-24.2", mcpBuild: "agent-mcp.2026-12-02.1" }), { fresh: true });
    expect(has(r.lines, "PASS", "CE0"), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("a server that serves 2026-07-28 passes CE2 when an unknown _meta version is HTTP 400 with -32022, and fails when it is answered", () => {
    const served = { ...GOOD(), discover: ok({ jsonrpc: "2.0", id: 21, result: { resultType: "complete", supportedVersions: ["2026-07-28", "2025-11-25"] } }) };
    const r = run(routes(served));
    expect(has(r.lines, "PASS", "CE2"), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    const r2 = run(routes({ ...served, oldmeta: ok({ jsonrpc: "2.0", id: 22, result: { tools: [] } }) }));
    expect(has(r2.lines, "FAIL", "CE2"), r2.out).toBe(true);
    expect(keysOf(r2.lines, "FAIL")).toEqual(["CE2"]);
  });
});

// ── each broken claim fails, and only it ─────────────────────────────────────

type Break = [key: string, what: string, breakIt: (w: World) => void, alsoFails?: string[]];
const sc = (a: Ans) => (a.body as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
/** Rebuild a tool answer from its structured half, as the server would (its lead line kept). */
const reTool = (a: Ans, edit: (s: Record<string, unknown>) => void, lead?: string | null) => {
  const s = structuredClone(sc(a));
  edit(s);
  const old = (a.body as { result: { content: Array<{ text: string }> } }).result.content;
  return toolAns(s, lead === null ? undefined : lead ?? (old.length > 1 ? old[0].text : undefined), a.headers);
};
const BROKEN: Break[] = [
  ["CE1", "2024-11-05 answered as 2025-06-18", (w) => { w.init["2024-11-05"] = initAns("2025-06-18", "off"); }],
  ["CE1", "a revision it does not speak echoed back", (w) => { w.init["2099-01-01"] = initAns("2099-01-01", "off"); }],
  ["CE1", "a preflight that does not allow mcp-name", (w) => { w.cors = "authorization, x-api-key, apikey, content-type, mcp-protocol-version, mcp-method"; }],
  ["CE2", "server/discover answered HTTP 200 with -32601", (w) => { w.discover = ok({ jsonrpc: "2.0", id: 21, error: { code: -32601, message: "method not found" } }); }],
  ["CE2", "server/discover answered HTTP 400 with -32601", (w) => { w.discover = at(400, { jsonrpc: "2.0", id: 21, error: { code: -32601, message: "method not found" } }); }],
  ["CE3", "page 2 answered as a page", (w) => { w.refusals.page = toolAns({ jobs: [ieRow(1)], total: 1 }); }],
  ["CE3", "Atlantis refused but counted", (w) => { w.refusals.atlantis = toolErr(`country: "Atlantis" is not a country this board knows.`, "x", { "x-unkeyed-remaining": "97" }); }],
  ["CE3", "Georgia refused naming only GE", (w) => { w.refusals.georgia = toolErr(`country: "Georgia" was read as GE.`); }],
  ["CE3", "employmentType refused without its set", (w) => { w.refusals.type = toolErr(`employmentType "sometimes" is not a value.`); }],
  ["CE3", "maxAgeDays 0 refused without postedAfter", (w) => { w.refusals.age = toolErr("maxAgeDays takes 1 to 30."); }],
  ["CE3", "a refusal that answered 429 (it went through the meter)", (w) => { w.refusals.atlantis = at(429, { jsonrpc: "2.0", id: 32, error: { code: -32000, message: "minute spent" } }); }],
  ["CE4", "a bearer that is no key listed the keyed tools", (w) => { w.listJunk = listAns(TWELVE); }],
  ["CE4", "key_status listed with no key", (w) => { w.listNone = listAns([...TEN.slice(0, 9), "key_status"]); w.listJunk = listAns([...TEN.slice(0, 9), "key_status"]); }],
  ["CE4", "key_status with no key refused", (w) => { w.keyStatus = toolErr("This tool needs a key."); }],
  ["CE4", "key_status with no key naming a tier", (w) => { w.keyStatus = reTool(w.keyStatus, (s) => { s.key = { tier: "free" }; }); }],
  ["CE5", "the keyword not said as read", (w) => { w.s5 = reTool(w.s5, (s) => { delete s.argumentsRead; }); }],
  ["CE5", "Ireland not said as IE", (w) => { w.s5 = reTool(w.s5, (s) => { delete s.countryRead; }); }],
  ["CE5", "a card outside Ireland", (w) => { w.s5 = reTool(w.s5, (s) => { (s.jobs as Array<Record<string, unknown>>)[3] = usRow(3); }); }],
  ["CE5", "the whole board's total", (w) => { w.s5 = reTool(w.s5, (s) => { s.total = 3525; }); }],
  ["CE5", "a limit cut without a word", (w) => { w.s5 = reTool(w.s5, (s) => { delete s.limitAsked; delete s.limitApplied; delete s.limitNote; }); }],
  ["CE5", "a SmartRecruiters posting handed on", (w) => { w.s5 = reTool(w.s5, (s) => { (s.jobs as Array<Record<string, unknown>>)[0] = { ...ieRow(0), id: "smartrecruiters:acme1:744000012345" }; }); }],
  ["CE5", "a short page with more to come and no reason", (w) => { w.s5 = reTool(w.s5, (s) => { s.jobs = (s.jobs as unknown[]).slice(0, 7); }); }],
  ["CE5", "a null or an empty string sent on (an argument error)", (w) => { w.s5 = toolErr("sort takes one of: relevance, newest, salary; got \"\"."); }, ["CE5d"]],
  ["CE5d", "colour dropped without a word (today's answer)", (w) => { w.s5 = reTool(w.s5, (s) => { delete s.notApplied; delete s.ignoredArguments; }, null); }],
  ["CE5d", "colour said in the JSON but not on the first line", (w) => { w.s5 = reTool(w.s5, () => { /* the same answer, its lead line dropped */ }, null); }],
  ["CE5d", "colour refused (the lane's first build, before D3)", (w) => { w.s5 = toolErr(`search_jobs does not take "colour". It takes: query, location, country.`); }, ["CE5"]],
  ["CE6", "a SmartRecruiters posting handed on", (w) => { w.s6 = reTool(w.s6, (s) => { (s.jobs as Array<Record<string, unknown>>)[2] = { ...itRow(2), id: "smartrecruiters:beta1:744000099" }; }); }],
  ["CE6", "a short page with withheld rows and no reason", (w) => { w.s6 = reTool(w.s6, (s) => { s.jobs = (s.jobs as unknown[]).slice(0, 7); }); }],
  ["CE6", "refill_limit said after one refill read", (w) => { w.s6 = reTool(w.s6, (s) => { s.jobs = (s.jobs as unknown[]).slice(0, 7); s.pageShortBecause = "refill_limit"; s.refillReads = 1; }); }],
  ["CE6", "withheld rows and neither withheldTotal nor totalIncludesWithheld", (w) => { w.s6 = reTool(w.s6, (s) => { delete s.withheldTotal; }); }],
  ["CE6", "withheldTotal off the board's SmartRecruiters count", (w) => { w.s6 = reTool(w.s6, (s) => { s.withheldTotal = 40; s.total = 80; }); }],
  ["CE6", "total and withheldTotal off the board's all-source count", (w) => { w.s6 = reTool(w.s6, (s) => { s.total = 150; }); }],
  ["CE6", "the revoked key's answer without a note naming it", (w) => { w.s6 = reTool(w.s6, (s) => { s.unkeyed = { remaining: 96 }; }); }],
  ["CE6", "the revoked key refused on a keyless tool (today's answer)", (w) => { w.s6 = toolErr("The key sent has been revoked."); }],
  ["CE5+6", "no search answer carrying feedFreshness", (w) => { w.s5 = reTool(w.s5, (s) => { delete s.feedFreshness; }); w.s6 = reTool(w.s6, (s) => { delete s.feedFreshness; }); }],
  ["CE5+6", "p95Minutes below p50Minutes", (w) => { w.s6 = reTool(w.s6, (s) => { s.feedFreshness = { ...FF, p95Minutes: 10 }; }); }],
  ["CE5+6", "an asOf in the future", (w) => { w.s5 = reTool(w.s5, (s) => { s.feedFreshness = { ...FF, asOf: ago(-120) }; }); }],
  ["CE7", "employer_growth refused a name (today's answer)", (w) => { w.s7 = toolErr("employer_growth needs companyTokens."); }],
  ["CE7", "a row that does not say the name it read", (w) => { w.s7 = toolAns({ employers: [{ company_token: "anthropic", verdict: "steady" }] }); }],
  ["CE8", "the OpenAPI document behind a key", (w) => { w.doc = at(401, { error: { code: "missing_key" } }); }],
  ["CE8", "an unknown path answered as a missing key", (w) => { w.nope = at(401, { error: { code: "missing_key" } }); }],
  ["CE8", "a 401 without WWW-Authenticate", (w) => { w.jobs = { ...w.jobs, headers: {} }; }],
  ["CE8", "a 401 that does not name x-api-key", (w) => { w.jobs = at(401, { error: { code: "missing_key", message: "Send your key as Authorization: Bearer <key>. https://resumebooster.work/data-api" } }, w.jobs.headers); }],
  ["CE8", "an index without getAKey", (w) => { w.root = ok({ apiVersion: "2026-11-21.1", openapi: "/v1/openapi.json", keylessSample: { offered: false } }); }],
  ["CE8", "an index that offers a keyless sample the keyless /v1/jobs refused", (w) => { w.root = ok({ ...(w.root.body as object), keylessSample: { offered: true } }); }],
  ["CE8", "HEAD /v1 refused", (w) => { w.head = 405; }],
  ["CE8", "a key in x-api-key not read (today's answer)", (w) => { w.xrev = at(401, { error: { code: "missing_key" } }); }],
  ["CE9", "a row outside Ireland", (w) => { w.kIe = ok({ ...(w.kIe.body as object), data: [ieRow(1), { ...ieRow(2), country: "GB" }] }); }],
  ["CE9", "Ireland not said as read", (w) => { w.kIe = ok({ ...(w.kIe.body as object), disclosures: {} }); }],
  ["CE9", "no feedFreshness on /v1/jobs", (w) => { w.kIe = ok({ ...(w.kIe.body as object), coverage: {} }); }],
  ["CE9", "Atlantis answered as a page", (w) => { w.kAt = ok({ data: [] }); }],
  ["CE9", "a cap cut without a word", (w) => { w.kCo = ok({ data: [], page: { limit: 100 } }); }],
  ["CE11", "ids in one comma string checked as one id (today's answer)", (w) => { w.s11 = toolAns({ open: { [`${itRow(0).id}, ${itRow(1).id}`]: false }, closed: [`${itRow(0).id}, ${itRow(1).id}`], checked: 1 }); }],
  ["CE11", "an open id called closed", (w) => { w.s11 = toolAns({ open: { [itRow(0).id]: true }, closed: [itRow(1).id], checked: 2 }); }],
  ["CE12", "the guide says total counts title matches only (today's guide)", (w) => { w.guide = ok({ jsonrpc: "2.0", id: 121, result: { contents: [{ uri: "resumebooster://guide", text: `${GUIDE_TODAY}\n${GUIDE_GOOD.split("\n")[1]}` }] } }); }],
  ["CE12", "the guide does not say notApplied opens an answer", (w) => { w.guide = ok({ jsonrpc: "2.0", id: 121, result: { contents: [{ uri: "resumebooster://guide", text: GUIDE_GOOD.split("\n")[0] }] } }); }],
];

describe("after the deploy each broken claim fails, and only it", () => {
  for (const [key, what, breakIt, alsoFails] of BROKEN) {
    it(`${key} fails on ${what}`, () => {
      const w = GOOD();
      breakIt(w);
      const r = run(routes(w), { fresh: true, keyless: true });
      expect(has(r.lines, "FAIL", key), r.out).toBe(true);
      expect(keysOf(r.lines, "FAIL"), r.out).toEqual([key, ...(alsoFails ?? [])].sort());
    });
  }
});

// ── what cannot be judged is INFO ────────────────────────────────────────────

describe("what cannot be judged is INFO, never a pass", () => {
  it("a Recruiter-in-Ireland page with no row is INFO for CE5", () => {
    const w = GOOD();
    w.s5 = reTool(w.s5, (s) => { s.jobs = []; s.total = 0; s.hasMore = false; });
    const r = run(routes(w), { keyless: true });
    expect(has(r.lines, "INFO", "CE5"), r.out).toBe(true);
    expect(has(r.lines, "PASS", "CE5")).toBe(false);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("an employer name the board cannot place is INFO for CE7", () => {
    const w = GOOD();
    w.s7 = toolAns({ employers: [{ company_token: null, asked: "Anthropic", record: "unknown", unknown_reason: "name_not_resolved", candidates: [{ companyToken: "anthropic" }] }] });
    const r = run(routes(w), { keyless: true });
    expect(has(r.lines, "INFO", "CE7"), r.out).toBe(true);
    expect(has(r.lines, "PASS", "CE7")).toBe(false);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("a short Manager-in-Italy page that says why passes, and its reason is INFO; a late count is INFO", () => {
    const w = GOOD();
    w.s6 = reTool(w.s6, (s) => { s.jobs = (s.jobs as unknown[]).slice(0, 7); s.pageShortBecause = "refill_limit"; s.refillReads = 2; delete s.withheldTotal; s.totalIncludesWithheld = true; });
    const r = run(routes(w), { keyless: true });
    expect(has(r.lines, "PASS", "CE6"), r.out).toBe(true);
    expect(r.lines.some((l) => /^INFO  CE6 short page \(7\) with a stated reason: refill_limit/.test(l)), r.out).toBe(true);
    expect(r.lines.some((l) => /^INFO  CE6 totalIncludesWithheld/.test(l)), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("while sign-in is on, the unsigned listing and key_status's challenge are INFO", () => {
    const w = GOOD();
    w.init = Object.fromEntries(REVISIONS.map((v) => [v, initAns(v === "2099-01-01" ? "2025-11-25" : v, "on")]));
    w.listJunk = listAns(TWELVE);
    w.keyStatus = at(401, { jsonrpc: "2.0", id: 43, error: { code: -32001, message: "sign in" } }, { "www-authenticate": "Bearer" });
    const r = run(routes(w));
    expect(r.lines.some((l) => /^INFO  CE4 sign-in is on/.test(l)), r.out).toBe(true);
    expect(r.lines.some((l) => /^INFO  CE4 key_status with no key answered the sign-in challenge/.test(l)), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("without a fresh key CE9 is INFO naming the owner's step, and no call carries a fresh key", () => {
    const r = run(routes(GOOD()), { keyless: true });
    expect(r.lines.some((l) => /^INFO  CE9 not run: RB_API_KEY_FRESH is not set.*https:\/\/resumebooster\.work\/data-api/.test(l)), r.out).toBe(true);
    expect(keyed(r.calls, "FRESH")).toEqual([]);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("without VERIFY_KEYLESS_CALLS=1 no counted call and no board read is made, and the skipped lines are INFO", () => {
    const r = run(routes(GOOD()), { fresh: true });
    expect(counted(r.calls), r.calls.join("\n")).toEqual([]);
    expect(r.calls.filter((c) => c.includes("/functions/v1/job-board"))).toEqual([]);
    expect(r.lines.some((l) => /^INFO  CE5, CE6, CE7 and CE11 .*VERIFY_KEYLESS_CALLS=1/.test(l)), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("a 429 on a counted call stops every later connector and board call, and nothing after it is judged", () => {
    const w = GOOD();
    w.s5 = at(429, { jsonrpc: "2.0", id: 51, error: { code: -32000, message: "The keyless allowance for today is spent." } });
    const r = run(routes(w), { fresh: true, keyless: true });
    const i = r.calls.findIndex((c) => c.includes(`"keyword":"Recruiter"`));
    expect(i).toBeGreaterThan(0);
    expect(r.calls.slice(i + 1).filter((c) => c.includes("/functions/v1/agent-mcp") || c.includes("/functions/v1/job-board")), r.calls.join("\n")).toEqual([]);
    expect(r.lines.some((l) => /^INFO  CE5 answered HTTP 429/.test(l)), r.out).toBe(true);
    expect(r.lines.some((l) => /^INFO  CE6 not sent/.test(l)), r.out).toBe(true);
    expect(r.lines.some((l) => /^INFO  CE7 not sent/.test(l)), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });

  it("a 429 on initialize stops the connector calls there, and CE1 to CE4 and CE12 are INFO", () => {
    const w = GOOD();
    w.init["2025-06-18"] = at(429, { error: "minute" });
    const r = run(routes(w), { fresh: true, keyless: true });
    const i = r.calls.findIndex((c) => c.includes(`"protocolVersion":"2025-06-18"`));
    expect(r.calls.slice(i + 1).filter((c) => c.startsWith(`POST ${MCP} `) || c.includes("/job-board")), r.calls.join("\n")).toEqual([]);
    expect(has(r.lines, "INFO", "CE1"), r.out).toBe(true);
    expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
  });
});

// ── keys ─────────────────────────────────────────────────────────────────────

describe("the revoked key is sent only after the API itself calls it revoked", () => {
  it("confirmed revoked: the precheck, CE6 in Authorization and CE8 in x-api-key, and nothing else", () => {
    const r = run(routes(GOOD()), { fresh: true, keyless: true });
    const rev = keyed(r.calls, "REV");
    expect(rev.map((c) => c.split(" DATA:")[0]), r.calls.join("\n")).toEqual([
      `GET ${PA}/v1/stats AUTH:REV XKEY:NONE`,
      `POST ${MCP} AUTH:REV XKEY:NONE BUDGET:probe`,
      `GET ${PA}/v1/stats AUTH:NONE XKEY:REV`,
    ]);
    expect(rev[1]).toContain(`"query":"Manager","country":"IT","limit":10`);
  });

  for (const [label, check] of [["a key the API still accepts", ok({ data: { open: 1 } })], ["a key the API does not know", at(401, { error: { code: "invalid_key" } })], ["a revoked check that failed", at(500, { error: { code: "query_failed" } })]] as const) {
    it(`${label}: the key goes only to the precheck, CE6 is sent with no key, and both halves are INFO`, () => {
      const r = run(routes({ ...GOOD(), revCheck: check }), { fresh: true, keyless: true });
      expect(keyed(r.calls, "REV").map((c) => c.split(" DATA:")[0]), r.calls.join("\n")).toEqual([`GET ${PA}/v1/stats AUTH:REV XKEY:NONE`]);
      expect(r.calls.some((c) => c.includes(`"query":"Manager","country":"IT"`) && c.includes("AUTH:NONE "))).toBe(true);
      expect(r.lines.some((l) => /^INFO  CE6 no key confirmed revoked/.test(l)), r.out).toBe(true);
      expect(r.lines.some((l) => /^INFO  CE8 no key confirmed revoked/.test(l)), r.out).toBe(true);
      expect(verdicts(r.lines, "FAIL"), r.out).toEqual([]);
    });
  }

  it("RB_REVOKED_KEY is read before .env.local's RB_API_KEY, and with neither no precheck is made", () => {
    const r = run(routes(GOOD()), { keyless: true, revokedKey: REV2 });
    expect(keyed(r.calls, "REV2").length, r.calls.join("\n")).toBe(3);
    expect(keyed(r.calls, "REV")).toEqual([]);
    const none = run(routes(GOOD()), { keyless: true, rb: "" });
    expect(none.calls.filter((c) => c.includes("/v1/stats")), none.calls.join("\n")).toEqual([]);
    expect(none.calls.some((c) => / AUTH:(REV|REV2|OTHER) | XKEY:(REV|REV2|OTHER)/.test(c))).toBe(false);
  });

  it("the source reads keys only as RB_API_KEY_FRESH and ${RB_REVOKED_KEY:-${RB:-}}, and never echoes one", () => {
    const [bash, node] = SECTION.split(/<<'NODE'\n/);
    const code = bash.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect([...new Set(code.match(/\bRB_[A-Z_]+\b/g) ?? [])].sort()).toEqual(["RB_API_KEY_FRESH", "RB_REVOKED_KEY"]);
    expect(code.match(/\$\{?RB\b/g)).toHaveLength(1);
    expect(code).toContain(`VDCE_REV="\${RB_REVOKED_KEY:-\${RB:-}}"`);
    expect(code.split("\n").filter((l) => /\becho\b/.test(l) && /\$\{?(VDCE_REV|VDCE_FRESH|RB|K)\b/.test(l))).toEqual([]);
    // The judging half reads the answers and its own VDCE_ flags, never a key.
    expect(node).not.toMatch(/process\.env\.(RB|K\b)|E\.(RB|K)\b|VDCE_REV\b|VDCE_FRESH\b/);
  });
});

// ── never writes ─────────────────────────────────────────────────────────────

describe("the section never writes and never prints a key", () => {
  it("every call is a read, a probe-budget board count or a reading JSON-RPC call, in every world", () => {
    for (const w of [TODAY(), TODAY_UNDER_NEW_STAMPS(), GOOD()]) {
      for (const opts of [{}, { fresh: true }, { fresh: true, keyless: true }] as RunOpts[]) {
        const r = run(routes(w), opts);
        expect(writes(r.calls), r.calls.join("\n")).toEqual([]);
        expect(r.calls.some((c) => c.includes("fit_resume"))).toBe(false);
        expect(counted(r.calls).length).toBeLessThanOrEqual(opts.keyless ? 4 : 0);
        for (const secret of [KEY, REV, REV2, FRESH]) expect(r.out).not.toContain(secret);
      }
    }
  });

  it("TEETH: the call filters catch what the section never sends", () => {
    expect(writes([`POST ${P}/rest/v1/rpc/api_key_issue AUTH:ANON XKEY:NONE DATA:{}`])).toHaveLength(1);
    expect(writes([`POST ${P}/functions/v1/job-board AUTH:ANON XKEY:NONE BUDGET:probe DATA:{"action":"refresh"}`])).toHaveLength(1);
    expect(writes([`POST ${MCP} AUTH:NONE XKEY:NONE BUDGET:probe DATA:{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"fit_resume","arguments":{}}}`])).toHaveLength(1);
    expect(writes([`POST ${MCP} AUTH:NONE XKEY:NONE DATA:{"jsonrpc":"2.0","id":9,"method":"tools/list","params":{}}`])).toHaveLength(1);
    expect(counted([`POST ${MCP} AUTH:NONE XKEY:NONE BUDGET:probe DATA:{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"get_job","arguments":{"id":"a:b:c"}}}`])).toHaveLength(1);
  });

  it("the section sorts after every other section, so it reads last", () => {
    const names = readdirSync(resolve(ROOT, "scripts/verify-deploy.d")).filter((f) => f.endsWith(".sh"));
    expect([...names].sort().at(-1)).toBe(NAME);
    expect([...names].sort((a, b) => a.localeCompare(b, "en-US")).at(-1)).toBe(NAME);
  });
});

// ── the words the section looks for are the words the code says ─────────────

describe("the section's patterns are the code's own words", () => {
  it("CE5d's first-line pattern is what the argument reader says of colour", () => {
    const pattern = /LINE = (\/\^search_jobs does not take .*?\/);/.exec(SECTION);
    expect(pattern, "CE5d's LINE pattern").not.toBeNull();
    const re = new Function(`return ${pattern![1]}`)() as RegExp;
    const reading = readToolArgs(
      { tool: "search_jobs", accepted: { query: { type: "string" }, location: { type: "string" }, country: { type: "string" }, sort: { type: "string", enum: ["relevance", "newest", "salary"] }, limit: { type: "number" } }, strict: true, pages: true },
      { keyword: "Recruiter", country: "Ireland", limit: 50, location: null, sort: "", colour: "red" },
    );
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.notes.notApplied?.[0]).toMatch(re);
    expect(reading.notes.ignoredArguments).toContain("colour");
    expect(reading.outcome).toBe("would_refuse");
  });

  it("CE12's two guide phrases are in the guide the connector serves", () => {
    const src = readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/index.ts"), "utf8").replace(/\\`/g, "`");
    expect(src).toMatch(/`total` counts postings whose title, employer name or department matched/);
    expect(src).toMatch(/`notApplied` opens an answer/);
    expect(src).toMatch(/`didYouMean`/);
  });
});
