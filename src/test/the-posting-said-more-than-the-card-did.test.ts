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

  // Pass B (2026-10-12): the card and the panel are the listing vocabulary's
  // (JobCard, PostingFacts). The annual estimate, the department, the minimum
  // years and the posted date are read there, through one reader each.
  const CARD = strip(readFileSync(resolve(ROOT, "src/components/jobs/listing/JobCard.tsx"), "utf8"));
  const FACTS = strip(readFileSync(resolve(ROOT, "src/components/jobs/listing/PostingFacts.tsx"), "utf8"));
  const PAY = strip(readFileSync(resolve(ROOT, "src/lib/listing/pay.ts"), "utf8"));
  const TEXT = strip(readFileSync(resolve(ROOT, "src/components/jobs/listing/listing-text.ts"), "utf8"));

  it("the card and the panel share one annualization, and no surface carries a private copy", () => {
    expect(JOBS, "the board mounts the card").toMatch(/<JobCard\b/);
    expect(JOBS, "the board mounts the pane").toMatch(/<PostingDetail\b/);
    // One reader: listingPay's `annual`, read from the server's salary_min_annual.
    expect(CARD, "the card").toMatch(/const pay = listingPay\(job, lng\);/);
    expect(FACTS, "the panel").toMatch(/const pay = listingPay\(job, lng\);/);
    expect(CARD).toMatch(/pay\?\.annual \?/);
    expect(FACTS).toMatch(/pay\.annual/);
    // The hand-rolled arithmetic no surface may carry alone.
    for (const [name, src] of [["the card", CARD], ["the panel", FACTS], ["the board", JOBS]] as const) {
      expect(src, `${name}: a second copy of the range maths`).not.toMatch(/salaryMaxAnnual && \w+\.salaryMaxAnnual > \w+\.salaryMinAnnual/);
      expect(src, `${name}: multiplies a rate itself`).not.toMatch(/\* ?2_?080\b|\* ?260\b/);
    }
    // Both surfaces phrase it as OUR estimate, each with its own key.
    expect((CARD.match(/t\("listing\.card\.annualEstimate"/g) ?? []).length).toBe(1);
    expect((FACTS.match(/t\("listing\.facts\.ourEstimate"/g) ?? []).length).toBe(1);
  });

  it("the annualized figure can only ever accompany the employer's own pay text", () => {
    // salary_min_annual is parsed from the posting's pay text and is only ever
    // written alongside it, so there is no row where a range exists without one
    // — and the reader answers null before it reads the period when there is no text.
    expect(BOARD).toMatch(/salary: minedSalary,\s*salary_min_annual: minedParse\?\.annualMin \?\? null,/);
    expect(PAY).toMatch(/const raw = typeof job\.salary === "string" \? job\.salary\.trim\(\) : "";\s*if \(!raw\) return null;/);
    expect(PAY, "our arithmetic only where the period is known and is not a year").toMatch(/period && period !== "year" && finitePositive\(job\.salaryMinAnnual\)/);
  });

  it("the panel names the department and the employer's own minimum years", () => {
    expect(FACTS).toMatch(/\{department && \(/);
    expect(FACTS).toMatch(/listing\.facts\.department/);
    // The band is our bucket; the years are what the posting actually demands.
    expect(FACTS).toMatch(/t\("jobsPage\.minYears", \{ defaultValue: "\{\{n\}\}\+ yrs", n: years \}\)/);
    expect(FACTS).toMatch(/listing\.facts\.minYearsNote/);
    expect(FACTS).toMatch(/listing\.facts\.bandNote/);
    // `> 0`: zero is not a stated requirement. "0+ yrs" would be a chip that says nothing.
    expect(FACTS, "a zero minimum must not render").toMatch(/minYears === "number" && job\.minYears > 0/);
  });

  it("the posting-age wording keeps its provenance untouched", () => {
    // Company-stated date and first-seen are DIFFERENT claims — the 2.8-day
    // median incident came from substituting one for the other — so the posted
    // row names the employer's system, and an undated row states no age.
    expect(TEXT).toMatch(/t\("listing\.facts\.postedDated", \{ defaultValue: "\{\{date\}\}, as the employer's system states it", date \}\)/);
    expect(TEXT).toMatch(/t\("listing\.facts\.postedUndated", "The employer's system states no posting date"\)/);
    expect(TEXT).not.toMatch(/firstSeen|lastSeen/);
  });

  it("reuses the keys that already name these values — no new locale strings needed", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, unknown> };
      const s = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/shards/listing", f), "utf8")) as { listing: { card: Record<string, unknown>; facts: Record<string, unknown> } };
      expect(typeof s.listing.card.annualEstimate, `${f}: listing.card.annualEstimate`).toBe("string");
      expect(String(s.listing.card.annualEstimate), `${f}: the amount is interpolated`).toContain("{{amount}}");
      expect(String(s.listing.facts.ourEstimate), `${f}: the rule is interpolated`).toContain("{{rule}}");
      expect(typeof j.jobsPage?.minYears, `${f}: jobsPage.minYears`).toBe("string");
      expect(String(j.jobsPage?.minYears), `${f}: the number is interpolated`).toContain("{{n}}");
    }
  });
});
