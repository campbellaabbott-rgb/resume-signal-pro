/**
 * A REFUSED POSTING CHECK KEEPS THE REALISM NUDGE (sweep SCAN-09).
 *
 * The nudge says the keywords were modeled for the industry and that pasting
 * a posting makes them exact. It was hidden whenever the reader had typed
 * anything in the posting box, so a posting the re-check refused, or one of
 * 50 characters or fewer that the scanner does not read, left a report of
 * modeled keywords with no word that they were modeled. It is now hidden only
 * when the scan says its keywords came from the posting.
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

import { FreeKeywordResults } from "@/components/FreeKeywordResults";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => cleanup());

// The nudge's own opening words: the test reads the sentence, not a marker
// the fix added, so it reads the same page before and after.
const NUDGE = "This scan modeled expectations for";

function report(extra: Record<string, unknown>) {
  const { container } = render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="marketing" atsScoreEstimate={61} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
        redFlags={[]} keywords={[]}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        onGetFullAnalysis={vi.fn()}
        {...(extra as object)}
      />
    </MemoryRouter>,
  );
  return container.textContent ?? "";
}

describe("the realism nudge", () => {
  it("stays when a posting was pasted but the scan's keywords were modeled (a refused re-check)", () => {
    expect(report({ hadJobDescription: true, keywordSource: { source: "model" } })).toContain(NUDGE);
  });

  it("stays when a posting too short to read was pasted and the scan names no source", () => {
    expect(report({ hadJobDescription: true, keywordSource: null })).toContain(NUDGE);
  });

  it("stays when the keywords came from O*NET", () => {
    expect(report({ hadJobDescription: true, keywordSource: { source: "onet", code: "13-1161.00", occupation: "market research analysts" } })).toContain(NUDGE);
  });

  it("goes only when the keywords were matched against the posting", () => {
    expect(report({ hadJobDescription: true, keywordSource: { source: "job_description" } })).not.toContain(NUDGE);
  });

  it("is shown to a reader who pasted no posting", () => {
    expect(report({ hadJobDescription: false })).toContain(NUDGE);
  });
});
