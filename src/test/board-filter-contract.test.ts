import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AppliedFilters,
  filterViolations,
  isUnfiltered,
  WIDENING_FILTERS,
  normalizeFilters,
} from "../../supabase/functions/job-board/filters.ts";

// These guards assert PROPERTIES of the filter contract, not the shape of the
// code that implements it. That distinction is the whole point: 1,010 tests were
// green while production served country=null on every row, because the test
// asserted "rowToJob emits country" — the last link of the chain — and never
// that the SELECT fetched it. It would have passed with the column absent from
// the database entirely.
const norm = (b: Record<string, unknown>) => normalizeFilters(b, 40_000);

describe("normalizeFilters — a filter is never silently ignored", () => {
  // The exact defect measured live on 2026-07-29: the gate inspected
  // `typeof body.experience === "string"`, so an ARRAY was never examined; the
  // query evaluated String(["bogus"]).split(",").filter(isExperienceBand) -> []
  // and bound no predicate. Returned bands were null 15 / entry 12 / mid 8 /
  // senior 4 / expert 1 — the unfiltered board dressed as a filtered one.
  it("reports an invalid experience band sent as an ARRAY", () => {
    const { applied, ignored } = norm({ experience: ["bogus"] });
    expect(ignored).toContain("experience");
    expect(applied.experience).toEqual([]);
  });

  it("reports a PARTIALLY invalid band list — the caller still gets senior, and still gets told", () => {
    const { applied, ignored } = norm({ experience: ["senior", "bogus"] });
    expect(applied.experience).toEqual(["senior"]);
    expect(ignored).toContain("experience");
  });

  it("accepts valid bands in both shapes clients actually send", () => {
    expect(norm({ experience: ["senior"] }).applied.experience).toEqual(["senior"]);
    expect(norm({ experience: "senior" }).applied.experience).toEqual(["senior"]);
    expect(norm({ experience: "senior,entry" }).applied.experience).toEqual(["senior", "entry"]);
    expect(norm({ experience: ["senior", "entry"] }).ignored).toEqual([]);
  });

  it("normalises casing rather than dropping the filter", () => {
    // category=Engineering is what published 587,793 over a filtered page.
    expect(norm({ category: "Engineering" }).applied.category).toBe("engineering");
    expect(norm({ workMode: "REMOTE" }).applied.workMode).toBe("remote");
    expect(norm({ country: "de" }).applied.country).toBe("DE");
    expect(norm({ category: "Engineering", workMode: "REMOTE", country: "de" }).ignored).toEqual([]);
  });

  it("names values it cannot honour", () => {
    expect(norm({ country: "USA" }).ignored).toContain("country");
    expect(norm({ category: "nonsense" }).ignored).toContain("category");
    expect(norm({ workMode: "hovering" }).ignored).toContain("workMode");
    expect(norm({ postedAfter: "not-a-date" }).ignored).toContain("postedAfter");
    expect(norm({ companies: [{ nope: 1 }] }).ignored).toContain("companies");
  });

  it("does NOT report the UI's off position as ignored", () => {
    // salaryFloor=0 and maxAgeDays=0 are how the controls say "no constraint".
    // Reporting them would hang a warning on every unfiltered page.
    expect(norm({ salaryFloor: 0 }).ignored).toEqual([]);
    expect(norm({ maxAgeDays: 0 }).ignored).toEqual([]);
    expect(norm({}).ignored).toEqual([]);
  });

  it("treats an unknown company token as a real filter matching nothing, not an error", () => {
    // A truthful empty result is the correct answer to "jobs at a company we
    // don't carry" — that is not the same as an invalid request.
    const { applied, ignored } = norm({ companies: ["not-a-real-token"] });
    expect(applied.companies).toEqual(["not-a-real-token"]);
    expect(ignored).toEqual([]);
  });

  it("clamps rather than trusts", () => {
    expect(norm({ maxAgeDays: 9999 }).applied.maxAgeDays).toBe(30);
    expect(norm({ salaryFloor: 99_999_999 }).applied.salaryFloor).toBe(2_000_000);
  });
});

