/**
 * THE REPORT OFFERS THE INDUSTRIES THE SCANNER KNOWS (register S13-018).
 *
 * The free report's "We read this as: Industry" select was built from the
 * client keyword config (getAvailableIndustries): 38 of the scanner's 59
 * industry ids were missing from it and 38 of its options were ids the
 * scanner does not know (camelCase like dataScience). A janitorial,
 * veterinary or skilled-trades résumé showed whichever option came first,
 * and a correction to dataScience was logged and sent as an id the scanner
 * folds to "general". The options are now the scanner's own ids, held in
 * src/config/scan-industries.ts and checked here against free-keyword-scan's
 * VALID_INDUSTRIES; an id the scanner did not list (an older or streamed
 * report) is still shown as itself, never replaced by another.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SCAN_INDUSTRY_IDS, scanIndustryOptions } from "@/config/scan-industries";

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

const SERVER = (() => {
  const src = readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/index.ts"), "utf8");
  const block = /const VALID_INDUSTRIES = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
  return [...block.replace(/\/\/[^\n]*/g, "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
})();

afterEach(() => cleanup());

const mount = (industry: string) => render(
  <MemoryRouter>
    <FreeKeywordResults
      industry={industry} atsScoreEstimate={66} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
      redFlags={[]} keywords={[]} resumeText={"Jordan Probe\nFacilities Technician\n- Kept 4 buildings clean\n".repeat(3)}
      sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
      onGetFullAnalysis={vi.fn()}
    />
  </MemoryRouter>,
);
const industrySelect = (c: HTMLElement) => c.querySelector<HTMLSelectElement>("select[data-industry-select]");

describe("the industry options", () => {
  it("are exactly the scanner's ids", () => {
    expect(SERVER.length).toBeGreaterThan(50);
    expect([...SCAN_INDUSTRY_IDS].sort()).toEqual([...SERVER].sort());
    expect(scanIndustryOptions().map((o) => o.value).sort()).toEqual([...SERVER].sort());
  });

  it("each has a label, and none is a raw id", () => {
    for (const o of scanIndustryOptions()) {
      expect(o.label.trim().length).toBeGreaterThan(1);
      expect(o.label).not.toMatch(/_/);
    }
  });

  it("an id the scanner did not list is shown as itself, not swapped for another", () => {
    const opts = scanIndustryOptions("supply_chain");
    expect(opts.find((o) => o.value === "supply_chain")?.label).toBe("Supply Chain");
    expect(opts.filter((o) => o.value === "supply_chain")).toHaveLength(1);
    expect(scanIndustryOptions("janitorial").filter((o) => o.value === "janitorial")).toHaveLength(1);
  });
});

describe("the report's select", () => {
  for (const id of ["janitorial", "veterinary", "skilled_trades", "data_science", "general"]) {
    it(`shows a ${id} résumé as ${id}`, () => {
      const { container } = mount(id);
      const sel = industrySelect(container);
      expect(sel, "the industry select").not.toBeNull();
      expect(sel!.value).toBe(id);
      const values = [...sel!.options].map((o) => o.value);
      expect(values).not.toContain("dataScience");
      for (const v of values) expect(SERVER, `${v} is not an id the scanner knows`).toContain(v);
    });
  }
});
