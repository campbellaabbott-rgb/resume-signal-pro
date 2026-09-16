// Executes the eight Agent Pass migrations (20260917100000 -> 110000 -> 120000 ->
// 140000 -> 150000 -> 160000 -> 170000 -> 180000) in pglite against synthetic copies of the tables
// they touch, AFTER the previous api_key_check (20260827162000) so the old and
// new checkers can be A/B'd on a key with no pass. Proves:
//   * the eight apply in order and are idempotent (a second run changes nothing);
//   * the grant copies every number in from its parameters, refuses a second
//     open pass for the same user through the partial unique index
//     (pass_already_open, nothing written), answers a repeated session id or
//     payment intent as a duplicate with the same id, and grants again once
//     the previous pass has run out (lazy close first);
//   * api_key_check on a key with NO pass answers byte-for-byte what the
//     previous definition answered on every path, with the two new columns
//     NULL; a live pass on an /mcp/ endpoint answers the pass row's rate,
//     quota and tier and the limits are COMPARED against them; the same key
//     on a /v1/ endpoint sees no overlay and does not activate;
//   * activation happens only on an allowed /mcp/ call other than key_status:
//     key_status, a rate-limited call, a revoked key and a quota-exceeded
//     call all leave activated_at NULL; the first allowed call stamps it
//     with expires_at = activated_at + the row's own session_hours and returns
//     it as pass_ends_at; a second call does not re-stamp; a rotated key for
//     the same user still sees the pass;
//   * after expiry the overlay is gone, the pass is closed session_ended and
//     pass_ends_at is NULL; a never-activated pass past its shelf closes
//     shelf_expired;
//   * agent_queue_enqueue inserts the row and increments the pass together,
//     stamps pass_id, answers already_queued without incrementing, refuses
//     pass_exhausted at applications_total with nothing written, refuses
//     pass_not_live without a live pass, and writes pass_id NULL with no
//     increment when subscription-funded;
//   * the refund trigger gives one application back on stale-at-insert and on
//     blocked with the never-retry attempts or a non-empty error, exactly once
//     per row, and never on a preparation-time blocked, on failed, on
//     submitted, or on a row no pass paid for; it lands after the pass has
//     closed; it gives NOTHING back when the status write arrives under the
//     owner's own role (authenticated) or anon — only the pipeline's
//     service_role and a claimless session refund; and the owner's UPDATE on
//     agent_queue / agent_submissions is narrowed to the decision columns, so
//     pass_id and pass_refunded_at are refused to the owner (42501) while the
//     panels' own writes still land;
//   * agent_pass_metrics answers the counts this run produced;
//   * anon, authenticated and a PUBLIC-only role cannot execute any of the
//     five functions; service_role can; anon cannot read agent_passes at all
//     (a permission error, not an empty page) and an owner reads only their
//     own rows;
//   * exactly one signature per function.
// No pass number is spelled here: every value handed to the grant is a
// synthetic one chosen to differ from the product's, which is also what proves
// the rows copy their numbers from the parameters.
// Usage: node scripts/verify-migration-20260917100000.mjs   (from the repo root)
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";
const byStamp = (stamp) => {
  const f = readdirSync(DIR).find((n) => n.startsWith(stamp + "_"));
  if (!f) throw new Error(`no migration with stamp ${stamp}`);
  return readFileSync(`${DIR}/${f}`, "utf8");
};
const PREVIOUS_CHECK = byStamp("20260827162000");
const STAMPS = ["20260917100000", "20260917110000", "20260917120000", "20260917140000", "20260917150000", "20260917160000", "20260917170000", "20260917180000"];
const MIGS = STAMPS.map(byStamp);

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

const db = new PGlite();
const rows = async (q, params) => (await db.query(q, params)).rows;
const one = async (q, params) => (await rows(q, params))[0];
const fails = async (q, params) => { try { await db.query(q, params); return null; } catch (e) { return e; } };

// Synthetic numbers for a pass: none equals the product's.
const PASS = { cents: 1234, hours: 2, apps: 3, rate: 4, quota: 50, shelf: 5 };
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const KEY_RATE = 60, KEY_QUOTA = 1000;

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE nobody_probe;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, nobody_probe;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  INSERT INTO auth.users VALUES ('${U1}', 'one@example.com'), ('${U2}', 'two@example.com'), ('${U3}', 'three@example.com');

  CREATE TABLE public.api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL, name text NOT NULL, owner_email text NOT NULL,
    tier text NOT NULL DEFAULT 'trial', rate_per_min integer NOT NULL DEFAULT ${KEY_RATE}, daily_quota integer NOT NULL DEFAULT ${KEY_QUOTA},
    created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz, notes text, user_id uuid
  );
  CREATE TABLE public.api_usage (key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE, day date NOT NULL, endpoint text NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day, endpoint));
  CREATE TABLE public.api_rate (key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE, minute timestamptz NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, minute));
  CREATE TABLE public.api_quota (key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE, day date NOT NULL, calls integer NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day));

  CREATE TABLE public.agent_searches (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY);
  CREATE TABLE public.agent_queue (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    posting_id text NOT NULL,
    title text NOT NULL DEFAULT '', company text NOT NULL DEFAULT '', company_token text NOT NULL DEFAULT '',
    location text NOT NULL DEFAULT '', apply_url text NOT NULL DEFAULT '', salary text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT 'other', posted_at timestamptz, fit_pct integer,
    reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','approved','dismissed','expired')),
    created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
    search_id bigint REFERENCES public.agent_searches(id) ON DELETE SET NULL,
    search_label text NOT NULL DEFAULT '',
    UNIQUE (user_id, posting_id)
  );
  GRANT SELECT, UPDATE ON public.agent_queue TO authenticated;
  ALTER TABLE public.agent_queue ENABLE ROW LEVEL SECURITY;
  CREATE POLICY agent_queue_owner_read ON public.agent_queue FOR SELECT USING (auth.uid() = user_id);
  CREATE POLICY agent_queue_owner_decide ON public.agent_queue FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  CREATE TABLE public.agent_submissions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    posting_id text NOT NULL,
    title text NOT NULL DEFAULT '', company text NOT NULL DEFAULT '', company_token text NOT NULL DEFAULT '',
    apply_url text NOT NULL DEFAULT '', source text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','ready','blocked','submitted','failed','stale')),
    fields jsonb NOT NULL DEFAULT '{}'::jsonb, questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    questions_are_real boolean NOT NULL DEFAULT false, answers jsonb NOT NULL DEFAULT '[]'::jsonb,
    blockers jsonb NOT NULL DEFAULT '[]'::jsonb, resume_version_id uuid, cover_letter text NOT NULL DEFAULT '',
    fit_pct integer, prepared_at timestamptz, submitted_at timestamptz, submitted_via text,
    error text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz, release_refusal text NOT NULL DEFAULT '', claimed_at timestamptz, claimed_by text NOT NULL DEFAULT '',
    attempts integer NOT NULL DEFAULT 0, claimable_at timestamptz,
    sent_answers jsonb NOT NULL DEFAULT '[]'::jsonb, sent_evidence text NOT NULL DEFAULT ''
  );
  GRANT SELECT, UPDATE ON public.agent_submissions TO authenticated;
  ALTER TABLE public.agent_submissions ENABLE ROW LEVEL SECURITY;
  CREATE POLICY agent_submissions_owner_read ON public.agent_submissions FOR SELECT USING (auth.uid() = user_id);
  CREATE POLICY agent_submissions_owner_update ON public.agent_submissions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

  CREATE TABLE public.used_stripe_sessions (session_id text PRIMARY KEY, used_at timestamptz NOT NULL DEFAULT now(), ip_address text, product_type text);
  CREATE TABLE public.product_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), stripe_session_id text NOT NULL, product_type text NOT NULL, status text NOT NULL DEFAULT 'payment_received');
