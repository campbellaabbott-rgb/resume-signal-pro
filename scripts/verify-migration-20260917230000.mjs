// Executes 20260917230000 (api_key_check: a resource read never starts a
// pass) in pglite against synthetic copies of the tables it touches, AFTER
// the previous api_key_check (20260917120000) so the two can be A/B'd on
// the same script. Proves:
//   * it applies, and applies again unchanged (idempotent); exactly one
//     signature; the OUT shape is byte-identical to the previous definition;
//   * on a key with NO pass the new definition answers every column exactly
//     as the previous one did, on every endpoint family;
//   * on a key whose account holds an UNACTIVATED pass: a resource read and
//     key_status are allowed, served the pass overlay (its rate and quota
//     compared and returned, tier = pass), metered under their own endpoint
//     in api_usage — and leave activated_at NULL and pass_ends_at NULL; the
//     first tool call then activates it, with expires_at = now() + the ROW's
//     session_hours, and a resource read after that reports the running
//     clock;
//   * the previous definition, given the same resource read, DID activate —
//     which is the defect this migration exists for, reproduced rather than
//     asserted;
//   * the families exempted here are exactly the non-tool families the
//     server writes (read out of agent-mcp/index.ts, comment-stripped), and
//     key_status stays exempt; a prompt is not among them because the server
//     never meters one (no /mcp/prompt literal exists to hand the check);
//   * anon, authenticated and a PUBLIC-only role cannot execute it; the
//     service role can.
// No pass number is spelled here: the synthetic pass carries numbers chosen
// to differ from the product's, which is also what proves the overlay copies
// its numbers from the row.
// Usage: node scripts/verify-migration-20260917230000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";
const byStamp = (stamp) => {
  const f = readdirSync(DIR).find((n) => n.startsWith(stamp + "_"));
  if (!f) throw new Error(`no migration with stamp ${stamp}`);
  return readFileSync(`${DIR}/${f}`, "utf8");
};
const PREVIOUS = byStamp("20260917120000");
const MIG = byStamp("20260917230000");
const bareSql = (s) => s.replace(/--[^\n]*/g, "");

const serverTs = readFileSync("supabase/functions/agent-mcp/index.ts", "utf8").replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
/** The non-tool families the server writes: every /mcp/<family>/ literal's family. */
const serverFamilies = [...new Set([...serverTs.matchAll(/["'`]\/mcp\/([A-Za-z0-9_-]+)\//g)].map((m) => m[1]))].sort();
if (!serverFamilies.length) throw new Error("agent-mcp no longer writes a non-tool endpoint family — RE-ANCHOR");

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

const db = new PGlite();
const rows = async (q, params) => (await db.query(q, params)).rows;
const one = async (q, params) => (await rows(q, params))[0];
const fails = async (q, params) => { try { await db.query(q, params); return null; } catch (e) { return e; } };

const PASS = { hours: 2, apps: 3, rate: 4, quota: 50 };
const U1 = "11111111-1111-4111-8111-111111111111";
const KEY_RATE = 60, KEY_QUOTA = 1000;

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE nobody_probe;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  INSERT INTO auth.users VALUES ('${U1}', 'one@example.com');
  CREATE TABLE public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL, name text NOT NULL, owner_email text NOT NULL,
    tier text NOT NULL DEFAULT 'trial', rate_per_min integer NOT NULL DEFAULT ${KEY_RATE}, daily_quota integer NOT NULL DEFAULT ${KEY_QUOTA},
    created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz, notes text, user_id uuid
  );
  CREATE TABLE public.api_usage (key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE, day date NOT NULL, endpoint text NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day, endpoint));
  CREATE TABLE public.api_rate (key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE, minute timestamptz NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, minute));
  CREATE TABLE public.api_quota (key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE, day date NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day));
  CREATE TABLE public.agent_passes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_session_id text NOT NULL, stripe_payment_intent_id text, amount_cents integer NOT NULL,
    session_hours integer NOT NULL, applications_total integer NOT NULL, applications_used integer NOT NULL DEFAULT 0,
    rate_per_min integer NOT NULL, daily_quota integer NOT NULL,
    purchased_at timestamptz NOT NULL DEFAULT now(), shelf_expires_at timestamptz NOT NULL,
    activated_at timestamptz, expires_at timestamptz, activated_via text, activated_user_agent text,
    closed_at timestamptz, close_reason text, created_at timestamptz NOT NULL DEFAULT now()
  );
