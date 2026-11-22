/**
 * A REPORT THE FALLBACK MADE CLAIMS NO CONTACT DETAILS IT NEVER READ (sweep
 * SCAN-M1).
 *
 * The page filled an absent contactInfo with hasEmail and hasPhone set to
 * true, so a report from the streaming fallback (which sends no contact facts)
 * showed a Contact card with an email and a phone "present" and raised no
 * contact finding, about a résumé nobody had checked for either. Absent is
 * hidden, never invented (the S11-147 rule): with no contactInfo, or one
 * without its two booleans, there is no Contact card and no contact finding.
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

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => cleanup());

function report(contactInfo: unknown) {
  return render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="general" atsScoreEstimate={58} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
        redFlags={[]} keywords={[]}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        {...(contactInfo === undefined ? {} : { contactInfo: contactInfo as never })}
        reportVerdict="complete"
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );
}
const items = () => i18n.t("reportInsights.findings.items", { returnObjects: true }) as Record<string, string>;

describe("a report with no contact facts", () => {
  it("shows no Contact card", () => {
    const { container } = report(undefined);
    expect(container.querySelector('[data-metric="contact"]')).toBeNull();
    // The rest of the structure cards are still there.
    expect(container.querySelector('[data-metric="sections"]')).not.toBeNull();
  });

  it("raises no contact finding either way", () => {
    const { container } = report(undefined);
    const text = container.textContent ?? "";
    expect(text).not.toContain(items().noEmail);
    expect(text).not.toContain(items().noPhone);
  });

  it("a contactInfo without its two booleans is no reading either", () => {
    const { container } = report({ missingItems: [] });
    expect(container.querySelector('[data-metric="contact"]')).toBeNull();
  });
});

describe("a report that did read them", () => {
  it("shows the card, counted from what it read", () => {
    const { container } = report({ hasEmail: true, hasPhone: false, hasLinkedIn: false, missingItems: [] });
    const contact = container.querySelector('[data-metric="contact"]');
    expect(contact?.textContent).toContain("1/3");
    expect(container.textContent).toContain(items().noPhone);
  });
});
