/**
 * "ONLY JOBS THE AGENT CAN APPLY TO" — A FILTER, NEVER A SORT.
 *
 * 31,552 of 588,607 postings (5.4%, measured live 2026-08-07) sit on the four
 * vendors the worker can drive. This filter narrows the board to them — the
 * filter form of the Sparkles badge, both reading the same SENDABLE_VENDORS
 * mirror, so the chip and the filter cannot mean different things.
 *
 * TWO INCIDENTS SHAPE EVERY ASSERTION HERE:
 *
 *   1. .order("category") — ranking by a non-indexed expression turned a 0.3s
 *      page into a 17.5s 500. So this is a FILTER composing with the date
 *      index, and this file pins that no sendability ORDER BY exists.
 *
 *   2. The partial rollout — the July purchase gate landed on the streaming
 *      fallbacks and missed the primaries; the category filter once reached
 *      the direct query and missed the RPCs. So this file counts CALL SITES:
 *      the direct query plus all three RPC bodies.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeFilters, sendableSourcesParam, filterViolations, type AppliedFilters } from "../../supabase/functions/job-board/filters";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";

const board = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
const DIR = resolve(__dirname, "../../supabase/migrations");
const mig = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .filter((t) => t.includes("p_sources")).pop() ?? "";

const norm = (b: Record<string, unknown>) => normalizeFilters(b, 200).applied;

describe("the flag only turns on for a literal true", () => {
  it("is off by default", () => {
    expect(norm({}).sendableOnly).toBe(false);
  });

  it("is on when asked", () => {
    expect(norm({ sendableOnly: true }).sendableOnly).toBe(true);
  });

  it("ignores truthy impostors — a query-param string must not narrow to 5% of the board", () => {
    for (const v of ["true", "1", 1, {}, "yes"]) {
      expect(norm({ sendableOnly: v }).sendableOnly, `${JSON.stringify(v)} must not enable it`).toBe(false);
    }
  });
});

describe("the RPC fragment, and why it is a fragment", () => {
  it("omits the key entirely when off", () => {
    // Including p_sources (even null) against the pre-migration SQL matches no
    // signature and PostgREST 404s the WHOLE search. Absence is the deploy-
    // window tolerance: only the toggle itself needs the migration.
    expect(sendableSourcesParam({ sendableOnly: false })).toEqual({});
    expect("p_sources" in sendableSourcesParam({ sendableOnly: false })).toBe(false);
  });

  it("carries the mirror's vendors when on", () => {
    expect(sendableSourcesParam({ sendableOnly: true })).toEqual({ p_sources: [...SENDABLE_VENDORS] });
  });

  it("hands out a copy, not the shared constant", () => {
    const a = sendableSourcesParam({ sendableOnly: true }) as { p_sources: string[] };
    const b = sendableSourcesParam({ sendableOnly: true }) as { p_sources: string[] };
    expect(a.p_sources).not.toBe(b.p_sources);
  });
});

describe("every call site, because there are four", () => {
  it("the direct query filters on source from the same mirror", () => {
    expect(board).toMatch(/if \(applied\.sendableOnly\) q = q\.in\("source", \[\.\.\.SENDABLE_VENDORS\]\)/);
  });

  it("all three RPC bodies spread the fragment", () => {
    // count_jobs_capped, and search_jobs on two paths — the same three sites
    // the category filter reaches.
    expect((board.match(/\.\.\.sendableSourcesParam\(applied\)/g) ?? []).length).toBe(3);
  });

  it("never sorts by sendability", () => {
    const code = board.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(code).not.toMatch(/\.order\("source"/);
  });
});

describe("the SQL took the list as a parameter", () => {
  it("widened BOTH functions", () => {
    expect(mig).toMatch(/CREATE FUNCTION public\.search_jobs\(/);
    expect(mig).toMatch(/CREATE FUNCTION public\.count_jobs_capped\(/);
    expect((mig.match(/p_sources text\[\] DEFAULT NULL/g) ?? []).length).toBe(2);
  });

  it("binds rather than interpolates", () => {
    expect((mig.match(/AND p\.source = ANY\(\$11\)/g) ?? []).length).toBe(2);
  });

  it("does NOT bake the vendor list into SQL", () => {
    // A vendor list in the migration is the fifth copy of SENDABLE_VENDORS,
    // and the fifth copy is the one that goes stale when adapter five lands.
    for (const v of SENDABLE_VENDORS) {
      expect(mig.includes(`'${v}'`), `${v} must not be hardcoded in the migration`).toBe(false);
    }
  });

  it("drops the old signatures before recreating — an overload would be ambiguous", () => {
    const sj = mig.indexOf("DROP FUNCTION IF EXISTS public.search_jobs");
    const cj = mig.indexOf("DROP FUNCTION IF EXISTS public.count_jobs_capped");
    expect(sj).toBeGreaterThan(-1);
    expect(cj).toBeGreaterThan(-1);
    expect(mig.indexOf("CREATE FUNCTION public.search_jobs")).toBeGreaterThan(sj);
    expect(mig.indexOf("CREATE FUNCTION public.count_jobs_capped")).toBeGreaterThan(cj);
  });

  it("renumbered the paged params past the new bind", () => {
    expect(mig).toMatch(/\$12::bigint AS total_rows/);
    expect(mig).toMatch(/LIMIT GREATEST\(LEAST\(\$13, 200\), 1\) OFFSET GREATEST\(\$14, 0\)/);
  });
});

describe("the self-check knows the new filter", () => {
  const base: AppliedFilters = norm({});
  const row = (source: string, category = "engineering") => ({ source, category, token: "t" });

  it("flags a walled-vendor row under the filter", () => {
    const v = filterViolations([row("workday")], { ...base, sendableOnly: true });
    expect(v.some((x) => x.field === "sendableOnly")).toBe(true);
  });

  it("passes a drivable row", () => {
    const v = filterViolations([row(SENDABLE_VENDORS[0])], { ...base, sendableOnly: true });
    expect(v).toEqual([]);
  });

  it("says nothing when the filter is off", () => {
    expect(filterViolations([row("workday")], base)).toEqual([]);
  });
});

describe("REGRESSION: the opt-in's own rows are not violations", () => {
  // Found while wiring the check above, one day after the two-subset pager
  // shipped: the category self-check flagged every `other` row an opted-in
  // page legitimately returns. Unsampled, that logs a false filter-integrity
  // incident on every such page — a permanent red light over a working
  // feature. Nothing had used the opt-in yet, which is the only reason the
  // incident log stayed clean.
  const base = norm({ category: "engineering", includeUncategorised: true });

  it("allows `other` when the caller opted in", () => {
    const v = filterViolations([{ source: "x", category: "other", token: "t" }], base);
    expect(v.filter((x) => x.field === "category")).toEqual([]);
  });

  it("still flags a genuinely wrong category", () => {
    const v = filterViolations([{ source: "x", category: "sales", token: "t" }], base);
    expect(v.some((x) => x.field === "category")).toBe(true);
  });

  it("still flags `other` when the caller did NOT opt in", () => {
    const strict = norm({ category: "engineering" });
    const v = filterViolations([{ source: "x", category: "other", token: "t" }], strict);
    expect(v.some((x) => x.field === "category")).toBe(true);
  });
});

describe("the UI round trip", () => {
  it("seeds from the URL and writes back to it", () => {
    expect(jobs).toMatch(/useState\(initial\.get\("agentOnly"\) === "1"\)/);
    expect(jobs).toMatch(/if \(agentOnly\) p\.set\("agentOnly", "1"\)/);
  });

  it("sends only a literal true", () => {
    expect((jobs.match(/sendableOnly: agentOnly \? true : undefined/g) ?? []).length).toBe(2);
  });

  it("refetches when toggled — a filter absent from the deps does nothing", () => {
    expect((jobs.match(/category, inclUncat, agentOnly,/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("does not hardcode a share of the board in the copy", () => {
    // Three code comments once said 2% and 3.4% while reality was 5.3%. The
    // badge tip stays number-free; the count on screen IS the live number.
    const tip = jobs.slice(jobs.indexOf("agentOnlyTip"), jobs.indexOf("agentOnlyTip") + 400);
    expect(tip).not.toMatch(/\d+%/);
  });
});
