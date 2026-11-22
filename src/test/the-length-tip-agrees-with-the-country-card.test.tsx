/**
 * THE LENGTH TIP AGREES WITH THE COUNTRY CARD (register S10-148).
 *
 * The personalised tips ended on "Recommended resume length: 1 page for
 * mid-level professionals", a count taken from the experience level alone,
 * under a country card that says two pages are standard in the UK. The tip
 * now gives the page range of the market the scan used (its country
 * standard's pagesMin and pagesMax), and a report with no standard gets no
 * length tip at all rather than a worldwide guess.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import i18n from "@/i18n";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { PersonalizedInsights } from "@/components/PersonalizedInsights";
import { evaluateCountryStandards } from "../../supabase/functions/free-keyword-scan/country-standards";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => cleanup());

const RESUME = "Jordan Probe\nAccountant, Barclays, 2019 - Present\n- Closed the books for 14 entities each month\n".repeat(3);
// The old tip's sentence for a mid-level reader, whatever the market.
const oneForMid = () => i18n.t("personalizedInsights.recommendedLength", { count: 1, level: i18n.t("personalizedInsights.levels.mid").toLowerCase() });

describe("a mid-level reader scanned for the UK", () => {
  it("is told the UK's range beside the UK card, not one page", () => {
    const gb = evaluateCountryStandards(RESUME, "GB")!;
    expect([gb.pagesMin, gb.pagesMax]).toEqual([1, 2]);
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="finance" atsScoreEstimate={66} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
          redFlags={[]} keywords={[]} resumeText={RESUME}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
          experienceLevel={{ level: "mid", yearsEstimate: "6 years" } as never}
          countryStandards={gb as never}
          onGetFullAnalysis={vi.fn()}
        />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    expect(text).toContain(gb.lengthNote);
    expect(text).not.toContain(oneForMid());
    expect(text).toContain(i18n.t("freeScanPage.insights.lengthRange", { min: 1, max: 2 }));
  });
});

describe("the tip itself", () => {
  const tips = (pageRange: { min: number; max: number } | null) => render(
    <PersonalizedInsights industry="finance" experienceLevel={{ level: "mid", yearsEstimate: "" }} atsScore={66} hasJobDescription={false} pageRange={pageRange} />,
  ).container;

  it("is not given when the scan named no market", () => {
    const c = tips(null);
    expect(c.textContent).not.toContain(oneForMid());
    expect(c.querySelector("[data-length-tip]")).toBeNull();
  });

  it("says one count when the market allows one", () => {
    expect(tips({ min: 2, max: 2 }).textContent).toContain(i18n.t("freeScanPage.insights.lengthExact", { count: 2 }));
  });

  it("says nothing from a range that is no range", () => {
    expect(tips({ min: 3, max: 1 }).querySelector("[data-length-tip]")).toBeNull();
  });
});
