#!/usr/bin/env node
// Post-publish DEPLOY VERIFIER — run after EVERY Lovable publish.
//
//   node scripts/post-publish-smoke.mjs
//   # optional: force a guaranteed (non-rate-limited) freshness scan
//   HEARTBEAT_SECRET=… node scripts/post-publish-smoke.mjs
//
// Catches the deploy gaps Lovable has silently shipped before — the July 2026
// incidents where "publish" updated the frontend but NOT the edge functions
// (stale code) or the DB migrations (missing RPCs/tables), and nothing noticed
// for days/weeks because every consumer degraded quietly:
//   1. functions respond but run STALE code   → engine-version mismatch (2b)
//   2. migrations never applied               → RPCs/tables 404 PGRST202/205 (7)
//   3. the scanner's report is malformed      → (2)
//   4. checkout / heartbeat / frontend / prerender regressions → (3–6)
//
// Exit 0 = safe to walk away; exit 1 = something specific is broken below.
// Costs at most one AI scan (skipped if the rate limiter answers and no
// HEARTBEAT_SECRET is provided).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env"), "utf8");
const grab = (k) => env.match(new RegExp(`${k}="?([^"\\n]+)`))?.[1];
const URL_BASE = grab("VITE_SUPABASE_URL");
const KEY = grab("VITE_SUPABASE_PUBLISHABLE_KEY");
const HEARTBEAT = process.env.HEARTBEAT_SECRET; // optional: bypasses per-IP rate limit so freshness is always verifiable
const SITE = "https://resumebooster.work";

// The engine version this checkout expects live. Bumped on meaningful backend
// changes; if a deployed scan reports an OLDER value, the functions didn't ship.
const COMMITTED_ENGINE = (readFileSync(join(root, "supabase/functions/free-keyword-scan/index.ts"), "utf8")
  .match(/REPORT_ENGINE_VERSION = '([^']+)'/) || [])[1];

const CORPUS = `Sam Ortiz\nsam@email.com\n\nEXPERIENCE\nStaff Accountant, Meridian LLC (2021-present)\n- Closed monthly books for 8 entities in QuickBooks\n- Cut close cycle from 10 to 6 days\n\nCERTIFICATIONS\nCPA, Texas\n\nEDUCATION\nBS Accounting (deploy-verify-corpus)`;

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const hdrs = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const post = (fn, body, ms = 90000, extra = {}) =>
  fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: "POST", headers: { ...hdrs, ...extra }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });

// ---- 1. Every user-facing function answers OPTIONS (404 = not deployed at all) ----
// Only proves the function RESPONDS, not that it runs CURRENT code — the
// engine-version check (2b) is the real staleness signal.
const FUNCTIONS = [
  "free-keyword-scan", "create-product-checkout", "verify-product-purchase",
  "generate-freelance-boost", "import-freelance-profile", "generate-resume-roast",
  "send-scan-report", "check-subscription", "parse-pdf", "parse-docx",
  "generate-premium-package-stream", "generate-cover-letter", "recover-purchase",
  "generate-product-preview", "scan-heartbeat", "health-check", "job-board",
  "send-search-digest",
];
const optionsChecks = await Promise.all(FUNCTIONS.map(async (fn) => {
  try {
    const r = await fetch(`${URL_BASE}/functions/v1/${fn}`, { method: "OPTIONS", signal: AbortSignal.timeout(10000) });
    return { fn, ok: r.status === 200 };
  } catch (e) {
    return { fn, ok: false, err: String(e) };
  }
}));
const missing = optionsChecks.filter((c) => !c.ok);
record("edge functions respond", missing.length === 0,
  missing.length ? `NOT deployed: ${missing.map((c) => c.fn).join(", ")}` : `${FUNCTIONS.length}/${FUNCTIONS.length}`);

