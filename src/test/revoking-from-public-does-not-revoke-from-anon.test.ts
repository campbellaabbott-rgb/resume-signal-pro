import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { anonCan, authenticatedCan, migrationReplay, parseSigRef, sigOf } from "./helpers/function-acl";
import { CLIENT_CALLABLE, CLOSED_BY_CENSUS } from "./helpers/client-callable-allowlist";

/**
 * PUBLIC AND anon ARE NOT THE SAME GRANTEE.
 *
 * On 2026-08-21 I locked two telemetry tables behind RLS with no policy, then
 * exposed one of them anyway through a SECURITY DEFINER function I believed I
 * had closed:
 *
 *   REVOKE ALL ON FUNCTION public.get_top_search_misses(...) FROM PUBLIC;
 *   GRANT  EXECUTE ON FUNCTION public.get_top_search_misses(...) TO service_role;
 *
 * Measured with the anon key minutes after deploy: the function answered, and
 * it returns RAW QUERY TEXT — what visitors typed into the search box. The anon
 * key ships in the frontend bundle, so that was public.
 *
 * Supabase grants EXECUTE on public-schema functions to the `anon` and
 * `authenticated` roles DIRECTLY. Revoking the PUBLIC pseudo-role does not
 * touch a grant held by a named role, so the revoke removed nothing that
 * mattered — and because the function was DEFINER, it read straight through the
 * RLS lock I had just added. A DEFINER function is exactly the thing that
 * bypasses the lock, which is what makes this the dangerous combination.
 *
 * This repo already learned the same fact from the other side: the
 * definer-exposure audit found 107 of 121 definer functions anon-callable and
 * recorded "a GRANT doesn't restrict". I then assumed a REVOKE does.
 *
 * THE RULE, mechanically checkable: if a migration revokes a function FROM
 * PUBLIC — which is only ever done to close something — it must also revoke it
 * from anon and authenticated by name. Half the revoke reads as security and
 * provides none.
 *
 * Whether the PUBLIC-only form suffices depends on grants that are not visible
 * in the migration, so "it worked last time" is not evidence it works now. Four
 * functions carrying the same pattern were probed live and ARE protected; they
 * are listed below WITH that evidence rather than silently excluded. A fifth
 * with the same pattern was probed and was NOT protected — which is the whole
 * reason the list is probe-derived instead of rule-derived.
 */
const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/**
 * VERIFIED PROTECTED BY LIVE PROBE, 2026-08-21 — not assumed, and not exempt
 * from the rule on principle.
 *
 * These four carry the same REVOKE-FROM-PUBLIC-only pattern that leaked the
 * telemetry aggregate, and the first version of this guard flagged all four.
 * They are NOT actually exposed:
 *
 *   POST /rest/v1/rpc/read_email_batch (anon key, non-existent queue)
 *   -> {"code":"42501","message":"permission denied for function read_email_batch"}
 *
 * THERE IS NO RULE OF THUMB HERE, and my first one was wrong. I assumed these
 * were safe because they were older. Then log_seniority_correction — created
 * TWO DAYS LATER, same pattern, also DEFINER — probed OPEN. Same SQL, opposite
 * outcomes, two days apart. Whether the PUBLIC-only revoke suffices depends on
 * grants this SQL cannot see, so the only way to know is to call the function
 * with the anon key.
 *
 * They stay listed rather than being pattern-matched away, because the
 * protection is a property of the deployed database and not of this SQL: if any
 * of them is ever recreated it inherits today's default privileges and becomes
 * exposed. Re-probe before trusting this list; a name added here without a
 * probe is the failure this whole file exists to prevent.
 */
const PROBED_PROTECTED = new Set([
  "public.enqueue_email(text,jsonb)",
  "public.read_email_batch(text,int,int)",
  "public.delete_email(text,bigint)",
  "public.move_to_dlq(text,text,bigint,jsonb)",
]);

