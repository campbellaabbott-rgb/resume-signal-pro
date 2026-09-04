import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "PART-TIME HOURLY NURSING JOBS UNDER 3 YEARS EXPERIENCE THAT STATE PAY"
 * reached the board as {q: "nursing jobs", category: "healthcare"}.
 *
 * Four of the five clauses were deleted in transit, and nothing on screen said
 * so. Not because the board cannot filter on any of them — it binds every one:
 * employment type, pay basis, a years ceiling, a stated-pay flag. Because
 * nl-search described the board to the model with a list of ELEVEN filters
 * while job-board/filters.ts reads TWENTY-THREE wire params, and a filter the
 * prompt never names is a filter the model cannot ask for, the schema has no
 * slot for, and the validator would have thrown away if it had.
 *
 * THREE LISTS THAT MUST AGREE IS NOT A THING TO TEST FOR. It is a thing to stop
 * having: the prompt line, the schema property and the validation rule for
 * every filter now come from one entry of NL_FILTERS, and this file's job is to
 * hold that table against the board's own — so that a filter added to
 * filters.ts fails here until somebody decides whether the parser emits it or
 * declines it with a reason.
 *
 * The assertions CALL validateParse rather than grepping for it wherever there
 * is a surface to call; the source assertions that remain read COMMENT-STRIPPED
 * text, because a guard literal written into a comment has passed while the
 * code was dead five times in this repo.
 */
import {
  CAPS,
  CATEGORIES,
  EMPLOYMENT_TYPES,
  EXPERIENCE,
  FILTER_LIST,
  NL_DECLINED,
  NL_FILTERS,
  PAY_BASES,
  SYSTEM_PROMPT,
  TOOL_PARAMETERS,
  VENDORS,
  WORK_MODES,
  validateParse,
} from "../../supabase/functions/nl-search/parse.ts";
import {
  BOARD_VENDORS,
  EMPLOYMENT_TYPES as BOARD_EMPLOYMENT_TYPES,
  PAY_BASES as BOARD_PAY_BASES,
  WORK_MODES as BOARD_WORK_MODES,
} from "../../supabase/functions/job-board/filters.ts";
import { JOB_CATEGORIES } from "../../supabase/functions/job-board/categories.ts";
import { EXPERIENCE_BANDS } from "../../supabase/functions/job-board/experience.ts";

const root = resolve(__dirname, "../..");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const FILTERS_CODE = strip(read("supabase/functions/job-board/filters.ts"));
const PARSE_CODE = strip(read("supabase/functions/nl-search/parse.ts"));
const INDEX_CODE = strip(read("supabase/functions/nl-search/index.ts"));
const JOBS_CODE = strip(read("src/pages/Jobs.tsx"));

/** Every wire param the board's normalisation actually reads, pulled out of its
 *  code rather than re-listed here. This is the list the parser is measured
 *  against, and it grows the moment filters.ts grows. */
const BOARD_WIRE_PARAMS = [
  ...new Set([...FILTERS_CODE.matchAll(/\bbody\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1])),
].sort();

const NL_KEYS = NL_FILTERS.map((f) => f.key);

/**
 * Filters the parser emits that are NOT normalizeFilters params: board CONTROLS
 * the page applies itself. Listed so the parity assertion below cannot be
 * satisfied by quietly adding an unknown key to this side.
 */
const BOARD_CONTROLS = ["activelyHiring"];

/** The applyNlSearch block, stripped — every "does the page do X with the
 *  parse" assertion reads this and only this. */
const NL_BLOCK = JOBS_CODE.slice(
  JOBS_CODE.indexOf("const applyNlSearch = useCallback("),
  JOBS_CODE.indexOf("const [companyQuery, setCompanyQuery]"),
);

