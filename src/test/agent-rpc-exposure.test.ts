import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Every SECURITY DEFINER function that takes a user id is a potential read of
// somebody else's data by anyone holding the publishable key.
//
// THE INCIDENT THIS GUARDS (2026-07-30): agent_sent_today was created
// SECURITY DEFINER with `GRANT EXECUTE ... TO authenticated, service_role` and
// nothing else. That reads like a restriction and is a no-op — Postgres grants
// EXECUTE on a new function to PUBLIC by default, and only a REVOKE removes it.
// Production answered an anonymous caller with a real count for an arbitrary
// user id. The two sibling functions written with explicit REVOKEs correctly
// returned 42501, which is the only reason the difference was visible at all.
const root = resolve(__dirname, "../..");
const migDir = resolve(root, "supabase/migrations");
const migs = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql")).sort()
  .map((f) => ({ name: f, sql: readFileSync(resolve(migDir, f), "utf8") }));
const allSql = migs.map((m) => m.sql).join("\n");

describe("SECURITY DEFINER functions are not left open to PUBLIC", () => {
  // Collect every SECURITY DEFINER function defined anywhere in the migration
  // set, then check each one is revoked somewhere. Scanning the whole set
  // rather than one file matters because the REVOKE legitimately arrives in a
  // later migration than the CREATE — which is exactly the shape of the fix.
  const defined = new Set<string>();
  for (const { sql } of migs) {
    const re = /CREATE OR REPLACE FUNCTION\s+public\.([a-z0-9_]+)\s*\(([^)]*)\)([\s\S]{0,400}?)\bAS\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      const [, name, args, tail] = m;
      // Only functions that are BOTH SECURITY DEFINER and take a uuid argument.
      // A definer function with no user-identifying parameter cannot be asked
      // about someone else.
      if (/SECURITY DEFINER/i.test(tail) && /\buuid\b/i.test(args)) defined.add(name);
    }
  }

  it("finds the functions it is supposed to be checking", () => {
    // If this ever goes to zero the suite would vacuously pass forever.
    expect(defined.size, "no SECURITY DEFINER(uuid) functions found — the matcher broke")
      .toBeGreaterThan(0);
    expect([...defined]).toContain("agent_sent_today");
  });

  // A function counts as locked if it is revoked by an explicit statement OR by
  // the pg_proc-driven lockdown block, which names functions in an array rather
  // than writing out 32 signatures. Only checking for the literal statement
  // would report the array-locked ones as open — a false alarm, which is the
  // failure mode that gets a guard ignored.
  const lockdownList = (() => {
    // Anchor on the SQL construct itself — `proname = ANY (ARRAY[...])` — not on
    // prose. My first attempt keyed off a comment that turned out to sit AFTER
    // the array, so it matched nothing and reported every locked function as
    // open. Matching the code means the guard tracks the code.
    const names = new Set<string>();
    for (const m of allSql.matchAll(/proname\s*=\s*ANY\s*\(\s*ARRAY\s*\[([\s\S]*?)\]\s*\)/gi)) {
      for (const q of m[1].matchAll(/'([a-z0-9_]+)'/g)) names.add(q[1]);
    }
    return names;
  })();
  const isLocked = (fn: string) =>
    new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\([^)]*\\)\\s+FROM[^;]*PUBLIC`, "i").test(allSql)
    || lockdownList.has(fn);

  it("revokes PUBLIC on every SECURITY DEFINER function taking a user id", () => {
    const unrevoked = [...defined].filter((fn) => !isLocked(fn));
    // get_temp_resume is deliberately reachable: the free scanner is anonymous
    // and the browser calls it with a session uuid as the capability. Listed
    // explicitly so the exemption is a decision on the record, not a silent gap.
    const INTENTIONALLY_PUBLIC = new Set(["get_temp_resume"]);
    const leaked = unrevoked.filter((fn) => !INTENTIONALLY_PUBLIC.has(fn));
    expect(leaked, `left on the default PUBLIC grant: ${leaked.join(", ")}`).toEqual([]);
  });

  it("actually locks the functions that were reachable in production", () => {
    // Each of these was confirmed anon-executable against the live database on
    // 2026-07-30, with get_storage_footprint returning 42501 on the same key as
    // the control that a denial would have been visible.
    for (const fn of [
      "add_scan_credits", "roll_up_and_prune_closures", "get_purchased_content_by_email",
      "get_purchased_content_by_session", "get_failed_deliveries_for_retry",
      "update_delivery_retry", "acquire_scan_slot", "release_scan_slot",
    ]) {
      expect(isLocked(fn), `${fn} was anon-callable in production and must be locked`).toBe(true);
    }
  });
});

describe("the in-function fallback actually excludes anon", () => {
  const fix = migs.find((m) => m.name.startsWith("20260730050000"))?.sql ?? "";

  it("ships the fix at all", () => {
    expect(fix, "20260730050000 missing").toContain("agent_sent_today");
  });

  // THE SECOND BUG, found while verifying the first: my own belt-and-braces
  // check was written as
  //
  //     IF auth.uid() IS NOT NULL AND auth.uid() <> p_user THEN RAISE
  //
  // which treats a NULL auth.uid() as "this must be the service role". An
  // ANONYMOUS caller also has a NULL auth.uid(). So the single caller the
  // REVOKE existed to stop was the one caller the fallback waved straight
  // through — a second line of defence that failed in exactly the same
  // circumstance as the first. And the REVOKE is not hypothetical here: it
  // failed to reach the database on its first deploy.
  it("does not treat a NULL auth.uid() as trusted", () => {
    expect(fix, "must distinguish anon from service_role by ROLE, not by a null uid")
      .toMatch(/auth\.role\(\)/);
    // service_role must be identified POSITIVELY by its role name. The exact
    // spelling is free (mine wraps it in coalesce) — what matters is that
    // 'service_role' is compared against auth.role() rather than inferred from
    // the absence of a uid.
    const usesRole = /auth\.role\(\)[\s\S]{0,30}'service_role'/.test(fix);
    expect(usesRole, "service_role must be identified positively, not inferred from a null uid").toBe(true);
  });

  it("refuses rather than returning a count when the caller is not the subject", () => {
    expect(fix).toMatch(/RAISE EXCEPTION/);
    // 42501 is what the correctly-written sibling functions return, so the
    // failure mode stays consistent across the whole agent surface.
    expect(fix).toMatch(/42501/);
  });
});

describe("anon-reachable ops functions do not hand out personal data", () => {
  // WHY THIS EXISTS. I audited the definer surface and cleared get_email_health
  // because src/pages/HealthCheck.tsx calls it — my rule was "a hand-written
  // frontend file calls it, so the browser is meant to reach it".
  //
  // That rule conflates two different questions. An admin dashboard is frontend
  // code too, so "a page calls it" says nothing about whether a STRANGER should.
  // In this case /health-check has no auth gate either, so both readings failed
  // at once, and production returned real customer email addresses to anon.
  //
  // Live probe of all sixteen ops/health RPCs showed only this one returns any
  // address, so the guard is specific rather than a blanket ban on the word.
  const latestDef = (fn: string) => {
    const withFn = migs.filter((m) => m.sql.includes(`FUNCTION public.${fn}`));
    return withFn.length ? withFn[withFn.length - 1].sql : "";
  };

  it("get_email_health masks recipient addresses", () => {
    const def = latestDef("get_email_health");
    expect(def, "get_email_health not found in any migration").toContain("get_email_health");
    // The body must not emit the column straight into the payload.
    expect(def, "recipient must not be returned raw").not.toMatch(/'recipient',\s*recipient\b/);
    // and must actually mask it
    expect(def, "expected a masked recipient").toMatch(/split_part\(recipient/);
  });


  it("scrubs addresses out of the provider's free-text error message too", () => {
    // Masking `recipient` alone left the address exposed: the mail provider
    // writes it into its own error copy ("You can only send testing emails to
    // your own email address (x@y.com)"). Three of ten live records carried it
    // AFTER the first fix shipped. Redacting a structured column does nothing
    // about free text holding the same value.
    const def = latestDef("get_email_health");
    expect(def, "error_message must be scrubbed, not passed through")
      .not.toMatch(/'error_message',\s*error_message\b/);
    expect(def).toMatch(/scrub_emails\(error_message\)/);
  });

  it("keeps the aggregate counters intact — masking must not gut the dashboard", () => {
    const def = latestDef("get_email_health");
    for (const col of ["total_emails", "successful_emails", "failed_emails", "success_rate"]) {
      expect(def, `${col} must survive`).toContain(col);
    }
  });
});
