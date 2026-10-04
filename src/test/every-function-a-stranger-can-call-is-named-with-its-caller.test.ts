// @vitest-environment node
/**
 * EVERY FUNCTION A STRANGER CAN CALL IS NAMED, WITH THE CALLER THAT NEEDS IT.
 *
 * WHAT WAS WRONG. Supabase grants EXECUTE on every new public function to
 * anon and authenticated directly, so a SECURITY DEFINER function was open to
 * the publishable key -- which ships in the frontend bundle -- unless somebody
 * remembered to close it by name. Replaying the migration lane found 121 such
 * functions on main. They included get_delivery_health (buyers' emails and the
 * Stripe checkout session id that unlocks their purchased content, for any
 * window), log_alert_sent (anyone could keep the owner's critical alerts in
 * cooldown), get_payment_health / get_rate_limit_stats /
 * detect_user_error_spikes (payment_intent ids, visitor ids), the AI response
 * cache's writer, the lead list's writer, and index builders. Every guard
 * before this one asked a narrower question with a regex ("was this name ever
 * revoked from PUBLIC?") and each was right about its slice.
 *
 * WHAT THIS HOLDS, against a REPLAY of every create, drop, grant and revoke in
 * file order (helpers/function-acl.ts), not against spellings:
 *   1. The set of client-callable definer functions is EXACTLY the allowlist
 *      (helpers/client-callable-allowlist.ts) plus the two another lane owns.
 *      A new function that reaches the publishable key fails here by name.
 *   2. Each allowlisted function names a file that calls it in CODE, says what
 *      it returns, and says why it may write when its body writes.
 *   3. No hand-written browser file, publishable-key script or worker file
 *      calls a function the census closed; an edge function that calls one
 *      builds no client from the anon key.
 *   4. The dashboards reach the closed readers only through admin-ops, whose
 *      list is exactly the closed readers they ask for.
 *   5. The migration's own arrays are these lists, its self-check checks every
 *      revoke and every allowlisted function, and it sorts after every file
 *      that created a function it closes.
 *   6. No table a client role can read or write every row of exists outside
 *      the table allowlist, and the four the census closed stay closed.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { anonCan, authenticatedCan, migrationReplay, arrayLiteralAt, replayMigrations, type FnState } from "./helpers/function-acl";
import { access, tableReplay } from "./helpers/table-acl";
import {
  CLIENT_CALLABLE, CLOSED_BY_CENSUS, CLOSED_TABLES, OPEN_TABLES, OWNED_ELSEWHERE,
} from "./helpers/client-callable-allowlist";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const CENSUS_FILE = readdirSync(MIG_DIR).find((f) => f.startsWith("20261004110000_"))!;
const CENSUS_SQL = CENSUS_FILE ? read(`supabase/migrations/${CENSUS_FILE}`) : "";

const nameOf = (sig: string) => sig.slice("public.".length, sig.indexOf("("));
const isTrigger = (f: FnState) => f.returns.trim().toLowerCase() === "trigger";

const { fns, history } = migrationReplay();
const clientCallable = [...fns.values()].filter((f) => f.definer && !isTrigger(f) && (anonCan(f) || authenticatedCan(f)));

const ALLOW = new Map(CLIENT_CALLABLE.map((a) => [a.sig, a]));
const ELSEWHERE = new Set(OWNED_ELSEWHERE.map((e) => e.sig));
const CLOSED = new Set(CLOSED_BY_CENSUS.map((c) => c.sig));

// ── the replay itself ────────────────────────────────────────────────────────

describe("the replay sees the schema it judges", () => {
  it("finds the functions, and replays a known history correctly", () => {
    // A replay that sees nothing passes every assertion below vacuously.
    expect(fns.size, "the replay found almost no functions -- the parser broke").toBeGreaterThan(200);
    expect(fns.has("public.get_stats_cache()")).toBe(true);
    // agent_reach was created, re-granted, then DROPPED: absent, not open.
    expect(fns.has("public.agent_reach(integer)"), "a dropped function must leave the replay").toBe(false);
    // The 07-30 lockdown is a catalogue loop; it must be read, not skipped.
    const add = fns.get("public.add_scan_credits(text,integer)");
    expect(add, "add_scan_credits(text,integer) missing from the replay").toBeTruthy();
    expect(anonCan(add!), "the definer lockdown loop was not interpreted").toBe(false);
  });

  it("a fresh function is open, OR REPLACE keeps grants, DROP then CREATE reopens", () => {
    const r = replayMigrations([
      { file: "1.sql", text: "CREATE FUNCTION public.f(p_a integer DEFAULT 1, OUT x int) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;" },
      { file: "2.sql", text: "REVOKE ALL ON FUNCTION public.f(int) FROM PUBLIC, anon, authenticated;" },
      { file: "3.sql", text: "CREATE OR REPLACE FUNCTION public.f(p_a int4) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 2 $$;" },
    ]);
    expect(anonCan(r.fns.get("public.f(integer)")!), "OR REPLACE must keep the revoke").toBe(false);
    const r2 = replayMigrations([
      { file: "1.sql", text: "CREATE FUNCTION public.f(int) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$; REVOKE ALL ON FUNCTION public.f(int) FROM PUBLIC;" },
    ]);
    expect(anonCan(r2.fns.get("public.f(integer)")!), "revoking PUBLIC alone leaves anon's direct grant").toBe(true);
    const r3 = replayMigrations([
      { file: "1.sql", text: "CREATE FUNCTION public.f(int) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$; REVOKE ALL ON FUNCTION public.f(int) FROM PUBLIC, anon, authenticated;" },
      { file: "2.sql", text: "DROP FUNCTION public.f(int); CREATE FUNCTION public.f(int) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;" },
    ]);
    expect(anonCan(r3.fns.get("public.f(integer)")!), "DROP + CREATE starts again from the default grants").toBe(true);
  });

  it("reads the signature loop the census closes with, brackets inside signatures included", () => {
    const r = replayMigrations([
      { file: "1.sql", text: "CREATE FUNCTION public.g(integer, integer, text[]) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;" },
      { file: "2.sql", text: "DO $x$ DECLARE v text[] := ARRAY['public.g(integer,integer,text[])']::text[]; s text; BEGIN FOREACH s IN ARRAY v LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', to_regprocedure(s)); END LOOP; END $x$;" },
    ]);
    expect(anonCan(r.fns.get("public.g(integer,integer,text[])")!)).toBe(false);
    expect(arrayLiteralAt("ARRAY['a(text[])', 'b''c']", 5)).toEqual(["a(text[])", "b'c"]);
  });
});

// ── 1. the set is the list ───────────────────────────────────────────────────

describe("every client-callable SECURITY DEFINER function is on the list, and nothing else is", () => {
  it("nothing reaches anon or authenticated that the allowlist does not name", () => {
    const unlisted = clientCallable.filter((f) => !ALLOW.has(f.sig) && !ELSEWHERE.has(f.sig)).map((f) =>
      `${f.sig} (anon ${anonCan(f)}, authenticated ${authenticatedCan(f)}; latest definition ${f.file})\n    ` +
      (history.get(f.sig) ?? []).slice(-3).join("\n    "));
    expect(
      unlisted,
      "These SECURITY DEFINER functions run as their owner for anyone holding the publishable key, and no " +
        "list says why. Revoke them from PUBLIC, anon and authenticated BY NAME in the migration that " +
        "creates them, or add a row to client-callable-allowlist.ts naming the client-role caller and what " +
        "it returns:\n  " + unlisted.join("\n  "),
    ).toEqual([]);
  });

  it("every allowlisted function is still client-callable, with the roles the list says", () => {
    const wrong: string[] = [];
    for (const a of CLIENT_CALLABLE) {
      const f = fns.get(a.sig);
      if (!f) { wrong.push(`${a.sig}: not in the replay (renamed or dropped?)`); continue; }
      if (!f.definer) wrong.push(`${a.sig}: not SECURITY DEFINER any more -- drop it from the list`);
      if (a.roles === "anon" && !anonCan(f)) wrong.push(`${a.sig}: listed for anon, anon cannot execute it (its page breaks)`);
      if (!authenticatedCan(f)) wrong.push(`${a.sig}: authenticated cannot execute it`);
      if (a.roles === "authenticated" && anonCan(f)) wrong.push(`${a.sig}: listed signed-in only, anon can execute it`);
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  it("the three lists do not overlap", () => {
    const both = [...CLOSED].filter((s) => ALLOW.has(s) || ELSEWHERE.has(s));
    expect(both).toEqual([]);
    expect(new Set(CLIENT_CALLABLE.map((a) => a.sig)).size, "a signature is listed twice").toBe(CLIENT_CALLABLE.length);
  });

  it("every function the census closed is closed in the replay", () => {
    const open = [...CLOSED].filter((s) => { const f = fns.get(s); return !f || anonCan(f) || authenticatedCan(f); });
    expect(open, `missing or still client-callable: ${open.join(", ")}`).toEqual([]);
    for (const s of ["public.get_delivery_health(integer)", "public.log_alert_sent(text,text,numeric,numeric,text,boolean)",
      "public.get_payment_health(integer)", "public.get_rate_limit_stats(integer)", "public.detect_user_error_spikes(integer,integer,integer)"]) {
      expect(CLOSED.has(s), `${s} is a register item and must be on the closed list`).toBe(true);
    }
  });
});

// ── 2. each row says who and what ────────────────────────────────────────────

const shCode = (s: string) => s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const codeOfFile = (p: string) => (p.endsWith(".sh") ? shCode(read(p)) : codeOf(read(p)));
const WRITES = /\b(INSERT\s+INTO|UPDATE\s+[\w.]+\s+SET|DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?[\w.]+|pgmq\.|net\.http_post|REFRESH\s+MATERIALIZED)\b/i;

describe("every allowlisted function names its caller and what a stranger receives", () => {
  it("the caller file exists and calls it in CODE, not only in a comment", () => {
    const bad: string[] = [];
    // OWNED_ELSEWHERE is not vouched for here: its lane may move or close the
    // caller (the credits lane does exactly that in parallel).
    for (const row of CLIENT_CALLABLE) {
      const name = nameOf(row.sig);
      if (!existsSync(resolve(ROOT, row.caller))) { bad.push(`${row.sig}: ${row.caller} does not exist`); continue; }
      if (/integrations\/supabase\/types\.ts$/.test(row.caller)) { bad.push(`${row.sig}: the generated types name every RPC; not a caller`); continue; }
      const re = new RegExp(`["'\`/\\s]${name}["'\`\\s]`);
      if (!re.test(codeOfFile(row.caller))) bad.push(`${row.sig}: ${row.caller} does not call it in code`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("says what it returns in one of the accepted shapes", () => {
    const bad = CLIENT_CALLABLE.filter((a) => !/^(aggregates|own rows|public record|write-only):/.test(a.returns)).map((a) => a.sig);
    expect(bad, `returns must start with aggregates: / own rows: / public record: / write-only: -- ${bad.join(", ")}`).toEqual([]);
  });

  it("a function whose body writes says why a stranger may cause that write; one that does not, does not claim to", () => {
    const bad: string[] = [];
    for (const a of CLIENT_CALLABLE) {
      const f = fns.get(a.sig);
      if (!f) continue;
      const writes = WRITES.test(f.body);
      if (writes && !a.writes) bad.push(`${a.sig} writes (${WRITES.exec(f.body)![0]}) and its row gives no reason`);
      if (!writes && a.writes) bad.push(`${a.sig} has a writes reason but its body writes nothing`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("no allowlisted function returns a Stripe identifier, an email column, raw search text or posting rows", () => {
    const bad: string[] = [];
    for (const a of CLIENT_CALLABLE) {
      const f = fns.get(a.sig);
      if (!f) continue;
      const out = f.returns.toLowerCase();
      // Whole column names: get_temp_resume's job_description_text is the
      // caller's own pasted posting, not a scraped description column.
      for (const forbidden of ["stripe_session_id", "payment_intent_id", "customer_email", "email", "query_text", "description", "apply_url", "visitor_id"]) {
        if (new RegExp(`\\b${forbidden}\\b`).test(out)) bad.push(`${a.sig} returns ${forbidden}`);
      }
      if (/\bjob_board_postings\b/i.test(out)) bad.push(`${a.sig} returns posting rows (SETOF job_board_postings)`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});

// ── 3. nobody with a client key calls a closed function ─────────────────────

const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "dist", "test", "__tests__"].includes(e)) continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|mjs|sh)$/.test(e) && !/\.test\.|_test\.ts$/.test(e)) out.push(p);
  }
  return out;
};
const rel = (p: string) => p.slice(ROOT.length + 1);
const CLIENT_FILES = [
  ...walk(resolve(ROOT, "src")).filter((p) => !p.includes("integrations/supabase/types.ts")),
  ...walk(resolve(ROOT, "worker/src")),
  // Scripts that read the publishable key: the owner's verifier, the smoke
  // test, the prerender. A script that brings the service key, or runs SQL in
  // pglite, is not a client-role caller.
  ...walk(resolve(ROOT, "scripts")).filter((p) => /PUBLISHABLE_KEY|apikey: \$K/.test(readFileSync(p, "utf8"))),
];
// `R name` is verify-deploy's positive read; `probe name` EXPECTS 42501 and is
// how a closed function is proved closed, so it is not a caller.
const callsByRpc = (code: string, name: string) =>
  new RegExp(`\\.rpc\\(\\s*["'\`]${name}["'\`]|\\brpc\\(\\s*["'\`]${name}["'\`]|rest/v1/rpc/${name}\\b|(?:^|\\s)R\\s+${name}\\s`, "m").test(code);

describe("no client-role caller is left pointing at a closed function", () => {
  it("finds the client files it scans", () => {
    expect(CLIENT_FILES.length, "the scan found no client files").toBeGreaterThan(200);
    expect(CLIENT_FILES.some((p) => p.endsWith("scripts/verify-deploy.sh"))).toBe(true);
  });

  it("no browser file, publishable-key script or worker file calls one with supabase.rpc or REST", () => {
    const bad: string[] = [];
    for (const p of CLIENT_FILES) {
      const code = p.endsWith(".sh") ? shCode(readFileSync(p, "utf8")) : codeOf(readFileSync(p, "utf8"));
      for (const s of CLOSED) {
        const n = nameOf(s);
        if (!code.includes(n)) continue;
        // store_temp_resume stays open in its three-argument form.
        if (n === "store_temp_resume") continue;
        if (callsByRpc(code, n)) bad.push(`${rel(p)} calls ${n}`);
      }
    }
    expect(bad, "these callers would get 42501 after the census: route them through admin-ops or the service role\n" + bad.join("\n")).toEqual([]);
  });

  it("an edge function that calls a closed function builds no client from the anon key", () => {
    const bad: string[] = [];
    const fnFiles = walk(resolve(ROOT, "supabase/functions"));
    for (const p of fnFiles) {
      const code = codeOf(readFileSync(p, "utf8"));
      const hits = [...CLOSED].map(nameOf).filter((n) => new RegExp(`\\.rpc\\(\\s*["'\`]${n}["'\`]`).test(code));
      if (!hits.length) continue;
      if (/createClient\(\s*[^,]*,\s*[^,)]*anon_?key/i.test(code) || /getAnonClient\(/.test(code)) bad.push(`${rel(p)} (${hits.join(", ")})`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("the browser circuit breaker no longer writes the alert ledger", () => {
    const code = codeOf(read("src/hooks/use-circuit-breaker.ts"));
    expect(code).not.toMatch(/log_alert_sent|should_send_alert/);
    expect(code, "it still records the circuit in error telemetry").toMatch(/log_error_telemetry/);
  });
});

// ── 4. the admin path ────────────────────────────────────────────────────────

const ADMIN_RPCS = (() => {
  const src = read("supabase/functions/admin-ops/rpcs.ts");
  const body = src.slice(src.indexOf("new Set(["), src.indexOf("]);", src.indexOf("new Set([")));
  return new Set([...body.matchAll(/"(\w+)"/g)].map((m) => m[1]));
})();

describe("the dashboards reach the closed readers only through admin-ops", () => {
  it("admin-ops serves exactly closed readers -- never an open function, never a writer", () => {
    expect(ADMIN_RPCS.size).toBeGreaterThan(10);
    const closedNames = new Set([...CLOSED].map(nameOf));
    const notClosed = [...ADMIN_RPCS].filter((n) => !closedNames.has(n));
    expect(notClosed, `admin-ops lists functions the census did not close: ${notClosed.join(", ")}`).toEqual([]);
    const writers = [...ADMIN_RPCS].filter((n) => [...fns.values()].some((f) => f.name === n && WRITES.test(f.body)));
    expect(writers, `admin-ops must only proxy readers: ${writers.join(", ")}`).toEqual([]);
  });

  it("every adminRpc(...) in the frontend names a function admin-ops serves, and each served one is used", () => {
    const used = new Set<string>();
    for (const p of walk(resolve(ROOT, "src"))) {
      for (const m of codeOf(readFileSync(p, "utf8")).matchAll(/adminRpc\(\s*["'`](\w+)["'`]/g)) used.add(m[1]);
    }
    expect([...used].filter((n) => !ADMIN_RPCS.has(n))).toEqual([]);
    expect([...ADMIN_RPCS].filter((n) => !used.has(n)), "admin-ops serves a reader no dashboard asks for").toEqual([]);
  });

  it("admin-ops checks the key before anything and calls with the service role", () => {
    const code = codeOf(read("supabase/functions/admin-ops/index.ts"));
    const gate = code.indexOf("keyMatches(req.headers.get(\"x-admin-key\")");
    expect(gate, "the x-admin-key check is missing").toBeGreaterThan(-1);
    expect(code.indexOf(".rpc(")).toBeGreaterThan(gate);
    expect(code).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(code).not.toMatch(/ANON_KEY/);
    expect(code, "a CORS preflight that does not allow x-admin-key blocks every dashboard call").toMatch(/x-admin-key/);
    expect(code).toMatch(/x-fn-build/);
  });
});

// ── 5. the migration ─────────────────────────────────────────────────────────

/** The quoted entries of the `name text[] := ARRAY[` (or `ARRAY[ ... ] AS name`) literal. */
const sqlArray = (sql: string, decl: RegExp): string[] => {
  const m = decl.exec(sql);
  if (!m) return [];
  return arrayLiteralAt(sql, m.index + m[0].length - 1);
};