`);

// ---- 1. the previous checker, then the eight in order ---------------------------------
{
  let threw = "";
  try { await db.exec(PREVIOUS_CHECK); } catch (e) { threw = String(e?.message ?? e); }
  check("the previous api_key_check (20260827162000) applies on the synthetic schema", threw === "", threw);
}

// A key with no pass, exercised on every path, under the OLD checker. The
// same script runs again under the new one and the eight old columns must
// match exactly.
const OLD8 = ["is_allowed", "deny_reason", "api_key_id", "key_tier", "rate_limit", "rate_used", "quota_limit", "quota_used"];
const pick = (r, cols) => JSON.stringify(cols.map((c) => r[c] instanceof Date ? r[c].toISOString() : r[c]));
const checkKey = (hash, endpoint) => one(`SELECT * FROM public.api_key_check($1, $2)`, [hash, endpoint]);
async function abScript() {
  await db.exec(`TRUNCATE public.api_rate, public.api_quota, public.api_usage; DELETE FROM public.api_keys;`);
  // Fixed ids, so the two runs are comparable byte for byte (api_key_id is returned).
  await db.exec(`INSERT INTO public.api_keys (id, key_hash, key_prefix, name, owner_email, tier, user_id) VALUES
    ('aaaaaaaa-0000-4000-8000-000000000001', 'h-nopass', 'rb_live_np', 'agent-mcp', 'three@example.com', 'free', '${U3}'),
    ('aaaaaaaa-0000-4000-8000-000000000002', 'h-anonless', 'rb_live_al', 'data', 'nobody@example.com', 'trial', NULL),
    ('aaaaaaaa-0000-4000-8000-000000000003', 'h-revoked', 'rb_live_rv', 'agent-mcp', 'three@example.com', 'free', '${U3}'),
    ('aaaaaaaa-0000-4000-8000-000000000004', 'h-tight', 'rb_live_tt', 'agent-mcp', 'three@example.com', 'free', NULL);
    UPDATE public.api_keys SET revoked_at = now() WHERE key_hash = 'h-revoked';
    UPDATE public.api_keys SET rate_per_min = 2, daily_quota = 3 WHERE key_hash = 'h-tight';`);
  const out = [];
  out.push(pick(await checkKey("h-missing", "/mcp/search_jobs"), OLD8));
  out.push(pick(await checkKey("h-nopass", "/mcp/key_status"), OLD8));
  out.push(pick(await checkKey("h-nopass", "/mcp/search_jobs"), OLD8));
  out.push(pick(await checkKey("h-nopass", "/v1/jobs"), OLD8));
  out.push(pick(await checkKey("h-anonless", "/mcp/search_jobs"), OLD8));
  out.push(pick(await checkKey("h-revoked", "/mcp/search_jobs"), OLD8));
  for (let i = 0; i < 3; i++) out.push(pick(await checkKey("h-tight", "/v1/jobs"), OLD8));   // 3rd trips the minute (rate 2)
  await db.exec(`DELETE FROM public.api_rate WHERE key_id = (SELECT id FROM public.api_keys WHERE key_hash = 'h-tight')`);
  for (let i = 0; i < 3; i++) out.push(pick(await checkKey("h-tight", "/mcp/get_job"), OLD8)); // day bucket climbs past 3
  await db.exec(`DELETE FROM public.api_rate WHERE key_id = (SELECT id FROM public.api_keys WHERE key_hash = 'h-tight')`);
  out.push(pick(await checkKey("h-tight", "/mcp/get_job"), OLD8));                            // quota_exceeded
  const usage = await rows(`SELECT ak.key_hash, u.endpoint, u.calls FROM public.api_usage u JOIN public.api_keys ak ON ak.id = u.key_id ORDER BY 1, 2`);
  out.push(JSON.stringify(usage));
  return out;
}
const before = await abScript();
check("the A/B script exercised unknown, allowed, revoked, rate_limited and quota_exceeded under the old checker",
  before.some((s) => s.includes('"unknown_key"')) && before.some((s) => s.includes('"revoked"')) && before.some((s) => s.includes('"rate_limited"')) && before.some((s) => s.includes('"quota_exceeded"')) && before.some((s) => s.includes('"ok"')));

const applyAll = async () => {
  for (let i = 0; i < MIGS.length; i++) {
    let threw = "";
    try { await db.exec(MIGS[i]); } catch (e) { threw = String(e?.message ?? e); }
    check(`${STAMPS[i]} applies`, threw === "", threw);
  }
};
await applyAll();

// ---- 2. the A/B: no pass, nothing changes ------------------------------------------
{
  const after = await abScript();
  check("A/B: on a key with no pass the new api_key_check answers the old eight columns byte-for-byte on every path",
    JSON.stringify(after) === JSON.stringify(before), after.find((s, i) => s !== before[i]) ?? "");
  const r = await checkKey("h-nopass", "/mcp/search_jobs");
  check("and the two new columns are NULL when there is no pass", r.pass_ends_at === null && r.pass_apps_left === null, JSON.stringify(r));
  check("the OUT shape is the old eight in the old order plus the two appended", Object.keys(r).join(",") === [...OLD8, "pass_ends_at", "pass_apps_left"].join(","), Object.keys(r).join(","));
}

// ---- 3. the grant -------------------------------------------------------------------
const grant = (user, sess, pi, over = {}) => one(
  `SELECT * FROM public.agent_pass_grant($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
  [user, sess, pi, over.cents ?? PASS.cents, over.hours ?? PASS.hours, over.apps ?? PASS.apps, over.rate ?? PASS.rate, over.quota ?? PASS.quota, over.shelf ?? PASS.shelf]);
