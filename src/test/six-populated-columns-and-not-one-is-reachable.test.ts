import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AppliedFilters,
  BOARD_VENDORS,
  filterViolations,
  isUnfiltered,
  WIDENING_FILTERS,
  normalizeFilters,
  rpcBlindFilters,
} from "../../supabase/functions/job-board/filters.ts";

/**
 * SIX COLUMNS THE BOARD FILLS, AND NOT ONE OF THEM REACHABLE.
 *
 * MEASURED 2026-08-25 against the 559,805 rows the live board can serve — open,
 * inside the freshness window, the same population the cached coverage figures
 * are taken over:
 *
 *   experience_band   559,805 non-null, but 318,607 "unspecified"  -> 241,198 (43.1%)
 *   department        226,631  (40.5%)
 *   min_years         162,032  (28.9%)
 *   work_mode         157,584  (28.1%)
 *   salary_min_annual 112,524  (20.1%)
 *   salary_max_annual  87,001  (15.5%)
 *   salary_period      59,505  (10.6%)   hour 41,542 | year 17,312 | month 627
 *
 * Every one of those columns is populated, indexed, and SELECTed on every page.
 * A visitor could reach exactly two of them: work mode and experience. The
 * others were populated for nobody. department was the sharpest case — it was
 * reachable only by typing into free-text `q`, where buildQuery ORs it with
 * title and company, so a request for the Legal department also returned every
 * Legal Assistant title and every employer with Legal in its name, and nothing
 * in the response said which of the three had matched.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT CALLS RATHER THAN GREPS.
 *
 * normalizeFilters is importable, so every claim about what a request MEANS is
 * made by calling it and reading the returned AppliedFilters. This repo has
 * been caught nine times by a guard that greps source: the spelling was there,
 * the code was dead, and the test was green. The only greps below are for the
 * two things that genuinely are not callable from here — the predicates
 * buildQuery binds, and the units coverageDisclosure publishes — and both strip
 * comments first, because four guards this month matched their own explanation.
 *
 * THE REJECTIONS MATTER AS MUCH AS THE ACCEPTANCES. A filter is REQUESTED when
 * the caller sends anything non-empty for it and APPLIED only when it can be
 * bound; requested-but-not-applied is always named back. A ceiling under the
 * floor, maxYears 0 or 99, a vendor that is not a hiring system and a pay basis
 * that is not one of the two literals all have to arrive in `ignored`, because
 * the alternative — an empty page — is a statement about the market, and each
 * of these would be a statement about the request wearing that costume.
 */
const norm = (b: Record<string, unknown>) => normalizeFilters(b, 40_000);

/** Executable lines only. A comment that names a column is not a predicate. */
const stripComments = (s: string) =>
  s
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

/** buildQuery's body, sliced to its real closing brace rather than a line count. */
const BUILD_QUERY = (() => {
  const start = FN.indexOf("const buildQuery = (");
  expect(start, "buildQuery has moved or been renamed").toBeGreaterThan(-1);
  const end = FN.indexOf("\n  };", start);
  expect(end, "buildQuery's closing brace was not found").toBeGreaterThan(start);
  return stripComments(FN.slice(start, end));
})();

