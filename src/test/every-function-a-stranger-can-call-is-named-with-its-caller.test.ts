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
 *      the table allowlist, and the ones the census closed stay closed.
 *   7. Every anonymous writer on the list spends the write budget, keyed on
 *      the platform's address; the signed-in lifecycle reads only the
 *      caller's own tracker; a json reader returns no forbidden key.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { anonCan, authenticatedCan, migrationReplay, arrayLiteralAt, replayMigrations, type FnState } from "./helpers/function-acl";
import { access, tableReplay } from "./helpers/table-acl";
import {
  ADMIN_READERS_CREATED_CLOSED, CLIENT_CALLABLE, CLOSED_BY_CENSUS, CLOSED_TABLES, CREATED_CLOSED, OPEN_TABLES, OWNED_ELSEWHERE, UNCAPPED_TOKEN_ARRAYS,
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

/** Functions 20261004110000 re-issues whole: the two redactions, the bounded writers, the owner-only lifecycle. */
const REISSUED_NAMES = [
  "get_delivery_health", "get_funnel_cohort_stats",
  "log_error_telemetry", "record_scan_outcome", "record_scan_feedback", "log_industry_correction",
  "track_affiliate_click", "register_affiliate", "login_affiliate",
  "get_application_lifecycle",
];
/** Functions it creates: the census, the address and write budget, the alert cron's key check. */
const CREATED_NAMES = ["client_callable_census", "request_client_address", "client_write_allowed", "alerts_cron_key_matches"];

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

  // A RETURNS clause of `jsonb` says nothing about what is inside it, so the
  // check above passed every json reader vacuously. For those, the keys a
  // body BUILDS are what it returns: every quoted literal in the body (the
  // keys of jsonb_build_object, the paths of ->>) is read against the same
  // forbidden names. A cache reader (`SELECT v FROM job_board_meta WHERE
  // k = '<key>'`) returns whatever its writer stored, so the writer is read
  // too: the SQL function with a statement that writes job_board_meta under
  // that key, or, for a key an edge function writes, the object it upserts.
  const FORBIDDEN_KEYS = ["stripe_session_id", "session_id", "payment_intent", "payment_intent_id", "customer_email", "email",
    "query_text", "visitor_id", "apply_url", "description", "session_token", "password", "password_hash", "ip_address", "ip_hash"];
  /** Own rows, named: the affiliate sign-in pair returns the affiliate's own token and email to the affiliate who proved the password or holds the session. */
  const OWN_ROW_KEYS: Record<string, string[]> = {
    "public.login_affiliate(text,text)": ["email", "session_token", "password", "password_hash"],
    "public.register_affiliate(text,text)": ["email", "session_token", "password", "password_hash"],
    "public.get_affiliate_dashboard(text)": ["email", "session_token"],
  };
  /** Cache keys an edge function writes, and the file whose upsert of `k: "<key>"` is scanned. */
  const EDGE_WRITTEN: Record<string, { file: string; what: string }> = {
    audit: { file: "supabase/functions/job-board/index.ts", what: "the board audit's aggregate result: sample counts, per-vendor posting counts and shares, coverage" },
  };
  const quotedLiterals = (body: string) => new Set([...body.matchAll(/'([A-Za-z_][\w]*)'/g)].map((m) => m[1].toLowerCase()));
  const metaKeyOf = (body: string) => /\bjob_board_meta\b[\s\S]{0,80}?\bk\s*=\s*'(\w+)'/.exec(body)?.[1] ?? null;
  const metaWriters = (key: string) => [...fns.values()].filter((g) => g.body.split(/;\n/).some((st) =>
    /\b(INSERT\s+INTO|UPDATE)\s+(public\.)?job_board_meta\b/i.test(st) && new RegExp(`'${key}'`).test(st)));
  /** The object keys in the ~1500 characters before an edge function's `k: "<key>"` upsert. */
  const edgeUpsertKeys = (file: string, key: string): Set<string> | null => {
    const code = codeOf(read(file));
    const at = code.search(new RegExp(`\\bk:\\s*["']${key}["']`));
    if (at < 0) return null;
    const win = code.slice(Math.max(0, at - 1500), at + 200);
    // `key: value` and the shorthand `{ key, ... }` alike.
    return new Set([
      ...[...win.matchAll(/["']?([A-Za-z_]\w*)["']?\s*:/g)].map((m) => m[1].toLowerCase()),
      ...[...win.matchAll(/[{,]\s*([A-Za-z_]\w*)\s*(?=[,}])/g)].map((m) => m[1].toLowerCase()),
    ]);
  };

  it("a json reader builds no forbidden key, and neither does the writer of the cache it hands back", () => {
    const bad: string[] = [];
    let jsonReaders = 0;
    let cacheReaders = 0;
    for (const a of CLIENT_CALLABLE) {
      const f = fns.get(a.sig);
      if (!f || !/\bjsonb?\b/i.test(f.returns)) continue;
      jsonReaders++;
      const allowed = new Set(OWN_ROW_KEYS[a.sig] ?? []);
      const sources: Array<{ where: string; keys: Set<string> }> = [{ where: "its body", keys: quotedLiterals(f.body) }];
      const key = metaKeyOf(f.body);
      if (key) {
        cacheReaders++;
        const writers = metaWriters(key);
        for (const w of writers) sources.push({ where: `${w.sig}, which writes job_board_meta '${key}'`, keys: quotedLiterals(w.body) });
        const edge = EDGE_WRITTEN[key];
        if (edge) {
          const ks = edgeUpsertKeys(edge.file, key);
          if (!ks) bad.push(`${a.sig}: ${edge.file} no longer upserts k: "${key}" -- find the writer again`);
          else sources.push({ where: `${edge.file}'s upsert of '${key}'`, keys: ks });
        }
        if (!writers.length && !edge) bad.push(`${a.sig} returns job_board_meta '${key}' and no SQL writer or listed edge writer was found`);
      }
      for (const { where, keys } of sources) {
        for (const k of FORBIDDEN_KEYS) if (keys.has(k) && !allowed.has(k)) bad.push(`${a.sig}: '${k}' in ${where}`);
      }
    }
    expect(jsonReaders, "the scan found no json readers -- the RETURNS parse broke").toBeGreaterThan(8);
    expect(cacheReaders, "the scan found no cache readers -- the job_board_meta parse broke").toBeGreaterThanOrEqual(5);
    expect(bad, "a json reader on the client-callable list hands back a forbidden key:\n" + bad.join("\n")).toEqual([]);
  });

  it("the json scan has teeth: an email key added to a cache writer is caught", () => {
    expect(metaWriters("stats_cache").map((w) => w.sig)).toEqual(["public.refresh_stats_cache()"]);
    expect(metaWriters("explore_cache").map((w) => w.sig)).toEqual(["public.refresh_explore_cache()"]);
    expect(metaWriters("audit"), "a function that only READS the audit key is not its writer").toEqual([]);
    expect(edgeUpsertKeys(EDGE_WRITTEN.audit.file, "audit")?.has("byvendor")).toBe(true);
    const writer = metaWriters("stats_cache")[0];
    expect(quotedLiterals(writer.body + " jsonb_build_object('email', x)").has("email")).toBe(true);
    expect(quotedLiterals("SELECT v FROM public.job_board_meta WHERE k = 'stats_cache'").has("stats_cache")).toBe(true);
    expect(metaKeyOf("SELECT v FROM public.job_board_meta WHERE k = 'explore_cache'")).toBe("explore_cache");
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
    const closedNames = new Set([...CLOSED, ...ADMIN_READERS_CREATED_CLOSED.map((r) => r.sig)].map(nameOf));
    const notClosed = [...ADMIN_RPCS].filter((n) => !closedNames.has(n));
    expect(notClosed, `admin-ops lists functions the census did not close: ${notClosed.join(", ")}`).toEqual([]);
    const writers = [...ADMIN_RPCS].filter((n) => [...fns.values()].some((f) => f.name === n && WRITES.test(f.body)));
    expect(writers, `admin-ops must only proxy readers: ${writers.join(", ")}`).toEqual([]);
  });

  it("a reader created closed after the census is closed to both client roles in the replay", () => {
    for (const { sig } of ADMIN_READERS_CREATED_CLOSED) {
      const f = fns.get(sig);
      expect(f, `${sig} missing from the replay`).toBeTruthy();
      expect(anonCan(f!), `anon can execute ${sig}`).toBe(false);
      expect(authenticatedCan(f!), `authenticated can execute ${sig}`).toBe(false);
      expect(f!.acl.service_role, `service_role lost ${sig}`).toBe(true);
    }
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

  it("names no existing function as `FUNCTION public.<name>` except the ones it redefines or creates", () => {
    // Dozens of guards select "the newest migration that mentions FUNCTION
    // public.<name>" as that function's live definition. A static REVOKE
    // here would make this file the "definition" of 56 functions and blind
    // every one of those guards, so the revokes are a signature loop. The
    // names below are exactly the functions this file DEFINES: each one is
    // re-issued whole (its live definition really is this file) or new.
    const named = [...code.matchAll(/FUNCTION public\.(\w+)\s*\(/g)].map((m) => m[1]);
    expect([...new Set(named)].sort()).toEqual([...REISSUED_NAMES, ...CREATED_NAMES].sort());
    const defined = [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\s*\(/g)].map((m) => m[1]);
    expect([...new Set(defined)].sort(), "a name above that this file only GRANTs on would blind that function's guards")
      .toEqual([...new Set(named)].sort());
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

// ── 7. bounded writers, the owner-only lifecycle, the helpers ───────────────

describe("every anonymous writer on the list is bounded, and the budget is keyed on the platform's address", () => {
  /**
   * Writers that need no budget, each with the reason. A capability writer
   * acts only on the row an unguessable token names; store_temp_resume is
   * the paid checkout's own step (a refusal there is a refused purchase) and
   * is bounded per row (50k characters a field) and by its 24-hour expiry.
   */
  const UNBUDGETED: Record<string, string> = {
    "public.delete_analysis_by_share_id(text)": "deletes only the analysis whose 24/32-hex share id the caller holds",
    "public.get_temp_resume(text)": "reads only the row whose session uuid the caller holds (it writes nothing since 20261005123000)",
    "public.logout_affiliate(text)": "deletes only the session whose token the caller presents",
    "public.store_temp_resume(text,text,text)": "spends a budget of its own, defined after the census (20261005123000): per address, per network, and live-row ceilings that one network cannot fill",
  };

  it("every anon-callable function whose body writes spends client_write_allowed, or is a named capability writer", () => {
    const bad: string[] = [];
    for (const a of CLIENT_CALLABLE) {
      const f = fns.get(a.sig);
      if (!f || a.roles !== "anon" || !WRITES.test(f.body)) continue;
      if (UNBUDGETED[a.sig]) continue;
      if (!/\bclient_write_allowed\s*\(/.test(f.body)) bad.push(`${a.sig} (${f.file}) writes with no budget`);
      if (f.file !== CENSUS_FILE) bad.push(`${a.sig}: its live definition is ${f.file}, not the census`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
    for (const sig of Object.keys(UNBUDGETED)) expect(ALLOW.has(sig), `${sig} is not on the allowlist any more`).toBe(true);
  });

  it("no client-callable function keys a rate limit on a value the caller passes", () => {
    // record_scan_outcome keyed check_rate_limit on p_ip -- the browser's own
    // visitor id -- so every call could name a fresh bucket.
    const bad: string[] = [];
    for (const f of clientCallable) {
      for (const m of f.body.matchAll(/check_(?:global_)?rate_limit\s*\(([^;]*?)\)/gi)) {
        if (/\bp_\w+/.test(m[1])) bad.push(`${f.sig}: check_rate_limit(${m[1].trim().slice(0, 80)})`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("the budget reads the address the way _shared/client-address.ts does: cf-connecting-ip, else the LAST forwarded hop", () => {
    const f = fns.get("public.request_client_address()")!;
    expect(f, "request_client_address is missing").toBeTruthy();
    expect(f.definer).toBe(false);
    expect(f.body).toMatch(/current_setting\('request\.headers', true\)/);
    const cf = f.body.indexOf("'cf-connecting-ip'");
    const xff = f.body.indexOf("'x-forwarded-for'");
    expect(cf).toBeGreaterThan(-1);
    expect(xff).toBeGreaterThan(cf);
    expect(f.body).toMatch(/v_hops\[cardinality\(v_hops\)\]/);
    expect(f.body, "the first hop is whatever the client wrote").not.toMatch(/v_hops\[1\]|split_part\([^)]*,\s*1\)/);
    const budget = fns.get("public.client_write_allowed(text,integer,integer,integer)")!;
    expect(budget.body).toMatch(/public\.request_client_address\(\)/);
    expect(budget.body, "the address is stored hashed").toMatch(/md5\(v_addr\)/);
    expect(budget.body, "its cleanup must never cut inside the longest window (a day)").toMatch(/interval '2 days'/);
  });

  it("the helpers the census created are closed to both client roles", () => {
    for (const { sig } of CREATED_CLOSED) {
      const f = fns.get(sig);
      expect(f, `${sig} missing from the replay`).toBeTruthy();
      expect(anonCan(f!), `anon can execute ${sig}`).toBe(false);
      expect(authenticatedCan(f!), `authenticated can execute ${sig}`).toBe(false);
      expect(f!.acl.service_role, `service_role lost ${sig}`).toBe(true);
    }
    expect(CREATED_CLOSED.map((c) => nameOf(c.sig)).sort()).toEqual(CREATED_NAMES.filter((n) => n !== "client_callable_census").sort());
  });
});

describe("the tracker's lifecycle answers only for the caller's own tracker", () => {
  const f = fns.get("public.get_application_lifecycle(text[])")!;

  it("is signed-in only in the replay, and its one caller is a signed-in page", () => {
    expect(anonCan(f)).toBe(false);
    expect(authenticatedCan(f)).toBe(true);
    expect(ALLOW.get(f.sig)?.roles).toBe("authenticated");
    const account = codeOf(read("src/pages/Account.tsx"));
    expect(account, "Account.tsx sends a visitor without a session to /auth").toMatch(/if \(!loading && !session\) navigate\("\/auth"/);
    expect(account).toMatch(/rpc\("get_application_lifecycle", \{ p_job_ids: toCheck \}\)/);
    expect(account, "toCheck is the job ids on the user's own tracker rows").toMatch(/const toCheck = apps\.filter\(/);
  });

  it("intersects the ids with user_applications for auth.uid() before reading either ledger", () => {
    expect(f.file).toBe(CENSUS_FILE);
    expect(f.body).toMatch(/FROM public\.user_applications a\s+WHERE a\.user_id = auth\.uid\(\)\s+AND a\.job_id = ANY \(p_job_ids\[1:500\]\)/);
    // Both ledgers are read only through the intersected ids.
    expect(f.body).toMatch(/c\.posting_id IN \(SELECT ids\.jid FROM ids\)/);
    expect(f.body).toMatch(/p\.id IN \(SELECT ids\.jid FROM ids\)/);
    expect(f.body, "no ledger read may take the caller's ids directly").not.toMatch(/(posting_id|p\.id)\s*=\s*ANY\s*\(\s*p_job_ids/);
    // The 2026-09-09 shape survives: the row stays, the duration goes NULL.
    expect(f.body).toMatch(/absence_basis = 'lap_backfill' THEN NULL/);
  });
});

describe("an array a stranger fills is sliced before it is read", () => {
  /** Every `unnest(...)` / `ANY (...)` over a p_ parameter that carries no `[1:N]` slice. */
  const uncappedUses = (body: string): string[] => {
    const out: string[] = [];
    for (const m of body.matchAll(/\b(unnest|ANY)\s*\(/gi)) {
      const open = m.index! + m[0].length - 1;
      let depth = 0;
      let close = open;
      for (let i = open; i < body.length; i++) {
        if (body[i] === "(") depth++;
        else if (body[i] === ")" && --depth === 0) { close = i; break; }
      }
      const inner = body.slice(open + 1, close);
      if (/\bp_\w+/.test(inner) && !/\[\s*1\s*:\s*\d+\s*\]/.test(inner)) out.push(`${m[1]}(${inner.trim().slice(0, 60)})`);
    }
    return out;
  };

  it("the parse has teeth", () => {
    expect(uncappedUses("SELECT DISTINCT unnest(p_tokens) AS tok")).toEqual(["unnest(p_tokens)"]);
    expect(uncappedUses("WHERE c.posting_id = ANY (p_job_ids[1:500])")).toEqual([]);
    expect(uncappedUses("unnest((COALESCE(p_tokens, '{}'))[1:200])")).toEqual([]);
    expect(uncappedUses("WHERE x = ANY (ARRAY['a','b'])")).toEqual([]);
  });

  it("the client-callable functions reading an unsliced caller array are exactly the named ratchet", () => {
    const found = clientCallable.filter((f) => uncappedUses(f.body).length > 0).map((f) => f.sig).sort();
    expect(found, "a client-callable function reads an array the caller fills without slicing it: cap it ([1:N]) " +
      "or, if it truly cannot be, explain it in UNCAPPED_TOKEN_ARRAYS\n" +
      found.map((s) => `${s}: ${uncappedUses(fns.get(s)!.body).join("; ")}`).join("\n"))
      .toEqual(UNCAPPED_TOKEN_ARRAYS.map((u) => u.sig).sort());
    // A ratchet row whose function now slices must be removed, so the list only shrinks.
    for (const { sig } of UNCAPPED_TOKEN_ARRAYS) expect(ALLOW.has(sig), `${sig} left the allowlist; drop its ratchet row`).toBe(true);
  });

  it("every caller of the ratchet's functions sends at most 200 tokens, the cap they will get", () => {
    const jobs = codeOf(read("src/pages/Jobs.tsx"));
    expect((jobs.match(/\.filter\(\(tok\) => !(?:health|growth)Attempted\.current\.has\(tok\)\)\s*\.slice\(0, 200\)/g) ?? []).length).toBe(2);
    expect(codeOf(read("src/pages/Account.tsx"))).toMatch(/\.filter\(Boolean\)\)\]\.slice\(0, 50\)/);
    expect(read("supabase/functions/agent-runner/index.ts")).toMatch(/const HEALTH_TOKENS_PER_CALL = 100;/);
    expect(read("supabase/functions/agent-mcp/index.ts")).toMatch(/const EMPLOYER_TOKENS_MAX = 20;/);
  });
});
