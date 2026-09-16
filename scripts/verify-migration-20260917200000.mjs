// Executes migration 20260917200000 (agent_adoption_metrics, the adoption
// reader) in pglite against the five tables it reads AS THEIR OWN DEFINING
// MIGRATIONS CREATE THEM (api_keys + api_usage from 20260826052300 and
// 20260829150000, mcp_anon_rate from 20260915100000, agent_passes from
// 20260917100000, job_board_search_events from 20260821010000 +
// 20260825040000 + 20260906216000) -- never a hand-typed copy of their DDL,
// so a column the catalog gains or loses is exercised here rather than
// discovered on the live call. Only what pglite cannot host is stubbed:
// auth.users / auth.uid() and the two agent tables the pass migration
// ALTERs. Seeded across four UTC days: today and yesterday carry rows, two
// days ago carries nothing, three days ago carries rows that a three-day
// window must leave out. Proves:
//   * the migration applies, and a second run changes nothing (idempotent);
//   * a three-day window answers exactly three rows, newest first, one per
//     day, and every column of every row is non-null;
//   * on a day with data every figure matches the seed: agent keys vs other
//     keys minted (a revoked key still minted), distinct keys active on the
//     MCP endpoints, calls split by family (tool / prompt / resource) with
//     the per-name detail carrying calls and distinct keys, the per-key
//     detail keyed by key_prefix (never id or hash), the unkeyed
//     tier's global row vs its address rows, passes sold / activated by
//     activated_via / exhausted, MCP-caller searches and zero-result
//     searches; a /v1/ usage row, a web search and an unattributed search
//     are never counted;
//   * on the empty day every count is zero and every detail is an empty
//     object -- zeros, not NULLs;
//   * rows three days old are outside a three-day window and inside a
//     four-day one; a NULL or zero p_days answers one row (today);
//   * anon, authenticated and a PUBLIC-only role cannot execute it (both by
//     privilege probe and by an actual call under SET ROLE, which must be
//     42501); service_role can;
//   * exactly one signature, SECURITY DEFINER, search_path pinned, and a
//     stray overload present before the migration runs is dropped by it.
// No product number is spelled here: the caps, prices and hours are all
// synthetic values chosen to differ from the product's.
// Usage: node scripts/verify-migration-20260917200000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";
const byStamp = (stamp) => {
  const f = readdirSync(DIR).find((n) => n.startsWith(stamp + "_"));
  if (!f) throw new Error(`no migration with stamp ${stamp}`);
  return readFileSync(`${DIR}/${f}`, "utf8");
};
const MIG = byStamp("20260917200000");
/** The migrations that define the five tables the reader reads, in order. */
const TABLE_STAMPS = ["20260826052300", "20260829150000", "20260915100000", "20260917100000", "20260821010000", "20260825040000", "20260906216000"];

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

const db = new PGlite();
const rows = async (q, params) => (await db.query(q, params)).rows;
const one = async (q, params) => (await rows(q, params))[0];
const fails = async (q, params) => { try { await db.query(q, params); return null; } catch (e) { return e; } };

const U = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
const K = (n) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
// Noon UTC on (today - off) as a timestamptz; the UTC date of it is what the
// reader buckets by, and noon is safe from either midnight.
const ts = (off) => `((((now() AT TIME ZONE 'utc')::date - ${off})::timestamp) + interval '12 hours') AT TIME ZONE 'utc'`;
const day = (off) => `((now() AT TIME ZONE 'utc')::date - ${off})`;

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE nobody_probe;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, nobody_probe;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  INSERT INTO auth.users VALUES ('${U(1)}', 'one@example.com'), ('${U(2)}', 'two@example.com'), ('${U(3)}', 'three@example.com'), ('${U(4)}', 'four@example.com');

  -- The two tables the pass migration ALTERs (a pass_id column each): the
  -- reader never reads them, so a bare row shape is enough to host the ALTER.
  CREATE TABLE public.agent_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.agent_submissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

  -- A stray overload that the live catalog might hold and this folder does
  -- not describe: the migration must drop it, not stack beside it.
  CREATE FUNCTION public.agent_adoption_metrics(p_days integer, p_stray text)
    RETURNS integer LANGUAGE sql AS $s$ SELECT 1 $s$;