// ---- 2. Real scan returns a well-formed diagnostic report ----
// Costs one AI scan. `npm run verify:deploy` sets NO_SCAN=1 and skips it;
// use `npm run verify:deploy:scan` when the report pipeline needs
// end-to-end proof.
let deployedEngine = null;
let scanFields = null;
if (process.env.NO_SCAN) {
  record("free scan end-to-end", true, "SKIPPED (NO_SCAN=1) — zero-cost mode; run verify:deploy:scan for end-to-end proof");
  record("AI generation live", true, "SKIPPED (NO_SCAN=1)");
} else try {
  const t0 = Date.now();
  // Prefer the heartbeat bypass (guaranteed run, logged as scan_type='heartbeat'
  // so it stays out of published stats). Without the secret, fall back to
  // synthetic:true (also excluded from stats) which may hit the per-IP limit.
  const r = await post("free-keyword-scan",
    HEARTBEAT ? { resumeText: CORPUS } : { resumeText: CORPUS, synthetic: true },
    90000,
    HEARTBEAT ? { "x-heartbeat-secret": HEARTBEAT } : {});
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 429) {
    record("free scan end-to-end", true, `rate-limited from this IP — function alive, report+freshness UNVERIFIED (set HEARTBEAT_SECRET to force) (${secs}s)`);
  } else if (!r.ok) {
    record("free scan end-to-end", false, `HTTP ${r.status}: ${(await r.text()).slice(0, 150)}`);
  } else {
    const j = await r.json();
    deployedEngine = j.reportMeta?.engineVersion || null;
    scanFields = { parseQuality: "parseQuality" in j, countryStandards: "countryStandards" in j };
    const anatomy = typeof j.atsScoreEstimate === "number" && j.reportMeta?.reportId && j.scoreBand;
    record("free scan end-to-end", !!anatomy,
      anatomy
        ? `score ${j.atsScoreEstimate}, report ${j.reportMeta.reportId}, engine ${deployedEngine}, ${secs}s`
        : "200 but missing atsScoreEstimate/reportMeta/scoreBand");
    // The scan has a deterministic fallback, so score/reportId/scoreBand all
    // pass even when the AI gateway is down (proven 2026-07-09: this check said
    // PASS score 41 during a 402 out-of-credits outage — users were getting
    // empty reports). Assert real AI prose is present so a degraded scan FAILS.
    const aiProse = [j.topStrength, j.quickWins, j.redFlags]
      .map((v) => JSON.stringify(v ?? "").length)
      .reduce((a, b) => Math.max(a, b), 0);
    record("AI generation live", aiProse > 60,
      aiProse > 60
        ? `AI-written report content present (${aiProse} chars in largest field)`
        : `AI CONTENT MISSING (largest AI field: ${aiProse} chars) — gateway down or out of credits? Check Lovable AI credits + scan-heartbeat`);
  }
} catch (e) {
  record("free scan end-to-end", false, String(e));
}

// ---- 2b. Engine-version FRESHNESS (stale-function detector) ----
// This is the check that would have caught the functions sitting 5 days stale.
if (!COMMITTED_ENGINE) {
  record("engine version fresh", false, "could not read committed REPORT_ENGINE_VERSION from source");
} else if (!deployedEngine) {
  record("engine version fresh", true, process.env.NO_SCAN
    ? `UNVERIFIED (NO_SCAN=1) — committed ${COMMITTED_ENGINE}; a user-run scan on the site shows the deployed version`
    : `UNVERIFIED (no scan response; rate-limited?) — committed ${COMMITTED_ENGINE}; re-run with HEARTBEAT_SECRET`);
} else {
  const fresh = deployedEngine === COMMITTED_ENGINE;
  record("engine version fresh", fresh,
    fresh ? `deployed ${deployedEngine} == committed`
          : `STALE FUNCTIONS: deployed ${deployedEngine} != committed ${COMMITTED_ENGINE} — functions did NOT deploy`);
  const staleFields = scanFields ? Object.entries(scanFields).filter(([, v]) => !v).map(([k]) => k) : [];
  if (staleFields.length) record("scan emits current fields", false, `missing keys: ${staleFields.join(", ")} — deployed function predates them`);
}

// ---- 3. Checkout session creation (no charge — just session validity) ----
try {
  const r = await post("create-product-checkout", { productId: "premiumPackage", email: "smoke-test-nonpro@example.com" }, 30000);
  const j = await r.json().catch(() => ({}));
  record("Stripe checkout session", !!j.url?.includes("checkout.stripe.com"), j.url ? j.url.slice(0, 45) : JSON.stringify(j).slice(0, 120));
} catch (e) {
  record("Stripe checkout session", false, String(e));
}

