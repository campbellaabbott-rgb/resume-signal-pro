/**
 * A VERSION BUMP MUST NOT REPUBLISH A FIGURE INGEST HONESTLY REFUSED.
 *
 * WHAT THIS GUARDS. `backfill-salary` re-parses every row holding salary text
 * whenever SALARY_PARSE_VERSION moves, and it reads the ROW — not the vendor
 * payload the ingest parse had. For almost the whole board that is the same
 * context: the part-time signal lives in the title or the description and the
 * sweep passes both. For one vendor it is not, and this bundle created that
 * vendor and bumped the version in the same publish.
 *
 * THE DEFECT, MEASURED ON THE BUNDLE'S OWN FIXTURE. `personio:tok:1613939`,
 * "Minijobber (m/w/d) Sales", `<schedule>part-time</schedule>`, hourly 14.50:
 * the ingest parse (which is handed the vendor's own schedule words) returns
 * annualMin null and a part-time signal, and the sweep's parse as it was written
 * — title and description only — returned 30,160 with no signal at all. The
 * sweep's skip test is "nothing changed", and null is not 30,160, so it would
 * have written a one-sided 30,160 floor into salary_min_annual: the column
 * salary_rank_usd is generated from, so the row would pass a EUR 30,000 salary
 * floor and sort as a 30k job. Nothing else could have rescued it — the title is
 * German, the stored body is German ("Aushilfe im Verkauf … auf Minijob-Basis"),
 * and the guard's vocabulary is English. This is the 2026-08-25 $44/hour → 91,520
 * defect, restored by the same commit that guards against it.
 *
 * WHY IT TAKES THREE PARTS, not one. (1) The vocabulary now accepts `part_time`,
 * our own underscore spelling, because the stored enum is the only durable record
 * of a schedule a row has. (2) The sweep selects `employment_type` and passes it,
 * so the two parses see the same thing. (3) Neither of those reaches the vendor's
 * THIRD state: `full-or-part-time` normalises to `full_time`, which declares the
 * opposite of what the guard needs, and no column can hold it — so the sweep
 * refuses outright to turn a NULL annual into a number on a load-dependent period
 * for a source whose schedule words nothing stores. Parts 1 and 2 make the sweep
 * agree with ingest where the column can say so; part 3 makes it silent where the
 * column cannot.
 *
 * WHAT THE REFUSAL COSTS, stated rather than implied: a future parser improvement
 * reaches these rows at ingest and on a pay-text correction, not through the
 * sweep. That is silence until the row is re-read, which is the trade this whole
 * lane makes everywhere else.
 *
 * EVERY CASE BELOW IS BEHAVIOURAL — the real modules are imported and the sweep's
 * own parse expression is reconstructed from the columns its select reads, with
 * the code pin only for the wiring. A guard that asserted the sweep passes the
 * field would pass while the field could not fire the guard, which is exactly the
 * state this bundle shipped in for one round.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePersonio, sweepRefusesAnnual } from "../../supabase/functions/job-board/normalize";
import { LOAD_DEPENDENT_PERIODS, parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const FEED = readFileSync(resolve(ROOT, "src/test/fixtures/personio-stated-pay.xml"), "utf8");
const ROWS = normalizePersonio(FEED, "Fixture Employer", "tok", "jobs.personio.de");
const byId = (id: string) => {
  const row = ROWS.find((r) => r.id === `personio:tok:${id}`);
  if (!row) throw new Error(`fixture position ${id} missing from the feed`);
  return row;
};

/** The columns the sweep's select actually reads, for one fixture row. */
const storedRow = (id: string) => {
  const row = byId(id);
  return {
    source: row.source as string,
    salary: row.salary,
    country: null as string | null,
    title: row.title,
    // The German body is what the feed carries; the sweep stores and re-reads it.
    description: null as string | null,
    employment_type: row.employmentType ?? null,
  };
};

/** EXACTLY the sweep's parse: the row's own columns, nothing the payload had. */
const asTheSweepWouldRead = (r: ReturnType<typeof storedRow>) =>
  parseSalaryStructured(r.salary, r.country, { title: r.title, description: r.description, employmentType: r.employment_type });

/** EXACTLY the ingest parse: the same text WITH the vendor's schedule words. */
const asIngestWouldRead = (id: string) => {
  const row = byId(id);
  return parseSalaryStructured(row.salary, null, {
    title: row.title,
    description: null,
    employmentType: row.employmentTypeText ?? null,
  });
};

