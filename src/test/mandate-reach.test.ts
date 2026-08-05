/**
 * A CATEGORY CHOICE WAS REMOVING 27.6% OF THE BOARD, SILENTLY.
 *
 * Measured against the live facets on 2026-08-05: 162,800 of 590,808 postings
 * sit in `other`, the bucket a posting lands in when the title classifier
 * cannot place it. BOARD_CATEGORY_SLUGS excludes it on purpose — "a catch-all
 * bucket, not a landing page anyone searches for" — which is right for an SEO
 * lander and wrong for a filter. agent-runner's `.eq("category", …)` inherited
 * the exclusion, so picking Engineering cost a subscriber a quarter of the
 * board with nothing on screen to say so.
 *
 * AND THE MANDATE HAD NO SENSE OF POSTING AGE AT ALL. The runner's 36-hour
 * window is on `first_seen` — when WE saw it — and a feed can surface a role
 * posted five months ago. This codebase has already published one false public
 * statistic on exactly that confusion, which is why `max_age_days` mirrors the
 * board's maxAgeDays rather than defining a second freshness.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { applyCategory, applyMaxAge } from "../../supabase/functions/_shared/mandate-reach";

const runner = readFileSync(
  resolve(__dirname, "../../supabase/functions/agent-runner/index.ts"), "utf8");
const panel = readFileSync(
  resolve(__dirname, "../components/account/MorningQueuePanel.tsx"), "utf8");

const DIR = resolve(__dirname, "../../supabase/migrations");
const sql = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .find((s) => s.includes("include_uncategorised")) ?? "";

/** A stand-in for the PostgREST builder that records what was asked of it. */
const spy = () => {
  const calls: Array<[string, unknown[]]> = [];
  const qb: Record<string, unknown> = {};
  for (const m of ["eq", "in", "gte"]) {
    qb[m] = (...args: unknown[]) => { calls.push([m, args]); return qb; };
  }
  return { qb: qb as never, calls };
};

describe("the category filter", () => {
  it("filters to one category by default — unchanged behaviour", () => {
    const s = spy();
    applyCategory(s.qb, { category: "engineering" });
    expect(s.calls).toEqual([["eq", ["category", "engineering"]]]);
  });

  it("includes the other bucket only when asked", () => {
    const s = spy();
    applyCategory(s.qb, { category: "engineering", include_uncategorised: true });
    expect(s.calls).toEqual([["in", ["category", ["engineering", "other"]]]]);
  });

  it("treats an absent column as off, so it survives its own migration window", () => {
    // The function can deploy before the migration applies. A missing field
    // must mean "not set", never "on".
    const s = spy();
    applyCategory(s.qb, { category: "engineering", include_uncategorised: undefined });
    expect(s.calls).toEqual([["eq", ["category", "engineering"]]]);
    const s2 = spy();
    applyCategory(s2.qb, { category: "engineering", include_uncategorised: null });
    expect(s2.calls).toEqual([["eq", ["category", "engineering"]]]);
  });

  it("adds no filter for 'any field', which already includes the bucket", () => {
    const s = spy();
    applyCategory(s.qb, { category: "", include_uncategorised: true });
    expect(s.calls).toEqual([]);
  });

  it("does not ask for other twice when other IS the category", () => {
    const s = spy();
    applyCategory(s.qb, { category: "other", include_uncategorised: true });
    expect(s.calls).toEqual([["eq", ["category", "other"]]]);
  });
});

describe("the posting-age floor", () => {
  it("adds nothing when unset — every existing mandate is unaffected", () => {
    for (const v of [null, undefined, 0, NaN]) {
      const s = spy();
      applyMaxAge(s.qb, { max_age_days: v as number });
      expect(s.calls, `max_age_days=${String(v)} must add no filter`).toEqual([]);
    }
  });

  it("constrains posted_at, never first_seen", () => {
    // first_seen is a DISCOVERY time. Using it here would reproduce the exact
    // confusion behind the 2.8-day-median incident, inside the agent.
    const s = spy();
    applyMaxAge(s.qb, { max_age_days: 7 });
    expect(s.calls[0][0]).toBe("gte");
    expect(s.calls[0][1][0]).toBe("posted_at");
  });

  it("clamps to the board's own 1..30, so the two cannot disagree", () => {
    const at = (days: number) => {
      const s = spy();
      applyMaxAge(s.qb, { max_age_days: days });
      return s.calls.length ? Date.parse(s.calls[0][1][1] as string) : null;
    };
    const thirty = Date.now() - 30 * 86_400_000;
    expect(at(400)!).toBeGreaterThanOrEqual(thirty - 5_000);
    expect(at(400)!).toBeLessThanOrEqual(thirty + 5_000);
    expect(at(0)).toBeNull();
    expect(at(-3)).toBeNull();
  });
});