const passRow = (id) => one(`SELECT * FROM public.agent_passes ap WHERE ap.id = $1`, [id]);
const openPass = (user) => one(`SELECT * FROM public.agent_passes ap WHERE ap.user_id = $1 AND ap.closed_at IS NULL`, [user]);
let p1;
{
  const g = await grant(U1, "cs_one", "pi_one");
  check("a first grant answers granted with a pass id", g.granted_ok === true && g.grant_reason === "granted" && g.was_duplicate === false && !!g.granted_pass_id, JSON.stringify(g));
  p1 = await passRow(g.granted_pass_id);
  check("the row copied every number in from the parameters",
    p1.amount_cents === PASS.cents && p1.session_hours === PASS.hours && p1.applications_total === PASS.apps && p1.rate_per_min === PASS.rate && p1.daily_quota === PASS.quota && p1.applications_used === 0, JSON.stringify(p1));
  const shelf = await one(`SELECT (ap.shelf_expires_at = ap.purchased_at + make_interval(days => $2)) AS ok, ap.activated_at, ap.expires_at, ap.closed_at FROM public.agent_passes ap WHERE ap.id = $1`, [p1.id, PASS.shelf]);
  check("shelf_expires_at is purchased_at plus the shelf parameter; not activated, no clock, not closed", shelf.ok === true && shelf.activated_at === null && shelf.expires_at === null && shelf.closed_at === null, JSON.stringify(shelf));
  const cols = await rows(`SELECT column_name, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_passes' AND column_name IN ('amount_cents','session_hours','applications_total','rate_per_min','daily_quota','shelf_expires_at')`);
  check("none of the copied-in columns carries a DEFAULT (no second spelling of a product number)", cols.length === 6 && cols.every((c) => c.column_default === null), JSON.stringify(cols));

  const d = await grant(U1, "cs_one", "pi_one");
  check("the same session id again is a duplicate with the SAME id, still granted_ok", d.granted_ok === true && d.was_duplicate === true && d.grant_reason === "duplicate" && d.granted_pass_id === p1.id, JSON.stringify(d));
  const d2 = await grant(U1, "cs_one_again", "pi_one");
  check("a different session carrying the SAME payment intent is a duplicate with the same id (Stripe's two-event case)", d2.granted_ok === true && d2.was_duplicate === true && d2.granted_pass_id === p1.id, JSON.stringify(d2));
  const n = await one(`SELECT count(*)::int AS n FROM public.agent_passes ap WHERE ap.user_id = $1`, [U1]);
  check("and no second row exists", n.n === 1);

  const second = await grant(U1, "cs_two", "pi_two");
  check("TEETH: a second pass while one is open is refused pass_already_open (the partial unique index), not granted", second.granted_ok === false && second.grant_reason === "pass_already_open" && second.granted_pass_id === null, JSON.stringify(second));
  const n2 = await one(`SELECT count(*)::int AS n FROM public.agent_passes ap WHERE ap.user_id = $1`, [U1]);
  check("nothing was written by the refusal", n2.n === 1);
  const idx = await fails(`INSERT INTO public.agent_passes (user_id, stripe_session_id, amount_cents, session_hours, applications_total, rate_per_min, daily_quota, shelf_expires_at) VALUES ($1, 'cs_direct', 1, 1, 1, 1, 1, now() + interval '1 day')`, [U1]);
  check("the index itself raises 23505 on a direct second open row", idx?.code === "23505" || /agent_passes_one_open_pass_per_user/.test(String(idx?.message)), String(idx?.message));

  const bad = await grant(null, "cs_x", "pi_x");
  const bad2 = await grant(U2, "  ", "pi_x");
  const bad3 = await grant(U2, "cs_x", "pi_x", { hours: 0 });
  check("a null user, a blank session id or a non-positive number is bad_request", [bad, bad2, bad3].every((b) => b.granted_ok === false && b.grant_reason === "bad_request"));
  const nul = await grant(U2, "cs_nopi", null);
  check("a grant with no payment intent is fine (the column is nullable and its UNIQUE ignores NULLs)", nul.granted_ok === true && nul.grant_reason === "granted", JSON.stringify(nul));
  const nul2 = await grant(U3, "cs_nopi2", "");
  check("and an empty payment intent is stored as NULL, so two of them do not collide", nul2.granted_ok === true && nul2.grant_reason === "granted", JSON.stringify(nul2));
  await db.exec(`DELETE FROM public.agent_passes WHERE stripe_session_id IN ('cs_nopi', 'cs_nopi2')`);
}

