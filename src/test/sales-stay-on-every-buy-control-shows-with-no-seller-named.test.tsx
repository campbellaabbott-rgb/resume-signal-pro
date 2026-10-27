/**
 * EVERY BUY CONTROL SHOWS WITH NO SELLER NAMED, AND THE REPORT OFFERS ITS
 * MAIL (owner, 2026-10-27: "there is no sales pause ... no one told you to do
 * that").
 *
 * Wave 4 replaced the buy buttons with "Purchases open soon" and hid the
 * pulse and fix-plan boxes while src/config/seller.ts was empty, which is how
 * it ships. Mounted for real with the shipped identity (nothing mocks the
 * seller or the purchase state):
 *   - /pricing links to the Full Analysis checkout and offers "Go Pro", with
 *     their terms, and says nothing opens soon;
 *   - the uploader's priced link under the free scan and its priced fallback
 *     with no free scan are there;
 *   - the homepage comparison's priced call to action is there;
 *   - the free report offers the Full Analysis;
 *   - the report's email capture offers the monthly pulse and the fix-plan
 *     emails, and a ticked box asks for them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q, is: q, not: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: (...a: unknown[]) => invoke(...a) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false, planTier: null, cancelAtPeriodEnd: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import Pricing from "@/pages/Pricing";
import { ResumeUploader } from "@/components/ResumeUploader";
import { ComparisonTable } from "@/components/ComparisonTable";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { EmailReportCapture } from "@/components/EmailReportCapture";
import { PRODUCTS } from "@/config/products";
import { SELLER } from "@/config/seller";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async () => ({ data: { success: true }, error: null }));
});
afterEach(cleanup);

const PRICE = new RegExp(`\\$${PRODUCTS.fullAnalysis.priceUsd}\\b`);
const pricedButtons = () => screen.queryAllByRole("button").filter((b) => PRICE.test(b.textContent ?? "") && !b.closest('[data-scan-button="true"]'));
const nothingOpensSoon = () => {
  expect(document.querySelector("[data-purchases-open-soon]")).toBeNull();
  expect(document.body.textContent ?? "").not.toMatch(/open soon/i);
};

describe("the premise", () => {
  it("the page's seller ships empty", () => {
    expect({ ...SELLER }).toEqual({ legalName: "", postalAddress: "" });
  });
});

describe("/pricing", () => {
  it("links to the Full Analysis, offers Go Pro with its terms, and says nothing opens soon", () => {
    render(<MemoryRouter initialEntries={["/pricing"]}><Pricing /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Get Full Resume Analysis/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go Pro/ })).toBeInTheDocument();
    expect(document.querySelector("[data-testid='purchase-terms']")).not.toBeNull();
    nothingOpensSoon();
  });
});

describe("the uploader and the comparison", () => {
  const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts";
  const uploader = (withFreeScan: boolean) => render(
    <MemoryRouter>
      <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={withFreeScan ? vi.fn() : undefined} isLoading={false} hasContent resumeText={RESUME} />
    </MemoryRouter>,
  );

  it("the uploader prices the analysis under the free scan, and as its fallback with no free scan", () => {
    uploader(true);
    expect(pricedButtons().length).toBe(1);
    nothingOpensSoon();
    cleanup();
    uploader(false);
    expect(pricedButtons().length).toBe(1);
    nothingOpensSoon();
  });

  it("the homepage comparison's call to action prices the analysis", () => {
    render(<ComparisonTable />);
    expect(pricedButtons().length).toBe(1);
    nothingOpensSoon();
  });
});

describe("the free report", () => {
  it("offers the Full Analysis", async () => {
    const { getByTestId } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="data_engineering"
          atsScoreEstimate={62}
          formatGrade="B"
          formatIssue="Minor spacing inconsistencies"
          resumeLength={"good" as never}
          candidateName="Jane Doe"
          currentRole="Senior Data Engineer"
          resumeText={"Jane Doe\nSenior Data Engineer\nBuilt pipelines with Airflow and Spark for 3 years.\n".repeat(4)}
          redFlags={[{ issue: "No metrics in bullets", impact: "Recruiters skip unquantified impact", severity: "critical" }] as never}
          keywords={[{ keyword: "airflow", reason: "Standard for the role", frequencyWeight: 3, suggestedSection: "skills" }] as never}
          quickWins={[{ fix: "Add pipeline throughput numbers", timeEstimate: "10 min", impact: "high", scoreImpact: 6, category: "quantification" }] as never}
          onGetFullAnalysis={vi.fn()}
          onGenerateTailoredResume={vi.fn()}
          jobMatchScore={64}
          jobMatchGrade={"C" as never}
          matchingSkills={["Airflow"]}
          missingSkills={["dbt"]}
        />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const steps = getByTestId("report-next-steps");
    expect(steps.querySelector('[data-offer="fullAnalysis"]')).not.toBeNull();
    expect(steps.querySelector("[data-purchases-open-soon]")).toBeNull();
  });
});

describe("the report's email capture", () => {
  const payload = {
    score: 74, projectedScore: 86, scoreBreakdown: null, peerPercentile: null,
    applicationPassRate: null, redFlags: [], fixRoadmap: null, industry: "technology",
  };

  it("offers the monthly pulse and the fix-plan emails, both unticked", () => {
    render(<EmailReportCapture payload={payload} />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(screen.getByText(/monthly market pulse/i)).toBeInTheDocument();
    expect(screen.getByText(/short email sequence/i)).toBeInTheDocument();
  });

  it("a ticked fix-plan box asks for the sequence, and a ticked pulse box asks send-market-pulse", async () => {
    render(<EmailReportCapture payload={payload} />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "seeker@example.org" } });
    for (const b of screen.getAllByRole("checkbox")) fireEvent.click(b);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(invoke.mock.calls.map((c) => c[0])).toContain("send-market-pulse"));
    const report = invoke.mock.calls.find((c) => c[0] === "send-scan-report")!;
    expect((report[1] as { body: Record<string, unknown> }).body.dripOptIn).toBe(true);
  });
});
