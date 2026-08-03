/**
 * The daily cap must count COMMITMENTS, not completions.
 *
 * agent_sent_today is what the cap is measured against. It originally counted
 *
 *     agent_submissions WHERE submitted_at >= date_trunc('day', now())
 *
 * and submitted_at is, by its own schema comment, "set ONLY by a confirmed
 * send" — stamped by the worker. apply-agent never sets it; it sets
 * released_at, the flag the worker gates on.
 *
 * So a released packet — a decision already taken to apply in someone's name —
 * was invisible to the ceiling until the worker got around to it:
 *
 *     09:00  cap 5, sent_today = 0  -> release 5
 *     10:00  worker has not run,
 *            sent_today STILL 0     -> release 5 more
 *
 * A cap of 5 becomes 5-per-hour whenever releases outrun the sender, which is
 * the normal case for a browser worker with a rate limit between applications.
 * The column comment on auto_apply_daily_cap names the harm exactly: "a runaway
 * loop that applies to the same employer forty times is a reputational event
 * for the candidate, not a bug report for us."
 *
 * Nothing was over-sent, because no worker has ever run — found before it
 * became an incident rather than after.
 *
 * THIS ALSO GATES A SCHEMA CHANGE. agent_mandates is `user_id PRIMARY KEY`, so
 * a candidate can express exactly one search. Allowing several is only safe
 * once the cap is a real per-user ceiling; otherwise four searches at cap 20
 * authorise eighty applications a day for one person. These assertions are the
 * precondition for that change.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");

/**
 * The LAST definition wins in a migration chain — that is the live one.
 *
 * Anchored on CREATE specifically. Searching for `FUNCTION public.<fn>(` and
 * taking lastIndexOf matched the trailing `COMMENT ON FUNCTION` line instead,
 * after which there is no closing `$$;` — so the body came back empty and
 * every assertion failed against "". A helper that returns nothing makes a
 * real fix look broken, which is the same shape of fault this file is about.
 */
function liveDefinitionOf(fn: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let live = "";
  for (const f of files) {
    const sql = readFileSync(resolve(MIGRATIONS, f), "utf8");
    const i = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    if (i === -1) continue;
    const end = sql.indexOf("$$;", i);
    if (end === -1) continue;
    const body = sql.slice(i, end + 3);
    if (body.includes("SELECT")) live = body;
  }
  return live;
}

describe("agent_sent_today counts commitments, not completions", () => {
  const live = liveDefinitionOf("agent_sent_today");

  it("has a live definition at all", () => {
    expect(live.length, "agent_sent_today has no SELECT-bearing definition").toBeGreaterThan(0);
  });

  it("counts packets released today, not only ones the worker finished", () => {
    expect(live, "the cap is blind to released-but-unsent packets — it can be exceeded by releasing faster than the worker sends")
      .toMatch(/released_at\s*>=\s*date_trunc\('day'/);
  });

  it("still counts genuinely submitted packets", () => {
    expect(live).toMatch(/submitted_at\s*>=\s*date_trunc\('day'/);
  });

  it("does not double-count a packet both released and submitted today", () => {
    // The released branch must be guarded on submitted_at IS NULL, or a row
    // that was released this morning and sent this afternoon consumes two of
    // the candidate's five.
    expect(live, "released branch is not mutually exclusive with the submitted branch")
      .toMatch(/submitted_at IS NULL AND released_at/);
  });

  it("stays per-user — the ceiling has to hold across every mandate a user has", () => {
    expect(live).toMatch(/user_id\s*=\s*p_user/);
  });

  it("is not callable by anon — a client-side count is not a cap", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const last = files.filter((f) =>
      readFileSync(resolve(MIGRATIONS, f), "utf8").includes("FUNCTION public.agent_sent_today(")).pop()!;
    const sql = readFileSync(resolve(MIGRATIONS, last), "utf8");
    expect(sql, "anon can call agent_sent_today").toMatch(/REVOKE ALL ON FUNCTION public\.agent_sent_today\(uuid\) FROM PUBLIC, anon/);
  });
});