// ---- 4. the overlay and activation ---------------------------------------------------
await db.exec(`INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, user_id) VALUES ('h-u1', 'rb_live_u1', 'agent-mcp', 'one@example.com', 'free', '${U1}')`);
{
  const s = await checkKey("h-u1", "/mcp/key_status");
  check("key_status on an unactivated pass already answers the pass row's rate, quota and tier", s.is_allowed === true && s.rate_limit === PASS.rate && s.quota_limit === PASS.quota && s.key_tier === "pass" && s.pass_apps_left === PASS.apps, JSON.stringify(s));
  check("but pass_ends_at is NULL — not started", s.pass_ends_at === null);
  check("and key_status did NOT activate the pass", (await passRow(p1.id)).activated_at === null);

  const v1 = await checkKey("h-u1", "/v1/jobs");
  check("the same key on a /v1/ endpoint sees no overlay: its own tier and limits", v1.is_allowed === true && v1.key_tier === "free" && v1.rate_limit === KEY_RATE && v1.quota_limit === KEY_QUOTA && v1.pass_ends_at === null && v1.pass_apps_left === null, JSON.stringify(v1));
  check("and a /v1/ call did NOT activate the pass", (await passRow(p1.id)).activated_at === null);

  // Trip the minute under the PASS rate (which is what proves the limit is compared, not merely returned).
  let last;
  for (let i = 0; i < PASS.rate + 1; i++) last = await checkKey("h-u1", "/mcp/key_status");
  check("the minute bucket is compared against the pass rate: the call past it is rate_limited with the pass numbers in the refusal", last.is_allowed === false && last.deny_reason === "rate_limited" && last.rate_limit === PASS.rate && last.key_tier === "pass", JSON.stringify(last));
  const rl = await checkKey("h-u1", "/mcp/search_jobs");
  check("a rate-limited /mcp/ call other than key_status is refused", rl.is_allowed === false && rl.deny_reason === "rate_limited");
  check("and did NOT activate the pass", (await passRow(p1.id)).activated_at === null);
  await db.exec(`DELETE FROM public.api_rate`);

  // Revoked key, same user: refused, not activated.
  await db.exec(`INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, user_id, revoked_at) VALUES ('h-u1-old', 'rb_live_u1o', 'agent-mcp', 'one@example.com', 'free', '${U1}', now())`);
  const rv = await checkKey("h-u1-old", "/mcp/search_jobs");
  check("a revoked key of the same user is refused revoked", rv.is_allowed === false && rv.deny_reason === "revoked");
  check("and did NOT activate the pass", (await passRow(p1.id)).activated_at === null);

  // Quota under the pass quota: push the day bucket past it directly.
  await db.exec(`INSERT INTO public.api_quota (key_id, day, calls) VALUES ((SELECT id FROM public.api_keys WHERE key_hash = 'h-u1'), (now() AT TIME ZONE 'utc')::date, ${PASS.quota}) ON CONFLICT (key_id, day) DO UPDATE SET calls = ${PASS.quota}`);
  const qe = await checkKey("h-u1", "/mcp/search_jobs");
  check("the day bucket is compared against the pass quota: the call past it is quota_exceeded", qe.is_allowed === false && qe.deny_reason === "quota_exceeded" && qe.quota_limit === PASS.quota, JSON.stringify(qe));
  check("and did NOT activate the pass", (await passRow(p1.id)).activated_at === null);
  await db.exec(`DELETE FROM public.api_quota; DELETE FROM public.api_rate;`);

  // The first ALLOWED call other than key_status.
  const ok = await checkKey("h-u1", "/mcp/search_jobs");
  const after = await passRow(p1.id);
  check("the first allowed /mcp/ call other than key_status is allowed with the pass numbers", ok.is_allowed === true && ok.key_tier === "pass" && ok.rate_limit === PASS.rate && ok.quota_limit === PASS.quota, JSON.stringify(ok));
  check("TEETH: and it activated the pass", after.activated_at !== null && after.expires_at !== null);
  const clock = await one(`SELECT (ap.expires_at = ap.activated_at + make_interval(hours => ap.session_hours)) AS ok FROM public.agent_passes ap WHERE ap.id = $1`, [p1.id]);
  check("expires_at is activated_at plus the ROW's session_hours", clock.ok === true);
  check("the activating call returns pass_ends_at = the new expires_at and the applications left", ok.pass_ends_at instanceof Date && ok.pass_ends_at.getTime() === after.expires_at.getTime() && ok.pass_apps_left === PASS.apps, JSON.stringify(ok));
  const ok2 = await checkKey("h-u1", "/mcp/get_job");
  const after2 = await passRow(p1.id);
  check("a second allowed call does not re-stamp activated_at or move expires_at", after2.activated_at.getTime() === after.activated_at.getTime() && after2.expires_at.getTime() === after.expires_at.getTime() && ok2.pass_ends_at.getTime() === after.expires_at.getTime());
  const ks = await checkKey("h-u1", "/mcp/key_status");
  check("key_status on a live pass now reports pass_ends_at", ks.pass_ends_at instanceof Date && ks.pass_ends_at.getTime() === after.expires_at.getTime());

  // Rotation mid-pass: a fresh key for the same user sees the same pass.
  await db.exec(`UPDATE public.api_keys SET revoked_at = now() WHERE key_hash = 'h-u1'; INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, user_id) VALUES ('h-u1-new', 'rb_live_u1n', 'agent-mcp', 'one@example.com', 'free', '${U1}')`);
  const rot = await checkKey("h-u1-new", "/mcp/search_jobs");
  check("a rotated key for the same user still carries the pass (lookup is by user_id)", rot.is_allowed === true && rot.key_tier === "pass" && rot.pass_ends_at.getTime() === after.expires_at.getTime(), JSON.stringify(rot));
  await db.exec(`UPDATE public.api_keys SET revoked_at = NULL WHERE key_hash = 'h-u1'; UPDATE public.api_keys SET revoked_at = now() WHERE key_hash = 'h-u1-new'`);
}