`);

// ---- the five tables, from their own migrations ---------------------------------------
for (const stamp of TABLE_STAMPS) {
  let threw = "";
  try { await db.exec(byStamp(stamp)); } catch (e) { threw = String(e?.message ?? e); }
  check(`defining migration ${stamp} applies on the stub`, threw === "", threw);
}
{
  const have = async (t) => (await rows(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t])).map((r) => r.column_name);
  const tables = ["api_keys", "api_usage", "mcp_anon_rate", "agent_passes", "job_board_search_events"];
  const missing = [];
  for (const t of tables) if ((await have(t)).length === 0) missing.push(t);
  check("every table the reader reads now exists with the columns its migrations give it", missing.length === 0, missing.join(","));
  // Every column the reader names on each table must be one the migrations created.
  const body = MIG.slice(MIG.indexOf("AS $$"), MIG.indexOf("$$;"));
  const aliases = { ak: "api_keys", u: "api_usage", r: "mcp_anon_rate", ap: "agent_passes", e: "job_board_search_events" };
  const unknown = [];
  for (const [alias, t] of Object.entries(aliases)) {
    const cols = await have(t);
    for (const m of body.matchAll(new RegExp(`\\b${alias}\\.([a-z_]+)`, "g"))) if (!cols.includes(m[1])) unknown.push(`${t}.${m[1]}`);
  }
  check("every column the reader names on those tables is one their migrations created", unknown.length === 0, unknown.join(","));
}

// ---- seed: D0 today, D1 yesterday, D2 empty, D3 outside a three-day window ----
await db.exec(`
  INSERT INTO public.api_keys (id, key_hash, key_prefix, name, owner_email, tier, user_id, created_at, revoked_at) VALUES
    ('${K(1)}', 'h1', 'rb_live_1', 'agent-mcp', 'one@example.com',   'free',  '${U(1)}', ${ts(0)}, NULL),
    ('${K(2)}', 'h2', 'rb_live_2', 'agent-mcp', 'two@example.com',   'free',  '${U(2)}', ${ts(1)}, NULL),
    ('${K(3)}', 'h3', 'rb_live_3', 'data',      'three@example.com', 'trial', NULL,      ${ts(1)}, NULL),
    ('${K(4)}', 'h4', 'rb_live_4', 'agent-mcp', 'four@example.com',  'free',  '${U(4)}', ${ts(3)}, NULL),
    ('${K(5)}', 'h5', 'rb_live_5', 'agent-mcp', 'one@example.com',   'free',  NULL,      ${ts(0)}, ${ts(0)});

  INSERT INTO public.api_usage (key_id, day, endpoint, calls) VALUES
    ('${K(1)}', ${day(0)}, '/mcp/search_jobs', 5),
    ('${K(1)}', ${day(0)}, '/mcp/get_job', 2),
    ('${K(2)}', ${day(0)}, '/mcp/search_jobs', 3),
    ('${K(2)}', ${day(0)}, '/mcp/prompt/find_my_next_role', 1),
    ('${K(2)}', ${day(0)}, '/mcp/resource/jobs', 4),
    ('${K(3)}', ${day(0)}, '/v1/jobs', 9),
    ('${K(2)}', ${day(1)}, '/mcp/board_stats', 1),
    ('${K(4)}', ${day(3)}, '/mcp/search_jobs', 7);

  INSERT INTO public.mcp_anon_rate (day, bucket, calls) VALUES
    (${day(0)}, 'global', 30), (${day(0)}, 'ip:aaaa', 25), (${day(0)}, 'ip:bbbb', 5), (${day(0)}, 'ip:cccc', 25),
    (${day(1)}, 'global', 2),  (${day(1)}, 'ip:dddd', 2),
    (${day(3)}, 'global', 99), (${day(3)}, 'ip:eeee', 99);

  INSERT INTO public.agent_passes (user_id, stripe_session_id, amount_cents, session_hours, applications_total, applications_used, rate_per_min, daily_quota, purchased_at, shelf_expires_at, activated_at, expires_at, activated_via) VALUES
    ('${U(1)}', 'cs_1', 1234, 2, 3, 3, 4, 50, ${ts(1)}, ${ts(1)} + interval '5 days', ${ts(0)}, ${ts(0)} + interval '2 hours', 'key'),
    ('${U(2)}', 'cs_2', 1234, 2, 3, 1, 4, 50, ${ts(0)}, ${ts(0)} + interval '5 days', ${ts(0)} + interval '1 hour', ${ts(0)} + interval '3 hours', 'oauth:client-x'),
    ('${U(3)}', 'cs_3', 1234, 2, 3, 0, 4, 50, ${ts(0)}, ${ts(0)} + interval '5 days', NULL, NULL, NULL),
    ('${U(4)}', 'cs_4', 1234, 2, 3, 3, 4, 50, ${ts(3)}, ${ts(3)} + interval '5 days', ${ts(3)}, ${ts(3)} + interval '2 hours', NULL);

  INSERT INTO public.job_board_search_events (search_id, q, results, at, caller) VALUES
    (gen_random_uuid(), 'nurse', 10, ${ts(0)}, 'mcp'),
    (gen_random_uuid(), 'zzzz', 0, ${ts(0)}, 'mcp'),
    (gen_random_uuid(), 'welder', 4, ${ts(0)}, 'mcp'),
    (gen_random_uuid(), 'nurse', 10, ${ts(0)}, 'web'),
    (gen_random_uuid(), 'nurse', 10, ${ts(0)}, 'web'),
    (gen_random_uuid(), 'nurse', 0, ${ts(0)}, NULL),
    (gen_random_uuid(), 'nurse', 3, ${ts(1)}, 'mcp'),
    (gen_random_uuid(), 'nurse', 3, ${ts(3)}, 'mcp');