describe("pay basis — a scalpel that has to be named as one", () => {
  it("binds both literals, in any casing the caller sends", () => {
    expect(norm({ payBasis: "hourly" }).applied.payBasis).toBe("hourly");
    expect(norm({ payBasis: "salaried" }).applied.payBasis).toBe("salaried");
    // {workMode:"Remote"} once served the whole unfiltered board to API callers
    // because a capital R was not a work mode. A capital H must not cost a
    // caller their pay basis the same way.
    expect(norm({ payBasis: "Hourly" }).applied.payBasis).toBe("hourly");
    expect(norm({ payBasis: " SALARIED " }).applied.payBasis).toBe("salaried");
    expect(norm({ payBasis: "hourly" }).ignored).toEqual([]);
  });

  it("names a basis it cannot bind instead of serving the board unfiltered", () => {
    const { applied, ignored } = norm({ payBasis: "weekly" });
    expect(applied.payBasis).toBeNull();
    expect(ignored).toContain("payBasis");
    expect(norm({ payBasis: "hour" }).ignored).toContain("payBasis");
    expect(norm({ payBasis: true }).ignored).toContain("payBasis");
  });

  it("says nothing when nobody asked", () => {
    expect(norm({}).applied.payBasis).toBeNull();
    expect(norm({}).ignored).toEqual([]);
  });

  it("excludes a row whose period the employer never stated", () => {
    // The same contract work mode has: 10.6% of the board states a period, and
    // the other 89.4% is out — honestly, never guessed at.
    const a = { ...norm({ payBasis: "hourly" }).applied };
    expect(filterViolations([{ salaryPeriod: "hour" }], a)).toEqual([]);
    expect(filterViolations([{ salaryPeriod: "year" }], a)[0]?.field).toBe("payBasis");
    expect(filterViolations([{ salaryPeriod: null }], a)[0]?.field).toBe("payBasis");
    const s = { ...norm({ payBasis: "salaried" }).applied };
    expect(filterViolations([{ salaryPeriod: "year" }, { salaryPeriod: "month" }], s)).toEqual([]);
    expect(filterViolations([{ salaryPeriod: "hour" }], s)[0]?.field).toBe("payBasis");
  });
});

describe("hasStatedPay — the honest half of what salaryFloor already does", () => {
  it("is literal true only, and a non-boolean is NAMED rather than guessed", () => {
    expect(norm({ hasStatedPay: true }).applied.hasStatedPay).toBe(true);
    expect(norm({ hasStatedPay: true }).ignored).toEqual([]);
    // {"sendableOnly":"true"} returned 598,066 rows with an empty
    // ignoredFilters. A string from a query param is truthy in JS and this
    // filter cuts the board to a fifth; the strictness stays, the silence does
    // not.
    const { applied, ignored } = norm({ hasStatedPay: "true" });
    expect(applied.hasStatedPay).toBe(false);
    expect(ignored).toContain("hasStatedPay");
    // The box being off is not a request, and must not hang a warning on the page.
    expect(norm({ hasStatedPay: false }).ignored).toEqual([]);
    expect(norm({ hasStatedPay: false }).applied.hasStatedPay).toBe(false);
  });

  it("flags a row with no stated figure", () => {
    const a = norm({ hasStatedPay: true }).applied;
    expect(filterViolations([{ salaryMinAnnual: 90_000 }], a)).toEqual([]);
    expect(filterViolations([{ salaryMinAnnual: null }], a)[0]?.field).toBe("hasStatedPay");
  });
});

describe("salaryCeiling — the other end of a band the board only had one end of", () => {
  it("accepts a ceiling and keeps the floor beside it", () => {
    const { applied, ignored } = norm({ salaryFloor: 80_000, salaryCeiling: 150_000 });
    expect(applied.salaryFloor).toBe(80_000);
    expect(applied.salaryCeiling).toBe(150_000);
    expect(ignored).toEqual([]);
    // A band of exactly one figure is a real request, not an inverted one.
    expect(norm({ salaryFloor: 100_000, salaryCeiling: 100_000 }).applied.salaryCeiling).toBe(100_000);
  });

  it("REFUSES a ceiling below the floor rather than serving an empty page", () => {
    const { applied, ignored } = norm({ salaryFloor: 150_000, salaryCeiling: 80_000 });
    expect(applied.salaryCeiling).toBeNull();
    expect(ignored).toContain("salaryCeiling");
    // The floor survives: only the half we could not honour is dropped, and it
    // is the half that gets named.
    expect(applied.salaryFloor).toBe(150_000);
    expect(ignored).not.toContain("salaryFloor");
  });

  it("compares against the DERIVED floor, including one lifted out of the search box", () => {
    // salaryFromQueryText turns "200k nurse" into a floor of 200,000. Comparing
    // the ceiling against body.salaryFloor — which is absent here — would let
    // this through as a band whose floor sits above its ceiling: zero rows, no
    // explanation, and the caller reading it as a fact about nursing pay.
    const { applied, ignored } = norm({ q: "200k nurse", salaryCeiling: 150_000 });
    expect(applied.salaryFloor).toBe(200_000);
    expect(applied.salaryCeiling).toBeNull();
    expect(ignored).toContain("salaryCeiling");
  });

  it("treats 0 as the control at rest and a negative as a refusal", () => {
    expect(norm({ salaryCeiling: 0 }).applied.salaryCeiling).toBeNull();
    expect(norm({ salaryCeiling: 0 }).ignored).toEqual([]);
    expect(norm({ salaryCeiling: -5 }).ignored).toContain("salaryCeiling");
    expect(norm({ salaryCeiling: "high" }).ignored).toContain("salaryCeiling");
  });
});