// ---- 5. consume ---------------------------------------------------------------------
const enqueue = (user, posting, funded, row = {}) => one(`SELECT * FROM public.agent_queue_enqueue($1, $2, $3::jsonb, $4)`, [user, posting, JSON.stringify({ title: "T", company: "C", status: "approved", fit_pct: 61, reasons: [{ k: "external-agent" }], search_label: "Connected agent", ...row }), funded]);
const used = async (id) => (await passRow(id)).applications_used;
{
  const e1 = await enqueue(U1, "job-1", true);
  check("a pass-funded accept inserts the row and answers queued with the applications left", e1.enqueued_ok === true && e1.enqueue_reason === "queued" && typeof e1.queued_row_id === "number" && e1.pass_apps_left === PASS.apps - 1, JSON.stringify(e1));
  check("and incremented the pass in the same call", (await used(p1.id)) === 1);
  const q1 = await one(`SELECT q.pass_id, q.status, q.title, q.fit_pct, q.reasons, q.search_label, q.category FROM public.agent_queue q WHERE q.id = $1`, [e1.queued_row_id]);
  check("the queue row is stamped with the pass that paid and carries the caller's fields", q1.pass_id === p1.id && q1.status === "approved" && q1.title === "T" && q1.fit_pct === 61 && q1.search_label === "Connected agent" && q1.category === "other", JSON.stringify(q1));
  const dup = await enqueue(U1, "job-1", true);
  check("the same posting again is already_queued, still enqueued_ok, and the pass is NOT incremented", dup.enqueued_ok === true && dup.enqueue_reason === "already_queued" && dup.queued_row_id === null && (await used(p1.id)) === 1, JSON.stringify(dup));
  await enqueue(U1, "job-2", true);
  const e3 = await enqueue(U1, "job-3", true);
  check("the last application is accepted with zero left", e3.enqueued_ok === true && e3.pass_apps_left === 0 && (await used(p1.id)) === PASS.apps);
  const nq = await one(`SELECT count(*)::int AS n FROM public.agent_queue q WHERE q.user_id = $1`, [U1]);
  const ex = await enqueue(U1, "job-4", true);
  check("TEETH: the accept past applications_total is refused pass_exhausted", ex.enqueued_ok === false && ex.enqueue_reason === "pass_exhausted" && ex.queued_row_id === null && ex.pass_apps_left === 0, JSON.stringify(ex));
  check("and nothing was written — no queue row, no increment", (await one(`SELECT count(*)::int AS n FROM public.agent_queue q WHERE q.user_id = $1`, [U1])).n === nq.n && (await used(p1.id)) === PASS.apps);
  const sub = await enqueue(U1, "job-5", false);
  check("a subscription-funded accept for the same user is queued with pass_id NULL and no increment", sub.enqueued_ok === true && sub.enqueue_reason === "queued" && (await one(`SELECT q.pass_id FROM public.agent_queue q WHERE q.id = $1`, [sub.queued_row_id])).pass_id === null && (await used(p1.id)) === PASS.apps, JSON.stringify(sub));
  const nl = await enqueue(U2, "job-1", true);
  check("a user with no live pass is refused pass_not_live with nothing written", nl.enqueued_ok === false && nl.enqueue_reason === "pass_not_live" && (await one(`SELECT count(*)::int AS n FROM public.agent_queue q WHERE q.user_id = $1`, [U2])).n === 0, JSON.stringify(nl));
  // An unactivated pass is not live either.
  const g2 = await grant(U2, "cs_u2", "pi_u2");
  const nl2 = await enqueue(U2, "job-1", true);
  check("an unactivated pass is not live for consumption", nl2.enqueued_ok === false && nl2.enqueue_reason === "pass_not_live");
  await db.exec(`DELETE FROM public.agent_passes WHERE id = '${g2.granted_pass_id}'`);
  const br = await enqueue(U1, "  ", true);
  check("a blank posting id is bad_request", br.enqueued_ok === false && br.enqueue_reason === "bad_request");
  const ins = await fails(`INSERT INTO public.agent_queue (user_id, posting_id, pass_id) VALUES ($1, 'x', $2)`, [U1, p1.id]);
  check("the CHECK still bounds applications_used at applications_total on a direct write", (await fails(`UPDATE public.agent_passes SET applications_used = applications_used + 1 WHERE id = $1`, [p1.id]))?.code === "23514", String(ins?.message ?? "ok"));
}

// ---- 6. the refund trigger --------------------------------------------------------------
const submit = (user, posting, patch = {}) => one(
  `INSERT INTO public.agent_submissions (user_id, posting_id, status, attempts, error, pass_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, pass_refunded_at`,
  [user, posting, patch.status ?? "preparing", patch.attempts ?? 0, patch.error ?? "", patch.pass_id === undefined ? p1.id : patch.pass_id]);
