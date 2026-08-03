/**
 * Several saved searches per candidate, without the three ways that breaks.
 *
 * agent_mandates is `user_id uuid PRIMARY KEY`, so a candidate could express
 * exactly ONE set of criteria. "Product Manager, NYC, >=140k" and "Program
 * Manager, remote, >=120k" are different searches with different floors, and
 * you had to pick one.
 *
 * Three things had to hold before that limit could be lifted, and each of them
 * fails quietly rather than loudly:
 *
 *  1. THE SEND CAP MUST BE PER USER. auto_apply_daily_cap is per-user and
 *     agent_sent_today counts commitments (fixed in 20260803120000). Without
 *     that, four searches at cap 20 authorise eighty applications a day in one
 *     person's name — the multiplication bug one level up.
 *
 *  2. THE PROFILE MUST NOT BE DUPLICATED. The mandate row also carries
 *     full_name, phone, resume, and the standing answers — including "are you
 *     authorised to work", which an employer reads as a statement of fact from
 *     the candidate. Two copies that can disagree is worse than the limitation.
 *     So criteria moved to their own table and the profile did not.
 *
 *  3. THE RUN SUMMARY MUST BE STAMPED PER SEARCH. Both writes targeted
 *     agent_mandates by user_id. With three searches that is last-writer-wins:
 *     three summaries land on one row and the first two vanish, so "why did my
 *     Product Manager search find nothing" has no answer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const runner = readFileSync(resolve(root, "supabase/functions/agent-runner/index.ts"), "utf8");

function migration(nameFragment: string): string {
  const f = readdirSync(MIGRATIONS).find((x) => x.includes(nameFragment));
  return f ? readFileSync(resolve(MIGRATIONS, f), "utf8") : "";
}

/**
 * SQL with `--` comments removed.
 *
 * The structural assertions below must read the schema, not the essay above
 * it. The migration's own header quotes `user_id uuid PRIMARY KEY` while
 * explaining what is being lifted, and names full_name/phone/resume_text while
 * explaining why they STAY on the mandate — so a raw-text assertion reports the
 * documentation as the defect it warns about. A guard that cannot tell
 * configuration from prose about configuration is the same fault caught in
 * worker-deploy.test.ts and again in agent-card-claims.test.ts.
 */
const stripComments = (sql: string): string =>
  sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("agent_searches schema", () => {
  const raw = migration("agent_searches");
  const sql = stripComments(raw);

  it("exists, with its own surrogate key rather than user_id", () => {
    expect(sql, "no agent_searches migration").toContain("CREATE TABLE IF NOT EXISTS public.agent_searches");
    expect(sql).toMatch(/id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY/);
    expect(sql, "user_id must NOT be the primary key — that is the limit being lifted")
      .not.toMatch(/user_id uuid[^,]*PRIMARY KEY/);
  });

  it("does not copy the applicant profile across", () => {
    // The profile is a set of factual claims about a person. One copy.
    for (const col of ["full_name", "phone", "resume_text", "work_authorized", "requires_sponsorship"]) {
      expect(sql, `agent_searches duplicates the profile column ${col}`).not.toContain(col);
    }
  });

  it("is owner-only at the row level", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(/USING \(auth\.uid\(\) = user_id\)/);
  });

  it("caps active searches per user in the DATABASE, not the form", () => {
    // RLS lets the owner insert directly, so a form-only limit is not a limit.
    expect(sql).toMatch(/CREATE TRIGGER agent_searches_cap_trg/);
    expect(sql).toMatch(/at most 10 active searches per user/);
  });

  it("carries every existing mandate across, so nobody opens an empty list", () => {
    expect(sql).toMatch(/INSERT INTO public\.agent_searches[\s\S]*FROM public\.agent_mandates/);
    expect(sql, "backfill must be idempotent — migrations get re-run")
      .toMatch(/WHERE NOT EXISTS/);
  });
});

describe("agent-runner fans out per search", () => {
  it("reads the searches table", () => {
    expect(runner).toMatch(/\.from\("agent_searches"\)/);
  });

  it("gates entitlement per USER, before fanning out", () => {
    // Running the checks inside the per-search loop would count one unentitled
    // subscriber three times and turn skipped_unentitled into a number of
    // searches wearing the name of a number of people.
    const gate = runner.indexOf("const eligible: MandateRow[] = []");
    const fanout = runner.indexOf("const runRows: RunRow[] = []");
    expect(gate, "no per-user eligibility pass").toBeGreaterThan(-1);
    expect(fanout, "no per-search fan-out").toBeGreaterThan(-1);
    expect(gate, "entitlement is gated AFTER the fan-out — it would count searches, not people")
      .toBeLessThan(fanout);
  });

  it("falls back to the mandate's own criteria when the table is absent", () => {
    // The function may deploy before its migration. An agent that silently
    // stops finding jobs because a table is not there yet is worse than one
    // that keeps doing what it did yesterday.
    expect(runner).toMatch(/agent_searches unavailable, using mandate criteria/);
    expect(runner).toMatch(/search_id: 0/);
  });

  it("stamps the run summary on the SEARCH, not on the user", () => {
    expect(runner, "stampRun helper is gone — summaries will overwrite each other")
      .toMatch(/const stampRun = async/);
    expect(runner).toMatch(/\.from\("agent_searches"\)\.update\(\{[\s\S]{0,200}\}\)\.eq\("id", r\.search_id\)/);
    // And no summary write may still target agent_mandates by user_id inside
    // the loop — that is the last-writer-wins bug.
    const strayUserStamp = /await client\.from\("agent_mandates"\)\.update\(\{[\s\S]{0,260}\}\)\.eq\("user_id", m\.user_id\)/;
    expect(runner, "a summary write still targets agent_mandates by user_id")
      .not.toMatch(strayUserStamp);
  });

  it("reports searches separately from people", () => {
    expect(runner, "a user with four searches must not look like four users")
      .toMatch(/searches: runRows\.length/);
  });
});