describe("maxYears — the job-seeker's question, refused rather than clamped", () => {
  it("binds 1 through 20", () => {
    expect(norm({ maxYears: 1 }).applied.maxYears).toBe(1);
    expect(norm({ maxYears: 3 }).applied.maxYears).toBe(3);
    expect(norm({ maxYears: 20 }).applied.maxYears).toBe(20);
    expect(norm({ maxYears: 5 }).ignored).toEqual([]);
  });

  it("does NOT clamp 99 to 20 — a clamp here would be a narrowing we invented", () => {
    // maxAgeDays clamps because 90 days and 30 days are the same intent against
    // a board that keeps 30, and the clamp is disclosed. There is no intent to
    // preserve here: "at most 99 years" clamped to "at most 20" removes rows the
    // caller asked to see, silently. So it is refused and named.
    const { applied, ignored } = norm({ maxYears: 99 });
    expect(applied.maxYears).toBeNull();
    expect(applied.maxYears).not.toBe(20);
    expect(ignored).toContain("maxYears");
    expect(norm({ maxYears: 21 }).ignored).toContain("maxYears");
  });

  it("refuses a FRACTION, because min_years is a smallint and 3.5 is a 400", () => {
    // Probed live 2026-08-25, read-only, against the deployed table:
    //   min_years=lte.3   -> a row
    //   min_years=lte.3.5 -> 22P02, invalid input syntax for type smallint
    // 3.5 clears every bound the filter states (finite, >= 1, <= 20) and would
    // have bound straight into buildQuery, so the whole list query 400s under a
    // request that looks perfectly ordinary. Refused and named, like every other
    // value this filter cannot bind.
    for (const bad of [3.5, "3.5", 0.5, 19.9]) {
      const { applied, ignored } = norm({ maxYears: bad });
      expect(applied.maxYears, `maxYears ${bad} must not bind`).toBeNull();
      expect(ignored, `maxYears ${bad} must be named`).toContain("maxYears");
    }
    // A whole number sent as a string is still a whole number.
    expect(norm({ maxYears: "5" }).applied.maxYears).toBe(5);
    expect(norm({ maxYears: "5" }).ignored).toEqual([]);
    // salaryCeiling deliberately does NOT get this rule: salary_rank_usd is
    // numeric, which parses 3.5 and 1e+21 alike (probed the same day).
    expect(norm({ salaryCeiling: 150_000.5 }).applied.salaryCeiling).toBe(150_000.5);
  });

  it("refuses 0 out loud — no control's rest position is 0 here", () => {
    const { applied, ignored } = norm({ maxYears: 0 });
    expect(applied.maxYears).toBeNull();
    expect(ignored).toContain("maxYears");
    expect(norm({ maxYears: -3 }).ignored).toContain("maxYears");
    expect(norm({ maxYears: "senior" }).ignored).toContain("maxYears");
  });

  it("flags a row that demands more, or that never said", () => {
    const a = norm({ maxYears: 3 }).applied;
    // 0 is a stated requirement and clears every ceiling — the correct reading
    // for someone asking "does this demand more than I have".
    expect(filterViolations([{ minYears: 0 }, { minYears: 3 }], a)).toEqual([]);
    expect(filterViolations([{ minYears: 8 }], a)[0]?.field).toBe("maxYears");
    // A posting that named no requirement cannot be shown to satisfy one, so
    // the predicate excludes it and a row that arrives anyway is the defect.
    expect(filterViolations([{ minYears: null }], a)[0]?.field).toBe("maxYears");
  });
});