// ---- 4. Heartbeat sentinel reports on itself ----
try {
  const r = await post("scan-heartbeat", {}, 120000);
  const j = await r.json();
  const failed = (j.checks || []).filter((c) => !c.passed).map((c) => c.name);
  record("heartbeat sentinel", j.status === "healthy",
    `status=${j.status}${failed.length ? `, failing: ${failed.join(", ")}` : ""} (${j.responseTimeMs}ms)`);
} catch (e) {
  record("heartbeat sentinel", false, String(e));
}

// ---- 5. Frontend serves + sitemap is current ----
try {
  const [home, sitemap] = await Promise.all([
    fetch(SITE, { signal: AbortSignal.timeout(10000) }),
    fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(10000) }),
  ]);
  const urlCount = ((await sitemap.text()).match(/<url>/g) || []).length;
  const localCount = (readFileSync(join(root, "public/sitemap.xml"), "utf8").match(/<url>/g) || []).length;
  record("frontend + sitemap", home.ok && sitemap.ok && urlCount === localCount,
    `home ${home.status}, sitemap ${urlCount} URLs (local has ${localCount}${urlCount === localCount ? " — in sync" : " — STALE FRONTEND"})`);
} catch (e) {
  record("frontend + sitemap", false, String(e));
}

// ---- 6. Prerendered SEO pages actually served (informational) ----
try {
  const r = await fetch(`${SITE}/industries/healthcare`, { signal: AbortSignal.timeout(10000) });
  const html = await r.text();
  const served = html.includes("x-prerendered");
  record("prerendered pages served", true, served
    ? "static HTML live — all crawlers see content"
    : "host serving SPA fallback — Google-only rendering (investigate hosting config)");
} catch (e) {
  record("prerendered pages served", false, String(e));
}