describe("isUnfiltered — derived, so a new filter cannot be forgotten", () => {
  it("is true only for a request with no constraint at all", () => {
    expect(isUnfiltered(norm({}).applied)).toBe(true);
    expect(isUnfiltered(norm({ salaryFloor: 0, maxAgeDays: 0 }).applied)).toBe(true);
  });

  // The property that matters. Rather than listing the filters we know about —
  // which is exactly the hand-maintained conjunction that published the whole
  // board's total over a filtered page — set each field of a FILLED applied
  // object in turn and assert every one of them is counted. A field added to
  // AppliedTypes later is covered by this test the moment it exists, with no
  // edit here.
  it("counts EVERY field of AppliedFilters, including ones added later", () => {
    const filled: AppliedFilters = {
      q: "nurse",
      location: "Berlin",
      country: "DE",
      remote: true,
      workMode: "remote",
      employmentType: "part_time,contract",
      // Added 2026-08-06. This test exists so a NEW field is covered the moment
      // it exists — it caught this one at the typecheck, which is the design
      // working: `isUnfiltered` must treat "engineering + unsorted" as a
      // filtered request, or the board could serve the whole-corpus total over
      // a narrowed page again.
      includeUncategorised: true,
      // Added 2026-08-07: the agent-ready filter. Same catch as above — this
      // literal fails the typecheck the moment AppliedFilters gains a field,
      // and the loop below then proves isUnfiltered counts it.
      sendableOnly: true,
      category: "engineering",
      experience: ["senior"],
      salaryFloor: 100_000,
      // Added 2026-08-25: the six populated columns nothing could reach. Same
      // catch again — this literal failed `npm run typecheck` the moment
      // AppliedFilters gained them, which is the tripwire doing its job, and
      // the loop below now proves isUnfiltered counts all six.
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
      // Added 2026-08-31: the agency opt-out (charter change). The literal
      // failing the typecheck the day AppliedFilters grew is this tripwire
      // doing its job again; the loop below proves isUnfiltered counts it —
      // a request hiding disclosed inventory is NOT the bare board.
      excludeAgencies: true,
      // Added 2026-09-04: only rows the résumé scorer can read.
      hasDescription: true,
    };
    const empty = norm({}).applied as unknown as Record<string, unknown>;
    const keys = Object.keys(filled) as Array<keyof AppliedFilters>;
    expect(keys.length).toBeGreaterThanOrEqual(11);
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

describe("filterViolations — the per-request self-check", () => {
  const base = norm({}).applied;

  it("flags a row that does not satisfy the filter we said we applied", () => {
    const a = { ...base, country: "DE" };
    expect(filterViolations([{ country: "DE" }], a)).toEqual([]);
    expect(filterViolations([{ country: "FR" }], a)[0]?.field).toBe("country");
    // The regression that shipped this morning: the column stopped being
    // fetched, so every row carried undefined. A mapper-level test passed.
    expect(filterViolations([{ title: "x" }], a)[0]?.field).toBe("country");
  });

  it("flags an out-of-band experience row and an undated row under maxAgeDays", () => {
    expect(filterViolations([{ experienceBand: "entry" }], { ...base, experience: ["senior"] })[0]?.field)
      .toBe("experience");
    // maxAgeDays excludes undated postings at the database, so an undated row
    // arriving under that filter is itself the defect.
    expect(filterViolations([{ postedAt: null }], { ...base, maxAgeDays: 7 })[0]?.field).toBe("maxAgeDays");
    const fresh = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(filterViolations([{ postedAt: fresh }], { ...base, maxAgeDays: 7 })).toEqual([]);
  });

  it("does NOT flag q or location — a literal check would fail correct behaviour", () => {
    // `swe` legitimately returns "Software Engineer" via alias expansion. An
    // audit metric that looked for the literal token scored that working alias
    // 0/10 earlier today; encoding the same mistake here would make the board
    // report violations on every correct alias hit.
    expect(filterViolations([{ title: "Software Engineer" }], { ...base, q: "swe" })).toEqual([]);
    expect(filterViolations([{ location: "Remote - EU" }], { ...base, location: "Berlin" })).toEqual([]);
  });

  // THE GUARD THAT WOULD HAVE CAUGHT THE REAL BUG.
  //
  // filterViolations read `r.companyToken`. rowToJob emits `token`. So with a
  // companies filter active, every row compared undefined against the token list
  // and was flagged — every company lander page would have logged an error,
  // written a false incident, and returned filterIntegrity on a working board.
  //
  // All 26 tests here passed through that, because the fixtures used the same
  // wrong name the implementation did. A test that invents its own field names
  // proves only that the code agrees with the test. So this one does not invent
  // them: it parses the keys rowToJob ACTUALLY emits out of index.ts and requires
  // every field filterViolations reads to be one of them.
  it("only reads fields rowToJob actually emits", () => {
    const index = readFileSync(
      resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
      "utf8",
    );
    const start = index.indexOf("const rowToJob");
    expect(start, "rowToJob should exist").toBeGreaterThan(-1);
    // rowToJob's keys sit at 2 spaces, not 4 — the first version of this regex
    // assumed 4, parsed zero keys, and failed with "expected 0 to be greater
    // than 10". Worth noting: it failed LOUDLY on an empty parse rather than
    // quietly passing an empty set, which is the only reason it was a nuisance
    // and not a second silent hole. Guards that scrape source have to assert
    // they actually scraped something.
    const end = index.indexOf("\n});", start);
    const block = index.slice(start, end > start ? end : start + 3000);
    const emitted = new Set(
      [...block.matchAll(/^\s+([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]),
    );
    expect(emitted.size, "should have parsed rowToJob's keys").toBeGreaterThan(10);
    expect(emitted.has("token")).toBe(true);

    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/job-board/filters.ts"),
      "utf8",
    );
    // EXECUTABLE LINES ONLY. The first version scanned the raw slice and matched
    // its OWN comment — the line explaining why there is no `r.companyToken`
    // fallback contains `r.companyToken`. That is the fourth guard this session
    // to fail on its own explanation; scoping is the fix, every time.
    const fnStart = src.indexOf("export function filterViolations");
    const body = src.slice(fnStart)
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    const read = new Set(
      [...body.matchAll(/\br\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]),
    );
    // Number helpers reached through `Number.` land in the same regex; drop them.
    const fields = [...read].filter((f) => !["isFinite", "isNaN"].includes(f));
    const unknown = fields.filter((f) => !emitted.has(f));
    expect(
      unknown,
      `filterViolations reads field(s) rowToJob never emits: ${unknown.join(", ")} — ` +
        `every row would be flagged whenever that filter is active`,
    ).toEqual([]);
  });

  it("flags a company mismatch using the real field name", () => {
    const a = { ...base, companies: ["gsknch~wd3~GSKCareers"] };
    expect(filterViolations([{ token: "gsknch~wd3~GSKCareers" }], a)).toEqual([]);
    expect(filterViolations([{ token: "someone-else" }], a)[0]?.field).toBe("companies");
    // The bug: with the wrong key this row read undefined and was flagged.
    expect(filterViolations([{ token: "gsknch~wd3~GSKCareers", companyToken: undefined }], a)).toEqual([]);
  });

  it("is silent on a clean page", () => {
    const a = { ...base, country: "DE", category: "engineering", remote: true };
    const rows = Array.from({ length: 60 }, () => ({ country: "DE", category: "engineering", remote: true }));
    expect(filterViolations(rows, a)).toEqual([]);
  });
});

describe("structural: the list action has ONE filter derivation", () => {
  const index = readFileSync(
    resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
    "utf8",
  );
  const code = index
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

  // The guard that actually prevents this bug class returning. Every filter
  // defect this board has shipped was two sites computing the same filter
  // differently; there were FIVE such sites before filters.ts. Re-deriving a
  // filter from the raw body inside the list action is how the next one starts.
  it("never re-derives a filter from the raw request body", () => {
    const offenders = [
      "body.country",
      "body.category",
      "body.experience",
      "body.workMode",
      "body.salaryFloor",
      "body.companies",
      "body.maxAgeDays",
      "body.postedAfter",
    ].filter((p) => code.includes(p));
    expect(offenders, `re-derived from the raw body instead of \`applied\`: ${offenders.join(", ")}`)
      .toEqual([]);
  });

  it("wires the normaliser and the self-check into the response", () => {
    expect(code).toContain("normalizeFilters(body");
    expect(code).toContain("isUnfiltered(applied)");
    expect(code).toContain("filterIntegrity");
  });

  // The self-check used to be inline at the recency path's return, so the three
  // EARLIER exits — ranked search, the fuzzy rescue, semantic — returned before
  // it and carried neither ignoredFilters nor filterIntegrity. Search is the
  // board's busiest surface, so the guarantee held on the path users take least.
  // Property: every exit that returns jobs also returns the honesty fields.
  it("every list exit that returns jobs carries the honesty fields", () => {
    expect(code).toContain("const honesty = (jobs:");
    expect(code).toContain("filterViolations(jobs, applied)");
    const exits = (code.match(/\.\.\.honesty\(/g) ?? []).length;
    expect(exits, "ranked, fuzzy, semantic and recency must all call it").toBeGreaterThanOrEqual(4);
  });
});

describe("the self-check has an alarm, not just a sensor", () => {
  const index = readFileSync(
    resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
    "utf8",
  );
  const code = index
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

  // The property, not the plumbing: BOTH outcomes must be recorded. If only
  // violations were written, "no incidents" and "the check stopped running"
  // would be indistinguishable — and this board has already shipped a
  // diagnostic whose delivery depended on the very thing it diagnosed, which
  // reported nothing at all.
  it("records clean checks as well as violations, so silence is not ambiguous", () => {
    expect(code).toContain("filter_integrity_ok");
    expect(code).toContain("filter_integrity_incident");
  });

  it("publishes proof-of-life through status, which anon can actually read", () => {
    // job_board_meta returns 42501 to anon, so a sensor that only writes there
    // is invisible in exactly the situation it exists for.
    expect(code).toContain("filterContract");
    expect(code).toContain("okAgeMin");
    expect(code).toContain('eq("k", "filter_integrity_ok")');
  });

  it("never treats a missing clean-check record as healthy", () => {
    // "unverified" and "fine" are different claims; the payload must not
    // collapse them.
    expect(index).toMatch(/never recorded a clean page/);
  });
});

describe("the scheduled filter audit", () => {
  const index = readFileSync(
    resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
    "utf8",
  );
  const code = index
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

  it("exists, is maintenance-gated, and self-schedules", () => {
    expect(code).toContain('action === "filter-audit"');
    expect(code).toContain("filter-audit is a maintenance action");
    // chainKey is derived inside the function, so a pg_cron row cannot make one
    // — the audit rides the sweep-kick path that is already proven to fire.
    expect(code).toContain('action: "filter-audit", chainKey: key');
  });

  it("shares the live self-check's predicate instead of reimplementing it", () => {
    // An audit that rebuilt the filter logic would agree with itself and prove
    // nothing — the same error as a mapper test passing while the column is
    // absent from the database.
    const audit = code.slice(code.indexOf('action === "filter-audit"'), code.indexOf('action === "recategorize"'));
    expect(audit).toContain("filterViolations(jobs, ap)");
    expect(audit).toContain("normalizeFilters(c.body");
    // It must ask the real endpoint, not a private copy of the query.
    expect(audit).toContain("functions/v1/job-board");
    expect(audit).toContain('action: "list"');
  });

  it("uses exact counts for recall, never estimated", () => {
    // PostgREST's estimate returned a fabricated uniform 22.1% on this table
    // where exact showed 100%. A recall check built on it would invent
    // disagreements rather than detect them.
    const audit = code.slice(code.indexOf('action === "filter-audit"'), code.indexOf('action === "recategorize"'));
    expect(audit).toContain('count: "exact"');
    expect(audit).not.toContain("estimated");
  });

  it("covers the shapes that actually broke, including the array form", () => {
    const audit = code.slice(code.indexOf('action === "filter-audit"'), code.indexOf('action === "recategorize"'));
    expect(audit).toContain('experience: ["bogus"]');       // silent-drop breach
    expect(audit).toContain('experience: ["senior", "bogus"]'); // partial drop
    expect(audit).toContain('category: "Design"');           // casing
    expect(audit).toContain("duplicate-rows");               // paging integrity
    expect(audit).toContain("nonsense-padded");              // must stay empty
  });
});

describe("typo tolerance fires below a useful threshold", () => {
  const index = readFileSync(
    resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
    "utf8",
  );

  // The machinery was never broken; the boundary was. It read `total < 5`, and
  // "nurse practicioner" returns EXACTLY 5 against 1,771 for the correct
  // spelling — five is not less than five, so the rescue never ran. Guarding the
  // property (a page with room gets close matches) rather than the literal
  // number, but the old boundary specifically must not come back.
  it("does not gate the fuzzy augmentation at the old boundary", () => {
    expect(index).not.toMatch(/total < 5 &&/);
  });

  it("gates it high enough that a nearly-empty page is rescued", () => {
    const m = index.match(/const FUZZY_AUGMENT_BELOW = (\d+);/);
    expect(m, "FUZZY_AUGMENT_BELOW should exist and be a literal").toBeTruthy();
    const n = Number(m![1]);
    // Above the measured failure (5) and below a full page (60) — padding a
    // genuinely useful result set would dilute it.
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThanOrEqual(30);
    // The WHOLE page, not the exact segment. Under two segments a query with 2
    // exact and 300 related matches already has a full page, and padding it
    // would dilute a result set that needs no rescuing.
    expect(index).toContain("pageTotal < FUZZY_AUGMENT_BELOW");
  });

  it("cannot surface another company's jobs under a filter — now by binding, not by refusing", () => {
    // The original rule was "stand down whenever a filter is active", and the
    // reason was real: a typo'd query on a company lander must not pad the page
    // with other companies' jobs. But the reason was a LIMITATION, not a
    // principle — the rescue RPC took no filter arguments, so refusing to run
    // was the only honest option available.
    //
    // It takes them now. The augmentation binds the caller's filters into the
    // call, so a company lander asks for close matches AT THAT COMPANY and gets
    // them. Refusing outright was costing every filtered typo search a page it
    // could have had: measured live, one mistyped letter plus any filter
    // returned zero rows and no disclosure.
    const gate = /pageTotal < FUZZY_AUGMENT_BELOW[\s\S]{0,1400}?rescueFilterParams\(\)/;
    expect(gate.test(index),
      "the augmentation must bind the caller's filters into the rescue call").toBe(true);
    // And the fence must not creep back in front of it.
    const blk = /const FUZZY_AUGMENT_BELOW = 20;[\s\S]{0,700}/.exec(index)?.[0] ?? "";
    expect(blk, "the augmentation block is missing").not.toBe("");
    expect(/!filtersActive/.test(blk),
      "it binds the filters now; refusing to run as well would just be the old bug").toBe(false);
  });
});

describe("location is not silently rewritten, and remote precedence is decided once", () => {
  const index = readFileSync(
    resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
    "utf8",
  );

  // Measured live 2026-07-29 on BUILD .9, before the fix:
  //   "San Francisco, CA"   38 served / 2,978 real   (1.3%)
  //   "New York, NY"        18 served / 3,070 real   (0.6%)
  //   "Berlin, Germany"      1 served /   438 real   (0.2%)
  // sanitizeTerm stripped the comma, so the board answered a question the user
  // had not asked and reported a confident total for it. "City, ST" is the
  // format the board prints on every card and the NL parser emits.
  it("sanitizeTerm strips ONLY ILIKE metacharacters", () => {
    // The definition moved to _shared/location-terms.ts on 2026-09-03 so /v1 can share it.
    const shared = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/location-terms.ts"), "utf8");
    const m = shared.match(/const sanitizeTerm = \(t: string\) => t\.replace\(([^,]+), ""\)/);
    expect(m, "sanitizeTerm should still exist").toBeTruthy();
    const cls = m![1];
    // A comma or paren in a bound term is a literal character, never a wildcard.
    expect(cls, "must not strip commas — that rewrites the user's location").not.toContain(",");
    expect(cls, "must not strip parens — 1,027 live rows carry a parenthesised location").not.toContain("(");
    // % _ and \ DO carry meaning to ILIKE and must still go.
    expect(cls).toContain("%");
    expect(cls).toContain("_");
  });

  it("remote-vs-workMode precedence is decided in the normaliser, not at the query", () => {
    // Deciding it at buildQuery alone gave three consumers three different
    // questions: rows dropped `remote`, the count RPCs bound it, and the
    // self-check flagged the rows for violating it. Live on .9,
    // {remote:true, workMode:"hybrid"} returned 60 hybrid rows under a total of 36.
    expect(normalizeFilters({ remote: true, workMode: "hybrid" }, 1).applied.remote).toBe(false);
    expect(normalizeFilters({ remote: true, workMode: "onsite" }, 1).applied.remote).toBe(false);
    expect(normalizeFilters({ remote: true }, 1).applied.remote).toBe(true);
    // ...and the query must now be a plain read of that decision.
    expect(index).not.toMatch(/applied\.remote && !applied\.workMode/);
  });

  it("a remote-only request still constrains the board", () => {
    expect(isUnfiltered(normalizeFilters({ remote: true }, 1).applied)).toBe(false);
    // remote+hybrid still filtered — by the work mode.
    expect(isUnfiltered(normalizeFilters({ remote: true, workMode: "hybrid" }, 1).applied)).toBe(false);
  });

  it("the self-check no longer flags rows for the dropped remote filter", () => {
    const a = normalizeFilters({ remote: true, workMode: "hybrid" }, 1).applied;
    const rows = Array.from({ length: 60 }, () => ({ workMode: "hybrid", remote: false }));
    expect(filterViolations(rows, a)).toEqual([]);
  });
});

describe("the countOnly exit is not exempt from the honesty contract", () => {
  const index = readFileSync(
    resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
    "utf8",
  );
  const code = index.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  // Found by verifying the .10 deploy, not by any test. I wired the honesty
  // helper into four exits and missed the fifth: countOnly returned {total} and
  // nothing else. Live on .10, {remote:"true"} named the dropped filter on the
  // list path and said nothing on this one — so the caller most likely to be a
  // machine (countOnly serves the relaxation buttons and the data API) was the
  // one least likely to be told a filter had been dropped. A response that is
  // ONLY a number needs the caveat more than one that ships rows, not less.
  it("every countOnly return carries ignoredFilters", () => {
    // Brace-matched, not anchored on a following marker. The first version
    // sliced to `const buildQuery`, which is defined BEFORE this block — so
    // indexOf returned -1 and the segment ran to the end of the file. It still
    // caught the real gap, by luck rather than design: my patch regex could not
    // match the two returns whose nested `...(cond ? {} : {})` spreads contain
    // braces, so 3 of 5 carried the fields. Getting the boundary right matters
    // for what this guard reports NEXT time.
    const start = code.indexOf("if (countOnly) {");
    expect(start).toBeGreaterThan(-1);
    let depth = 0, end = start;
    for (let i = start; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) { end = i + 1; break; }
    }
    expect(end, "should have found the closing brace").toBeGreaterThan(start);
    const seg = code.slice(start, end);
    // COUNT EVERY RETURN, not the ones that happen to fit on one line. The
    // two-segment count exit is a multi-line literal, and the old pattern could
    // not see it — so the file could grow a countOnly return that names no
    // dropped filter while this guard reported a tidy balance.
    const returns = seg.match(/return json\(\{/g) ?? [];
    expect(returns.length, "countOnly should have several return sites").toBeGreaterThan(1);
    const carried = seg.match(/\.\.\.countHonesty/g) ?? [];
    expect(carried.length, `${returns.length} countOnly returns, ${carried.length} carry ignoredFilters`)
      .toBe(returns.length);
  });

  it("an augmented page does not publish a total it has just called unknown", () => {
    // rows=60 alongside total=18 AND countUnavailable:true, verified live on .10.
    // The frontend reads countUnavailable first so a user saw no total, but the
    // payload contradicted itself for anyone reading `total`.
    // Strengthened 2026-08-24: the same suppression now also fires when the
    // page holds more rows than the count claims (q=camarero published a total
    // of 3 above 60 delivered rows, 57 of them "Camarero/a"). The invariant
    // this test defends — an augmented page never publishes a total — is
    // unchanged; the condition it rides on simply widened.
    expect(code).toMatch(/total: augmented \|\| totalUnderstated \? null : total/);
  });
});

describe("a category lander may publish its OWN count, never the whole facet", () => {
  // index.ts PLUS clusters.ts: the page-shaping functions these assertions pin
// (visibleCategories, interleaveByCompany, collapseClusters) moved to a pure
// module on 2026-08-23 so they could be walked by tests instead of grepped.
// The properties are about the functions wherever they live.
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8")
  + readFileSync(resolve(__dirname, "../../supabase/functions/job-board/clusters.ts"), "utf8");

  it("withholds the board-wide facet on any filtered view", () => {
    // The original rule, and it stays: board-wide category counts rendered
    // inside a filtered view overstated by 15.7x to 45x.
    const fn = /function visibleCategories\([\s\S]*?\n\}/.exec(FN)?.[0] ?? "";
    expect(fn, "visibleCategories not found").not.toBe("");
    expect(fn.includes("if (unfiltered) return facet ?? {};")).toBe(true);
    expect(
      /if \(!activeCategory \|\| !facet\) return undefined;/.test(fn),
      "a filtered view with no active category must publish NOTHING",
    ).toBe(true);
  });

  it("publishes exactly one entry — the category being filtered", () => {
    // Scoped to what the reader actually filtered, so it cannot overstate.
    // This is what lets /jobs/field/engineering show 68,347 instead of the
    // capped "10,000+" it fell back to, under a Google snippet promising the
    // real number.
    const fn = /function visibleCategories\([\s\S]*?\n\}/.exec(FN)?.[0] ?? "";
    expect(/\{ \[activeCategory\]: n \}/.test(fn), "must return a single-key object").toBe(true);
    expect(
      fn.includes("typeof n === \"number\""),
      "a missing count must yield undefined, never 0 — zero would render as " +
        "'0 live openings' on a page that has thousands",
    ).toBe(true);
  });

  it("routes every response site through the helper", () => {
    // Four sites emit `categories`. One left on the old ternary would make the
    // lander's number depend on which internal path served it.
    expect(
      FN.includes("categories: unfiltered ?"),
      "a response site still uses the old unfiltered-ternary instead of visibleCategories",
    ).toBe(false);
    const uses = (FN.match(/categories: visibleCategories\(/g) ?? []).length;
    expect(uses, "expected every categories site to use the helper").toBeGreaterThanOrEqual(4);
  });
});