`);

// ---- 1. applies ----------------------------------------------------------------------
{
  let threw = "";
  try { await db.exec(MIG); } catch (e) { threw = String(e?.message ?? e); }
  check("20260917200000 applies on the synthetic schema", threw === "", threw);
}

const SIG = "public.agent_adoption_metrics(integer)";
const FN = "agent_adoption_metrics";
const call = (days) => rows(`SELECT * FROM public.agent_adoption_metrics($1)`, [days]);
const today = (await one(`SELECT ((now() AT TIME ZONE 'utc')::date)::text AS d`)).d;
const dateOf = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const minus = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const num = (v) => (typeof v === "bigint" ? Number(v) : Number(v));
// jsonb stores object keys shortest-first, so compare through a key-sorted serialisation.
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : typeof x === "bigint" ? Number(x) : x));

// ---- 2. the three-day window ---------------------------------------------------------
const three = await call(3);
check("a three-day window answers three rows, newest first, one per day", three.length === 3 && dateOf(three[0].metric_day) === today && dateOf(three[1].metric_day) === minus(today, 1) && dateOf(three[2].metric_day) === minus(today, 2), three.map((r) => dateOf(r.metric_day)).join(","));
{
  const nulls = [];
  for (const r of three) for (const [k, v] of Object.entries(r)) if (v === null || v === undefined) nulls.push(`${dateOf(r.metric_day)}.${k}`);
  check("every column of every row is non-null", nulls.length === 0, nulls.join(", "));
  check("the OUT shape has more than twenty columns and every name carries a prefix no table column uses",
    Object.keys(three[0]).length > 20 && Object.keys(three[0]).every((k) => /^(metric|keys|mcp|unkeyed|passes)_/.test(k)), Object.keys(three[0]).join(","));
}

const d0 = three[0], d1 = three[1], d2 = three[2];
// keys
check("D0: two agent keys minted (one of them revoked), zero other", num(d0.keys_minted_agent) === 2 && num(d0.keys_minted_other) === 0, `${d0.keys_minted_agent}/${d0.keys_minted_other}`);
check("D1: one agent key and one other key minted", num(d1.keys_minted_agent) === 1 && num(d1.keys_minted_other) === 1, `${d1.keys_minted_agent}/${d1.keys_minted_other}`);
// usage
check("D0: two distinct keys active on the MCP endpoints (the /v1 key is not one of them)", num(d0.keys_active_mcp) === 2, String(d0.keys_active_mcp));
check("D0: fifteen MCP calls across every family; the nine /v1 calls are not counted", num(d0.mcp_calls_total) === 15, String(d0.mcp_calls_total));
check("D0: ten tool calls, one prompt read, four resource reads", num(d0.mcp_tool_calls_total) === 10 && num(d0.mcp_prompt_calls_total) === 1 && num(d0.mcp_resource_calls_total) === 4, `${d0.mcp_tool_calls_total}/${d0.mcp_prompt_calls_total}/${d0.mcp_resource_calls_total}`);
check("D0: the tool detail carries calls and distinct keys per tool name",
  canon(d0.mcp_tool_usage) === canon({ get_job: { calls: 2, keys: 1 }, search_jobs: { calls: 8, keys: 2 } }), JSON.stringify(d0.mcp_tool_usage));
check("D0: the prompt and resource details are keyed by the leaf name, not the full endpoint",
  canon(d0.mcp_prompt_usage) === canon({ find_my_next_role: { calls: 1, keys: 1 } }) && canon(d0.mcp_resource_usage) === canon({ jobs: { calls: 4, keys: 1 } }),
  JSON.stringify([d0.mcp_prompt_usage, d0.mcp_resource_usage]));
check("D0: the per-key detail is keyed by key_prefix (never id or hash) with each key's calls across every family",
  canon(d0.mcp_key_usage) === canon({ rb_live_1: 7, rb_live_2: 8 }) && !JSON.stringify(d0.mcp_key_usage).includes("aaaaaaaa") && !JSON.stringify(d0.mcp_key_usage).includes("h1"), JSON.stringify(d0.mcp_key_usage));
check("D1: the per-key detail names the one key active that day", canon(d1.mcp_key_usage) === canon({ rb_live_2: 1 }), JSON.stringify(d1.mcp_key_usage));
check("D1: one key, one tool call, empty prompt and resource details", num(d1.keys_active_mcp) === 1 && num(d1.mcp_calls_total) === 1 && canon(d1.mcp_tool_usage) === canon({ board_stats: { calls: 1, keys: 1 } }) && JSON.stringify(d1.mcp_prompt_usage) === "{}" && JSON.stringify(d1.mcp_resource_usage) === "{}");
// unkeyed
check("D0: the global row's calls, three address rows, the largest address count, two addresses at it",
  num(d0.unkeyed_calls) === 30 && num(d0.unkeyed_addresses) === 3 && num(d0.unkeyed_address_calls_max) === 25 && num(d0.unkeyed_addresses_at_max) === 2,
  `${d0.unkeyed_calls}/${d0.unkeyed_addresses}/${d0.unkeyed_address_calls_max}/${d0.unkeyed_addresses_at_max}`);
check("D1: two global calls from one address, which is therefore the one at max", num(d1.unkeyed_calls) === 2 && num(d1.unkeyed_addresses) === 1 && num(d1.unkeyed_address_calls_max) === 2 && num(d1.unkeyed_addresses_at_max) === 1);
// passes
check("D0: two passes sold (one never activated), neither exhausted", num(d0.passes_sold) === 2 && num(d0.passes_exhausted) === 0, `${d0.passes_sold}/${d0.passes_exhausted}`);
check("D1: one pass sold, and it has since used every application (cohort exhausted)", num(d1.passes_sold) === 1 && num(d1.passes_exhausted) === 1, `${d1.passes_sold}/${d1.passes_exhausted}`);
check("D0: two passes activated -- one by key, one by an OAuth client, none unstamped",
  num(d0.passes_activated) === 2 && num(d0.passes_activated_via_key) === 1 && num(d0.passes_activated_via_oauth) === 1 && num(d0.passes_activated_via_unstamped) === 0,
  `${d0.passes_activated}/${d0.passes_activated_via_key}/${d0.passes_activated_via_oauth}/${d0.passes_activated_via_unstamped}`);
check("D0: the activation detail names the OAuth client id", canon(d0.passes_activated_via_detail) === canon({ key: 1, "oauth:client-x": 1 }), JSON.stringify(d0.passes_activated_via_detail));
check("D1: no activation that day", num(d1.passes_activated) === 0 && JSON.stringify(d1.passes_activated_via_detail) === "{}");
// searches
check("D0: three MCP searches, one with zero results; web and unattributed searches are not counted", num(d0.mcp_searches) === 3 && num(d0.mcp_searches_zero_results) === 1, `${d0.mcp_searches}/${d0.mcp_searches_zero_results}`);
check("D1: one MCP search, none empty", num(d1.mcp_searches) === 1 && num(d1.mcp_searches_zero_results) === 0);
// the empty day
{
  const bad = [];
  for (const [k, v] of Object.entries(d2)) {
    if (k === "metric_day") continue;
    const ok = typeof v === "object" && v !== null ? JSON.stringify(v) === "{}" : num(v) === 0;
    if (!ok) bad.push(`${k}=${JSON.stringify(v)}`);
  }
  check("D2 (no rows anywhere): every count is zero and every detail is an empty object, never NULL", bad.length === 0, bad.join(", "));
}

// ---- 3. the window edge and the degenerate argument -------------------------------------
{
  const four = await call(4);
  const d3 = four[3];
  check("a four-day window includes the day three back, with its rows", four.length === 4 && dateOf(d3.metric_day) === minus(today, 3) && num(d3.keys_minted_agent) === 1 && num(d3.mcp_calls_total) === 7 && num(d3.unkeyed_calls) === 99 && num(d3.passes_sold) === 1 && num(d3.passes_activated_via_unstamped) === 1 && num(d3.mcp_searches) === 1,
    four.map((r) => `${dateOf(r.metric_day)}:${r.mcp_calls_total}`).join(","));
  check("a three-day window never counted the day three back into another day", num(d0.mcp_calls_total) + num(d1.mcp_calls_total) + num(d2.mcp_calls_total) === 16);
  const nul = await call(null);
  const zero = await call(0);
  const neg = await call(-5);
  check("NULL, zero and negative p_days each answer exactly today", nul.length === 1 && zero.length === 1 && neg.length === 1 && dateOf(nul[0].metric_day) === today && dateOf(neg[0].metric_day) === today);
}

// ---- 4. privileges, signature, definer ------------------------------------------------
{
  const priv = async (role) => (await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, SIG])).ok;
  check(`${FN}: anon, authenticated and a PUBLIC-only role cannot execute; service_role can`, (await priv("anon")) === false && (await priv("authenticated")) === false && (await priv("nobody_probe")) === false && (await priv("service_role")) === true);
  const ctl = await one(`SELECT has_function_privilege('anon', 'auth.uid()', 'EXECUTE') AS ok`);
  check("control: the privilege probe can see a grant that exists", ctl.ok === true);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    const err = await fails(`SELECT * FROM public.agent_adoption_metrics(3)`);
    await db.exec(`RESET ROLE`);
    check(`an actual call as ${role} is a permission error (42501), not a row`, err?.code === "42501", String(err?.message ?? "no error"));
  }
  await db.exec(`SET ROLE service_role`);
  const asService = await fails(`SELECT * FROM public.agent_adoption_metrics(3)`);
  await db.exec(`RESET ROLE`);
  check("an actual call as service_role answers", asService === null, String(asService?.message ?? ""));
  const n = await one(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`, [FN]);
  check(`${FN}: exactly one signature in the catalog (the stray overload was dropped)`, n.n === 1, String(n.n));
  const args = await one(`SELECT pg_get_function_identity_arguments(p.oid) AS a FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`, [FN]);
  check("and that signature is (p_days integer)", args.a === "p_days integer", args.a);
  const def = await one(`SELECT p.prosecdef AS definer, p.proconfig AS cfg, p.provolatile AS vol FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`, [FN]);
  check(`${FN}: SECURITY DEFINER with search_path pinned, declared STABLE (it writes nothing)`, def.definer === true && (def.cfg ?? []).some((c) => /^search_path=/.test(c)) && def.vol === "s", JSON.stringify(def));
}

