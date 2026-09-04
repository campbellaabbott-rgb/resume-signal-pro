// The two surfaces that answer to SOMEONE ELSE'S CODE — /v1 and MCP — probed live.
//
//   node scripts/api-contract-probe.mjs
//
// Needs RB_API_KEY (an rb_live_ key) in the environment or in .env.local,
// which is gitignored via *.local. Never put it in .env: that file is TRACKED
// and this repository is public.
//
// WHY THIS EXISTS. Search had four live harnesses and these had none. They are
// covered by static tests — 8 files touch public-api, 4 touch agent-mcp — but
// those pin SOURCE, and the failure this surface actually suffered was a
// runtime one no static test can see: a Postgres 42702 ambiguous-column error
// from an RPC whose OUT parameters collided with real columns, which 503'd
// EVERY authenticated call while the unauthenticated root kept answering 200.
// It happened twice. A reader of the source could not have caught either.
//
// So the sharpest assertion here is a negative one: an authenticated call must
// never 5xx. A 401 is a working API refusing a bad key; a 503 is the API down
// wearing an error message. Everything else checks the SHAPE a consumer's code
// is entitled to depend on — field names, pagination that does not repeat, the
// metering headers a client needs to back off, and the `basis` sentence that
// keeps a published number honest about what it counts.
//
// Read-only. It calls no write endpoint and requests no application. ~22 calls,
// well inside the free tier's 60/min.

import { readFileSync } from "node:fs";

const env = {};
for (const f of ["../.env", "../.env.local"]) {
  try {
    for (const l of readFileSync(new URL(f, import.meta.url), "utf8").split("\n")) {
      if (l.includes("=") && !l.trim().startsWith("#")) {
        env[l.slice(0, l.indexOf("=")).trim()] = l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* .env.local is optional */ }
}
const BASE = `${env.VITE_SUPABASE_URL}/functions/v1/`;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const KEY = process.env.RB_API_KEY || env.RB_API_KEY;
if (!KEY) {
  console.error("No RB_API_KEY. Put it in .env.local (gitignored) or the environment.");
  console.error("Get one: POST {email} to /functions/v1/api-key-request");
  process.exit(2);
}

const fails = [];
const ok = (pass, label, detail) => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) fails.push(label);
};

async function api(path, { key = KEY } = {}) {
  const res = await fetch(BASE + "public-api" + path, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(45_000),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body is itself a finding */ }
  return { status: res.status, body, headers: res.headers };
}