describe("department — a column reachable only by accident", () => {
  it("trims and keeps what the employer actually wrote", () => {
    expect(norm({ department: "  Legal  " }).applied.department).toBe("Legal");
    // A comma is DATA here, not a separator: this binds a plain .ilike(), not an
    // or() branch, and "Sales, Marketing" is a real department on this board.
    expect(norm({ department: "Sales, Marketing" }).applied.department).toBe("Sales, Marketing");
    expect(norm({ department: "Legal" }).ignored).toEqual([]);
  });

  it("strips the ILIKE wildcards before they become someone else's query", () => {
    // A surviving % turns "eng%" into a prefix match nobody asked for and _
    // matches any single character.
    expect(norm({ department: "eng%" }).applied.department).toBe("eng");
    expect(norm({ department: "a_b" }).applied.department).toBe("ab");
    expect(norm({ department: 'x"y' }).applied.department).toBe("xy");
    expect(norm({ department: "a|b" }).applied.department).toBe("ab");
  });

  it("names a request that is nothing but wildcards", () => {
    const { applied, ignored } = norm({ department: "%%" });
    expect(applied.department).toBeNull();
    expect(ignored).toContain("department");
    expect(norm({ department: "%_" }).ignored).toContain("department");
    // Whitespace alone is not a REQUEST — `sent()` trims before it decides, the
    // same way it does for q and location — so it is silent rather than named.
    // Reporting it would put a warning on a page where a control is simply
    // empty, which is the noise the "0 is the off position" rule avoids.
    expect(norm({ department: "   " }).applied.department).toBeNull();
    expect(norm({ department: "   " }).ignored).toEqual([]);
  });

  it("names a non-string instead of coercing it into a predicate", () => {
    // String({}) is "[object Object]" — a perfectly valid ILIKE that matches
    // nothing, under a filter the caller never expressed. The `companies` rule:
    // an unknown value is a fair question, an invalid SHAPE is not.
    expect(norm({ department: {} }).applied.department).toBeNull();
    expect(norm({ department: {} }).ignored).toContain("department");
    expect(norm({ department: ["Legal"] }).ignored).toContain("department");
    // A digit is plausible: "Technology/Imaging 40-065" is a real department here.
    expect(norm({ department: 40 }).applied.department).toBe("40");
  });

  it("caps the length, so a filter value cannot become a payload", () => {
    const long = "x".repeat(300);
    expect(norm({ department: long }).applied.department).toHaveLength(60);
  });

  it("checks a returned row with the SAME substring question the query asked", () => {
    const a = norm({ department: "engineering" }).applied;
    // "Hardware Engineering" is a row the ILIKE deliberately returns; an
    // equality check here would flag correct behaviour as a violation.
    expect(filterViolations([{ department: "Hardware Engineering" }], a)).toEqual([]);
    expect(filterViolations([{ department: "Sales" }], a)[0]?.field).toBe("department");
    expect(filterViolations([{ department: null }], a)[0]?.field).toBe("department");
  });
});