// ---- 5. reads only: the tables are byte-identical after a call -------------------------
{
  const snapTables = async () => JSON.stringify({
    keys: await rows(`SELECT ak.id, ak.revoked_at FROM public.api_keys ak ORDER BY ak.id`),
    usage: await rows(`SELECT u.key_id, u.day, u.endpoint, u.calls FROM public.api_usage u ORDER BY 1, 2, 3`),
    anon: await rows(`SELECT r.day, r.bucket, r.calls FROM public.mcp_anon_rate r ORDER BY 1, 2`),
    passes: await rows(`SELECT ap.id, ap.closed_at, ap.applications_used FROM public.agent_passes ap ORDER BY ap.id`),
    searches: await rows(`SELECT e.id, e.caller FROM public.job_board_search_events e ORDER BY e.id`),
  });
  const a = await snapTables();
  await call(30);
  check("a call writes nothing: every table it reads is unchanged afterwards (no lazy close, no prune)", (await snapTables()) === a);
}

// ---- 6. idempotent ----------------------------------------------------------------------
{
  const snap = async () => JSON.stringify({
    fns: await rows(`SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS a, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1, 2`),
    grants: await rows(`SELECT r.rolname, has_function_privilege(r.rolname, '${SIG}', 'EXECUTE') AS ok FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'nobody_probe') ORDER BY 1`),
    out: (await call(3)).map((r) => JSON.stringify(r, (_, v) => (typeof v === "bigint" ? Number(v) : v))),
  });
  const a = await snap();
  let threw = "";
  try { await db.exec(MIG); } catch (e) { threw = String(e?.message ?? e); }
  check("a second run applies cleanly", threw === "", threw);
  check("and changes nothing: same catalog, same grants, same answer (idempotent)", (await snap()) === a);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
