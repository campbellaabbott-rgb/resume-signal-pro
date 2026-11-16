/**
 * THE BUILDER HAND-OFF NAMES THE RÉSUMÉ IT WAS MADE FOR (S14X-285).
 *
 * "Open in the builder" put the résumé and the report's rewrites in this
 * tab's session storage (rb_scan_fixes) with nothing tying the rewrites to
 * the résumé they were made for, so a builder opened later on another résumé
 * could apply them to it. The hand-off now carries the résumé's fingerprint
 * (textFingerprint, the builder's own), so the builder can refuse fixes made
 * for a different text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
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
import { textFingerprint } from "@/lib/builder-import";

beforeEach(() => { try { sessionStorage.clear(); } catch { /* blocked */ } });
afterEach(() => cleanup());

const RESUME = "Jordan Probe\nData Engineer, Acme Corp, 2019 - Present\n- Built pipelines that moved two billion rows a day\n- Led a team of five engineers across three regions\n";

describe("the builder hand-off", () => {
  it("stores the fingerprint of the résumé its fixes were made for", () => {
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="data_engineering" atsScoreEstimate={70} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
          redFlags={[]} keywords={[{ keyword: "dbt", reason: "Named in many postings" }] as never} resumeText={RESUME}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
          onGetFullAnalysis={vi.fn()}
        />
      </MemoryRouter>,
    );
    const link = container.querySelector<HTMLAnchorElement>("[data-builder-handoff] a");
    expect(link, "the builder hand-off").not.toBeNull();
    fireEvent.click(link!);
    const fixes = JSON.parse(sessionStorage.getItem("rb_scan_fixes") ?? "null") as { fingerprint?: string } | null;
    expect(fixes, "no hand-off was stored").not.toBeNull();
    expect(fixes!.fingerprint).toBe(textFingerprint(RESUME));
  });
});