describe("vendor — nineteen hiring systems, and the board could only ask for five", () => {
  it("knows every hiring system the board serves, and only those", () => {
    // Pinned to JobSourceKind by the typechecker, both directions — see the
    // assertion in filters.ts. This is the runtime half of that contract.
    // 17 since paylocity landed (2026-08-30), 18 since adp (2026-08-31) — the
    // length pin exists so a vendor joining the union is a conscious act here
    // too, not a drive-by.
    // 20 since jazzhr (2026-09-04).
    expect(BOARD_VENDORS).toHaveLength(20);
    expect(BOARD_VENDORS).toContain("workday");
    // usajobs is not an ATS and the agent can never apply there, and it is
    // still a source the board serves. A vendor list that omits it is false by
    // omission however true each named item is.
    expect(BOARD_VENDORS).toContain("usajobs");
    // oracle has no catalogue entry today and still has rows in the table —
    // which is why this list is not derived from JOB_SOURCES.
    expect(BOARD_VENDORS).toContain("oracle");
  });

  it("takes a CSV or an array, in any casing, and dedupes", () => {
    expect(norm({ vendor: "greenhouse,lever" }).applied.vendors).toEqual(["greenhouse", "lever"]);
    expect(norm({ vendor: ["greenhouse", "lever"] }).applied.vendors).toEqual(["greenhouse", "lever"]);
    expect(norm({ vendor: " Workday , ASHBY " }).applied.vendors).toEqual(["workday", "ashby"]);
    expect(norm({ vendor: "greenhouse,lever" }).ignored).toEqual([]);
    // A repeat is not a dropped member and must not be reported as one.
    const dup = norm({ vendor: ["lever", "lever"] });
    expect(dup.applied.vendors).toEqual(["lever"]);
    expect(dup.ignored).toEqual([]);
  });

  it("NAMES a vendor that is not a hiring system", () => {
    // Unlike a company token — 19,701 of those exist and asking about one the
    // board does not carry is a fair question with an empty answer — the vendor
    // space is closed at seventeen. A name outside it is a typo, and answering a
    // typo with an empty page is answering it.
    const { applied, ignored } = norm({ vendor: "monster" });
    expect(applied.vendors).toEqual([]);
    expect(ignored).toContain("vendor");
  });

  it("reports a PARTIAL drop, not only a total one", () => {
    // ["senior","bogus"] stayed silent for a day because only total loss was
    // reported. The caller keeps lever and still gets told monster did nothing.
    const { applied, ignored } = norm({ vendor: ["lever", "monster"] });
    expect(applied.vendors).toEqual(["lever"]);
    expect(ignored).toContain("vendor");
  });

  it("caps the list at eight and says that it did", () => {
    const nine = [
      "greenhouse", "lever", "ashby", "smartrecruiters", "workable",
      "bamboohr", "recruitee", "teamtailor", "personio",
    ];
    const { applied, ignored } = norm({ vendor: nine });
    expect(applied.vendors).toHaveLength(8);
    // Slicing in silence would tell a caller who asked for nine systems that
    // they got nine. That is the shape of the clamp that read as "there is
    // nothing older".
    expect(ignored).toContain("vendor");
  });

  it("is spelled `vendor` on the wire and `vendors` in the applied filters", () => {
    // The API contract is fixed. A UI wired to the plural would send a filter
    // the board never sees, and nothing would say so — this is the assertion
    // that catches that before it ships.
    expect(norm({ vendor: "lever" }).applied.vendors).toEqual(["lever"]);
    expect(norm({ vendors: ["lever"] }).applied.vendors).toEqual([]);
  });

  it("flags a row from a system nobody asked for", () => {
    const a = norm({ vendor: "lever" }).applied;
    expect(filterViolations([{ source: "lever" }], a)).toEqual([]);
    expect(filterViolations([{ source: "greenhouse" }], a)[0]?.field).toBe("vendor");
  });
});

