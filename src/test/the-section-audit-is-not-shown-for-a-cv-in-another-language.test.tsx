/**
 * THE SECTION AUDIT IS NOT SHOWN FOR A CV IN ANOTHER LANGUAGE (NB-6).
 *
 * The scanner counts words per section by English headings ("Experience",
 * "Education"), so for a German or Spanish CV every section came back with
 * no words, and the report's section audit marked each one "Missing". For a
 * CV the scanner detected as another language the audit is not shown; an
 * English CV keeps it.
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

import i18n from "@/i18n";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";

afterEach(() => cleanup());

const EMPTY = { current: 0, idealMin: 30, idealMax: 600, verdict: "too_few" as const };
const audit = (detectedLanguage: string) => {
  const { container } = render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="data_engineering" atsScoreEstimate={66} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
        redFlags={[]} keywords={[]} resumeText={"Jana Muster\nBerufserfahrung\nDateningenieurin, Beispiel GmbH, 2018 - heute\n- Datenstrecken gebaut\n".repeat(3)}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        sectionWordCounts={{ summary: EMPTY, experience: EMPTY, skills: EMPTY, education: EMPTY }}
        detectedLanguage={detectedLanguage as never}
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );
  const title = i18n.t("freeScanPage.sectionAudit.title");
  return [...container.querySelectorAll("h4")].some((h) => h.textContent === title || /Section Length Audit/.test(h.textContent ?? ""));
};

describe("the section audit", () => {
  it("is not shown for a CV the scanner detected as German", () => {
    expect(audit("de"), "a German CV was told every section is missing").toBe(false);
  });
  it("is shown for an English CV", () => {
    expect(audit("en")).toBe(true);
  });
});
