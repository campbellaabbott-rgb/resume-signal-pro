// THE POSTING SAID MORE THAN THE CARD DID.
//
// rowToJob returns structured pay (min/max annual, period, currency), the
// experience band, min_years and department on every row. Most of that already
// reached a surface — but not the same surfaces, and the split was backwards:
//
//   - the DETAIL PANEL annualized an hourly rate ("≈66k/year as stated") and
//     the CARD did not, so the fact a skimmer needs to compare "$32.00 per
//     hour" with the "$120,000 per year" on the next card was shown only after
//     they had already decided to click;
//   - the CARD named the department and the employer's own minimum years, and
//     the panel — the surface someone actually reads before applying — named
//     neither.
//
// The rules that constrain the fix matter more than the completeness: a field
// the employer did not state shows NOTHING, and the annualization must never
// become a way to manufacture a pay figure for a posting that states none.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { annualizedPayRange } from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const JOBS = strip(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));
const BOARD = strip(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));

describe("the posting said more than the card did", () => {
  it("annualizes pay stated in another period, as a range or a single figure", () => {
    expect(annualizedPayRange({ salaryMinAnnual: 60_000, salaryMaxAnnual: 80_000, salaryPeriod: "hour" }))
      .toBe("60k–80k");
    expect(annualizedPayRange({ salaryMinAnnual: 120_000, salaryMaxAnnual: null, salaryPeriod: "month" }))
      .toBe("120k");
    // A max that is not actually above the min is not a range.
    expect(annualizedPayRange({ salaryMinAnnual: 90_000, salaryMaxAnnual: 90_000, salaryPeriod: "hour" }))
      .toBe("90k");
  });

  it("says nothing when there is nothing to add", () => {
    // Already annual: restating the verbatim figure is noise, not information.
    expect(annualizedPayRange({ salaryMinAnnual: 120_000, salaryPeriod: "year" })).toBeNull();
    // No stated pay at all — this must never manufacture a figure.
    expect(annualizedPayRange({ salaryMinAnnual: null, salaryPeriod: "hour" })).toBeNull();
    expect(annualizedPayRange({})).toBeNull();
    // A parsed amount with no period is not enough to claim an annual figure.
    expect(annualizedPayRange({ salaryMinAnnual: 60_000, salaryPeriod: null })).toBeNull();
  });

  it("the card and the panel share one annualization, and the panel's private copy is gone", () => {
    expect(JOBS, "the card").toMatch(/\{annualizedPayRange\(job\) && \(/);
    expect(JOBS, "the panel").toMatch(/\{annualizedPayRange\(detailJob\) && \(/);
    // The hand-rolled arithmetic the panel used to carry alone.
    expect(JOBS, "a second copy of the range maths").not.toMatch(/salaryMaxAnnual && detailJob\.salaryMaxAnnual > detailJob\.salaryMinAnnual/);
    // Both surfaces phrase it with the key that already existed.
    expect((JOBS.match(/t\("jobsPage\.salaryAnnualized"/g) ?? []).length).toBe(2);
  });

  it("the annualized figure can only ever accompany the employer's own pay text", () => {
    // salary_min_annual is parsed from the posting's pay text and is only ever
    // written alongside it, so there is no row where a range exists without one
    // — and both renders sit inside the `salary &&` branch regardless.
    expect(BOARD).toMatch(/salary: minedSalary,\s*salary_min_annual: minedParse\?\.annualMin \?\? null,/);
    expect(JOBS).toMatch(/\{job\.salary && \(/);
    expect(JOBS).toMatch(/\{detailJob\.salary && \(/);
  });

  it("the panel finally names the department and the employer's own minimum years", () => {
    expect(JOBS).toMatch(/\{detailJob\.department \? <> · \{detailJob\.department\}<\/> : null\}/);
    // The band is our bucket; the years are what the posting actually demands.
    expect(JOBS).toMatch(/typeof detailJob\.minYears === "number" && detailJob\.minYears > 0 &&/);
    expect(JOBS).toMatch(/t\("jobsPage\.minYears", "\{\{n\}\}\+ yrs", \{ n: detailJob\.minYears \}\)/);
    // `> 0`: zero is not a stated requirement, and the years filter refuses it
    // for the same reason (1..20). "0+ yrs" would be a chip that says nothing.
    expect(JOBS, "a zero minimum must not render").not.toMatch(/typeof detailJob\.minYears === "number" &&\s*\(/);
  });

  it("the posting-age wording keeps its provenance untouched", () => {
    // Company-stated date and first-seen are DIFFERENT claims — the 2.8-day
    // median incident came from substituting one for the other — so surfacing
    // more fields must not have re-labelled either.
    expect(JOBS).toMatch(/t\("jobsPage\.postedProvenance", "Posting age from the date the company states on its own careers feed/);
    expect(JOBS).toMatch(/t\("jobsPage\.firstSeenProvenance", "This employer states no posting date/);
    expect(JOBS).toMatch(/t\("jobsPage\.firstSeenDaysAgo"/);
  });

  it("reuses the keys that already name these values — no new locale strings needed", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, unknown> };
      expect(typeof j.jobsPage?.salaryAnnualized, `${f}: jobsPage.salaryAnnualized`).toBe("string");
      expect(String(j.jobsPage?.salaryAnnualized), `${f}: the range is interpolated`).toContain("{{range}}");
      expect(typeof j.jobsPage?.minYears, `${f}: jobsPage.minYears`).toBe("string");
      expect(String(j.jobsPage?.minYears), `${f}: the number is interpolated`).toContain("{{n}}");
    }
  });
});