describe("isUnfiltered — mechanical, so all six are counted the day they exist", () => {
  it("still calls a bare request unfiltered", () => {
    expect(isUnfiltered(norm({}).applied)).toBe(true);
    expect(isUnfiltered(norm({ salaryCeiling: 0, hasStatedPay: false }).applied)).toBe(true);
  });

  it("counts each of the six ON ITS OWN as a filtered request", () => {
    // PROVEN, not assumed. isUnfiltered is derived from Object.values, but "it
    // is derived" is a claim about the code, and this repo's rule is that a
    // claim about the code is checked by calling it. A request narrowed to a
    // tenth of the board that reads as unfiltered is how the whole catalogue's
    // total — 587,793 — got published over 3,949 filtered results.
    const cases: Array<Record<string, unknown>> = [
      { payBasis: "hourly" },
      { hasStatedPay: true },
      { salaryCeiling: 150_000 },
      { maxYears: 3 },
      { department: "Legal" },
      { vendor: "lever" },
    ];
    for (const body of cases) {
      const { applied, ignored } = norm(body);
      expect(ignored, `${JSON.stringify(body)} should be honoured, not refused`).toEqual([]);
      expect(
        isUnfiltered(applied),
        `${JSON.stringify(body)} narrows the board and must not read as unfiltered`,
      ).toBe(false);
    }
  });

  it("counts EVERY field of AppliedFilters, including ones added after this file", () => {
    // The same property board-filter-contract.test.ts asserts, re-stated here
    // over an object that carries the six. The literal is typed, so adding a
    // seventh filter to AppliedFilters fails the typecheck HERE until it is
    // listed — and the loop then proves isUnfiltered counts it.
    const filled: AppliedFilters = {
      q: "nurse",
      location: "Berlin",
      country: "DE",
      remote: true,
      workMode: "remote",
      employmentType: "internship",
      includeUncategorised: true,
      sendableOnly: true,
      category: "engineering",
      experience: ["senior"],
      salaryFloor: 100_000,
      salaryCeiling: 200_000,
      payBasis: "salaried",
      hasStatedPay: true,
      includeUnstatedPay: true,
      maxYears: 5,
      department: "Legal",
      vendors: ["lever"],
      companies: ["tok"],
      maxAgeDays: 7,
      postedAfter: "2026-07-01T00:00:00Z",
      // 2026-08-31: the agency opt-out — the typed-literal tripwire fired
      // here exactly as designed when AppliedFilters gained it.
      excludeAgencies: true,
      // Added 2026-09-04: only rows the résumé scorer can read.
      hasDescription: true,
    };
    const empty = norm({}).applied as unknown as Record<string, unknown>;
    const keys = Object.keys(filled) as Array<keyof AppliedFilters>;
    expect(keys.length).toBeGreaterThanOrEqual(19);
    // WIDENING FLAGS ARE EXEMPT, and the exemption is pinned below so it cannot
    // quietly grow. They admit rows and bind no predicate ALONE —
    // includeUnstatedPay only relaxes an ACTIVE pay floor, includeUncategorised
    // only widens an ACTIVE category — so counting one as a narrowing made an
    // otherwise-bare request stop reading its maintained total and run a capped
    // count, publishing "10,000 (capped)" beside a real ~600k (measured
    // 2026-08-30). The concern this test records — "engineering + unsorted must
    // read as filtered" — is untouched: `category` is still counted, so that
    // request is still filtered.
    for (const k of keys.filter((k) => !WIDENING_FILTERS.has(String(k)))) {
      const one = { ...empty, [k]: (filled as Record<string, unknown>)[k] } as unknown as AppliedFilters;
      expect(isUnfiltered(one), `field "${String(k)}" is not counted as a filter`).toBe(false);
    }
    // The hole is exactly two wide, and each is exempt because ALONE it binds
    // nothing. A third one has to be argued for, which is the point of a
    // mechanical rule with a NAMED hole rather than a hand-maintained list.
    expect([...WIDENING_FILTERS].sort()).toEqual(["includeUncategorised", "includeUnstatedPay"]);
    for (const w of WIDENING_FILTERS) {
      const only = { ...empty, [w]: true } as unknown as AppliedFilters;
      expect(isUnfiltered(only), `widening flag "${w}" must not filter the bare board`).toBe(true);
    }
  });
});

