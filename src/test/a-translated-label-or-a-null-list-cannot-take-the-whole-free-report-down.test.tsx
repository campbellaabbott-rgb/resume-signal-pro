/**
 * A TRANSLATED LABEL OR A NULL LIST CANNOT TAKE THE WHOLE FREE REPORT DOWN
 * (register S11-029), the page's half.
 *
 * The keyword card read impactConfig[impact].badge and the section-quality
 * grid read the colour map's .bg; a model that wrote "alta" or "sólida" made
 * both undefined, the card threw, and the page's one error boundary replaced
 * the entire report. matchingSkills (and three other lists) as null threw on
 * .length, because a default parameter covers only undefined. The servers now
 * normalize these (the node test beside this one); the page also draws an
 * unknown impact as medium, an unknown quality as adequate, and null as empty.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

import { KeywordsSection } from "@/components/scorecard/RedFlagsKeywords";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";

describe("the keyword card", () => {
  it("draws an impact outside the three as medium instead of throwing", () => {
    render(
      <KeywordsSection
        industry="technology"
        keywords={[
          { keyword: "Kafka", reason: "Expected", impact: "alta" as never },
          { keyword: "gRPC", reason: "Expected", impact: "low" as never },
          { keyword: "Terraform", reason: "Expected", impact: "critical" },
        ]}
      />,
    );
    expect(screen.getByText("Kafka")).toBeTruthy();
    expect(screen.getByText("gRPC")).toBeTruthy();
  });
});

describe("the whole report", () => {
  it("renders with a translated section quality and null skill lists", () => {
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="technology"
          atsScoreEstimate={61}
          formatGrade="B"
          formatIssue="Clean single-column layout"
          resumeLength={"good" as never}
          candidateName="María López"
          currentRole="Ingeniera de Software"
          resumeText={"María López\nIngeniera de Software Senior\nDirigí un equipo de cinco ingenieros.\n".repeat(4)}
          jobDescriptionText="Buscamos una ingeniera de plataforma con Kafka y Terraform."
          redFlags={[]}
          keywords={[{ keyword: "Kafka", reason: "Esperado", impact: "alta" }] as never}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, sectionQuality: { summary: "sólida", experience: "strong" } } as never}
          matchingSkills={null as never}
          missingSkills={null as never}
          missingSkillsDetailed={null as never}
          skillGapActions={null as never}
          jobMatchScore={58}
          onGetFullAnalysis={vi.fn()}
          onGenerateTailoredResume={vi.fn()}
        />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Section Quality");
    expect(text).toContain("sólida");
    expect(text).toContain("Kafka");
  });
});
