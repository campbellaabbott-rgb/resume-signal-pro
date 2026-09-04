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
// Read-only. It calls no write endpoint and requests no application. ~43 calls
// as of 2026-09-04 (the "~22" this line used to claim was stale by a dozen) —
// still inside the free tier's 60 requests/minute, but no longer comfortably:
// another dozen checks and the run has to be split, or it will start measuring
// its own rate limit instead of the API.
//
// RB_API_KEY IS A FREE KEY, and several assertions below depend on it: the
// paid tools must REFUSE it (fit_resume in band, engine=ranked with 402) and
// key_status must report that refusal in advance. If you point this at a paid
// key, those three checks are the ones that will "fail" without anything being
// wrong.

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
  //
  // OFFSET, NOT `page`. This asked for ?page=1 and ?page=2 — a parameter /v1
  // has never accepted — so both calls were 400 unknown_parameter, both bodies
  // were empty, zero ids overlapped, and the check reported PASS for years
  // without ever comparing two pages. A probe that cannot fail is not a probe.
  const [a, b] = [await api("/v1/jobs?limit=5&offset=0"), await api("/v1/jobs?limit=5&offset=5")];
  const A = new Set((a.body?.data ?? []).map((x) => x.id));
  const B = (b.body?.data ?? []).map((x) => x.id);
  ok(A.size === 5 && B.length === 5, "/v1/jobs served two full pages to compare", `${A.size} and ${B.length} rows`);
  const dupes = B.filter((x) => A.has(x)).length;
  ok(A.size > 0 && dupes === 0, "/v1/jobs page 1 and 2 do not overlap", `${dupes} repeated ids`);
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

  // ── how fresh, and from which systems (2026-09-04) ──────────────────────
  const d = r.body?.data ?? {};
  const ff = d.feedFreshness;
  // Null is a legitimate answer (the rollup row can be missing); a NUMBER that
  // is not a number is not. Whichever it is, the basis must travel with it.
  ok(ff === null || Number.isFinite(ff?.p95Minutes), "/v1/stats feedFreshness is a figure or an honest null",
    ff === null ? "null" : `p95 ${ff?.p95Minutes}m over ${ff?.boards} boards`);
  if (ff) {
    ok(Boolean(ff.asOf), "feedFreshness carries its own asOf", ff.asOf ?? "absent");
    ok(/re-verified/.test(ff.basis ?? "") && /NOT how long ago a role was posted/.test(ff.basis ?? ""),
      "feedFreshness says it measures OUR re-check cadence, not a posting's age");
    // A plausibility bound, the heartbeat rule applied here: the published
    // claim is re-verification within a few hours, and a p95 of zero or of a
    // fortnight both mean the measurement is broken rather than the board.
    ok(ff.p95Minutes > 0 && ff.p95Minutes < 20_160, "feedFreshness p95 is inside a plausible range", `${ff.p95Minutes} min`);
  }
  const bs = d.bySource ?? {};
  ok(/WITHOUT the 30-day serving window/.test(bs.population ?? ""),
    "bySource states its population — these totals are NOT livePostings", bs.population ? "stated" : "absent");
  for (const [name, pctKey] of [["descriptionCoverage", "describedPct"], ["statedDateCoverage", "datedPct"]]) {
    const blk = bs[name];
    ok(blk === null || Array.isArray(blk?.data), `bySource.${name} is an array or an honest null`,
      blk === null ? "null" : `${blk?.data?.length} sources`);
    if (blk) {
      ok(Boolean(blk.asOf), `${name} carries its own asOf`, blk.asOf ?? "absent");
      ok(typeof blk.basis === "string" && blk.basis.length > 40, `${name} names what it counts`);
      const rows = blk.data ?? [];
      const bad = rows.filter((x) => !x.source || !Number.isFinite(x.total) || !Number.isFinite(x[pctKey])).length;
      ok(rows.length > 0 && bad === 0, `${name} rows are {source,total,${pctKey}}`, `${rows.length} rows, ${bad} malformed`);
      const outOfRange = rows.filter((x) => x[pctKey] < 0 || x[pctKey] > 100).length;
      ok(outOfRange === 0, `${name} percentages are percentages`, `${outOfRange} out of range`);
      // The per-source totals must NOT equal the fenced headline count: they
      // stand on a wider population, and a customer told otherwise would build
      // a ratio out of two different sets.
      const sum = rows.reduce((n, x) => n + Number(x.total || 0), 0);
      if (Number.isFinite(d.livePostings)) {
        ok(sum >= d.livePostings, `${name} totals sit above livePostings, as the population line says`,
          `${sum} vs ${d.livePostings}`);
      }
    }
  }
  ok(Array.isArray(bs.quarantined?.sources), "bySource.quarantined lists the skipped systems",
    (bs.quarantined?.sources ?? []).join(",") || "none");
  ok(/not being re-verified/.test(bs.quarantined?.meaning ?? ""),
    "quarantine says what it means for the rows, not just which vendors");
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