/**
 * PRE-EXISTING, FROZEN -- and now EMPTY. The ratchet reached zero on 2026-10-04.
 *
 * Seventeen functions carried the PUBLIC-only revoke when this guard was
 * written, and the population was genuinely mixed, so none could be revoked
 * as a batch. The client-callable census (migration 20261004110000,
 * every-function-a-stranger-can-call-is-named-with-its-caller.test.ts) traced
 * every caller of each and triaged all seventeen:
 *
 *   CLOSED to anon and authenticated, by exact signature --
 *     agent_confirmation_gaps, agent_fill_gaps   only scan-heartbeat reads them,
 *                                                with the service key
 *     email_delivery_health, product_delivery_health
 *                                                the same: the heartbeat, the
 *                                                webhook and the retry job
 *     get_db_size_stats                          the heartbeat only
 *     get_scan_metrics_hourly                    the scan dashboards, which now
 *                                                read it through admin-ops
 *     get_user_score_trend                       already closed; now by name
 *   GONE -- agent_reach, dropped by 20260805210811.
 *   PROMOTED to INTENTIONALLY_PUBLIC below (each one is also a row in
 *   helpers/client-callable-allowlist.ts naming the caller that needs it).
 *
 * A name added here is a function somebody typed to make this test pass,
 * which is the opposite of what the list was for. It stays empty.
 */
const UNTRIAGED_PRE_EXISTING = new Set<string>([]);

/**
 * PUBLIC on purpose: revoked from PUBLIC, granted to anon by name, and each
 * one a row in the census allowlist with the client-role file that calls it.
 * The last test below holds that cross-reference, so a name cannot sit here
 * without a caller on record.
 */
const INTENTIONALLY_PUBLIC = new Set([
  "public.agent_sender_public_status()",
  "public.get_industry_correction_stats(integer)",
  "public.get_public_scan_insights()",
  "public.get_real_score_distribution(text)",
  "public.get_scan_geo_stats(integer)",
  "public.get_scan_health_status()",
  "public.get_scan_success_rate(integer,text)",
  "public.get_scan_totals()",
  "public.record_scan_outcome(text,text,text)",
]);

/** `public.fn(args)` as written in a REVOKE/GRANT, normalised for comparison. */
const sig = (s: string) => s.replace(/\s+/g, "").toLowerCase();

