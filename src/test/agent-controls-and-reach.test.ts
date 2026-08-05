/**
 * WHERE THE AGENT MAY NOT APPLY, AND HOW MUCH OF THE BOARD IT CAN REACH.
 *
 * MEASURED 2026-08-04 against the live board:
 *
 *   breezy      11,218   teamtailor  9,658   personio 4,539   pinpoint 4,930
 *   ------------------------------------------------------------------ 30,345 drivable
 *   smartrecruiters                                                     44,410 NOT drivable
 *
 * SmartRecruiters is bigger than all four driven vendors combined, and the
 * adapter for it is written, 143 lines, with a working submit path. It is not
 * dispatched, and that is deliberate: RECON.md records "Written but not served —
 * the adapter is correct; the vendor refuses headless", a 403 on the apply URL,
 * re-measured and closed on 2026-08-01. Getting past it means defeating bot
 * detection, which is out of bounds.
 *
 * So the temptation is precise and expensive: counting a vendor we have code for
 * would overstate published reach by 146%, and every one of those applications
 * would fail. The reach number must follow the DISPATCH LIST, not the file list.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260804030000_agent_controls_and_honest_reach.sql"), "utf8");
const agent = readFileSync(
  resolve(__dirname, "../../supabase/functions/apply-agent/index.ts"), "utf8");
// worker/src/vendors/index.ts, NOT worker/src/index.ts — the registry is here.
// And the whole file cannot be searched for a vendor name: BLOCKED and
// NEEDS_RECON deliberately NAME the vendors they refuse, so a substring match
// would read "smartrecruiters is dispatched" from the sentence explaining that
// it is not. Only the ADAPTERS map counts.
const registry = readFileSync(
  resolve(__dirname, "../../worker/src/vendors/index.ts"), "utf8");
const dispatched = (): string[] => {
  const start = registry.indexOf("export const ADAPTERS");
  const end = registry.indexOf("};", start);
  expect(start, "the ADAPTERS registry was renamed").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return [...registry.slice(start, end).matchAll(/^\s*([a-z][a-z0-9_]*),\s*$/gm)].map((m) => m[1]);
};
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * The vendors named in agent_reach()'s ARRAY[...] — parsed, not restated.
 *
 * NOTE, 2026-08-05: no UI reads agent_reach() any more. It returns 57014
 * statement timeout on every call (its cache's only writer is its own slow
 * path, which counts ~590k rows twice and never finishes), so AgentReachNote
 * now reads job-board's `status.sendable` instead — see that component.
 *
 * These assertions are kept rather than deleted: the SQL is still deployed and
 * still anon-callable, so if anyone revives or repairs it, the vendor list it
 * publishes must still match what the worker can actually drive. What they no
 * longer prove is anything about what a subscriber SEES.
 */
const publishedVendors = (): string[] => {
  const marker = "v_vendors text[] := ARRAY[";
  const start = sql.indexOf(marker);
  expect(start, "the reach vendor list was renamed or removed").toBeGreaterThan(-1);
  const from = start + marker.length;
  const end = sql.indexOf("]", from);
  const names = [...sql.slice(from, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(names.length, "parsed an empty vendor list — assertions would be vacuous")
    .toBeGreaterThan(0);
  return names;
};

describe("published reach follows the dispatch list, not the file list", () => {
  it("the two lists are exactly equal", () => {
    const live = dispatched();
    expect(live.length, "parsed no adapters — the assertion would be vacuous").toBeGreaterThan(0);
    // Set-equal in both directions: publishing a vendor the worker cannot drive
    // overstates reach, and dropping one the worker CAN drive understates it and
    // quietly wastes coverage that already works.
    expect([...publishedVendors()].sort()).toEqual([...live].sort());
  });

  it("does NOT publish smartrecruiters — 44,410 postings the vendor 403s", () => {
    // The single most expensive mistake available here, because the adapter
    // exists and looks ready. RECON.md closed it on evidence, twice.
    expect(publishedVendors()).not.toContain("smartrecruiters");
  });

  it("the smartrecruiters adapter still exists but is still unwired", () => {
    // If someone wires it, this fails and forces a decision rather than letting
    // the reach number and reality drift apart silently.
    const files = readdirSync(resolve(__dirname, "../../worker/src/vendors"));
    expect(files, "adapter deleted — update RECON and this test together")
      .toContain("smartrecruiters.ts");
    expect(dispatched(), "smartrecruiters is now dispatched — reach must be re-measured")
      .not.toContain("smartrecruiters");
    // And the refusal stays documented rather than becoming a silent omission.
    expect(registry, "the reason smartrecruiters is refused was deleted")
      .toMatch(/smartrecruiters:/);
  });

  it("counts the whole board too, so the share is computable and not asserted", () => {
    expect(sql).toMatch(/board_total/);
    expect(sql).toMatch(/SELECT count\(\*\)::int INTO v_total FROM public\.job_board_postings;/);
  });

  it("is readable by anon — the number belongs on the pricing page", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.agent_reach\(integer\) TO anon/);
  });
});