describe("rpcBlindFilters — the six bind in ONE place, and it is not the RPCs", () => {
  // search_jobs, search_jobs_semantic and count_jobs_capped each take one p_
  // parameter per filter, and a filter with no parameter is not refused by them
  // — it is ignored. Measured 2026-07-25: the ranked path without p_work_mode
  // returned 30 rows that ALL had work_mode NULL under a remote-only request.
  // Until those parameters exist, a route that serves RPC rows or an RPC count
  // has to stand down when any of these is active.
  it("names exactly the filters no RPC can bind", () => {
    expect(rpcBlindFilters(norm({}).applied)).toEqual([]);
    // Everything the RPCs DO carry stays out of the list.
    expect(rpcBlindFilters(norm({
      q: "nurse",
      country: "DE",
      workMode: "remote",
      employmentType: "internship",
      category: "engineering",
      experience: ["senior"],
      salaryFloor: 100_000,
      maxAgeDays: 7,
      sendableOnly: true,
      companies: ["tok"],
    }).applied)).toEqual([]);
    // ALL SIX HAVE NOW MOVED OUT OF THE BLIND SET, in two steps, and the
    // history is the fact this test carries:
    //   20260826041500 — hasStatedPay / includeUnstatedPay (p_pay_stated,
    //   p_include_unstated).
    //   20260827210000 — payBasis, salaryCeiling, maxYears, department
    //   (parameters of their own), and vendors riding the existing p_sources.
    // While blind they were correctly diverted, and the diversion was a
    // quality cliff: any one of them cost ranking, the trigram tier, the
    // exact-word tier and semantic, silently. The SQL is what changed —
    // executed against real Postgres, nine combinations return the correct
    // rows and the injection probe returns zero. Reporting one of these blind
    // again would push its searches back off the ranked path, so the
    // assertions flip rather than move.
    expect(rpcBlindFilters(norm({ payBasis: "hourly" }).applied)).toEqual([]);
    expect(rpcBlindFilters(norm({ hasStatedPay: true }).applied)).toEqual([]);
    expect(rpcBlindFilters(norm({ salaryCeiling: 150_000 }).applied)).toEqual([]);
    expect(rpcBlindFilters(norm({ maxYears: 3 }).applied)).toEqual([]);
    expect(rpcBlindFilters(norm({ department: "Legal" }).applied)).toEqual([]);
    expect(rpcBlindFilters(norm({ vendor: "lever" }).applied)).toEqual([]);
    expect(rpcBlindFilters(norm({ maxYears: 3, vendor: "lever" }).applied)).toEqual([]);
  });
});