// ---- 7. Migrations APPLIED — critical DB objects reachable (PGRST202/205 = unapplied) ----
// The check that would have caught the benchmarks page, scan counter and outcome
// tracking silently offline for weeks. Add an entry here whenever a migration
// ships an RPC/table the app depends on.
const rpcState = async (name, body) => {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, { method: "POST", headers: hdrs, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
    return (await r.json().catch(() => ({})))?.code === "PGRST202" ? "MISSING" : "ok";
  } catch { return "error"; }
};
const tableState = async (name) => {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/${name}?select=count`, { headers: { ...hdrs, Prefer: "count=exact" }, signal: AbortSignal.timeout(15000) });
    return (await r.json().catch(() => ({})))?.code === "PGRST205" ? "MISSING" : "ok";
  } catch { return "error"; }
};
const dbObjects = {
  "get_scan_totals()": await rpcState("get_scan_totals"),
  "get_job_board_facets()": await rpcState("get_job_board_facets"),
  "get_public_scan_insights()": await rpcState("get_public_scan_insights"),
  "get_real_score_distribution()": await rpcState("get_real_score_distribution", { p_industry: "technology" }),
  "get_industry_score_benchmark()": await rpcState("get_industry_score_benchmark", { p_industry: "technology", p_score: 70 }),
  // A call (not a table check) so a PARTIALLY-applied migration — table present,
  // function missing, exactly what happened — is still caught. Writes one
  // identifiable probe row (report_id "deploy-verify-probe"); harmless.
  "record_scan_outcome()": await rpcState("record_scan_outcome", { p_report_id: "deploy-verify-probe", p_outcome: "interview", p_ip: "deploy-verify" }),
  "table scan_outcomes": await tableState("scan_outcomes"),
  "table job_board_postings": await tableState("job_board_postings"),
  // THE DOOR BESIDE THE KEY WALL, re-checked on every publish. The line above
  // only asks whether the table EXISTS (PGRST205), and permission-denied still
  // proves that — so it would keep saying "ok" whether or not the corpus is
  // exposed. job_board_postings was anon-readable for the life of the board:
  // the anon key ships in the frontend bundle, so anyone could page all 565k
  // postings straight off PostgREST and walk around the /v1 metering entirely
  // (closed by 20260827130000, verified live before the fix). Readable is the
  // regression, so that is the case that reports MISSING.
  "job_board_postings anon-locked": await (async () => {
    try {
      const r = await fetch(`${URL_BASE}/rest/v1/job_board_postings?select=id&limit=1`, { headers: hdrs, signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => null);
      // No GRANT: 42501, the loud shape. RLS with no policy: 200 and an empty
      // array, the silent shape. Both mean shut.
      if (r.status === 401 || r.status === 403 || j?.code === "42501") return "ok";
      if (Array.isArray(j) && j.length === 0) return "ok";
      return "MISSING";
    } catch { return "error"; }
  })(),
  "table user_job_searches": await tableState("user_job_searches"),
  // THE TWO 2026-09-23 READERS, each called with its REAL named parameters.
  // PostgREST resolves an RPC by name AND argument names, so posting {} to a
  // function that takes parameters answers PGRST202 whether or not it exists —
  // which is how six live functions were once reported missing in one sweep.
  // Both are anon-callable readers behind a public panel, so a partial deploy
  // that ships the frontend and drops the migration would otherwise show as an
  // empty component and nothing else. A token and an id that have never
  // existed are deliberate, and THE TWO ANSWER DIFFERENTLY, which is the point
  // of writing it down rather than sharing one sentence: the Ontario reader
  // answers an unknown id with ZERO ROWS (the posting is out of scope, and a
  // surface prints nothing); the LCA reader answers an unknown token with
  // EXACTLY ONE ROW OF NULLS, because its whole guarded contract is one row
  // per asked token -- a missing row there would be an absence a client had to
  // interpret, and the interpretation is a statement about a person. Neither
  // probe reads the row count today; the next person to tighten this check
  // needs to know which shape is correct before they assert on it.
  "get_ontario_posting_disclosures()": await rpcState("get_ontario_posting_disclosures", { p_id: "deploy-verify:no-such-posting:0" }),
  "get_employer_lca_wages()": await rpcState("get_employer_lca_wages", { p_tokens: ["deploy-verify-no-such-company"], p_soc_code: null, p_worksite_state: null }),
  // THE NEGATIVE CONTROL, without which every "ok" above means nothing.
  // PostgREST resolves an RPC by name AND argument names, so a probe that
  // cannot tell a missing function from a live one still reports "ok" for all
  // of them -- a sweep where everything passes is then indistinguishable from
  // a sweep that is blind. This name has never existed and MUST read MISSING;
  // if it does not, the reading above is not a reading.
  "negative control (a function that never existed)": await (async () => {
    const state = await rpcState("no_such_function_deploy_control", { p_x: 1 });
    // Inverted on purpose: MISSING is the healthy answer here, so the entry
    // reports MISSING when the control FAILS to come back missing.
    return state === "MISSING" ? "ok" : "MISSING";
  })(),
  // Behavioral, not just reachable: 20260721230000 redefined closed_90d as
  // genuine-tenure fills and made tracking_days the global log span, so even a
  // token with zero closures gets tracking_days >= 1; the old definition
  // returned 0 for it. Old definition live = repost churn is wearing the
  // "Actively hiring" badge with copy that claims tenure-vetted fills.
  "get_company_hiring_health() real-fills def": await (async () => {
    try {
      const r = await fetch(`${URL_BASE}/rest/v1/rpc/get_company_hiring_health`, { method: "POST", headers: hdrs, body: JSON.stringify({ p_tokens: ["deploy-verify-no-such-company"] }), signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => null);
      if (j?.code === "PGRST202") return "MISSING";
      return Array.isArray(j) && (j[0]?.tracking_days ?? 0) >= 1 ? "ok" : "MISSING";
    } catch { return "error"; }
  })(),
};
// ---- 7b. THE FILED-WAGE PANEL SHIPS DARK, AND THAT IS A STATE, NOT A BUG ----
// REACHABILITY IS NOT DATA. The reader above answers with its real parameters
// the moment its migration applies, and it will answer a row of nulls for
// every token until an operator loads a quarter: the loader script
// (scripts/load-oflc-lca.mjs) reads the Department's 250 MB disclosure file
// and EMITS ROWS, it does not write them, and the writer
// (public.oflc_lca_wages_load) is service_role only. So the panel renders
// nothing on the day this deploys, by design — and a sweep that only reports
// the function as present would let the next person read a permanently empty
// panel as a regression and go looking for a fault that is not there.
//
// The table is closed to anon by design, so this cannot count its rows from
// here; what it can do is say, out loud, which of the two lanes is armed.
record("filed-wage panel: reader present, quarter not loaded from here", true,
  dbObjects["get_employer_lca_wages()"] === "ok"
    ? "reader reachable. The panel prints nothing until an operator runs "
      + "`node scripts/load-oflc-lca.mjs --file <LCA_Disclosure_Data_FY....xlsx> --published YYYY-MM-DD --out rows.json` "
      + "and posts the rows in chunks to public.oflc_lca_wages_load with ONE shared p_run_started_at, p_prune on the LAST chunk only. "
      + "An empty panel before that step is the expected state, not a fault."
    : "reader NOT reachable — the migration has not applied; the panel would be empty for that reason instead");

const dbMissing = Object.entries(dbObjects).filter(([, v]) => v === "MISSING").map(([k]) => k);
record("migrations applied (critical DB objects)", dbMissing.length === 0,
  dbMissing.length
    ? `NOT APPLIED: ${dbMissing.join(", ")} — run pending migrations in Lovable's SQL editor, then \`notify pgrst, 'reload schema'\``
    : `${Object.keys(dbObjects).length} objects reachable`);

