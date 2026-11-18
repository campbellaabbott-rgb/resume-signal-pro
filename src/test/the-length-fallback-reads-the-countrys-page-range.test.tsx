/**
 * THE LENGTH FALLBACK READS THE COUNTRY'S PAGE RANGE (S14X-028).
 *
 * When the scan sends no length verdict, the report works one out from the
 * text: about 550 words a page, and one page recommended unless the reader is
 * senior. A two-page German CV for a mid-level reader was "too long", though
 * two pages is the German norm. When the scanner sends the target country's
 * range (countryStandards.pagesMin/pagesMax), a length inside it is right,
 * and the target shown is the nearest length the range allows. Without a
 * range the old rule stands.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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

import { FreeKeywordResults } from "@/components/FreeKeywordResults";

afterEach(() => cleanup());

// About 1,100 words: two pages at 550 a page.
const TWO_PAGES = ["Jana Muster", "Data Engineer, Beispiel GmbH, 2018 - heute"]
  .concat(Array.from({ length: 110 }, (_, i) => `- Built pipeline number ${i} that moved rows daily`))
  .join("\n");
const DE = {
  iso: "DE", country: "Germany", confidence: "high", docTerm: "Lebenslauf", paper: "A4", lengthNote: "1-2 pages",
  photoNorm: "optional", photoAdvice: "", personalDataNote: "", conventions: [], advisories: [],
};
const pagesTile = (countryStandards: Record<string, unknown> | null) => {
  const { container } = render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="data_engineering" atsScoreEstimate={70} formatGrade="B" formatIssue="ok"
        experienceLevel={{ level: "mid", yearsEstimate: "6" } as never}
        redFlags={[]} keywords={[]} resumeText={TWO_PAGES}
        // No length from the scan: the report works it out from the text.
        resumeLength={undefined as never}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [] } as never}
        countryStandards={countryStandards as never}
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );
  const tile = container.querySelector<HTMLElement>('[data-metric="pages"]');
  expect(tile, "the pages tile").not.toBeNull();
  return tile!;
};

describe("a two-page CV for a mid-level reader, with no length from the scan", () => {
  it("is the right length where the country's range is 1-2 pages", () => {
    const tile = pagesTile({ ...DE, pagesMin: 1, pagesMax: 2 });
    expect(tile.dataset.status).toBe("success");
    expect(tile.textContent).toContain("2 / 2");
  });

  it("is too long where the range is 1 page", () => {
    const tile = pagesTile({ ...DE, pagesMin: 1, pagesMax: 1 });
    expect(tile.dataset.status).toBe("warning");
    expect(tile.textContent).toContain("2 / 1");
  });

  it("keeps the worldwide rule when the scan sends no range", () => {
    expect(pagesTile(DE).dataset.status).toBe("warning");
  });
});