const refundedAt = async (id) => (await one(`SELECT s.pass_refunded_at FROM public.agent_submissions s WHERE s.id = $1`, [id])).pass_refunded_at;
{
  const start = await used(p1.id); // = PASS.apps
  const st = await submit(U1, "job-1", { status: "stale" });
  check("stale at insert refunds one application and stamps pass_refunded_at", (await used(p1.id)) === start - 1 && (await refundedAt(st.id)) !== null);
  const bl0 = await submit(U1, "job-2", { status: "blocked", attempts: 0, error: "" });
  check("a preparation-time blocked (no attempts, no error) does NOT refund", (await used(p1.id)) === start - 1 && (await refundedAt(bl0.id)) === null);
  await db.query(`UPDATE public.agent_submissions SET status = 'blocked', attempts = 99 WHERE id = $1`, [bl0.id]);
  check("TEETH: blocked with the never-retry attempts refunds once", (await used(p1.id)) === start - 2 && (await refundedAt(bl0.id)) !== null);
  const stamp = await refundedAt(bl0.id);
  await db.query(`UPDATE public.agent_submissions SET status = 'blocked', attempts = 99, error = 'again' WHERE id = $1`, [bl0.id]);
  await db.query(`UPDATE public.agent_submissions SET status = 'stale' WHERE id = $1`, [bl0.id]);
  check("a second status write on the same row does not refund again and keeps the first stamp", (await used(p1.id)) === start - 2 && (await refundedAt(bl0.id)).getTime() === stamp.getTime());
  const er = await submit(U1, "job-3", { status: "ready" });
  await db.query(`UPDATE public.agent_submissions SET status = 'blocked', error = 'employer refused the fill' WHERE id = $1`, [er.id]);
  check("blocked with a non-empty error refunds", (await used(p1.id)) === start - 3 && (await refundedAt(er.id)) !== null);
  const fl = await submit(U1, "job-6", { status: "ready" });
  await db.query(`UPDATE public.agent_submissions SET status = 'failed', error = 'x', attempts = 99 WHERE id = $1`, [fl.id]);
  check("failed does NOT refund (no code path writes it)", (await used(p1.id)) === start - 3 && (await refundedAt(fl.id)) === null);
  const sm = await submit(U1, "job-7", { status: "ready" });
  await db.query(`UPDATE public.agent_submissions SET status = 'submitted', submitted_at = now(), submitted_via = 'worker' WHERE id = $1`, [sm.id]);
  check("submitted does NOT refund", (await used(p1.id)) === start - 3 && (await refundedAt(sm.id)) === null);
  const np = await submit(U1, "job-8", { status: "stale", pass_id: null });
  check("a row no pass paid for is out of scope", (await used(p1.id)) === start - 3 && (await refundedAt(np.id)) === null);
  const floor = await one(`UPDATE public.agent_passes SET applications_used = 0 WHERE id = $1 RETURNING applications_used`, [p1.id]);
  await submit(U1, "job-9", { status: "stale" });
  check("the refund never takes applications_used below zero", floor.applications_used === 0 && (await used(p1.id)) === 0);
  await db.query(`UPDATE public.agent_passes SET applications_used = $2 WHERE id = $1`, [p1.id, PASS.apps]);

  // Who wrote the row decides whether anything comes back. The owner's own
  // session (JWT role authenticated) may move status through RLS, but the
  // trigger gives nothing back for it; the pipeline's service_role does; a
  // session with no claims at all (pg_cron, psql) does. The claims are set
  // the way the API gateway sets them, whole-claims first, per-claim second.
  const asRole = async (role, sub, fn) => {
    const claims = JSON.stringify({ role, sub: sub ?? "" });
    await db.exec(`SELECT set_config('request.jwt.claims', '${claims}', false); SELECT set_config('request.jwt.claim.role', '${role}', false); SELECT set_config('request.jwt.claim.sub', '${sub ?? ""}', false);`);
    if (role === "authenticated" || role === "anon") await db.exec(`SET ROLE ${role}`);
    try { return await fn(); } finally {
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false); SELECT set_config('request.jwt.claim.role', '', false); SELECT set_config('request.jwt.claim.sub', '', false);`);
    }
  };
  const own = await submit(U1, "job-10", { status: "ready" });
  const before = await used(p1.id);
  const ownErr = await asRole("authenticated", U1, () => fails(`UPDATE public.agent_submissions SET status = 'blocked' WHERE id = $1`, [own.id]));
  const ownRow = await one(`SELECT s.status FROM public.agent_submissions s WHERE s.id = $1`, [own.id]);
  check("an owner's RLS-scoped status write lands but refunds NOTHING (the role gate)", ownErr === null && ownRow.status === "blocked" && (await used(p1.id)) === before && (await refundedAt(own.id)) === null, String(ownErr?.message ?? ""));
  // The refund shape the owner cannot write directly any more (error is not
  // theirs to set), driven from a claimless session as a would-be attacker
  // with the owner's JWT role: still nothing.
  await db.query(`UPDATE public.agent_submissions SET error = 'cancelled' WHERE id = $1`, [own.id]);
  await asRole("authenticated", U1, () => db.query(`UPDATE public.agent_submissions SET status = 'ready' WHERE id = $1`, [own.id]));
  await asRole("authenticated", U1, () => db.query(`UPDATE public.agent_submissions SET status = 'blocked' WHERE id = $1`, [own.id]));
  check("TEETH: the owner cycling ready -> blocked on a row carrying an error refunds nothing", (await used(p1.id)) === before && (await refundedAt(own.id)) === null);
  await asRole("anon", null, async () => { await fails(`UPDATE public.agent_submissions SET status = 'stale' WHERE id = $1`, [own.id]); });
  check("anon refunds nothing either", (await used(p1.id)) === before && (await refundedAt(own.id)) === null);
  // The same shape from the pipeline's role: the refund the trigger exists for.
  await asRole("service_role", null, () => db.query(`UPDATE public.agent_submissions SET status = 'ready' WHERE id = $1`, [own.id]));
  await asRole("service_role", null, () => db.query(`UPDATE public.agent_submissions SET status = 'blocked', error = 'employer refused the fill' WHERE id = $1`, [own.id]));
  check("the same write under service_role refunds once", (await used(p1.id)) === before - 1 && (await refundedAt(own.id)) !== null);
  const claimless = await submit(U1, "job-10b", { status: "stale" });
  check("a claimless session (cron, psql) still refunds", (await used(p1.id)) === before - 2 && (await refundedAt(claimless.id)) !== null);
  await db.query(`UPDATE public.agent_passes SET applications_used = $2 WHERE id = $1`, [p1.id, PASS.apps]);

  // The owner's UPDATE is narrowed to the decision columns (20260917180000).
  const colPriv = async (table, col) => (await one(`SELECT has_column_privilege('authenticated', $1, $2, 'UPDATE') AS ok`, [`public.${table}`, col])).ok;
  check("authenticated may update the panels' columns and nothing that says who paid",
    (await colPriv("agent_submissions", "status")) === true && (await colPriv("agent_submissions", "attempts")) === true && (await colPriv("agent_submissions", "submitted_at")) === true
    && (await colPriv("agent_submissions", "pass_id")) === false && (await colPriv("agent_submissions", "pass_refunded_at")) === false && (await colPriv("agent_submissions", "error")) === false
    && (await colPriv("agent_queue", "status")) === true && (await colPriv("agent_queue", "decided_at")) === true && (await colPriv("agent_queue", "pass_id")) === false
    && (await one(`SELECT has_table_privilege('authenticated', 'public.agent_submissions', 'UPDATE') AS ok`)).ok === false);
  const clearReceipt = await asRole("authenticated", U1, () => fails(`UPDATE public.agent_submissions SET pass_refunded_at = NULL WHERE id = $1`, [own.id]));
  check("an owner clearing the refund receipt is refused on permission (42501)", clearReceipt?.code === "42501", String(clearReceipt?.message));
  const q = await one(`INSERT INTO public.agent_queue (user_id, posting_id, status) VALUES ($1, 'job-q-owner', 'dismissed') RETURNING id`, [U1]);
  const stampPass = await asRole("authenticated", U1, () => fails(`UPDATE public.agent_queue SET status = 'approved', pass_id = $2 WHERE id = $1`, [q.id, p1.id]));
  check("an owner stamping their pass onto a dismissed queue row is refused on permission (42501)", stampPass?.code === "42501", String(stampPass?.message));
  const decide = await asRole("authenticated", U1, () => fails(`UPDATE public.agent_queue SET status = 'approved', decided_at = now() WHERE id = $1`, [q.id]));
  const retry = await asRole("authenticated", U1, () => fails(`UPDATE public.agent_submissions SET attempts = 0, claimed_at = NULL, claimed_by = '' WHERE id = $1 AND submitted_at IS NULL`, [own.id]));
  const sent = await asRole("authenticated", U1, () => fails(`UPDATE public.agent_submissions SET status = 'submitted', submitted_at = now(), submitted_via = 'manual' WHERE id = $1`, [own.id]));
  check("control: the panels' own writes (decide, try again, recorded as sent) still land for the owner", decide === null && retry === null && sent === null, [decide, retry, sent].map((e) => e?.message ?? "ok").join(" | "));
  const other = await submit(U2, "job-11", { status: "ready", pass_id: null });
  const cross = await asRole("authenticated", U1, () => one(`WITH u AS (UPDATE public.agent_submissions SET status = 'blocked' WHERE id = $1 RETURNING id) SELECT count(*)::int AS n FROM u`, [other.id]));
  check("RLS still stops an owner touching another user's row", cross.n === 0);
}

// ---- 7. expiry, shelf close, and the grant after -----------------------------------------
{
  await db.query(`UPDATE public.agent_passes SET activated_at = now() - interval '3 hours', expires_at = now() - interval '1 hour' WHERE id = $1`, [p1.id]);
  const r = await checkKey("h-u1", "/mcp/search_jobs");
  const closed = await passRow(p1.id);
  check("after expiry the overlay is gone: the key's own tier and limits, pass columns NULL", r.is_allowed === true && r.key_tier === "free" && r.rate_limit === KEY_RATE && r.quota_limit === KEY_QUOTA && r.pass_ends_at === null && r.pass_apps_left === null, JSON.stringify(r));
  check("and the pass was closed session_ended by the read", closed.closed_at !== null && closed.close_reason === "session_ended");
  const late = await submit(U1, "job-12", { status: "stale" });
  check("a refund still lands on a closed pass (a recorded fact, not a credit)", (await refundedAt(late.id)) !== null && (await used(p1.id)) === PASS.apps - 1);
  const nl = await enqueue(U1, "job-13", true);
  check("a closed pass is not live for consumption", nl.enqueued_ok === false && nl.enqueue_reason === "pass_not_live");

  const g = await grant(U1, "cs_three", "pi_three");
  check("a new grant after the clock ended succeeds — the lazy close ran first", g.granted_ok === true && g.grant_reason === "granted" && g.granted_pass_id !== p1.id, JSON.stringify(g));
  await db.query(`UPDATE public.agent_passes SET shelf_expires_at = now() - interval '1 minute' WHERE id = $1`, [g.granted_pass_id]);
  const s = await checkKey("h-u1", "/mcp/search_jobs");
  const shelf = await passRow(g.granted_pass_id);
  check("a never-activated pass past its shelf is closed shelf_expired by the read and serves no overlay", s.key_tier === "free" && shelf.closed_at !== null && shelf.close_reason === "shelf_expired" && shelf.activated_at === null, JSON.stringify(shelf));
  const g4 = await grant(U1, "cs_four", "pi_four");
  check("and a grant after the shelf closed succeeds too", g4.granted_ok === true && g4.grant_reason === "granted");
  await db.query(`UPDATE public.agent_passes SET shelf_expires_at = now() - interval '1 minute' WHERE id = $1`, [g4.granted_pass_id]);
  const g5 = await grant(U1, "cs_five", "pi_five");
  check("the grant's own lazy close: a shelf-expired pass never activated is closed by the grant itself", g5.granted_ok === true && (await passRow(g4.granted_pass_id)).close_reason === "shelf_expired");
  await db.query(`UPDATE public.agent_passes SET activated_at = now(), expires_at = now() + interval '1 hour' WHERE id = $1`, [g5.granted_pass_id]);
}

// ---- 8. the metrics reader ---------------------------------------------------------------
{
  await db.exec(`INSERT INTO public.used_stripe_sessions (session_id, product_type) VALUES ('cs_one', 'agent_pass'), ('cs_other', 'freelance_boost');
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, status) VALUES ('cs_two', 'agent_pass', 'generation_failed'), ('cs_zzz', 'scan_pack', 'generation_failed');`);
  const m = await one(`SELECT * FROM public.agent_pass_metrics($1)`, [7]);
  const sold = await one(`SELECT count(*)::int AS n FROM public.agent_passes`);
  const refunded = await one(`SELECT count(*)::int AS n FROM public.agent_submissions s WHERE s.pass_refunded_at IS NOT NULL`);
  const queued = await one(`SELECT count(*)::int AS n FROM public.agent_queue q WHERE q.pass_id IS NOT NULL`);
  const submitted = await one(`SELECT count(*)::int AS n FROM public.agent_submissions s WHERE s.pass_id IS NOT NULL AND s.status = 'submitted'`);
  check("the reader answers the counts this run produced", Number(m.window_days) === 7 && Number(m.passes_sold) === sold.n && Number(m.sessions_claimed) === 1 && Number(m.applications_refunded) === refunded.n && Number(m.applications_queued) === queued.n && Number(m.applications_submitted) === submitted.n && submitted.n > 1 && Number(m.paid_undelivered) === 1, JSON.stringify(m));
  check("it counts activations, the lag percentiles, the shelf closes and the unactivated backlog", Number(m.passes_activated) >= 2 && m.activation_lag_p50_minutes !== null && Number(m.shelf_expired_unused) === 2 && Number(m.unactivated_backlog) === 0 && Number(m.passes_closed_unused) >= 2, JSON.stringify(m));
  check("calls per pass follow api_usage through the key's user_id inside the activation window", Number(m.calls_total) >= 1 && Number(m.moat_calls_total) >= 1, JSON.stringify(m));
  const m0 = await one(`SELECT * FROM public.agent_pass_metrics($1)`, [null]);
  check("a null window is read as one day, never an error", Number(m0.window_days) === 1);
  const cols = Object.keys(m);
  check("the reader returns every column section 8 asks for", cols.length === 20 && cols.includes("second_day_returns") && cols.includes("activation_lag_p95_minutes"));
}

// ---- 9. privileges --------------------------------------------------------------------------
const SIGS = {
  agent_pass_grant: "public.agent_pass_grant(uuid, text, text, integer, integer, integer, integer, integer, integer)",
  api_key_check: "public.api_key_check(text, text)",
  agent_queue_enqueue: "public.agent_queue_enqueue(uuid, text, jsonb, boolean)",
  agent_pass_refund_on_failure: "public.agent_pass_refund_on_failure()",
  agent_pass_metrics: "public.agent_pass_metrics(integer)",
};
{
  for (const [fn, sig] of Object.entries(SIGS)) {
    const priv = async (role) => (await one(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig])).ok;
    check(`${fn}: anon, authenticated and a PUBLIC-only role cannot execute; service_role can`, (await priv("anon")) === false && (await priv("authenticated")) === false && (await priv("nobody_probe")) === false && (await priv("service_role")) === true);
    const n = await one(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`, [fn]);
    check(`${fn}: exactly one signature in the catalog`, n.n === 1, String(n.n));
    const def = await one(`SELECT p.prosecdef AS definer, p.proconfig AS cfg FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1`, [fn]);
    check(`${fn}: SECURITY DEFINER with search_path pinned`, def.definer === true && (def.cfg ?? []).some((c) => /^search_path=/.test(c)), JSON.stringify(def));
  }
  const ctl = await one(`SELECT has_function_privilege('anon', 'auth.uid()', 'EXECUTE') AS ok`);
  check("control: the privilege probe can see a grant that exists", ctl.ok === true);
  const tbl = async (role, p) => (await one(`SELECT has_table_privilege($1, 'public.agent_passes', $2) AS ok`, [role, p])).ok;
  check("anon has no privilege on agent_passes at all; authenticated may SELECT (RLS decides which rows); nobody may write through RLS",
    (await tbl("anon", "SELECT")) === false && (await tbl("authenticated", "SELECT")) === true && (await tbl("authenticated", "INSERT")) === false && (await tbl("authenticated", "UPDATE")) === false && (await tbl("nobody_probe", "SELECT")) === false);
  await db.exec(`SET ROLE anon`);
  const anonErr = await fails(`SELECT ap.id FROM public.agent_passes ap`);
  await db.exec(`RESET ROLE`);
  check("an anonymous SELECT of a real column is a permission error (42501), not an empty page", anonErr?.code === "42501", String(anonErr?.message));
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${U1}', false);`);
  const mine = await rows(`SELECT ap.user_id FROM public.agent_passes ap`);
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
  check("an owner reads only their own passes", mine.length > 0 && mine.every((r) => r.user_id === U1), JSON.stringify(mine.length));
  const rls = await one(`SELECT c.relrowsecurity AS rls FROM pg_class c WHERE c.relname = 'agent_passes'`);
  check("RLS is enabled on agent_passes", rls.rls === true);
}

// ---- 10. idempotent ------------------------------------------------------------------------
{
  const snap = async () => JSON.stringify({
    passes: await rows(`SELECT ap.id, ap.applications_used, ap.closed_at FROM public.agent_passes ap ORDER BY ap.id`),
    fns: await rows(`SELECT p.proname, count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' GROUP BY 1 ORDER BY 1`),
    trg: await rows(`SELECT t.tgname FROM pg_trigger t WHERE NOT t.tgisinternal ORDER BY 1`),
    cols: await rows(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('pass_id', 'pass_refunded_at') ORDER BY 1, 2`),
  });
  const a = await snap();
  await applyAll();
  check("a second run of all eight changes nothing (idempotent)", (await snap()) === a);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