describe("the agent honours where it may not apply", () => {
  it("selects the new columns — an unselected column is undefined forever", () => {
    // The exact bug that made the broker's `active` gate a no-op: PostgREST
    // returns only what select() names.
    const sel = agent.slice(agent.indexOf('from("agent_mandates")'), agent.indexOf('.eq("active", true)'));
    expect(sel).toMatch(/blocked_companies/);
    expect(sel).toMatch(/paused_until/);
    expect(sel).toMatch(/employer_cooldown_days/);
  });

  it("skips a paused mandate BEFORE the entitlement query", () => {
    const c = code(agent);
    const pause = c.indexOf("summary.skippedPaused++");
    const entitle = c.indexOf("rowIsEntitled(sub)");
    expect(pause).toBeGreaterThan(-1);
    expect(pause).toBeLessThan(entitle);
  });

  it("a missing paused_until does NOT pause — permissive when absent", () => {
    // Rows written before the migration have no paused_until. Reading absent as
    // paused would stop a working agent with no error anywhere.
    expect(code(agent)).toMatch(/if \(m\.paused_until &&/);
  });

  it("an empty blocklist blocks nothing", () => {
    // `blockedCompanies.size &&` — without it, a mandate with no blocklist and a
    // posting with no company name could match empty-string against empty-string.
    expect(code(agent)).toMatch(/blockedCompanies\.size &&/);
  });

  it("matches companies case- and whitespace-insensitively", () => {
    const c = code(agent);
    expect(c).toMatch(/\.trim\(\)\.toLowerCase\(\)/);
    expect(c).toMatch(/blockedCompanies\.has\(String\(q\.company \?\? ""\)\.trim\(\)\.toLowerCase\(\)\)/);
  });

  it("cooldown of 0 disables the rule rather than blocking everything", () => {
    expect(code(agent)).toMatch(/cooldownDays > 0 && q\.company/);
    expect(sql).toMatch(/p_days <= 0/);
  });

  it("cooldown counts only applications that actually went out", () => {
    // submitted_at IS NOT NULL. Counting prepared-but-unsent packets would lock
    // a candidate out of an employer they were never actually sent to.
    expect(sql).toMatch(/s\.submitted_at IS NOT NULL/);
  });

  it("a blank company is never treated as in cooldown", () => {
    // Otherwise every unnamed posting collides with every other unnamed one.
    expect(sql).toMatch(/coalesce\(btrim\(p_company\), ''\) = ''/);
  });
});

describe("a silent morning is explainable", () => {
  for (const counter of ["skippedPaused", "skippedBlockedCompany", "skippedEmployerCooldown"]) {
    it(`counts ${counter} separately`, () => {
      // "0 applications today" must not mean four different things. A candidate
      // whose whole shortlist was their own employer deserves a different
      // sentence from one with no matches.
      expect(code(agent)).toContain(counter);
    });
  }
});
