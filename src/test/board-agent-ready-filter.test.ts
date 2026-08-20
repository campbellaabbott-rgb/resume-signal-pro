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
    // Asserts the PROPERTY, not a count. This hardcoded the number of
    // search_jobs call sites, so adding a legitimate one — the clustering
    // top-up on the ranked path — failed a guard about sendable sources
    // that the new call actually satisfies. Every call site must spread the
    // fragment; how many there are is not the contract.
    const calls = (board.match(/client\.rpc\("search_jobs", \{/g) ?? []).length;
    const withFragment = (board.match(/sendableSourcesParam\(applied\)/g) ?? []).length;
    expect(calls, "guard would be vacuous with no search_jobs calls").toBeGreaterThanOrEqual(2);
    expect(withFragment, `a search_jobs call site omits sendableSourcesParam(applied)`).toBeGreaterThanOrEqual(calls);
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

  it("sends only a literal true, at every send site", () => {
    // Counts SITES, and there are three since the filter-aware category counts
    // shipped (list, count-probe, facet counts). The property being protected
    // is not the number — it is that no site can send a truthy STRING, which
    // would silently narrow the board to ~6% for anyone with ?sendableOnly=1
    // in a shared URL. So: every occurrence of the key uses the literal form,
    // and none uses a bare pass-through.
    const literal = (jobs.match(/sendableOnly: agentOnly \? true : undefined/g) ?? []).length;
    const total = (jobs.match(/sendableOnly:/g) ?? []).length;
    expect(literal, "a sendableOnly send site is not using the literal-true form").toBe(total);
    expect(total, "guard would be vacuous with no send sites").toBeGreaterThanOrEqual(2);
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

describe("the agent filter is inside the never-silently-dropped fence", () => {
  it("names sendableOnly in ignoredFilters when it is not a boolean", () => {
    // PROVEN LIVE on 2026-08-17 against the deployed build:
    //   {"action":"list","sendableOnly":"true","limit":25}
    //     -> total 598,066, ignoredFilters ABSENT, 0 of 25 rows sendable
    //   {"action":"list","remote":"true","limit":5}
    //     -> total 598,066, ignoredFilters ["remote"]
    // Same failure shape, one named and one silent — and the silent one gates
    // the $99/mo product. ~16x over-serve (36,489 sendable rows vs 600,803).
    for (const bogus of ["true", 1, {}, []]) {
      const { applied, ignored } = normalizeFilters({ sendableOnly: bogus } as never, 15);
      expect(applied.sendableOnly, `${JSON.stringify(bogus)} must not enable the filter`).toBe(false);
      expect(ignored, `${JSON.stringify(bogus)} must be REPORTED, not dropped in silence`).toContain("sendableOnly");
    }
  });

  it("leaves a real boolean alone", () => {
    expect(normalizeFilters({ sendableOnly: true } as never, 15).ignored).not.toContain("sendableOnly");
    expect(normalizeFilters({ sendableOnly: false } as never, 15).ignored).not.toContain("sendableOnly");
    expect(normalizeFilters({} as never, 15).ignored).not.toContain("sendableOnly");
  });

  it("derives filtersActive mechanically, so a new filter cannot be forgotten", () => {
    // The rescue tiers (fuzzy, semantic, fuzzy-augmentation) stand down when a
    // filter is active, because none of those RPCs takes filter params. That
    // gate was a hand-written list of ten fields and sendableOnly was never
    // added — so with the agent filter alone, all three fired UNFILTERED.
    // Live proof: {"q":"nurse practicioner","sendableOnly":true} returned an
    // IDENTICAL id set to the unfiltered control, with filterIntegrity
    // reporting 12 violations across 13 rows.
    const fn = readFileSync(
      resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8",
    );
    const start = fn.indexOf("const filtersActive =");
    expect(start, "filtersActive not found").toBeGreaterThan(-1);
    const body = fn.slice(start, start + 700);
    expect(
      /Object\.entries\(applied\)/.test(body),
      "filtersActive must be derived from `applied`, not hand-listed — a " +
        "conjunction that needs editing whenever a filter is added is one that " +
        "goes stale, and it already did once.",
    ).toBe(true);
  });
});