describe("the parser's vocabulary is the board's vocabulary", () => {
  it("every value domain is the board's own list, member for member", () => {
    // Copied rather than imported (nl-search must not pull filters.ts's
    // 2.6MB sources.ts reach into its bundle), so the copy is pinned here in
    // BOTH directions — a vendor added to the board fails this until the parser
    // learns to say it, and a value invented here fails it too.
    expect([...CATEGORIES]).toEqual([...JOB_CATEGORIES]);
    expect([...EXPERIENCE]).toEqual([...EXPERIENCE_BANDS]);
    expect([...WORK_MODES]).toEqual([...BOARD_WORK_MODES]);
    expect([...EMPLOYMENT_TYPES]).toEqual([...BOARD_EMPLOYMENT_TYPES]);
    expect([...PAY_BASES]).toEqual([...BOARD_PAY_BASES]);
    expect([...VENDORS]).toEqual([...BOARD_VENDORS]);
  });

  it("the caps are the board's caps, not round numbers", () => {
    // The board TRUNCATES an over-long list and reports the truncation in
    // ignoredFilters. A parser that over-reaches therefore produces a visible
    // "we couldn't do that" on the reader's screen for something the reader
    // never asked for, so the cap has to be the same number on both sides.
    const capOf = (name: string) => {
      const m = new RegExp(`const ${name} = (\\d+);`).exec(FILTERS_CODE);
      expect(m, `${name} is no longer declared in filters.ts`).not.toBeNull();
      return Number(m![1]);
    };
    expect(CAPS.category).toBe(capOf("CATEGORY_LIMIT"));
    expect(CAPS.country).toBe(capOf("COUNTRY_LIMIT"));
    expect(CAPS.vendor).toBe(capOf("VENDOR_LIMIT"));
    expect(CAPS.experience).toBe(EXPERIENCE_BANDS.length);
    expect(CAPS.workMode).toBe(BOARD_WORK_MODES.length);
    expect(CAPS.employmentType).toBe(BOARD_EMPLOYMENT_TYPES.length);
  });

  it("emitted plus declined is EXACTLY what the board reads off a request body", () => {
    // THE TRIPWIRE. Not "the parser knows about these eight" — a set equality
    // against the params filters.ts actually reads, so the day the board grows
    // a filter this fails until it is either spoken or refused on the record.
    // "Nobody thought about it" stops being a reachable state.
    const accountedFor = [
      ...new Set([...NL_KEYS.filter((k) => !BOARD_CONTROLS.includes(k)), ...Object.keys(NL_DECLINED)]),
    ].sort();
    expect(accountedFor).toEqual(BOARD_WIRE_PARAMS);
  });

  it("a board CONTROL is only exempt while it really is not a filter param", () => {
    for (const k of BOARD_CONTROLS) {
      expect(BOARD_WIRE_PARAMS, `${k} is a real filter param now — take it out of the exempt list`)
        .not.toContain(k);
      // And it must be a control the page genuinely applies, or the exemption
      // is hiding a filter that goes nowhere.
      expect(NL_BLOCK, `${k} is exempted as a page control but the page never reads it`)
        .toContain(`f.${k}`);
    }
  });

  it("every declined filter carries its reason, and none of them can be emitted", () => {
    for (const [k, why] of Object.entries(NL_DECLINED)) {
      expect(String(why).trim().length, `${k} is declined with no reason`).toBeGreaterThan(20);
      expect(NL_KEYS, `${k} is both emitted and declined`).not.toContain(k);
    }
    // The two RECORDED decisions, pinned by name. The category widener has
    // never been emitted and must not start: a parse may narrow, never widen,
    // and a stale "+ unsorted" reactivating under an interpretation that does
    // not mention it is what the page's reset block exists for. Same for the
    // pay widener beside it.
    expect(Object.keys(NL_DECLINED)).toContain("includeUncategorised");
    expect(Object.keys(NL_DECLINED)).toContain("includeUnstatedPay");
  });
});