describe("the migration carries exactly these lists and checks every one", () => {
  const code = CENSUS_SQL.replace(/--[^\n]*/g, "");

  it("exists, under its stamp, after every migration that created a function it closes", () => {
    expect(CENSUS_FILE, "20261004110000_*.sql is missing").toBeTruthy();
    const late = [...CLOSED].map((s) => fns.get(s)).filter((f): f is FnState => !!f && f.createdIn >= CENSUS_FILE);
    expect(late.map((f) => `${f.sig} created in ${f.createdIn}`)).toEqual([]);
  });

  it("the closed list in the DO block and in the census function is CLOSED_BY_CENSUS", () => {
    const want = [...CLOSED].sort();
    expect(sqlArray(code, /v_closed\s+text\[\]\s*:=\s*ARRAY\s*\[/).sort()).toEqual(want);
    const census = code.slice(code.indexOf("FUNCTION public.client_callable_census()"));
    expect(sqlArray(census, /WITH lists AS \(\s*SELECT\s+ARRAY\s*\[/).sort()).toEqual(want);
  });

  it("the census function's allowlists are the allowlist file", () => {
    const census = code.slice(code.indexOf("FUNCTION public.client_callable_census()"));
    const anonAt = census.indexOf("]::text[] AS closed,");
    const anon = arrayLiteralAt(census, census.indexOf("ARRAY[", anonAt));
    expect(anon.sort()).toEqual(CLIENT_CALLABLE.filter((a) => a.roles === "anon").map((a) => a.sig).sort());
    const authAt = census.indexOf("]::text[] AS allow_anon,");
    expect(arrayLiteralAt(census, census.indexOf("ARRAY[", authAt)).sort())
      .toEqual(CLIENT_CALLABLE.filter((a) => a.roles === "authenticated").map((a) => a.sig).sort());
    const elseAt = census.indexOf("]::text[] AS allow_auth,");
    expect(arrayLiteralAt(census, census.indexOf("ARRAY[", elseAt)).sort()).toEqual([...ELSEWHERE].sort());
    const tabAt = census.indexOf("]::text[] AS elsewhere,");
    expect(arrayLiteralAt(census, census.indexOf("ARRAY[", tabAt)).sort())
      .toEqual(CLOSED_TABLES.map((t) => `public.${t.table}`).sort());
  });

  it("the overload sweep names every closed function whose every overload closes, and only those", () => {
    const kept = new Set([...ALLOW.keys(), ...ELSEWHERE].map(nameOf));
    const want = [...new Set([...CLOSED].map(nameOf))].filter((n) => !kept.has(n)).sort();
    expect(sqlArray(code, /v_names\s+text\[\]\s*:=\s*ARRAY\s*\[/).sort()).toEqual(want);
  });

  it("refuses to revoke anything while a named signature is missing", () => {
    const close = code.slice(code.indexOf("DO $close$"), code.indexOf("$close$;"));
    const check = close.indexOf("RAISE EXCEPTION");
    const firstRevoke = close.indexOf("EXECUTE format('REVOKE");
    expect(check).toBeGreaterThan(-1);
    expect(firstRevoke).toBeGreaterThan(check);
    expect(close).toMatch(/to_regprocedure\(s\) IS NULL/);
  });

  it("the self-check fails on a closed function a client can call, an allowlisted one it cannot, the redactions and the tables", () => {
    const check = code.slice(code.indexOf("DO $check$"));
    expect(check).toMatch(/closed_still_callable/);
    expect(check).toMatch(/allowlisted_not_callable/);
    expect(check).toMatch(/closed_tables_still_open/);
    expect(check).toMatch(/has_function_privilege\('anon'/);
    expect(check).toMatch(/has_function_privilege\('authenticated'/);
    expect(check).toMatch(/has_function_privilege\('service_role'/);
    expect(check).toMatch(/session_ref/);
    expect(check).toMatch(/22023/);
    expect(check).toMatch(/RAISE EXCEPTION 'client-callable census self-check failed/);
    // Drift is reported, never failed: a function made outside this folder may be live.
    expect(check).toMatch(/RAISE NOTICE 'client-callable census: % client-callable definer function\(s\) appear in no list/);
    const census = code.slice(code.indexOf("FUNCTION public.client_callable_census()"));
    expect(census).toMatch(/has_function_privilege\('anon', f, 'EXECUTE'\)/);
    expect(census).toMatch(/has_function_privilege\('authenticated', f, 'EXECUTE'\)/);
  });

  it("names no existing function as `FUNCTION public.<name>` except the two it redefines", () => {
    // Dozens of guards select "the newest migration that mentions FUNCTION
    // public.<name>" as that function's live definition. A static REVOKE
    // here would make this file the "definition" of 56 functions and blind
    // every one of those guards, so the revokes are a signature loop.
    const named = [...code.matchAll(/FUNCTION public\.(\w+)\s*\(/g)].map((m) => m[1]);
    expect([...new Set(named)].sort()).toEqual(["client_callable_census", "get_delivery_health", "get_funnel_cohort_stats"]);
  });

  it("the delivery reader returns no session id or address, and limits before aggregating", () => {
    const f = fns.get("public.get_delivery_health(integer)")!;
    expect(f.file).toBe(CENSUS_FILE);
    expect(f.body).not.toMatch(/'session_id'/);
    expect(f.body).not.toMatch(/'email',\s*\w*\.?customer_email/);
    expect(f.body).toMatch(/'session_ref', left\(md5\(/);
    expect(f.body).toMatch(/scrub_emails\(/);
    expect(f.body).toMatch(/LEAST\(GREATEST\(COALESCE\(p_hours_back, 24\), 1\), 168\)/);
    expect(f.body).toMatch(/ORDER BY d\.created_at DESC\s+LIMIT 10\s*\)/);
  });

  it("the cohort reader groups only by the dimensions its callers use", () => {
    const f = fns.get("public.get_funnel_cohort_stats(text,integer)")!;
    expect(f.file).toBe(CENSUS_FILE);
    const allowed = [...f.body.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    for (const d of ["trafficSource", "deviceType", "browser", "os", "userType", "utmSource", "utmMedium", "utmCampaign"]) {
      expect(allowed, `${d} is used by generate-cohort-report`).toContain(d);
    }
    expect(f.body).toMatch(/RAISE EXCEPTION[\s\S]*22023/);
    // Every dimension generate-cohort-report asks for is accepted.
    const report = codeOf(read("supabase/functions/generate-cohort-report/index.ts"));
    const dims = [...(/const dimensions = \[([^\]]*)\]/.exec(report)?.[1] ?? "").matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(dims.length).toBeGreaterThan(0);
    for (const d of dims) expect(allowed, `generate-cohort-report asks for ${d}`).toContain(d);
  });

  it("the census function is INVOKER, catalogue-only and readable with the publishable key", () => {
    const f = fns.get("public.client_callable_census()")!;
    expect(f.definer).toBe(false);
    expect(anonCan(f)).toBe(true);
    expect(WRITES.test(f.body)).toBe(false);
  });
});

// ── 6. tables ────────────────────────────────────────────────────────────────

describe("no table a client role can read or write every row of exists outside the table allowlist", () => {
  const { tables } = tableReplay();
  const open = new Set(OPEN_TABLES.map((t) => t.table));

  it("the replay sees the tables", () => {
    expect(tables.size).toBeGreaterThan(80);
    expect(tables.has("job_board_postings")).toBe(true);
  });

  it("every all-rows grant to anon or authenticated is on OPEN_TABLES, and every OPEN_TABLES entry still is one", () => {
    const found = new Map<string, string[]>();
    for (const t of tables.values()) {
      for (const role of ["anon", "authenticated"] as const) {
        for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
          const a = access(t, role, cmd);
          if (a.level === "all-rows") found.set(t.name, [...(found.get(t.name) ?? []), `${role} ${cmd} via ${a.via.join(",")}`]);
        }
      }
    }
    const unlisted = [...found.entries()].filter(([n]) => !open.has(n)).map(([n, v]) => `${n}: ${v.join("; ")}`);
    expect(unlisted, "a client role can read or write every row of these, and no list says why:\n" + unlisted.join("\n")).toEqual([]);
    const stale = [...open].filter((n) => !found.has(n));
    expect(stale, "OPEN_TABLES lists tables nobody can read any more").toEqual([]);
    for (const [n, v] of found) {
      if (open.has(n)) expect(v.every((x) => /SELECT/.test(x)), `${n} is listed for reading, not writing: ${v.join("; ")}`).toBe(true);
    }
  });

  it("the four tables the census closed give a client role nothing", () => {
    for (const { table } of CLOSED_TABLES) {
      const t = tables.get(table);
      expect(t, `${table} missing from the replay`).toBeTruthy();
      for (const role of ["anon", "authenticated"] as const) {
        for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
          expect(access(t!, role, cmd).level, `${role} ${cmd} on ${table}`).toBe("none");
        }
      }
    }
  });

  it("the two INVOKER readers of job_board_stats_rollup keep the read they need", () => {
    for (const s of ["public.get_freshness_stats()", "public.get_date_coverage()"]) {
      const f = fns.get(s)!;
      expect(f.definer).toBe(false);
      expect(f.body).toMatch(/job_board_stats_rollup/);
      expect(anonCan(f)).toBe(true);
    }
    expect(access(tables.get("job_board_stats_rollup")!, "anon", "SELECT").level).toBe("all-rows");
  });
});