describe("BOTH call sites, which is the failure this file exists to catch", () => {
  // The multi-term change shipped one commit ago with a post-mortem: this
  // function turns a mandate into a query in TWO places, and patching only the
  // obvious one leaves a feature working in the main path and silently absent
  // in the other — a partial rollout that looks complete.
  // EXACTLY two, not "at least". The definitions live in _shared now, so every
  // occurrence in this file is a call site — and an over-count would mean a
  // third query nobody has looked at, which is the same blind spot from the
  // other direction.
  it("applies the category helper at both call sites", () => {
    expect((runner.match(/applyCategory\(/g) ?? []).length).toBe(2);
  });

  it("applies the age helper at both call sites", () => {
    expect((runner.match(/applyMaxAge\(/g) ?? []).length).toBe(2);
  });

  it("has no bare .eq(\"category\" left anywhere in the runner", () => {
    // A surviving direct call is a call site the opt-in does not reach.
    expect(runner).not.toMatch(/qb\.eq\("category"/);
    expect(runner).not.toMatch(/sb2\.eq\("category"/);
  });
});

describe("it can be deployed before its migration", () => {
  it("the runner falls back to the legacy column list", () => {
    // PostgREST 400s the WHOLE query on an unknown column. Without the
    // fallback, deploying this bundle first stops the nightly run for everyone.
    expect(runner).toMatch(/reach columns unavailable/);
    expect(runner).toMatch(/readMandates\(MANDATE_COLS\)/);
    expect(runner).toMatch(/readSearches\(SEARCH_COLS\)/);
  });

  it("the panel falls back too, or saved searches vanish from the page", () => {
    // The error path there sets `searches` to null, which renders the old
    // single-mandate form — so the symptom would be "the agent forgot my
    // searches", not a missing checkbox.
    expect(panel).toMatch(/if \(error\) \(\{ data, error \} = await read\(COLS\)\)/);
  });
});

describe("the migration", () => {
  it("defaults the opt-in to off", () => {
    expect(sql).toMatch(/include_uncategorised boolean NOT NULL DEFAULT false/);
  });

  it("leaves max_age_days nullable, meaning no constraint", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS max_age_days integer/);
    expect(sql).not.toMatch(/max_age_days integer NOT NULL/);
  });

  it("adds both columns to searches as well as mandates", () => {
    // Reach is per SEARCH: "anything posted this week" and "anything at all"
    // are different searches, and one value per person would make one wrong.
    expect(sql).toMatch(/ALTER TABLE public\.agent_searches[\s\S]{0,200}max_age_days/);
  });

  it("refuses to store a value the runner would silently correct", () => {
    expect(sql).toMatch(/max_age_days >= 1 AND max_age_days <= 30/);
  });
});

describe("the person can see what changed", () => {
  it("offers the age control", () => {
    expect(panel).toMatch(/agentQueue\.fieldMaxAge/);
  });

  it("states that undated postings are excluded rather than dated by guess", () => {
    expect(panel).toMatch(/we never guess an age/);
  });

  it("offers the uncategorised opt-in only when a category is set", () => {
    expect(panel).toMatch(/\{form\.category && \(/);
  });

  it("warns when the opt-in is being used without title terms", () => {
    // With titles set, including `other` is nearly free — the title filter does
    // the work. Without them it genuinely widens the search, and saying so is
    // the difference between an option and a trap.
    expect(panel).toMatch(/agentQueue\.uncategorisedNoTerms/);
  });

  it("shows the reach in the saved-search summary", () => {
    expect(panel).toMatch(/agentQueue\.summaryAge/);
    expect(panel).toMatch(/agentQueue\.summaryUncat/);
  });
});