describe("the text re-sweep must not publish an annual the ingest parse refused", () => {
  it("reads the Minijobber row the same way ingest does, from the row alone", () => {
    const row = storedRow("1613939");
    expect(row.salary).toBe("EUR 14.50 per hour");
    expect(row.employment_type).toBe("part_time");
    // The two parses must agree, because they are about to write the same column.
    expect(asIngestWouldRead("1613939")?.annualMin).toBeNull();
    const swept = asTheSweepWouldRead(row);
    expect(swept?.min).toBe(14.5);            // the wage still reads
    expect(swept?.annualMin).toBeNull();      // the 2,080-hour assumption does not
    expect(swept?.partTimeSignal).toBe("part_time");
  });

  it("goes red in the state the defect lived in — the enum unread", () => {
    // BREAK IT WHERE IT BROKE. The sweep's select did not carry employment_type
    // and its context did not pass it; this is that exact call, on this exact row.
    const row = storedRow("1613939");
    const blind = parseSalaryStructured(row.salary, row.country, { title: row.title, description: row.description });
    expect(blind?.annualMin).toBe(30160);
    expect(blind?.partTimeSignal).toBeNull();
    // AND THE OTHER HALF OF THE SAME DEFECT, which is why the enum had to become
    // reachable rather than the guard being handed more prose: the vocabulary is
    // English plus our own column spellings, and the word THIS employer would
    // actually write is German. "Teilzeit" is a real, accepted residual — stated
    // here so nobody reads the case above as "the guard understands schedules".
    expect(parseSalaryStructured(row.salary, row.country, { title: row.title, description: null, employmentType: "Teilzeit" })?.annualMin).toBe(30160);
    // The row's own title cannot rescue it: "Minijobber" is in no vocabulary here,
    // and it is the reason the enum had to be reachable at all.
    expect(row.title).toContain("Minijobber");
    expect(parseSalaryStructured(row.salary, row.country, { title: row.title, description: null })?.partTimeSignal).toBeNull();
  });

  it("refuses to promote a NULL annual where the schedule words reach no column", () => {
    // THE VENDOR'S THIRD STATE. full-or-part-time normalises to full_time, so the
    // column DECLARES full time on a posting whose load is unstated, and the sweep
    // reading that column computes the very annual ingest refused. No widening of
    // the vocabulary can fix this one — the stored value is not ambiguous, it is
    // wrong for this purpose — so the sweep declines to write at all.
    const ambiguous = byId("2694122");
    expect(ambiguous.employmentTypeText).toBe("full-or-part-time");
    expect(ambiguous.employmentType).toBe("full_time");
    // Take the Minijobber's own hourly text into that state and read it as the
    // sweep would: a number appears where ingest wrote nothing.
    const wouldWrite = parseSalaryStructured("EUR 14.50 per hour", null, { title: ambiguous.title, description: null, employmentType: "full_time" });
    expect(wouldWrite?.annualMin).toBe(30160);
    expect(wouldWrite?.period).toBe("hour");
    // And the sweep's rule stops it.
    expect(sweepRefusesAnnual("personio", null, wouldWrite?.annualMin ?? null, wouldWrite?.period ?? null)).toBe(true);
  });

  it("refuses only that one promotion, so the sweep still does its job", () => {
    // NARROW, AND EVERY ARM OF THE NARROWING ASSERTED. A rule this blunt would
    // silence the comma-decimal repair this same bundle ships, which is 638 rows
    // going from NULL to a value on greenhouse, smartrecruiters, workday and
    // oracle — none of which is this source.
    expect(sweepRefusesAnnual("greenhouse", null, 30160, "hour")).toBe(false);
    expect(sweepRefusesAnnual("smartrecruiters", null, 37648, "hour")).toBe(false);
    // A stored annual that is WRONG is still corrected — that is what the sweep is
    // for, and it is how v8's three-decimal rows get repaired.
    expect(sweepRefusesAnnual("personio", 23170, 48193, "hour")).toBe(false);
    // A period that is not load-dependent carries no assumption about how much
    // someone works, so a monthly or yearly Personio figure sweeps normally.
    expect(sweepRefusesAnnual("personio", null, 48000, "month")).toBe(false);
    expect(sweepRefusesAnnual("personio", null, 60000, "year")).toBe(false);
    // The load-dependent set is the parser's own, not a second copy of it.
    for (const p of ["hour", "day", "week"]) expect(LOAD_DEPENDENT_PERIODS.has(p), p).toBe(true);
    for (const p of ["month", "year"]) expect(LOAD_DEPENDENT_PERIODS.has(p), p).toBe(false);
    // Nothing to refuse when there is no new figure, or no row.
    expect(sweepRefusesAnnual("personio", null, null, "hour")).toBe(false);
    expect(sweepRefusesAnnual(null, null, 30160, "hour")).toBe(false);
  });

  it("is wired into the sweep that would otherwise write it", () => {
    // The three expressions, whole, against comment-stripped code — the select
    // that has to carry the columns, the parse that has to pass them, and the
    // refusal. A docblock naming employment_type cannot satisfy any of them.
    const CODE = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
    expect(CODE).toContain('.select("id,source,salary,country,title,description,employment_type,salary_min_annual,salary_max_annual,salary_period,salary_currency")');
    expect(CODE).toContain("{ title: (row as { title?: string | null }).title ?? null, description: (row as { description?: string | null }).description ?? null, employmentType: row.employment_type ?? null }");
    expect(CODE).toContain("if (sweepRefusesAnnual(row.source, curMin, nextMin, nextPer)) continue;");
    // AND IT SITS AFTER THE NO-CHANGE SKIP, so a row it protects is not grouped
    // into a patch that a later edit might send anyway.
    const skip = CODE.indexOf("if (nextMin === curMin && nextMax === curMax");
    const refuse = CODE.indexOf("if (sweepRefusesAnnual(");
    const group = CODE.indexOf("const key = `${nextMin ?? \"\"}|${nextMax ?? \"\"}");
    expect(skip).toBeGreaterThan(0);
    expect(refuse).toBeGreaterThan(skip);
    expect(group).toBeGreaterThan(refuse);
  });

  it("names the sources it cannot see, and no others", () => {
    // The list is the claim "this vendor states a schedule in the payload and
    // nowhere else". A second entry is a decision, not an append: any vendor added
    // here loses the sweep's repairs on its load-dependent rows.
    const NORM = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/normalize.ts"), "utf8"));
    expect(NORM).toContain('export const SCHEDULE_WORDS_NOT_STORED: ReadonlySet<string> = new Set(["personio"]);');
    // And it is the same vendor the words are actually set on, so the two halves
    // cannot drift: employmentTypeText is written by one arm of this file.
    expect(NORM.match(/employmentTypeText: schedule \|\| null/g)?.length).toBe(1);
  });
});