async function mcp(method, params, { key = KEY } = {}) {
  const res = await fetch(BASE + "agent-mcp", {
    method: "POST",
    headers: {
      apikey: ANON, "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(60_000),
  });
  let body = null;
  try { body = await res.json(); } catch { /* ditto */ }
  return { status: res.status, body };
}
/** MCP tools answer as text content that happens to be JSON. */
const toolJson = (b) => {
  const t = (b?.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  try { return JSON.parse(t); } catch { return null; }
};

console.log("=".repeat(68));
console.log("API CONTRACT PROBE — /v1 and MCP, live");
console.log("=".repeat(68));

// ── the negative assertion this file exists for ────────────────────────────
console.log("\n[auth] a bad key must be REFUSED, never a 5xx (the 42702 guard)");
for (const [label, key] of [["no key", null], ["bad key", "rb_live_deadbeef"]]) {
  const r = await api("/v1/jobs?limit=1", { key });
  ok(r.status < 500, `${label}: not a server error`, `HTTP ${r.status}`);
  ok(r.status === 401, `${label}: refused with 401`, r.body?.error?.code ?? "no error code");
  ok(Boolean(r.body?.error?.message), `${label}: says how to fix it`);
}

// ── /v1 ────────────────────────────────────────────────────────────────────
console.log("\n[/v1] discovery + shapes");
{
  const r = await api("/v1");
  const eps = r.body?.endpoints ?? [];
  ok(r.status === 200, "root answers", `HTTP ${r.status}`);
  for (const e of ["/v1/jobs", "/v1/jobs/{id}", "/v1/changes", "/v1/companies", "/v1/stats", "/v1/usage"]) {
    ok(eps.includes(e), `root advertises ${e}`);
  }
}
let firstId = null;
{
  const r = await api("/v1/jobs?limit=5");
  ok(r.status === 200, "/v1/jobs answers", `HTTP ${r.status}`);
  for (const k of ["apiVersion", "data", "page", "total"]) ok(k in (r.body ?? {}), `/v1/jobs carries ${k}`);
  const row = (r.body?.data ?? [])[0] ?? null;
  firstId = row?.id ?? null;
  // The fields a consumer builds against. Dropping one silently is the
  // breaking change an API is not allowed to make without a version.
  for (const f of ["id", "title", "company", "company_token", "apply_url", "location", "category", "posted_at", "last_seen", "agency"]) {
    ok(row ? f in row : false, `/v1/jobs row carries ${f}`);
  }
  // Metering a client needs in order to back off.
  for (const h of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-quota-limit", "x-quota-remaining", "x-api-version"]) {
    ok(r.headers.get(h) !== null, `header ${h}`, r.headers.get(h) ?? "absent");
  }
}
{
  const r = await api(`/v1/jobs/${firstId}`);
  ok(r.status === 200 && r.body?.data?.id === firstId, "/v1/jobs/{id} returns that job");
}
{
  // A filter that is accepted must be APPLIED — the board's own cardinal rule.
  const r = await api("/v1/jobs?country=US&limit=10");
  const rows = r.body?.data ?? [];
  const bad = rows.filter((x) => x.country && x.country !== "US").length;
  ok(rows.length > 0 && bad === 0, "/v1/jobs country filter is applied", `${rows.length} rows, ${bad} violate`);
}
{
  // Pagination must not repeat: a consumer paging a feed would double-count.
  const [a, b] = [await api("/v1/jobs?limit=5&page=1"), await api("/v1/jobs?limit=5&page=2")];
  const A = new Set((a.body?.data ?? []).map((x) => x.id));
  const dupes = (b.body?.data ?? []).filter((x) => A.has(x.id)).length;
  ok(dupes === 0, "/v1/jobs page 1 and 2 do not overlap", `${dupes} repeated ids`);
}
{
  const r = await api("/v1/companies?limit=3");
  ok(r.status === 200, "/v1/companies answers", `HTTP ${r.status}`);
  const row = (r.body?.data ?? [])[0];
  ok(row ? ["company", "company_token", "open_postings"].every((k) => k in row) : false, "/v1/companies row shape");
}
{
  // A change feed without a window is a full dump; refusing is correct, and
  // the refusal has to say what to send.
  const bare = await api("/v1/changes?limit=2");
  ok(bare.status === 400 && bare.body?.error?.code === "missing_since",
    "/v1/changes refuses without ?since", bare.body?.error?.code ?? `HTTP ${bare.status}`);
  ok(/since=/.test(bare.body?.error?.message ?? ""), "/v1/changes refusal shows the parameter");
  const since = new Date(Date.now() - 36 * 3600e3).toISOString();
  const r = await api(`/v1/changes?since=${since}&limit=5`);
  ok(r.status === 200, "/v1/changes answers with ?since", `HTTP ${r.status}`);
  for (const k of ["opened", "closed", "since"]) ok(k in (r.body ?? {}), `/v1/changes carries ${k}`);
}
{
  const r = await api("/v1/stats");
  ok(r.status === 200, "/v1/stats answers", `HTTP ${r.status}`);
  // THE STAT-PROVENANCE RULE: a published number names its date basis. A
  // count with no stated basis is how "2.8d median" once meant something
  // nobody intended.
  ok(typeof r.body?.basis === "string" && r.body.basis.length > 40,
    "/v1/stats states its basis", `${String(r.body?.basis ?? "").length} chars`);
  ok(Boolean(r.body?.asOf), "/v1/stats states asOf");
}
{
  const r = await api("/v1/usage");
  ok(r.status === 200, "/v1/usage answers", `HTTP ${r.status}`);
  ok(Number.isFinite(r.body?.limits?.perMinute) && Number.isFinite(r.body?.limits?.perDay), "/v1/usage states both limits");
  ok(Number.isFinite(r.body?.remaining?.today), "/v1/usage states what is left");
}

// ── the 2026-09-02 MCP-parity params ──────────────────────────────────────
// agent-mcp accepted these for months while /v1 answered 400 to every one, so
// an AI agent could filter by city and a developer's code could not. Six are
// served by the default engine; location and sort are deliberately ranked-only
// and must REFUSE here rather than approximate.
console.log("\n[/v1] MCP-parity filters");
{
  for (const [q, why] of [
    ["employment_type=full_time", "employment_type accepted"],
    ["has_stated_pay=true", "has_stated_pay accepted"],
    ["pay_basis=hourly", "pay_basis accepted"],
    ["max_years=3", "max_years accepted"],
    ["max_age_days=7", "max_age_days accepted"],
    ["agent_ready_only=true", "agent_ready_only accepted"],
  ]) {
    const r = await api(`/v1/jobs?${q}&limit=3`);
    ok(r.status === 200, why, `HTTP ${r.status}${r.status === 400 ? ` ${r.body?.error?.code}` : ""}`);
  }
  // Applied, not merely accepted — the board's cardinal rule.
  const hp = await api("/v1/jobs?has_stated_pay=true&limit=10");
  const rows = hp.body?.data ?? [];
  ok(rows.length > 0 && rows.every((x) => x.salary_min_annual !== null),
    "has_stated_pay is APPLIED", `${rows.length} rows, ${rows.filter((x) => x.salary_min_annual === null).length} unstated`);
  const hr = await api("/v1/jobs?pay_basis=hourly&limit=10");
  const hrows = hr.body?.data ?? [];
  ok(hrows.length === 0 || hrows.every((x) => x.salary_period === "hour"),
    "pay_basis=hourly is APPLIED", `${hrows.length} rows`);
  const my = await api("/v1/jobs?max_years=3&limit=10");
  const myr = my.body?.data ?? [];
  ok(myr.length === 0 || myr.every((x) => typeof x.min_years === "number" && x.min_years <= 3),
    "max_years is APPLIED", `${myr.length} rows`);
  // Refused on purpose, and the refusal must say where the filter DOES work.
  for (const p_ of ["sort=newest"]) {
    const r = await api(`/v1/jobs?${p_}&limit=1`);
    ok(r.status === 400 && r.body?.error?.code === "unsupported_param",
      `${p_.split("=")[0]} refused by the default engine`, r.body?.error?.code ?? `HTTP ${r.status}`);
    ok(/engine=ranked/.test(r.body?.error?.message ?? ""),
      `${p_.split("=")[0]} refusal names engine=ranked`);
  }
  // Still strict about everything else.
  const bogus = await api("/v1/jobs?nonsense=1&limit=1");
  ok(bogus.status === 400 && bogus.body?.error?.code === "unknown_parameter",
    "unknown params are still rejected", bogus.body?.error?.code ?? `HTTP ${bogus.status}`);
}

// ── 2026-09-03 upgrades: location on the default engine, POST /v1/fit, apiVersion ──
console.log("\n[/v1] 2026-09-03 upgrades");
{
  const root = await api("/v1");
  ok(root.body?.apiVersion === "2026-09-03.1", "apiVersion is 2026-09-03.1", root.body?.apiVersion ?? "none");
  ok((root.body?.endpoints ?? []).includes("POST /v1/fit"), "root advertises POST /v1/fit");
  const loc = await api("/v1/jobs?location=London&limit=10");
  ok(loc.status === 200, "location is ACCEPTED on the default engine now", `HTTP ${loc.status} ${loc.body?.error?.code ?? ""}`);
  const rows = loc.body?.data ?? [];
  ok(rows.length > 0 && rows.every((x) => /london/i.test(String(x.location ?? ""))), "location is APPLIED", `${rows.length} rows, ${rows.filter((x) => !/london/i.test(String(x.location ?? ""))).length} off`);
  // The one POST route: refused without payment, never a 5xx, and GET stays 405.
  const post = await fetch(BASE + "public-api/v1/fit", { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ resumeText: "Jane Doe - Senior Software Engineer. ".repeat(6) }), signal: AbortSignal.timeout(45_000) });
  const pb = await post.json().catch(() => null);
  ok(post.status < 500, "POST /v1/fit is not a server error", `HTTP ${post.status}`);
  ok(post.status === 402 && pb?.error?.code === "upgrade_required", "POST /v1/fit is paid: free key gets 402 upgrade_required", pb?.error?.code ?? `HTTP ${post.status}`);
  const get = await api("/v1/fit");
  ok(get.status === 405, "GET /v1/fit is 405 — the résumé must not ride a query string", `HTTP ${get.status}`);
}