`);

// ---- 1. previous, then this one, twice -------------------------------------------
{
  let threw = "";
  try { await db.exec(PREVIOUS); } catch (e) { threw = String(e?.message ?? e); }
  check("the previous api_key_check (20260917120000) applies on the synthetic schema", threw === "", threw);
}
const shapeOf = async () => (await rows(`SELECT pg_get_function_result(p.oid) AS r, pg_get_function_identity_arguments(p.oid) AS a FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'api_key_check'`));
const prevShape = await shapeOf();

const ALL = ["is_allowed", "deny_reason", "api_key_id", "key_tier", "rate_limit", "rate_used", "quota_limit", "quota_used", "pass_ends_at", "pass_apps_left"];
const pick = (r, cols) => JSON.stringify(cols.map((c) => r[c] instanceof Date ? r[c].toISOString() : r[c]));
const checkKey = (hash, endpoint) => one(`SELECT * FROM public.api_key_check($1, $2)`, [hash, endpoint]);
const KEY_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const NOPASS_ID = "aaaaaaaa-0000-4000-8000-000000000002";
const ENDPOINTS = ["/mcp/key_status", "/mcp/search_jobs", ...serverFamilies.map((f) => `/mcp/${f}/x`), "/v1/jobs"];

async function reset() {
  await db.exec(`TRUNCATE public.api_rate, public.api_quota, public.api_usage, public.agent_passes; DELETE FROM public.api_keys;`);
  await db.exec(`INSERT INTO public.api_keys (id, key_hash, key_prefix, name, owner_email, tier, user_id) VALUES
    ('${KEY_ID}', 'h-pass', 'rb_live_p', 'agent-mcp', 'one@example.com', 'free', '${U1}'),
    ('${NOPASS_ID}', 'h-nopass', 'rb_live_n', 'data', 'nobody@example.com', 'trial', NULL);`);
}
async function grantPass() {
  await db.exec(`INSERT INTO public.agent_passes (user_id, stripe_session_id, amount_cents, session_hours, applications_total, rate_per_min, daily_quota, shelf_expires_at)
    VALUES ('${U1}', 'cs_${Math.random()}', 1234, ${PASS.hours}, ${PASS.apps}, ${PASS.rate}, ${PASS.quota}, now() + interval '5 days')`);
}
const passRow = () => one(`SELECT activated_at, expires_at, closed_at FROM public.agent_passes WHERE user_id = $1`, [U1]);

// The no-pass script, under both definitions: identical answers.
async function noPassScript() {
  await reset();
  const out = [];
  for (const ep of ENDPOINTS) out.push(pick(await checkKey("h-nopass", ep), ALL));
  return out.join("|");
}
// The unactivated-pass script: what a discovery read does to the clock.
async function lookScript(endpoint) {
  await reset();
  await grantPass();
  const d = await checkKey("h-pass", endpoint);
  const p = await passRow();
  const usage = await one(`SELECT calls FROM public.api_usage WHERE key_id = $1 AND endpoint = $2`, [KEY_ID, endpoint]);
  return { d, p, usage };
}

const previousNoPass = await noPassScript();
const previousLook = {};
for (const f of serverFamilies) previousLook[f] = await lookScript(`/mcp/${f}/x`);

{
  let threw = "";
  try { await db.exec(MIG); } catch (e) { threw = String(e?.message ?? e); }
  check("20260917230000 applies after the previous definition", threw === "", threw);
  threw = "";
  try { await db.exec(MIG); } catch (e) { threw = String(e?.message ?? e); }
  check("applies a second time unchanged (idempotent)", threw === "", threw);
}
const newShape = await shapeOf();
check("exactly one signature, and the OUT shape is the previous definition's byte for byte", newShape.length === 1 && JSON.stringify(newShape) === JSON.stringify(prevShape), JSON.stringify(newShape));

// ---- 2. A/B on a key with no pass -------------------------------------------------
check("A/B: a key with no pass answers every column exactly as before, on every endpoint family", (await noPassScript()) === previousNoPass);

// ---- 3. the look: no clock -----------------------------------------------------------
for (const f of serverFamilies) {
  const { d, p, usage } = await lookScript(`/mcp/${f}/x`);
  check(`${f} read on an unactivated pass: allowed, served the pass overlay (rate ${PASS.rate}, quota ${PASS.quota}, tier pass)`,
    d.is_allowed === true && d.rate_limit === PASS.rate && d.quota_limit === PASS.quota && d.key_tier === "pass", pick(d, ALL));
  check(`${f} read on an unactivated pass: activated_at stays NULL, pass_ends_at NULL, applications untouched`,
    p.activated_at === null && p.expires_at === null && d.pass_ends_at === null && d.pass_apps_left === PASS.apps, JSON.stringify({ p, ends: d.pass_ends_at }));
  check(`${f} read is metered under its own endpoint`, usage?.calls === 1, JSON.stringify(usage));
  // The defect, reproduced: the previous definition started the clock on the same read.
  check(`the PREVIOUS definition started the clock on that ${f} read (the defect this migration removes)`,
    previousLook[f].p.activated_at !== null && previousLook[f].d.pass_ends_at !== null, JSON.stringify(previousLook[f].p));
}
{
  const { d, p } = await lookScript("/mcp/key_status");
  check("key_status on an unactivated pass still starts nothing", d.is_allowed === true && p.activated_at === null && d.pass_ends_at === null);
}
{
  await reset(); await grantPass();
  const before = await one(`SELECT now() AS t`);
  const d = await checkKey("h-pass", "/mcp/search_jobs");
  const p = await passRow();
  const expectedEnd = new Date(before.t.getTime() + PASS.hours * 3600 * 1000);
  check("the first TOOL call activates: expires_at = now() + the row's session_hours, returned as pass_ends_at",
    d.is_allowed === true && p.activated_at !== null && p.expires_at !== null && Math.abs(p.expires_at.getTime() - expectedEnd.getTime()) < 5000 && d.pass_ends_at?.getTime() === p.expires_at.getTime(),
    JSON.stringify({ p, ends: d.pass_ends_at }));
  const after = await checkKey("h-pass", `/mcp/${serverFamilies[0]}/x`);
  const p2 = await passRow();
  check("a read AFTER activation reports the running clock and does not re-stamp",
    after.pass_ends_at?.getTime() === p.expires_at.getTime() && p2.activated_at?.getTime() === p.activated_at.getTime());
}
{
  await reset(); await grantPass();
  const d = await checkKey("h-pass", "/v1/jobs");
  const p = await passRow();
  check("a /v1/ call sees no overlay and starts nothing (unchanged)", d.key_tier === "free" && d.rate_limit === KEY_RATE && p.activated_at === null);
}

// ---- 4. the families exempted here are the families the server writes ---------------
{
  const exempt = [...bareSql(MIG).matchAll(/p_endpoint NOT LIKE '\/mcp\/([A-Za-z0-9_-]+)\/%'/g)].map((m) => m[1]).sort();
  check("the exempted families equal the non-tool families agent-mcp writes", JSON.stringify(exempt) === JSON.stringify(serverFamilies), `migration ${JSON.stringify(exempt)} vs server ${JSON.stringify(serverFamilies)}`);
  // A prompt is discovery and never metered: no prompt endpoint exists on
  // the server to hand api_key_check, so none is exempted here either.
  check("the server hands no prompt endpoint to the check, and the migration exempts none", !/\/mcp\/prompt/.test(serverTs) && !exempt.includes("prompt"), JSON.stringify(exempt));
}

// ---- 5. roles ---------------------------------------------------------------------------
for (const role of ["anon", "authenticated", "nobody_probe"]) {
  await db.exec(`SET ROLE ${role}`);
  const e = await fails(`SELECT * FROM public.api_key_check('h-pass', '/mcp/key_status')`);
  await db.exec(`RESET ROLE`);
  check(`${role} cannot execute api_key_check`, e !== null && /permission denied/i.test(String(e?.message ?? e)), String(e?.message ?? e).slice(0, 80));
}
{
  await db.exec(`SET ROLE service_role`);
  const e = await fails(`SELECT * FROM public.api_key_check('h-pass', '/mcp/key_status')`);
  await db.exec(`RESET ROLE`);
  check("service_role can execute api_key_check", e === null, String(e?.message ?? ""));
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures ? 1 : 0);