describe("the prompt, the schema and the validator cannot disagree", () => {
  it("all three are DERIVED from one table, not written out three times", () => {
    // Read stripped, so a comment describing the derivation cannot stand in for
    // performing it.
    expect(PARSE_CODE).toMatch(/export const FILTER_LIST = NL_FILTERS\.map\(/);
    expect(PARSE_CODE).toMatch(/\$\{FILTER_LIST\}/);
    expect(PARSE_CODE).toMatch(/Object\.fromEntries\(NL_FILTERS\.map\(/);
    expect(PARSE_CODE).toMatch(/for \(const f of NL_FILTERS\)/);
    // One entry per filter — a second entry for the same key would let the
    // prompt and the validator describe it differently.
    for (const k of NL_KEYS) {
      const hits = (PARSE_CODE.match(new RegExp(`key: "${k}",`, "g")) ?? []).length;
      expect(hits, `${k} has ${hits} entries in NL_FILTERS`).toBe(1);
    }
  });

  it("the prompt names every filter, once, and nothing else", () => {
    // The "EXACTLY these filters" block only — the RULES paragraph below it
    // also opens a line with "- interpreted:", which is a disclosure array and
    // not a filter the model may set.
    const lines = [...FILTER_LIST.matchAll(/^- ([A-Za-z]+): /gm)].map((m) => m[1]);
    expect(lines).toEqual(NL_KEYS);
    expect(SYSTEM_PROMPT, "the prompt no longer carries the derived list").toContain(FILTER_LIST);
  });

  it("the prompt states the exact spellings, so an unknown value is the model's fault and not ours", () => {
    // Every closed domain has to be IN the prompt: the tool schema carries no
    // `enum` (some gateways reject it), so the prompt is the only place the
    // model is told what "part_time" is spelled like, and the validator is the
    // only place a miss is caught.
    for (const v of [...CATEGORIES, ...EXPERIENCE, ...WORK_MODES, ...EMPLOYMENT_TYPES, ...PAY_BASES, ...VENDORS]) {
      expect(SYSTEM_PROMPT, `the prompt never spells ${v}`).toContain(v);
    }
  });

  it("the schema has one property per filter, plus the two disclosure arrays", () => {
    expect(Object.keys(TOOL_PARAMETERS.properties)).toEqual([...NL_KEYS, "interpreted", "notMapped"]);
    for (const f of NL_FILTERS) {
      const p = (TOOL_PARAMETERS.properties as Record<string, { type: string; description: string }>)[f.key];
      expect(p.type, `${f.key} has no schema type`).toMatch(/^(string|number|boolean)$/);
      expect(p.description.trim().length, `${f.key} has an empty schema description`).toBeGreaterThan(0);
    }
  });

  it("the validator can only ever produce keys the table carries", () => {
    // Fed EVERY key at once plus junk the model has no business sending. The
    // validator iterates the table, never the payload, so an off-contract key
    // cannot reach the client no matter what the gateway returns.
    const everything: Record<string, unknown> = {
      ...Object.fromEntries(NL_FILTERS.map((f) => [
        f.key,
        f.type === "boolean" ? true : f.type === "number" ? 1 : plausible(f.key),
      ])),
      ...Object.fromEntries(Object.keys(NL_DECLINED).map((k) => [k, true])),
      sendableOnly: true,
      companies: ["acme"],
      postedAfter: "2026-08-01",
      dropTable: "students",
      interpreted: ["x"],
    };
    const { filters } = validateParse(everything);
    expect(Object.keys(filters).sort()).toEqual([...NL_KEYS].sort());
  });

  it("index.ts uses the derived contract and holds no second copy of it", () => {
    expect(INDEX_CODE).toMatch(/import \{ SYSTEM_PROMPT, TOOL_PARAMETERS, validateParse \} from "\.\/parse\.ts"/);
    expect(INDEX_CODE).toMatch(/content: SYSTEM_PROMPT/);
    expect(INDEX_CODE).toMatch(/parameters: TOOL_PARAMETERS/);
    expect(INDEX_CODE).toMatch(/validateParse\(parsed\)/);
    // The three hand-maintained lists this replaced. A re-inlined one here is
    // the defect returning, and it would be invisible: the function would still
    // work, just on a shorter vocabulary than the board's.
    expect(INDEX_CODE, "a filter list has been re-inlined into index.ts").not.toMatch(/const CATEGORIES = \[/);
    expect(INDEX_CODE, "a validator has been re-inlined into index.ts").not.toMatch(/filters\.[A-Za-z]+ = /);
    expect(INDEX_CODE, "a tool schema has been re-inlined into index.ts").not.toMatch(/properties: \{/);
  });
});

/** A value the model would plausibly return for a string-typed filter. */
function plausible(key: string): string {
  if (key === "category") return "healthcare";
  if (key === "experience") return "senior";
  if (key === "workMode") return "remote";
  if (key === "employmentType") return "part_time";
  if (key === "payBasis") return "hourly";
  if (key === "country") return "US";
  if (key === "vendor") return "greenhouse";
  if (key === "sort") return "salary";
  return "nurse";
}

describe("what a real sentence turns into", () => {
  // The tool arguments a model plausibly returns for each sentence, and what
  // the board must end up being asked. The point of the table is the SECOND
  // column: it is the board's wire names, spellings and shapes, so a change
  // that quietly renames or re-shapes one shows up as a filter the board would
  // ignore rather than as a passing unit test.
  const CASES: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    [
      "part-time hourly nursing jobs under 3 years experience that state pay",
      { q: "nursing", category: "Healthcare", employmentType: "Part-Time", payBasis: "Hourly", maxYears: 3, hasStatedPay: true },
      { q: "nursing", category: "healthcare", employmentType: "part_time", payBasis: "hourly", maxYears: 3, hasStatedPay: true },
    ],
    [
      "remote or hybrid product manager roles in Germany posted in the last fortnight, 150k+",
      { q: "product manager", category: "product", workMode: "remote, hybrid", remote: true, country: "de", maxAgeDays: 14, salaryFloor: 150000 },
      { q: "product manager", category: "product", workMode: "remote,hybrid", remote: true, country: "DE", maxAgeDays: 14, salaryFloor: 150000 },
    ],
    [
      "entry level design jobs on greenhouse or lever, no staffing agencies",
      { q: "design", category: "design", experience: "entry", vendor: "greenhouse,lever", excludeAgencies: true },
      { q: "design", category: "design", experience: "entry", vendor: "greenhouse,lever", excludeAgencies: true },
    ],
    [
      "warehouse jobs paying between 40k and 60k in the logistics department, newest first",
      { q: "warehouse", salaryFloor: 40000, salaryCeiling: 60000, department: "Logistics", sort: "newest" },
      { q: "warehouse", salaryFloor: 40000, salaryCeiling: 60000, department: "Logistics", sort: "newest" },
    ],
    [
      "internships at companies that actually hire, posted today",
      { q: "internship", employmentType: "internship", activelyHiring: true, maxAgeDays: 1 },
      { q: "internship", employmentType: "internship", activelyHiring: true, maxAgeDays: 1 },
    ],
  ];

  for (const [sentence, model, want] of CASES) {
    it(`"${sentence}"`, () => {
      const { filters, dropped } = validateParse({ ...model, interpreted: ["chip"] });
      expect(filters).toEqual(want);
      expect(dropped, "a clean parse must refuse nothing").toEqual([]);
    });
  }

  it("the residual keywords never repeat a clause the filters already carry", () => {
    // q is ANDed against the posting TITLE, so "part time nurse" alongside
    // employmentType=part_time returns almost nothing — the same failure
    // salaryFromQueryText exists to undo for "100k engineer". The prompt has to
    // say so, in the q line itself.
    const qLine = /^- q: .*/m.exec(SYSTEM_PROMPT)?.[0] ?? "";
    expect(qLine).toMatch(/NOTHING you expressed as a filter/);
    expect(qLine).toMatch(/TITLE/);
  });
});

describe("a value the validator does not know is dropped and named", () => {
  it("an invented enum member never reaches the board", () => {
    const { filters, dropped } = validateParse({
      category: "nursing",
      vendor: "indeed",
      employmentType: "gig",
      payBasis: "per hour",
      workMode: "wfh",
      experience: "principal",
      sort: "relevance",
      country: "United Kingdom",
    });
    expect(filters).toEqual({});
    expect(dropped.sort()).toEqual(
      ["category", "country", "employmentType", "experience", "payBasis", "sort", "vendor", "workMode"],
    );
  });

  it("a half-valid list keeps the good members and still reports the refusal only when nothing binds", () => {
    // The board's rule: unknown members cannot match a posting and are dropped;
    // a request whose members are ALL unusable is the one that gets named.
    expect(validateParse({ vendor: "greenhouse,indeed,lever" }).filters).toEqual({ vendor: "greenhouse,lever" });
    expect(validateParse({ vendor: "indeed,ziprecruiter" }).dropped).toEqual(["vendor"]);
  });

  it("numerics are refused outside the board's range, never clamped into one", () => {
    // maxYears is 1..20 and WHOLE, both of them filters.ts's rules: clamping 99
    // to 20 invents a narrowing nobody asked for, and min_years is a SMALLINT,
    // so a 3.5 is not a finer filter — it is a 22P02 that 400s the list query.
    expect(validateParse({ maxYears: 3.5 }).dropped).toEqual(["maxYears"]);
    expect(validateParse({ maxYears: 99 }).dropped).toEqual(["maxYears"]);
    expect(validateParse({ maxYears: 20 }).filters).toEqual({ maxYears: 20 });
    // The date window is the API's whole 1..30, and out-of-range is refused
    // rather than silently narrowed to a week.
    expect(validateParse({ maxAgeDays: 14 }).filters).toEqual({ maxAgeDays: 14 });
    expect(validateParse({ maxAgeDays: 90 }).dropped).toEqual(["maxAgeDays"]);
    expect(validateParse({ salaryFloor: 9_000_000 }).filters).toEqual({ salaryFloor: 2_000_000 });
  });

  it("a pay band that closes below its own floor is refused HERE, not by the board", () => {
    // Forwarded, the board refuses it too — and names salaryCeiling in
    // ignoredFilters, which tells the reader the BOARD declined a filter when
    // what actually happened is that the parse contradicted itself.
    const { filters, dropped } = validateParse({ q: "nurse", salaryFloor: 150_000, salaryCeiling: 60_000 });
    expect(filters).toEqual({ q: "nurse", salaryFloor: 150_000 });
    expect(dropped).toEqual(["salaryCeiling"]);
    // The right way round still binds both ends.
    expect(validateParse({ salaryFloor: 60_000, salaryCeiling: 150_000 }).filters)
      .toEqual({ salaryFloor: 60_000, salaryCeiling: 150_000 });
  });

  it("a control at rest is not a refusal", () => {
    // 0 and false are the off positions on this board, for numerics and
    // booleans alike. Reporting them would hang a "we couldn't do that" on
    // every filter the sentence never mentioned.
    const { filters, dropped } = validateParse({
      q: "", remote: false, excludeAgencies: false, hasStatedPay: false,
      salaryFloor: 0, salaryCeiling: 0, maxYears: 0, maxAgeDays: 0, category: "", vendor: [],
    });
    expect(filters).toEqual({});
    expect(dropped).toEqual([]);
  });

  it("a department is stripped of the wildcards its predicate would honour", () => {
    // department binds ILIKE '%s%'. A surviving % makes a prefix match nobody
    // asked for and _ matches any single character — filters.ts strips exactly
    // this set, and a value that arrives already stripped cannot surprise it.
    expect(validateParse({ department: '  eng%_\\|"ineering  ' }).filters).toEqual({ department: "engineering" });
    expect(validateParse({ department: "%%%" }).dropped).toEqual(["department"]);
    expect(validateParse({ department: { evil: 1 } }).dropped).toEqual(["department"]);
  });

  it("a one-element array from the gateway is not a lost filter", () => {
    // String-typed tool parameters come back as arrays often enough that
    // refusing the shape would drop real filters for a JSON habit.
    expect(validateParse({ workMode: ["remote"], category: ["healthcare"], country: ["us", "ca"] }).filters)
      .toEqual({ workMode: "remote", category: "healthcare", country: "US,CA" });
  });

  it("an over-long list is cut to the board's cap here, where it can be seen", () => {
    const many = validateParse({
      category: [...JOB_CATEGORIES].slice(0, 6).join(","),
      country: "US,GB,CA,DE,FR,NL,IE",
      vendor: [...BOARD_VENDORS].join(","),
    }).filters;
    expect(String(many.category).split(",")).toHaveLength(CAPS.category);
    expect(String(many.country).split(",")).toHaveLength(CAPS.country);
    expect(String(many.vendor).split(",")).toHaveLength(CAPS.vendor);
  });
});

describe("the board can still show what was understood", () => {
  it("the response names every applied filter by the board's own wire name", () => {
    const { applied, filters } = validateParse({
      q: "nurse", employmentType: "part_time", payBasis: "hourly", hasStatedPay: true, maxYears: 3,
    });
    expect(applied).toEqual(Object.keys(filters));
    expect(applied).toContain("employmentType");
    // Named as the BOARD spells it, not as the page's state does — `hasStatedPay`
    // for the box labelled "States pay", `vendor` singular. A page-side spelling
    // here is a filter the server silently ignores.
    expect(applied).toContain("hasStatedPay");
  });

  it("the two disclosure arrays the page renders today still arrive", () => {
    const r = validateParse({
      q: "x",
      interpreted: ["Remote", "", "Part-time", 7, "$150k+"],
      notMapped: ["startups", "no degree"],
    });
    expect(r.interpreted).toEqual(["Remote", "Part-time", "$150k+"]);
    expect(r.notMapped).toEqual(["startups", "no degree"]);
    // And the page still reads both — this is the line that says "Read as: …"
    // and "Couldn't filter by: …".
    expect(NL_BLOCK).toContain("d.interpreted");
    expect(NL_BLOCK).toContain("d.notMapped");
    expect(JOBS_CODE).toContain("jobsPage.nlInterpreted");
    expect(JOBS_CODE).toContain("jobsPage.nlNotMapped");
  });

  it("chips are capped where the prompt promises they are", () => {
    expect(validateParse({ interpreted: Array(20).fill("chip") }).interpreted).toHaveLength(6);
    expect(validateParse({ notMapped: Array(20).fill("thing") }).notMapped).toHaveLength(4);
  });
});

describe("no filter survives an interpreted search unmentioned", () => {
  it("every emitted filter is either APPLIED from the parse or RESET by the page", () => {
    // THE FOUNDING RULE OF THAT BLOCK, and the one thing that must hold whether
    // or not the page has caught up with a filter the parser can now emit: the
    // interpretation chips list what was read, so a filter left switched on
    // from before is a constraint the interpretation does not mention and the
    // visitor cannot see the source of. Applied is the goal; reset is the
    // honest floor. Left standing is the defect.
    const RESET: Record<string, string> = {
      q: 'setQ("")',
      category: 'setCategory("")',
      experience: 'setExperience("")',
      maxYears: "setMaxYears(0)",
      remote: "setRemoteOnly(false)",
      workMode: 'setWorkMode("")',
      employmentType: 'setEmploymentType("")',
      salaryFloor: "setSalaryFloor(0)",
      salaryCeiling: "setSalaryCeiling(0)",
      payBasis: 'setPayBasis("")',
      hasStatedPay: "setStatedPayOnly(false)",
      country: 'setCountry("")',
      location: 'setLocation("")',
      department: 'setDepartment("")',
      vendor: 'setVendor("")',
      excludeAgencies: "setHideAgencies(false)",
      maxAgeDays: 'setFreshness("")',
      activelyHiring: "setActivelyHiringOnly(false)",
      sort: 'setSortMode("newest")',
    };
    expect(Object.keys(RESET).sort(), "a filter with no known off position").toEqual([...NL_KEYS].sort());
    expect(NL_BLOCK.length, "the applyNlSearch block did not parse").toBeGreaterThan(800);
    for (const k of NL_KEYS) {
      const applied = NL_BLOCK.includes(`f.${k}`);
      const reset = NL_BLOCK.includes(RESET[k]);
      expect(
        applied || reset,
        `${k} is emitted by nl-search and the page neither applies it (f.${k}) nor resets it (${RESET[k]}) — a stale value rides the interpreted search`,
      ).toBe(true);
    }
  });

  it("a declined filter is reset, never read off the parse", () => {
    // The recorded decisions, on the page side. The category widener is never
    // emitted, so a stale "+ unsorted" must be switched off; the agency opt-out
    // was this block's founding defect wearing the newest filter; the agent-only
    // toggle pins the board to 5.4% and nl-search does not speak it.
    for (const [k, page] of [
      ["includeUncategorised", "setInclUncat(false)"],
      ["includeUnstatedPay", "setIncludeUnstatedPay(false)"],
      ["sendableOnly", "setAgentOnly(false)"],
    ] as Array<[string, string]>) {
      expect(NL_DECLINED[k], `${k} is no longer declined`).toBeTruthy();
      expect(NL_BLOCK, `${k} is declined by the parser and left standing by the page`).toContain(page);
      expect(NL_BLOCK, `${k} is declined by the parser and the page reads it anyway`).not.toContain(`f.${k}`);
    }
  });
});
