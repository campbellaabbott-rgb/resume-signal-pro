/**
 * THE RESULT SCREEN STILL SOLD A PREMIUM PACKAGE UNDER AN AUTO-REJECTED
 * BANNER (owner decision 1 of 2026-10-08; review of 94778203).
 *
 * The free report itself was cut to two offers, the $5 Full Analysis and
 * Pro, but the homepage rendered a second offer card right under it, with no
 * gate: "⚠️ Your resume is being auto-rejected" and a pulsing "Critical"
 * badge, the $12 Premium Package "Strongly Recommended", another product as
 * the alternative, and an invented "Estimated gain: 30-40 points". The
 * site's own ATS tooltip says they rarely auto-reject. A test that rendered
 * the report alone could not see it.
 *
 * This mounts the whole homepage, scans a restored résumé with the scan
 * endpoint faked, and reads the results region the visitor sees.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

const SCAN = {
  success: true,
  cached: false,
  industry: "data_engineering",
  atsScoreEstimate: 42,
  formatGrade: "C",
  formatIssue: "Two-column layout",
  experienceLevel: "mid",
  candidateName: "Jane Doe",
  currentRole: "Data Engineer",
  topStrength: "Pipeline ownership",
  redFlags: [{ issue: "No metrics in bullets", impact: "Recruiters skip unquantified impact", severity: "critical" }],
  keywords: [{ keyword: "airflow", reason: "Standard for the role", frequencyWeight: 3, suggestedSection: "skills" }],
  quickWins: [{ fix: "Add pipeline throughput numbers", timeEstimate: "10 min", impact: "high", scoreImpact: 6, category: "quantification" }],
  improvementPotential: 20,
};

const invoke = vi.fn(async (fn: string) => (fn === "free-keyword-scan" ? { data: SCAN, error: null } : { data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  for (const k of ["select", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "gte", "lte", "gt", "lt", "insert", "upsert", "update", "delete", "match", "filter"]) chain[k] = q;
  Object.assign(chain, {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: (fn: string) => invoke(fn) },
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

import Index from "@/pages/Index";
import { saveResumeToSession } from "@/hooks/use-session-resume";
import { PRODUCTS, SUBSCRIPTIONS } from "@/config/products";

const RESUME = "Jane Doe\nData Engineer\nBuilt Airflow pipelines processing 2TB a day for three years at Acme.\n".repeat(4);

describe("the homepage's result screen", () => {
  it("offers only the Full Analysis and Pro after a scan, with no urgency banner or invented gain", async () => {
    saveResumeToSession(RESUME);
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    const scan = (await screen.findAllByRole("button", {}, SLOW)).find((b) => b.closest('[data-scan-button="true"]')) as HTMLButtonElement;
    expect(scan, "the free-scan button").toBeTruthy();
    fireEvent.click(scan);
    const steps = await screen.findByTestId("report-next-steps", {}, SLOW);
    expect(invoke.mock.calls.some((c) => c[0] === "free-keyword-scan")).toBe(true);

    // The region the report renders in, and everything after it up to the page's own sections.
    const region = steps.closest("section") as HTMLElement;
    expect(region, "the results section").toBeTruthy();
    const text = region.textContent ?? "";
    expect(text).not.toMatch(/auto-rejected|strongly recommended|estimated gain/i);
    expect(text).not.toContain(PRODUCTS.premiumPackage.name);
    const prices = new Set([...text.matchAll(/\$\s?(\d+)(?![\d.,]*\s?[KMBkmb](?![a-z]))(?![\d.,])/g)].map((m) => Number(m[1])));
    expect([...prices].sort((a, b) => a - b)).toEqual([PRODUCTS.fullAnalysis.priceUsd, SUBSCRIPTIONS.pro.priceUsd].sort((a, b) => a - b));
  });
});
