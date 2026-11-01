/**
 * THE PULSE IS OFFERED AS THE CURATED KEYWORDS IT SENDS (S13-100).
 *
 * WHAT WAS WRONG. The monthly market pulse mails the core keywords from our
 * curated keyword table for the field (send-market-pulse's buildDigest reads
 * KEYWORD_FREQUENCY), and its mail says it is not a count of this month's
 * postings. But the page a confirmation link opens promised "the keywords job
 * postings in your field are screening for", and the box under the scan report
 * promised "the keywords rising in my industry": a measurement of postings
 * that nothing makes.
 *
 * WHAT HOLDS NOW: both places say what is sent, the curated core keywords for
 * the field, and neither claims a reading of postings.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn(async () => ({ data: null, error: null })) } },
}));

import MarketPulseConfirm from "../pages/MarketPulseConfirm";
import { EmailReportCapture } from "../components/EmailReportCapture";

const TOKEN = "ab".repeat(32);
const POSTINGS_CLAIM = /postings in your field are screening for|keywords rising in/i;

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("what the market pulse is said to be", () => {
  it("the confirmation page names the curated keywords, not a reading of postings", async () => {
    window.history.replaceState(null, "", `/market-pulse/confirm#t=${TOKEN}`);
    render(<HelmetProvider><MemoryRouter><MarketPulseConfirm /></MemoryRouter></HelmetProvider>);
    await screen.findByRole("button", { name: /yes, send me the pulse/i });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(POSTINGS_CLAIM);
    expect(text).toMatch(/curated keyword guide/i);
    expect(text).toMatch(/not a count of this month's postings/i);
  });

  it("the box under the scan report offers the same thing", () => {
    render(<EmailReportCapture payload={{ score: 70, projectedScore: 80, scoreBreakdown: null, peerPercentile: null, applicationPassRate: null, redFlags: [], fixRoadmap: null, industry: "technology" }} />);
    const box = screen.getByRole("checkbox", { name: /monthly market pulse/i });
    const label = box.closest("label")?.textContent ?? "";
    expect(label).not.toMatch(POSTINGS_CLAIM);
    expect(label).toMatch(/curated keyword guide/i);
  });
});