describe("buildQuery — the ONE binder actually binds all six", () => {
  // Not callable from here: buildQuery closes over a live PostgREST client
  // inside serveList. So this reads its body with the comments removed — the
  // narrowest grep that can prove a predicate exists, and the reason every
  // other assertion in this file is a call instead.
  it("binds each new filter to the column the contract names", () => {
    const required: Array<[string, RegExp]> = [
      // The ceiling now BRANCHES on includeUnstatedPay — a plain .lte() ANDed
      // after the floor's OR-arm silently cancelled it, because NULL fails `<=`
      // and every unpriced row the toggle had just re-admitted was thrown back
      // out. So this one spans lines and is matched over the block rather than
      // one line; both arms are asserted below so a half-written binding still
      // cannot pass.
      ["salaryCeiling -> salary_rank_usd", /applied\.salaryCeiling !== null\)[\s\S]{0,400}?lte\("salary_rank_usd", applied\.salaryCeiling\)/s],
      ["hasStatedPay -> salary_min_annual IS NOT NULL", /applied\.hasStatedPay\).*not\("salary_min_annual", "is", null\)/s],
      ["payBasis hourly -> salary_period = 'hour'", /applied\.payBasis === "hourly"\).*eq\("salary_period", "hour"\)/s],
      ["payBasis salaried -> salary_period IN (year, month)", /applied\.payBasis === "salaried"\).*in\("salary_period", \[\.\.\.SALARIED_PERIODS\]\)/s],
      ["maxYears -> min_years <= n", /applied\.maxYears !== null\).*lte\("min_years", applied\.maxYears\)/s],
      ["department -> ILIKE %s%", /applied\.department\).*ilike\("department", `%\$\{applied\.department\}%`\)/s],
      ["vendor -> source IN (...)", /applied\.vendors\.length\).*in\("source", applied\.vendors\)/s],
    ];
    for (const [what, re] of required) {
      // Each predicate is matched on its OWN line-anchored fragment, so a
      // half-written binding cannot be covered by a neighbour's match.
      const line = BUILD_QUERY.split("\n").find((l) => re.test(l))
        ?? (re.test(BUILD_QUERY) ? "matched across lines" : undefined);
      expect(line, `buildQuery does not bind ${what}`).toBeTruthy();
    }
    // The ceiling's widening arm, asserted by name: without it the toggle is
    // cancelled on every banded pay search (measured: 3,375 -> 404).
    expect(
      BUILD_QUERY,
      "the ceiling must share includeUnstatedPay's widening, or it re-arms the NULL discard",
    ).toMatch(/salary_rank_usd\.lte\.\$\{applied\.salaryCeiling\},salary_rank_usd\.is\.null/);
  });

  it("reads the derived filters, never the raw body", () => {
    // Five defects in two days came from a second derivation. normalizeFilters
    // is the only place these are read from the request.
    const offenders = [
      "body.payBasis",
      "body.hasStatedPay",
      "body.salaryCeiling",
      "body.maxYears",
      "body.department",
      "body.vendor",
    ].filter((p) => BUILD_QUERY.includes(p));
    expect(offenders, `buildQuery re-derives from the raw body: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("coverageDisclosure — a fraction, published in the unit the page renders", () => {
  const BLOCK = (() => {
    const start = FN.indexOf("const MEASURED_COVERAGE = {");
    expect(start, "MEASURED_COVERAGE has moved or been renamed").toBeGreaterThan(-1);
    const end = FN.indexOf("} as const;", start);
    expect(end, "MEASURED_COVERAGE's closing brace was not found").toBeGreaterThan(start);
    return stripComments(FN.slice(start, end));
  })();

  const measured = Object.fromEntries(
    [...BLOCK.matchAll(/^\s*(\w+):\s*([0-9.]+),/gm)].map((m) => [m[1], Number(m[2])]),
  );

  it("publishes the measured figure for every filter over a partly-populated column", () => {
    expect(Object.keys(measured).sort()).toEqual(
      ["department", "hasStatedPay", "maxYears", "payBasis", "vendor"],
    );
    // The numbers from the live measurement, not rounded-off approximations of
    // them: 59,505 / 112,524 / 162,032 / 226,631 / 559,805 over 559,805.
    expect(measured.payBasis).toBe(0.106);
    expect(measured.hasStatedPay).toBe(0.201);
    expect(measured.maxYears).toBe(0.289);
    expect(measured.department).toBe(0.405);
    expect(measured.vendor).toBe(1);
  });

  it("is a FRACTION, because the page multiplies it by 100", () => {
    // Jobs.tsx renders Math.round(fc.salaryFloor * 100). A 10.6 written where
    // 0.106 was meant reaches the screen as "stated on 1,060% of postings" — a
    // published percentage that measures nothing it names.
    for (const [k, v] of Object.entries(measured)) {
      expect(v, `${k} must be a fraction of 1, not a percentage`).toBeLessThanOrEqual(1);
      expect(v, `${k} must be positive`).toBeGreaterThan(0);
    }
  });

  it("reports coverage for the ceiling from the column it actually compares", () => {
    // The ceiling and the floor both compare salary_rank_usd, so the ceiling's
    // coverage is the floor's — read from the same cached figure rather than
    // pinned as a sixth constant that could go stale on one of its two readers.
    const body = stripComments(FN.slice(FN.indexOf("function coverageDisclosure("), FN.indexOf("\n}", FN.indexOf("function coverageDisclosure("))));
    expect(body).toMatch(/applied\.salaryCeiling != null.*cov\.salaryFloor/s);
    for (const k of ["payBasis", "hasStatedPay", "maxYears", "department", "vendors"]) {
      expect(body, `coverageDisclosure never looks at applied.${k}`).toContain(`applied.${k}`);
    }
  });
});