// ── 2026-09-04 upgrades: comma lists, closed-set refusals, include= ───────
//
// All three failure modes these cover looked IDENTICAL from outside before the
// change: HTTP 200, a well-formed envelope, and an empty or short `data`. That
// is the only reason they survived — a caller reading the response could not
// tell a filtered board from a misunderstood request.
console.log("\n[/v1] comma lists, closed sets, and the opt-in description");
{
  // A comma list must return rows from EVERY value, not zero rows for the
  // literal string "US,GB".
  const multi = await api("/v1/jobs?country=US,GB&limit=50");
  const rows = multi.body?.data ?? [];
  const countries = new Set(rows.map((x) => x.country).filter(Boolean));
  ok(multi.status === 200 && rows.length > 0, "country=US,GB returns rows", `HTTP ${multi.status}, ${rows.length} rows`);
  ok([...countries].every((c) => c === "US" || c === "GB"), "country list is APPLIED — no third country leaks in", [...countries].join(","));
  // Two values, and the page has to be able to show both. A single-country
  // answer here is the ".eq() against a joined string" bug wearing a 200.
  ok(countries.size >= 1, "country list binds an IN, not an equality on the joined string", `${countries.size} distinct`);
  const one = await api("/v1/jobs?country=US&limit=10");
  ok(one.status === 200 && (one.body?.data ?? []).every((x) => !x.country || x.country === "US"),
    "a single value still binds an equality and is unchanged");
  // Case folded the way the board folds it.
  const folded = await api("/v1/jobs?country=us&work_mode=Remote&limit=5");
  ok(folded.status === 200, "country=us and work_mode=Remote are folded, not refused", `HTTP ${folded.status} ${folded.body?.error?.code ?? ""}`);
  ok((folded.body?.data ?? []).every((x) => !x.work_mode || x.work_mode === "remote"), "the folded work mode is APPLIED");
}
{
  // Over the cap is refused rather than sliced — a slice reads as "the board
  // carries nothing in the sixth country".
  const over = await api("/v1/jobs?country=US,GB,DE,FR,NL,IE&limit=1");
  ok(over.status === 400 && over.body?.error?.code === "invalid_value",
    "six countries is refused, not silently cut to five", over.body?.error?.code ?? `HTTP ${over.status}`);
  ok(/at most 5/.test(over.body?.error?.message ?? ""), "the cap refusal names the cap", over.body?.error?.message);
  const overCat = await api("/v1/jobs?category=engineering,design,sales,legal&limit=1");
  ok(overCat.status === 400, "four categories is refused (cap 3)", `HTTP ${overCat.status}`);
}
{
  // THE SILENT-EMPTY-PAGE BUG. Each of these used to bind an equality that no
  // row could match and answer 200 with total 0 — a statement about the market
  // in reply to a typo.
  for (const [q, param, valid] of [
    ["source=greenhosue", "source", "greenhouse"],
    ["category=enginering", "category", "engineering"],
    ["work_mode=wfh", "work_mode", "remote"],
    ["experience_band=junior", "experience_band", "entry"],
  ]) {
    const r = await api(`/v1/jobs?${q}&limit=1`);
    ok(r.status === 400 && r.body?.error?.code === "unsupported_param",
      `${param} refuses a value outside its set`, r.body?.error?.code ?? `HTTP ${r.status}`);
    ok(new RegExp(valid).test(r.body?.error?.message ?? ""),
      `the ${param} refusal names the valid values`, (r.body?.error?.message ?? "").slice(0, 90));
  }
  // country is checked for SHAPE, since ISO-2 is not a list we hold.
  const usa = await api("/v1/jobs?country=USA&limit=1");
  ok(usa.status === 400 && /alpha-2/.test(usa.body?.error?.message ?? ""),
    "country=USA is refused as a malformed code", usa.body?.error?.code ?? `HTTP ${usa.status}`);
  // company_token is an OPEN key space: an employer we do not carry is a
  // truthful empty page, never a 400.
  const unknownCo = await api("/v1/jobs?company_token=not-an-employer-we-carry&limit=1");
  ok(unknownCo.status === 200 && (unknownCo.body?.data ?? []).length === 0,
    "an unknown company_token is an honest empty page, not a refusal", `HTTP ${unknownCo.status}`);
}
{
  // include=description: the field arrives, and the page cap moves with it.
  const inc = await api("/v1/jobs?include=description&limit=100");
  const rows = inc.body?.data ?? [];
  ok(inc.status === 200, "include=description is accepted", `HTTP ${inc.status} ${inc.body?.error?.code ?? ""}`);
  ok(rows.length > 0 && rows.every((x) => "description" in x), "every row carries description when asked for", `${rows.length} rows`);
  ok(rows.length <= 25, "the page cap drops to 25 for a description page", `${rows.length} rows`);
  ok(inc.body?.page?.maxLimit === 25, "page.maxLimit reports the ceiling actually applied", String(inc.body?.page?.maxLimit));
  // The clamp is DISCLOSED. A silent one reads as "the board ran out of rows".
  const cap = inc.body?.disclosures?.limitCapped;
  ok(cap?.requested === 100 && cap?.applied === 25 && cap?.reason === "include=description",
    "the clamp is disclosed with what was asked and what was applied", JSON.stringify(cap ?? null));
  // Without it, nothing changes: no description field, no cap.
  const plain = await api("/v1/jobs?limit=30");
  const prows = plain.body?.data ?? [];
  ok(prows.length === 30, "a plain page is untouched by the description cap", `${prows.length} rows`);
  ok(prows.every((x) => !("description" in x)), "description is absent unless asked for");
  ok(plain.body?.page?.maxLimit === 100, "page.maxLimit is 100 on a plain request", String(plain.body?.page?.maxLimit));
  // A typo in the include list is a 400, not a 200 whose rows quietly lack it.
  const bad = await api("/v1/jobs?include=descriptions&limit=1");
  ok(bad.status === 400 && bad.body?.error?.code === "unsupported_param",
    "include=descriptions is refused", bad.body?.error?.code ?? `HTTP ${bad.status}`);
  // And the single-posting route carries it with no opt-in at all.
  if (firstId) {
    const one = await api(`/v1/jobs/${encodeURIComponent(firstId)}`);
    ok("description" in (one.body?.data ?? {}), "/v1/jobs/{id} carries description unconditionally");
  }
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
  const tools = r.body?.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  for (const t of ["search_jobs", "get_job", "get_jobs", "check_jobs_open", "check_apply_support",
                   "request_application", "application_status", "board_stats", "key_status",
                   "debug_search", "fit_resume"]) {
    ok(names.includes(t), `tools/list advertises ${t}`);
  }
  const missingSchema = tools.filter((t) => !t.inputSchema).map((t) => t.name);
  ok(missingSchema.length === 0, "every tool ships an inputSchema", missingSchema.join(",") || "all present");
  // Without annotations a client must assume every tool might be destructive
  // and interrupt its human before board_stats. The hints are only useful if
  // they are ON THE WIRE — a client reads them from tools/list, not from source.
  const missingAnn = tools.filter((t) => !t.annotations || typeof t.annotations.readOnlyHint !== "boolean").map((t) => t.name);
  ok(missingAnn.length === 0, "every tool ships annotations with readOnlyHint", missingAnn.join(",") || "all present");
  const missingTitle = tools.filter((t) => !t.title).map((t) => t.name);
  ok(missingTitle.length === 0, "every tool ships a display title", missingTitle.join(",") || "all present");
  const acting = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
  ok(acting.length === 1 && acting[0] === "request_application",
    "exactly one tool is NOT read-only, and it is request_application", acting.join(",") || "none");
  const ra = tools.find((t) => t.name === "request_application");
  ok(ra?.annotations?.destructiveHint === true, "request_application asks the client to confirm (destructiveHint)");
  ok(ra?.annotations?.idempotentHint === true, "request_application is idempotent — a retry does not apply twice");
  // outputSchema is what lets a client parse rows instead of guessing at
  // JSON-in-text; a tool that declares one must also SEND structuredContent,
  // asserted on search_jobs below.
  const missingOut = ["search_jobs", "get_job", "get_jobs", "check_jobs_open", "key_status", "fit_resume"]
    .filter((n) => !tools.find((t) => t.name === n)?.outputSchema);
  ok(missingOut.length === 0, "the row-returning tools declare an outputSchema", missingOut.join(",") || "all present");
  const sj = tools.find((t) => t.name === "search_jobs");
  for (const p of ["companies", "experience", "postedAfter", "includeUnstatedPay"]) {
    ok(Boolean(sj?.inputSchema?.properties?.[p]), `search_jobs advertises ${p}`);
  }
  const ds = tools.find((t) => t.name === "debug_search");
  ok(JSON.stringify(ds?.inputSchema?.properties ?? {}) === JSON.stringify(sj?.inputSchema?.properties ?? {}),
    "debug_search takes the SAME arguments as search_jobs, as its description claims");
}
{
  const r = await mcp("tools/call", { name: "board_stats", arguments: {} });
  const j = toolJson(r.body);
  ok(Number.isFinite(j?.servablePostings), "board_stats returns servablePostings", String(j?.servablePostings));
  ok(Number.isFinite(j?.freshnessWindowDays), "board_stats names its freshness window", String(j?.freshnessWindowDays));
}
let mcpIds = [];
let mcpToken = null;
{
  const r = await mcp("tools/call", { name: "search_jobs", arguments: { query: "registered nurse", limit: 3 } });
  const j = toolJson(r.body);
  const jobs = j?.jobs ?? [];
  mcpIds = jobs.map((x) => x.id).filter(Boolean);
  mcpToken = jobs[0]?.companyToken ?? null;
  ok(jobs.length > 0, "search_jobs returns rows", `${jobs.length}`);
  ok(jobs.every((x) => /nurse/i.test(x.title ?? "")), "search_jobs rows match the query");
  ok(jobs.every((x) => x.applyUrl), "search_jobs rows carry an applyUrl");
  ok(jobs.every((x) => typeof x.companyToken === "string" && x.companyToken.length > 0),
    "search_jobs rows carry companyToken — the handle the `companies` filter takes");
  // A tool that declares an outputSchema must SEND the structured half, or the
  // schema describes nothing a client can check.
  const sc = r.body?.result?.structuredContent;
  ok(sc && typeof sc === "object" && Array.isArray(sc.jobs),
    "search_jobs answers with structuredContent, not only JSON-in-text", sc ? "present" : "absent");
}
{
  // THE STRUCTURED PAY THE BOARD HAD ALREADY PARSED. Until 2026-09-04 the card
  // carried the employer's prose and nothing else, so an agent that filtered on
  // pay could not read the number it had filtered by — it had to re-parse
  // "$120k-$140k DOE" to sort its own results.
  const r = await mcp("tools/call", { name: "search_jobs", arguments: { query: "nurse", hasStatedPay: true, limit: 10 } });
  const jobs = toolJson(r.body)?.jobs ?? [];
  const priced = jobs.filter((x) => typeof x.salaryMinAnnual === "number");
  ok(jobs.length > 0 && priced.length === jobs.length,
    "hasStatedPay rows carry a numeric salaryMinAnnual", `${priced.length}/${jobs.length}`);
  ok(jobs.every((x) => x.salaryMinAnnual === undefined || typeof x.salaryMinAnnual === "number"),
    "a card never states pay it does not have — the field is ABSENT, never 0");
}
{
  // The parity filters. Accepted is not enough: applied, and named in
  // ignoredFilters if not — the board's cardinal rule, on the agent surface.
  const r = await mcp("tools/call", { name: "search_jobs", arguments: { query: "engineer", experience: "senior", limit: 10 } });
  const j = toolJson(r.body);
  const jobs = j?.jobs ?? [];
  ok(!(j?.ignoredFilters ?? []).includes("experience"), "experience is not ignored", JSON.stringify(j?.ignoredFilters ?? []));
  ok(jobs.length === 0 || jobs.every((x) => x.experienceBand === "senior"),
    "experience is APPLIED and the band is returned", `${jobs.length} rows`);
  if (mcpToken) {
    const c = await mcp("tools/call", { name: "search_jobs", arguments: { companies: mcpToken, limit: 5 } });
    const cj = toolJson(c.body);
    const rows = cj?.jobs ?? [];
    ok(!(cj?.ignoredFilters ?? []).includes("companies"),
      "companies binds — it must reach the board as an array, not a string", JSON.stringify(cj?.ignoredFilters ?? []));
    ok(rows.length > 0 && rows.every((x) => x.companyToken === mcpToken),
      "companies is APPLIED", `${rows.length} rows for ${mcpToken}`);
  }
}
{
  // ONE CALL FOR A WHOLE SHORTLIST. get_job is one posting per metered call
  // against 1,000/day; re-verifying twenty spent twenty.
  const ids = [...mcpIds, "greenhouse:not-a-real-employer:000000"];
  const r = await mcp("tools/call", { name: "check_jobs_open", arguments: { ids } });
  const j = toolJson(r.body);
  ok(j?.open && typeof j.open === "object", "check_jobs_open answers a map of ids");
  ok(Object.keys(j?.open ?? {}).length === ids.length, "every id sent gets an answer", `${Object.keys(j?.open ?? {}).length}/${ids.length}`);
  ok(mcpIds.every((id) => j?.open?.[id] === true), "the ids search just served read open");
  ok(j?.open?.["greenhouse:not-a-real-employer:000000"] === false, "an id this board never carried reads closed");
  // A published claim names its basis — "open" here is the index, not a live
  // probe of the employer's site, and the answer has to say which.
  ok(typeof j?.basis === "string" && j.basis.length > 60, "check_jobs_open states what 'open' means", `${String(j?.basis ?? "").length} chars`);
}
{
  const ids = [...mcpIds.slice(0, 2), "lever:not-a-real-employer:000000"];
  const r = await mcp("tools/call", { name: "get_jobs", arguments: { ids } });
  const j = toolJson(r.body);
  ok(Array.isArray(j?.jobs) && Array.isArray(j?.unavailable), "get_jobs answers jobs + unavailable");
  ok((j?.jobs ?? []).length === mcpIds.slice(0, 2).length, "the good ids come back", `${(j?.jobs ?? []).length}`);
  ok((j?.jobs ?? []).every((x) => typeof x.description === "string" && x.description.length > 0),
    "each batched job carries its description");
  ok((j?.unavailable ?? []).some((u) => u.id === "lever:not-a-real-employer:000000" && u.reason === "notFound"),
    "one bad id is named notFound, not thrown — the other ids survive it",
    JSON.stringify(j?.unavailable ?? []).slice(0, 120));
  // An id this board does not carry is a fact about the id. It used to arrive
  // as "the get_job tool hit an internal error. Try again shortly" — a retry
  // instruction for a call that can never succeed.
  const one = await mcp("tools/call", { name: "get_job", arguments: { id: "lever:not-a-real-employer:000000" } });
  const oj = toolJson(one.body);
  ok(one.body?.result?.isError !== true && oj?.notFound === true,
    "get_job answers an unknown id as 'no posting', never as an internal error", oj?.note ?? JSON.stringify(oj)?.slice(0, 80));
  const bare = await mcp("tools/call", { name: "get_jobs", arguments: { ids: mcpIds.slice(0, 2), includeDescription: false } });
  ok((toolJson(bare.body)?.jobs ?? []).every((x) => x.description === undefined),
    "includeDescription=false returns cards only");
}
{
  // THE KEY, ASKED INSTEAD OF INFERRED. Rate and quota used to travel only in
  // HTTP headers, which an MCP client never surfaces to the model; apply
  // readiness could only be learned by attempting an application.
  const r = await mcp("tools/call", { name: "key_status", arguments: {} });
  const j = toolJson(r.body);
  ok(typeof j?.key?.tier === "string", "key_status names the tier", j?.key?.tier);
  ok(Number.isFinite(j?.rate?.limit) && Number.isFinite(j?.rate?.remaining), "key_status states the rate limit and what is left",
    `${j?.rate?.remaining}/${j?.rate?.limit}`);
  ok(Number.isFinite(j?.quota?.limit) && Number.isFinite(j?.quota?.remaining), "key_status states the daily quota and what is left",
    `${j?.quota?.remaining}/${j?.quota?.limit}`);
  ok(Number.isFinite(j?.quota?.resetsInSeconds) && Number.isFinite(j?.rate?.resetsInSeconds), "key_status says when each window resets");
  // The probe key is FREE, so the paid tools must read false here — and that
  // must agree with the 402 /v1 gives and the in-band refusal fit_resume gives.
  ok(j?.key?.paid === false, "the probe key reports as free", String(j?.key?.paid));
  ok(j?.features?.fit_resume === false && j?.features?.rankedEngine === false,
    "key_status refuses the paid features in ADVANCE, matching what they answer");
  ok(typeof j?.apply?.ready === "boolean" && Array.isArray(j?.apply?.blockers),
    "key_status states apply readiness with the blockers named");
  ok(j.apply.ready === true || j.apply.blockers.length > 0, "a not-ready answer always names at least one blocker");
  ok(r.body?.result?.structuredContent?.key !== undefined, "key_status answers with structuredContent too");
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