describe("revoking from PUBLIC does not revoke from anon", () => {
  it("every function revoked FROM PUBLIC is also revoked from anon by name", () => {
    // Evaluated across the WHOLE TREE, not per file: closing a function in a
    // later migration is a perfectly good fix, and a per-file check would keep
    // reporting the original file forever after it was remediated.
    const fromPublic = new Map<string, string>();   // signature -> file that opened it
    const fromAnon = new Set<string>();

    for (const f of FILES) {
      const sql = readFileSync(resolve(DIR, f), "utf8");
      // Comments in these files explain the rule and quote the bad pattern;
      // strip them so an explanation is never mistaken for the thing itself.
      const code = sql.replace(/^\s*--.*$/gm, "");
      for (const m of code.matchAll(/REVOKE\s+[\s\S]*?\s+ON\s+FUNCTION\s+(public\.[\w]+\s*\([^)]*\))\s+FROM\s+([^;]*);/gi)) {
        const fn = sig(m[1]);
        const grantees = m[2];
        if (/\banon\b/i.test(grantees)) fromAnon.add(fn);
        if (/\bPUBLIC\b/i.test(grantees) && !fromPublic.has(fn)) fromPublic.set(fn, f);
      }
    }

    // The census closes 56 functions with a catalogue-driven signature loop
    // (a static REVOKE per function would make that file the "newest
    // definition" every per-function guard reads). The replay interprets that
    // loop, so a function the replay shows anon cannot execute is closed, by
    // whatever statement did it.
    const { fns } = migrationReplay();
    const closedInReplay = (fn: string) => {
      const ref = parseSigRef(fn);
      if (!ref || ref.args === null) return false;
      const f = fns.get(sigOf(ref.name, ref.args));
      return !f || !anonCan(f);
    };

    const violations: string[] = [];
    for (const [fn, file] of fromPublic) {
      if (PROBED_PROTECTED.has(fn) || UNTRIAGED_PRE_EXISTING.has(fn) || fromAnon.has(fn)) continue;
      if (INTENTIONALLY_PUBLIC.has(fn) || closedInReplay(fn)) continue;
      violations.push(
        `${fn} (opened in ${file}) is revoked FROM PUBLIC but never FROM anon anywhere in the ` +
          `tree. PUBLIC and anon are different grantees, so this may still be callable — and if ` +
          `it is SECURITY DEFINER it reads straight through any RLS lock on its tables. Probe it ` +
          `with the anon key; if it answers, revoke it by name.`,
      );
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("the two telemetry aggregates are closed to anon somewhere in the tree", () => {
    // Anchored on the specific functions that leaked, so a future migration
    // that recreates them without the revoke is caught by name rather than
    // relying on the general rule above.
    const all = FILES.map((f) => readFileSync(resolve(DIR, f), "utf8").replace(/^\s*--.*$/gm, "")).join("\n");
    for (const fn of ["get_top_search_misses", "get_search_quality"]) {
      expect(
        new RegExp(String.raw`REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.${fn}\s*\([^)]*\)\s+FROM[^;]*\banon\b`, "i").test(all),
        `${fn} reads RLS-locked visitor data as DEFINER and must be revoked from anon by name`,
      ).toBe(true);
    }
  });

  it("the revoke migration sorts AFTER the migration that created the functions", () => {
    // A fix stamped earlier than the hole is a no-op on a fresh database — the
    // same ordering trap the moat locks had to satisfy.
    const created = FILES.find((f) => f.includes("search_quality_needs_a_denominator"));
    const fixed = FILES.find((f) => f.includes("revoke_from_public_did_not_revoke_from_anon"));
    expect(created, "the telemetry migration is missing").toBeTruthy();
    expect(fixed, "the revoke migration is missing").toBeTruthy();
    expect(fixed! > created!, `${fixed} must sort after ${created}`).toBe(true);
  });

  it("the frozen list is empty and stays empty", () => {
    // The ratchet, run to the end. Every one of the seventeen was triaged by
    // the 2026-10-04 census; a name added back is a name typed to make this
    // test pass.
    expect(
      UNTRIAGED_PRE_EXISTING.size,
      "this list reached zero when the census triaged all seventeen. A function that needs to be here does " +
        "not: close it by name, or add it to INTENTIONALLY_PUBLIC AND to the census allowlist with its caller.",
    ).toBe(0);
  });

  it("every intentionally public function is on the census allowlist with its caller, and still open", () => {
    const allow = new Map(CLIENT_CALLABLE.map((a) => [a.sig, a]));
    const { fns } = migrationReplay();
    for (const fn of INTENTIONALLY_PUBLIC) {
      const ref = parseSigRef(fn)!;
      const key = sigOf(ref.name, ref.args!);
      expect(allow.get(key)?.roles, `${fn} is public on purpose but has no census allowlist row naming its caller`).toBe("anon");
      expect(anonCan(fns.get(key)!), `${fn} is listed public and anon cannot execute it`).toBe(true);
    }
  });

  it("the seventeen it froze are each closed, gone, or public with a caller", () => {
    // The original seventeen, kept verbatim so the triage stays checkable.
    const seventeen = [
      "public.agent_confirmation_gaps(integer)", "public.agent_fill_gaps(integer)", "public.agent_reach(integer)",
      "public.agent_sender_public_status()", "public.email_delivery_health(integer)", "public.get_db_size_stats()",
      "public.get_industry_correction_stats(integer)", "public.get_public_scan_insights()",
      "public.get_real_score_distribution(text)", "public.get_scan_geo_stats(integer)", "public.get_scan_health_status()",
      "public.get_scan_metrics_hourly(integer)", "public.get_scan_success_rate(integer,text)", "public.get_scan_totals()",
      "public.get_user_score_trend(text)", "public.product_delivery_health(integer)", "public.record_scan_outcome(text,text,text)",
    ];
    const { fns } = migrationReplay();
    const closed = new Set(CLOSED_BY_CENSUS.map((c) => c.sig));
    for (const fn of seventeen) {
      const f = fns.get(fn);
      if (!f) { expect(fn, "only agent_reach was dropped").toBe("public.agent_reach(integer)"); continue; }
      if (INTENTIONALLY_PUBLIC.has(fn)) continue;
      expect(closed.has(fn), `${fn} is neither public on purpose nor on the census closed list`).toBe(true);
      expect(anonCan(f) || authenticatedCan(f), `${fn} is still client-callable`).toBe(false);
    }
  });
});