// ---- 8. The agent server tells the truth about sign-in (verify-deploy "5o") ----
// agent-mcp 2026-09-04.7 answers a keyed tool called with no credential ONE
// of two ways, decided by a probe of the authorization server's metadata
// document: a 401 sign-in challenge while that server is on, the in-band
// refusal (200 + isError, no WWW-Authenticate) otherwise. The server
// publishes the same fact on its initialize result. This section reads the
// document itself, reads the fact, makes ONE unkeyed call to a keyed tool
// (tools/call key_status, no bearer — both answers return before the
// unkeyed allowance is counted, so it spends nothing) and requires the
// three to agree — so a deploy that challenges into a dead sign-in, or that
// hides a live one, fails here. The URLs, the key and the three checks that
// make the document "on" are read off the server modules, never typed.
try {
  const oauthSrc = readFileSync(join(root, "supabase/functions/agent-mcp/oauth.ts"), "utf8");
  const probeSrc = readFileSync(join(root, "supabase/functions/agent-mcp/as-probe.ts"), "utf8");
  const mcpUrl = oauthSrc.match(/export const MCP_URL = "([^"]+)";/)?.[1];
  const metaKey = probeSrc.match(/export const SIGN_IN_META_KEY = "([^"]+)";/)?.[1];
  // The issuer path and the well-known prefix, the way the server derives them.
  const issuerPath = oauthSrc.match(/export const AUTH_ISSUER = `\$\{new URL\(MCP_URL\)\.origin\}(\/[^`]+)`;/)?.[1];
  const wellKnown = probeSrc.match(/`\$\{issuer\.origin\}(\/\.well-known\/[^$`]+)\$\{issuer\.pathname\}`/)?.[1];
  // The three things the server requires of a 200 document before it says "on".
  const requiredMethods = [...probeSrc.matchAll(/includes\(doc\?\.([a-z_]+), "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
  if (!mcpUrl || !metaKey || !issuerPath || !wellKnown || requiredMethods.length !== 2) {
    throw new Error("could not read MCP_URL / SIGN_IN_META_KEY / the metadata URL parts / the document checks off the server modules");
  }
  const origin = new URL(mcpUrl).origin;
  const asUrl = `${origin}${wellKnown}${issuerPath}`;
  const mcpHeaders = { "Content-Type": "application/json", "mcp-protocol-version": "2025-06-18" };
  const rpc = (id, method, params) => fetch(mcpUrl, {
    method: "POST", headers: mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), signal: AbortSignal.timeout(20000),
  });

  const as = await fetch(asUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
  const asBody = await as.json().catch(() => null);
  // Judged exactly as the server judges it: registration endpoint, then each listed method.
  const asMissing = as.status !== 200 ? [] : [
    ...(typeof asBody?.registration_endpoint === "string" && asBody.registration_endpoint.trim() !== "" ? [] : ["registration_endpoint"]),
    ...requiredMethods.filter(([field, value]) => !(Array.isArray(asBody?.[field]) && asBody[field].includes(value))).map(([field, value]) => `${field}:${value}`),
  ];
  const asOn = as.status === 200 && asMissing.length === 0;
  record("authorization server metadata read", true,
    `${asUrl} → ${as.status}${asOn ? " with registration_endpoint, S256 and a public-client token endpoint" : as.status === 200 ? ` WITHOUT ${asMissing.join(", ")}` : ` ${asBody?.error_code ?? ""}`.trimEnd()}`);

  const init = await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "post-publish-smoke", version: "1" } });
  const initBody = await init.json().catch(() => ({}));
  const fact = initBody?.result?._meta?.[metaKey];
  const version = initBody?.result?.serverInfo?.version;
  const factOk = fact && ["on", "off", "unknown"].includes(fact.state) && typeof fact.checkedAt === "string";
  record("initialize carries the sign-in fact", !!factOk,
    factOk ? `version ${version}; ${metaKey} = ${fact.state}${fact.reason ? ` (${fact.reason})` : ""}, checked ${fact.checkedAt}` : `no ${metaKey} on the initialize result (version ${version ?? "?"}) — is .7 deployed?`);
  // The published fact must agree with the document as this machine reads it
  // (a state the server cached up to a minute ago may lag; say so, don't fail).
  if (factOk && ((fact.state === "on") !== asOn)) {
    record("sign-in fact agrees with the document", false,
      `server says ${fact.state} but the metadata document says ${asOn ? "on" : "off"} — a cache no older than 60 s explains it; re-run in a minute before believing this`);
  } else if (factOk) {
    record("sign-in fact agrees with the document", true, fact.state);
  }

  // ONE unkeyed call to a keyed tool: key_status with no bearer. Both answers
  // (the 401, the in-band refusal) return before the allowance is counted.
  const call = await rpc(2, "tools/call", { name: "key_status", arguments: {} });
  const www = call.headers.get("www-authenticate");
  const callBody = await call.json().catch(() => ({}));
  const inBand = call.status === 200 && callBody?.result?.isError === true;
  const inBandCue = !!callBody?.result?._meta?.["mcp/www_authenticate"];
  if (asOn) {
    const ok = call.status === 401 && !!www && /resource_metadata=/.test(www);
    record("keyed tool with no key: challenged only while sign-in is on", ok,
      ok ? `401 with WWW-Authenticate (metadata document 200 with everything a public client needs)`
         : `expected 401 + WWW-Authenticate while the AS is on; got ${call.status}${www ? " with header" : " without header"}${inBand ? " (in-band refusal)" : ""}`);
  } else {
    const ok = inBand && !www && !inBandCue;
    const text = String(callBody?.result?.content?.[0]?.text ?? "");
    record("keyed tool with no key: in band while sign-in is off", ok,
      ok ? `200 + isError, no WWW-Authenticate, no in-band cue — ${text.slice(0, 90)}`
         : `expected 200 + isError with no challenge while the AS is not on; got ${call.status}${www ? " WITH WWW-Authenticate (a challenge into a dead sign-in)" : ""}${inBandCue ? " with an in-band cue" : ""}${inBand ? "" : " not isError"}`);
  }
} catch (e) {
  record("agent server sign-in honesty", false, String(e));
}

// ---- Verdict ----
const failures = results.filter((r) => !r.ok);
console.log(failures.length === 0
  ? "\nALL CLEAR — publish verified."
  : `\n${failures.length} FAILURE(S) — do not walk away:\n${failures.map((f) => `  - ${f.name}: ${f.detail}`).join("\n")}`);
process.exit(failures.length === 0 ? 0 : 1);