// ── MCP ────────────────────────────────────────────────────────────────────
console.log("\n[mcp] handshake, catalogue, and the keyed tools");
{
  const r = await mcp("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } });
  ok(r.status === 200 && Boolean(r.body?.result?.protocolVersion), "initialize", r.body?.result?.protocolVersion ?? "no protocol");
  ok(Boolean(r.body?.result?.serverInfo?.name), "names itself", r.body?.result?.serverInfo?.name);
}
{
  const r = await mcp("tools/list");
  const names = (r.body?.result?.tools ?? []).map((t) => t.name);
  for (const t of ["search_jobs", "get_job", "check_apply_support", "request_application", "application_status", "board_stats", "debug_search", "fit_resume"]) {
    ok(names.includes(t), `tools/list advertises ${t}`);
  }
  const missingSchema = (r.body?.result?.tools ?? []).filter((t) => !t.inputSchema).map((t) => t.name);
  ok(missingSchema.length === 0, "every tool ships an inputSchema", missingSchema.join(",") || "all present");
}
{
  const r = await mcp("tools/call", { name: "board_stats", arguments: {} });
  const j = toolJson(r.body);
  ok(Number.isFinite(j?.servablePostings), "board_stats returns servablePostings", String(j?.servablePostings));
  ok(Number.isFinite(j?.freshnessWindowDays), "board_stats names its freshness window", String(j?.freshnessWindowDays));
}
{
  const r = await mcp("tools/call", { name: "search_jobs", arguments: { query: "registered nurse", limit: 3 } });
  const j = toolJson(r.body);
  const jobs = j?.jobs ?? [];
  ok(jobs.length > 0, "search_jobs returns rows", `${jobs.length}`);
  ok(jobs.every((x) => /nurse/i.test(x.title ?? "")), "search_jobs rows match the query");
  ok(jobs.every((x) => x.applyUrl), "search_jobs rows carry an applyUrl");
}
{
  // The reason this tool exists: turning "why did I get that?" into one call.
  const r = await mcp("tools/call", { name: "debug_search", arguments: { query: "nurse practicioner", location: "New York" } });
  const j = toolJson(r.body);
  ok(Boolean(j?.decision), "debug_search returns a decision trace");
  ok(Array.isArray(j?.decision?.query?.terms), "trace names the parsed terms",
    JSON.stringify(j?.decision?.query?.terms ?? null));
  ok("applied" in (j?.decision?.filters ?? {}), "trace names the applied filters");
}
{
  // fit_resume: the drop as a tool, and PAID — gated on the key's tier exactly
  // as POST /v1/fit is. RB_API_KEY is a free key, so the honest answer is the
  // in-band refusal: a tool RESULT with isError and the upgrade pointer, never
  // a transport error, and never a silently served score (which is what a
  // free key got until 2026-09-04, draining the paid customers' scorer
  // bucket). Scoring itself — the founder résumé resolving to a real role —
  // is pinned in src/test/a-founders-resume-searched-for-go-to-market.test.ts.
  const cv = "Campbell Abbott - Founder & CEO, Resume Booster\nEXPERIENCE\nFounder & CEO 2024-2026. Ran go-to-market, hired the team.\nLed go-to-market strategy across three launches; owned roadmap and P&L.\nSKILLS: leadership, strategy, hiring, SQL\nBS, University of Washington";
  const r = await mcp("tools/call", { name: "fit_resume", arguments: { resumeText: cv, limit: 5 } });
  const j = toolJson(r.body);
  ok(r.status === 200 && !!j, "fit_resume answers in-band", j ? "tool result" : `HTTP ${r.status}`);
  ok(r.body?.result?.isError === true && typeof j?.error === "string", "fit_resume refuses a free key as a tool result, not a server error", j?.error ?? "no error line");
  ok(/paid/i.test(j?.error ?? ""), "the refusal names it a paid feature", j?.error);
  ok(/data-api/.test(j?.fix ?? ""), "the refusal points at the upgrade", j?.fix);
  ok(!Array.isArray(j?.jobs), "no score is served to a free key");
}
{
  // An unkeyed tool call must be refused in the MCP way — a result the agent
  // can read — not a transport error it cannot.
  const r = await mcp("tools/call", { name: "board_stats", arguments: {} }, { key: null });
  const j = toolJson(r.body);
  ok(r.status < 500, "unkeyed tool call is not a server error", `HTTP ${r.status}`);
  ok(Boolean(j?.error || r.body?.error), "unkeyed tool call is refused in-band");
}

console.log("\n" + "=".repeat(68));
console.log(fails.length ? `FAILED (${fails.length}): ${fails.join("; ")}` : "ALL CHECKS PASSED");
process.exit(fails.length ? 1 : 0);
