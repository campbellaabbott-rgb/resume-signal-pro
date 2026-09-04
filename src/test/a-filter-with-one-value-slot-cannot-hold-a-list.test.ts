import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOARD_VENDORS, WORK_MODES } from "../../supabase/functions/job-board/filters";
import { JOB_CATEGORIES } from "../../supabase/functions/job-board/categories";
import { EXPERIENCE_BANDS } from "../../supabase/functions/job-board/experience";

/**
 * A FILTER WITH ONE VALUE SLOT CANNOT HOLD A LIST — AND SAID SO WITH A 200.
 *
 * /v1/jobs bound six closed-set filters through one helper:
 *
 *   const eq = (param, col) => { const v = p.get(param); if (v) qb = qb.eq(col, v); };
 *
 * So `?country=US,GB` became `country=eq.US,GB`. No row has ever held the
 * literal string "US,GB", the caller received HTTP 200 with an empty `data`
 * and a `total` describing an empty set, and nothing in the response said the
 * request had been misunderstood. Meanwhile the board splits every one of
 * these, and agent-mcp had been passing comma lists through to it for months —
 * the two-doors defect one layer below parameter NAMES, in parameter VALUES.
 *
 * The same helper had a second failure with the same signature: an unknown
 * member of a CLOSED set. `source=greenhosue`, `work_mode=Remote`,
 * `experience_band=bogus` each bound an equality that could never match, and
 * each came back as a well-formed 200 saying the board has nothing. That is a
 * statement about the market delivered in answer to a typo, and it is the
 * defect job-board/filters.ts was written to end — {workMode:"Remote"} once
 * served the entire unfiltered board to API callers.
 *
 * THE CAPS ARE NOT THIS FILE'S TO INVENT. Each one already exists on a surface
 * that enforces it, and this test compares /v1 against those sources rather
 * than against a number retyped here.
 *
 * COMMENT-STRIPPED, and that is load-bearing. The comments in public-api
 * necessarily quote the broken forms they explain ("US,GB", eq, the vendor
 * names) — a scanner that read them would pass on prose while the code was
 * wrong, which is the false positive this repo has shipped five times.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

const API = strip(read("supabase/functions/public-api/index.ts"));
const RAW = read("supabase/functions/public-api/index.ts");
const FILTERS = strip(read("supabase/functions/job-board/filters.ts"));
const JOBS_PAGE = strip(read("src/pages/Jobs.tsx"));
const DOCS = strip(read("src/pages/DataApi.tsx"));

/** The LIST_FILTERS table, as data: param -> { cap, domain }. */
function listFilterTable(): Record<string, { cap: string; domain: string }> {
  const i = API.indexOf("const LIST_FILTERS = [");
  expect(i, "LIST_FILTERS not found — every assertion below would be vacuous").toBeGreaterThan(-1);
  const block = API.slice(i, API.indexOf("] as const satisfies", i));
  const out: Record<string, { cap: string; domain: string }> = {};
  for (const m of block.matchAll(/\{ param: "([a-z_]+)", col: "([a-z_]+)", cap: ([^,]+), domain: ([^,]+),/g)) {
    expect(m[1], `${m[1]} binds the column ${m[2]}`).toBe(m[2]);
    out[m[1]] = { cap: m[3].trim(), domain: m[4].trim() };
  }
  return out;
}

describe("a filter with one value slot cannot hold a list", () => {
  it("the six closed-set filters are declared once, with a column each", () => {
    const t = listFilterTable();
    for (const p of ["country", "category", "company_token", "work_mode", "source", "experience_band"]) {
      expect(t[p], `${p} is not in LIST_FILTERS — it still binds a single value`).toBeTruthy();
    }
    // The old single-value helper must be gone, not merely bypassed: leaving it
    // in place is how a seventh filter gets bound the broken way tomorrow.
    expect(API, "the single-value eq() helper is still in listJobs")
      .not.toMatch(/const eq = \(param: string, col: string\)/);
  });

  it("one value is an equality, several are an IN — the board's own choice", () => {
    // .in() on a large bucket loses the date index the keyset ordering rides
    // on, so a single-value request must stay byte-identical to what it was.
    expect(API).toMatch(/if \(v\.length === 1\) qb = qb\.eq\(f\.col, v\[0\]\);/);
    expect(API).toMatch(/else if \(v\.length > 1\) qb = qb\.in\(f\.col, v\);/);
    // The board makes exactly this split, which is where it was copied from.
    expect(strip(read("supabase/functions/job-board/index.ts")))
      .toMatch(/cs\.length > 1 \? q\.in\("country", cs\) : q\.eq\("country", cs\[0\]\)/);
  });

  it("every cap is the number the surface that already enforces it uses", () => {
    const t = listFilterTable();
    // country and category: filters.ts names both as constants.
    expect(FILTERS).toMatch(/const COUNTRY_LIMIT = 5;/);
    expect(t.country.cap, "country must take the board's COUNTRY_LIMIT").toBe("5");
    expect(FILTERS).toMatch(/const CATEGORY_LIMIT = 3;/);
    expect(t.category.cap, "category must take the board's CATEGORY_LIMIT").toBe("3");
    // source: the vendor cap, which filters.ts sets at eight.
    expect(FILTERS).toMatch(/const VENDOR_LIMIT = 8;/);
    expect(t.source.cap, "source must take the board's VENDOR_LIMIT").toBe("8");
    // work_mode and experience_band: the whole domain, expressed as the domain
    // rather than as its current length, so adding a band moves the cap too.
    expect(t.work_mode.cap).toBe("WORK_MODES.length");
    expect(t.experience_band.cap).toBe("EXPERIENCE_BANDS.length");
    // company_token: the Explore-collection cap the board's own UI applies, so
    // a hand-edited URL cannot turn a cheap query into an expensive one.
    expect(JOBS_PAGE).toMatch(/company\.split\(","\)\.map\(\(s\) => s\.trim\(\)\)\.filter\(Boolean\)\.slice\(0, 12\)/);
    expect(t.company_token.cap, "company_token must take the board UI's 12").toBe("12");
  });

  it("over the cap is REFUSED, not silently sliced", () => {
    // The board can truncate because it has an ignoredFilters channel to say so
    // in. The default engine's envelope has none, and a silent slice reads as
    // "the board carries nothing in the sixth country" — the clamp incident.
    expect(API).toMatch(/if \(asked\.length > f\.cap\)/);
    expect(API).toMatch(/comma-separated values, got \$\{asked\.length\}/);
  });

  it("the closed domains are IMPORTED, never retyped", () => {
    // Two lists that can disagree is the shape of every filter defect this
    // board has shipped. Vendor #21 must join both surfaces on the same day.
    expect(RAW).toMatch(/import \{ BOARD_VENDORS, WORK_MODES \} from "\.\.\/job-board\/filters\.ts";/);
    expect(RAW).toMatch(/import \{ JOB_CATEGORIES \} from "\.\.\/job-board\/categories\.ts";/);
    expect(RAW).toMatch(/import \{ EXPERIENCE_BANDS \} from "\.\.\/job-board\/experience\.ts";/);
    const t = listFilterTable();
    expect(t.category.domain).toBe("JOB_CATEGORIES");
    expect(t.source.domain).toBe("BOARD_VENDORS");
    expect(t.work_mode.domain).toBe("WORK_MODES");
    expect(t.experience_band.domain).toBe("EXPERIENCE_BANDS");
    // The domains are real and non-trivial, or the check above proves nothing.
    expect(BOARD_VENDORS.length).toBeGreaterThan(15);
    expect(JOB_CATEGORIES.length).toBeGreaterThan(10);
    expect(WORK_MODES.length).toBe(3);
    expect(EXPERIENCE_BANDS.length).toBe(4);
  });

  it("an unknown value in a closed set is a 400 that names the set", () => {
    expect(API).toMatch(/const unknown = asked\.filter\(\(x\) => !\(f\.domain as readonly string\[\]\)\.includes\(x\)\)/);
    expect(API).toMatch(/"unsupported_param",\s*\n\s*`\$\{f\.param\} accepts: \$\{\[\.\.\.f\.domain\]\.join\(", "\)\}/);
  });

  it("company_token is NOT domain-checked — an open key space answers empty honestly", () => {
    // ~23,400 tokens: a caller can legitimately ask about an employer the board
    // does not carry, and an empty page is the true answer to that. The same
    // split filters.ts makes between `vendor` and `companies`.
    const t = listFilterTable();
    expect(t.company_token.domain).toBe("null");
    expect(t.country.domain).toBe("null");
  });

  it("country is checked for SHAPE instead — 'USA' is not a code this board stores", () => {
    expect(API).toMatch(/!\/\^\[A-Z\]\{2\}\$\/\.test\(x\)/);
    expect(API).toMatch(/ISO-3166-1 alpha-2/);
    // Folded to upper case before the test, the way the board folds it: a
    // lower-case 'gb' must not be the difference between a filter and a 400.
    expect(API).toMatch(/f\.fold === "upper" \? x\.toUpperCase\(\)/);
    expect(API).toMatch(/f\.fold === "lower" \? x\.toLowerCase\(\)/);
  });

  it("BOTH engines parse the lists once, so they refuse the same junk", () => {
    // Parsed before the engine dispatch. If the ranked branch ran first, a
    // typo would be a 400 on one engine and a 200 on the other.
    const parseAt = API.indexOf("for (const f of LIST_FILTERS) {");
    const engineAt = API.indexOf('engine === "ranked"');
    expect(parseAt).toBeGreaterThan(-1);
    expect(parseAt, "the closed-set parse must run before the ranked dispatch").toBeLessThan(engineAt);
    expect(API).toMatch(/return await listJobsRanked\(url, headers, lists\);/);
  });

  it("the ranked path sends company_token as an ARRAY — a string bound nothing", () => {
    // normalizeFilters reads `Array.isArray(body.companies) ? body.companies : []`
    // and reports NOTHING when it is not an array, so ?engine=ranked with an
    // employer token returned the whole board under an empty ignoredFilters.
    // The one filter shape on that path the board's honesty channel misses.
    expect(FILTERS).toMatch(/const compAsked = Array\.isArray\(body\.companies\) \? body\.companies : \[\];/);
    expect(API).toMatch(/\{ companies: lists\.company_token \}/);
    expect(API, "the ranked body must not pass the raw query string as companies")
      .not.toMatch(/companies: p\.get\("company_token"\)/);
  });

  it("explain reports the PARSED values and the operator they became", () => {
    expect(API).toMatch(/operator: lists\[f\.param\]\.length === 1 \? "eq" : "in"/);
    expect(API, "explain must not echo the raw query string back as the bound filter")
      .not.toMatch(/\{ country: p\.get\("country"\) \}/);
  });

  it("the docs say the lists exist and what they cap at", () => {
    expect(DOCS).toMatch(/country=US,GB/);
    expect(DOCS).toMatch(/comma list/i);
  });
});

/**
 * THE POSTING BODY, ON THE LIST ROUTE, WITH THE PAGE CAP THAT MAKES IT AFFORDABLE.
 *
 * description is the field that turns a job feed into something a customer can
 * build on — matching, skill extraction, classification, salary mining — and
 * the anonymous board served it while the paying API did not. It was refused on
 * the list route for a real reason (~5.7KB a posting, so a 100-row page is
 * ~570KB), and the answer to a real reason is a smaller page, not a missing
 * field.
 */
describe("the posting body is opt-in, and the page shrinks when it is asked for", () => {
  it("include is an accepted parameter, validated per member", () => {
    expect(API).toMatch(/"include",/);
    expect(API).toMatch(/const INCLUDABLE_FIELDS = \["description"\] as const;/);
    expect(API).toMatch(/const unknownIncludes = includeFields\.filter/);
    expect(API, "include=descriptions must not be a silent 200")
      .toMatch(/`include accepts: \$\{INCLUDABLE_FIELDS\.join\(", "\)\}/);
  });

  it("the cap is DEFAULT_LIMIT, and the arithmetic behind it is written down", () => {
    expect(API).toMatch(/const MAX_LIMIT_WITH_DESCRIPTION = 25;/);
    expect(API).toMatch(/const DEFAULT_LIMIT = 25;/);
    // The comment must carry the numbers, or the next reader re-derives them.
    const raw = RAW.slice(0, RAW.indexOf("const MAX_LIMIT_WITH_DESCRIPTION"));
    expect(raw, "the page-size arithmetic is not stated").toMatch(/570KB/);
    expect(raw).toMatch(/5\.7KB/);
  });

  it("the cap actually binds the limit, and the narrowing is disclosed", () => {
    expect(API).toMatch(/const maxLimit = wantDescription \? MAX_LIMIT_WITH_DESCRIPTION : MAX_LIMIT;/);
    expect(API).toMatch(/const limit = Math\.min\(Math\.max\(askedLimit, 1\), maxLimit\);/);
    // Clamping in silence is what makes a caller conclude the board ran out.
    expect(API).toMatch(/limitCapped: \{/);
    expect(API).toMatch(/requested: askedLimit,/);
    expect(API).toMatch(/reason: "include=description",/);
    // And the ceiling rides every page, not only the capped ones.
    expect(API).toMatch(/^\s*maxLimit,$/m);
  });

  it("the description column is selected ONLY when asked for", () => {
    expect(API).toMatch(/const extraSelect = wantDescription \? ",description" : "";/);
    expect(API).toMatch(/\.select\(`\$\{JOB_FIELDS\},effective_posted\$\{extraSelect\}`, opts\)/);
    // JOB_FIELDS itself must not gain it — that would publish ~5.7KB a row to
    // every caller of every route, which is the trade this design refuses.
    const fields = API.slice(API.indexOf("const JOB_FIELDS = ["), API.indexOf('].join(",")'));
    expect(fields, "description must not be unconditional").not.toMatch(/"description"/);
  });

  it("the ranked engine REFUSES it rather than answering without it", () => {
    // That path proxies job-board's list, whose row shape has no description,
    // so honouring the parameter would mean 200 rows missing the one field the
    // caller accepted a page cap to get.
    expect(API).toMatch(/include=description needs the default engine/);
    expect(API).toMatch(/\/v1\/jobs\/\{id\}, which always includes it/);
  });

  it("the docs describe include and its cap", () => {
    expect(DOCS).toMatch(/include=description/);
    expect(DOCS).toMatch(/25/);
  });
});
