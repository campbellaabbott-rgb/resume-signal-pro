/**
 * ONE INDUSTRY CORRECTION IS ONE LOGGED ROW (S14X-046).
 *
 * The industry card logs a correction itself (log_industry_correction, with
 * the scanner's signals and the source "server") and then hands the new
 * industry to the report. The report's handler logged it again, as a select
 * change, so every correction made on the card counted twice in the table
 * the detector is tuned from. The report now logs only its own select; a
 * card correction is the card's one row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.hoisted(() => vi.fn(async (_name: string, _args?: unknown) => ({ data: null, error: null })));
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
      rpc,
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

beforeEach(() => { rpc.mockClear(); });
afterEach(() => cleanup());

const mount = () => render(
  <MemoryRouter>
    <FreeKeywordResults
      onContextConfirm={vi.fn()}
      industry="janitorial" atsScoreEstimate={66} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
      industryDetection={{ detected: "janitorial", confidence: "medium", signals: ["custodial"] } as never}
      redFlags={[]} keywords={[]} resumeText={"Jordan Probe\nFacilities Technician\n- Kept 4 buildings clean\n".repeat(3)}
      sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
      onGetFullAnalysis={vi.fn()}
    />
  </MemoryRouter>,
);
const logged = () => rpc.mock.calls.filter(([name]) => name === "log_industry_correction");
/** The corrected id, under either overload's parameter name. */
const corrected = (row: unknown) => { const a = row as { p_corrected_industry?: string; p_corrected?: string }; return a.p_corrected_industry ?? a.p_corrected; };
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("an industry correction", () => {
  it("made on the industry card is logged once", async () => {
    const { container } = mount();
    const card = within(container);
    fireEvent.click(card.getAllByText(/Industry:/i)[0]);
    fireEvent.click(card.getByText(/Change Industry/i));
    const grid = container.querySelector<HTMLElement>(".grid.max-h-48");
    expect(grid, "the correction grid").not.toBeNull();
    fireEvent.click(within(grid!).getByRole("button", { name: "Veterinary" }));
    await waitFor(() => expect(logged().length).toBeGreaterThan(0), { timeout: 2000 });
    await settle();
    expect(logged(), "one correction, two rows").toHaveLength(1);
    expect(corrected(logged()[0][1])).toBe("veterinary");
  });

  it("made in the report's select is logged once", async () => {
    const { container } = mount();
    const select = container.querySelector<HTMLSelectElement>("select[data-industry-select]");
    expect(select, "the industry select").not.toBeNull();
    fireEvent.change(select!, { target: { value: "dental" } });
    await waitFor(() => expect(logged().length).toBeGreaterThan(0), { timeout: 2000 });
    await settle();
    expect(logged()).toHaveLength(1);
    expect(corrected(logged()[0][1])).toBe("dental");
  });
});
