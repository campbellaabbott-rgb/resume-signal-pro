/**
 * A PAUSED PULSE AND A PAUSED FIX-PLAN SEQUENCE ARE OFFERED NOWHERE (recheck 3
 * of wave 4, 2026-10-26).
 *
 * While the seller is unnamed (as shipped), marketing mail is paused: the
 * market-pulse batch sends nothing and the report mail carries no button for
 * the fix-plan emails. The free report still offered both boxes, said "Your
 * report email has a button to start the fix-plan emails", asked for a pulse
 * confirmation, and /market-pulse/confirm said "The first pulse arrives within
 * a day". Mounted for real with only the network faked, as shipped: no box,
 * no drip or pulse request, no such line, and a paused confirmation that
 * promises no pulse. The page's pause reads the frontend's copy of the seller,
 * which answers as the server's does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { EmailReportCapture } from "../components/EmailReportCapture";
import MarketPulseConfirm from "../pages/MarketPulseConfirm";
import { marketingMailPaused } from "@/lib/marketing-pause";
import { marketingPaused, MARKETING_PAUSED } from "../../supabase/functions/_shared/marketing-pause";
import { SELLER } from "@/config/seller";
import EN from "@/i18n/locales/en.json";

const payload = {
  score: 74, projectedScore: 86, scoreBreakdown: null, peerPercentile: null,
  applicationPassRate: null, redFlags: [], fixRoadmap: null, industry: "technology",
};
const TOKEN = "ab".repeat(32);
const PC = (EN as { pulseConfirm: Record<string, string> }).pulseConfirm;

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockImplementation(async () => ({ data: { success: true }, error: null }));
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("the page's pause is the server's", () => {
  it("as shipped both say paused, and both open once a seller is named", () => {
    expect(marketingMailPaused()).toBe(true);
    expect(marketingMailPaused()).toBe(marketingPaused());
    const named = { legalName: "Example Seller LLC", postalAddress: "1 Example Street, Springfield" };
    expect(marketingMailPaused(named)).toBe(false);
    expect(marketingPaused(named)).toBe(false);
    expect(SELLER).toEqual({ legalName: "", postalAddress: "" });
  });
});

describe("the report's email capture while marketing is paused", () => {
  it("offers neither the monthly pulse nor the fix-plan emails", () => {
    render(<EmailReportCapture payload={payload} />);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryByText(/monthly market pulse/i)).toBeNull();
    expect(screen.queryByText(/short email sequence/i)).toBeNull();
  });

  it("sends the report alone, asks for no drip, asks the pulse nothing, and claims no button or pulse", async () => {
    render(<EmailReportCapture payload={payload} />);
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "seeker@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getByText(/Sent!/)).toBeInTheDocument());
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(["send-scan-report"]);
    expect((invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body.dripOptIn).toBe(false);
    expect(screen.queryByText(/button to start the fix-plan emails/i)).toBeNull();
    expect(screen.queryByText(/confirmation link/i)).toBeNull();
  });
});

describe("/market-pulse/confirm while marketing is paused", () => {
  it("a link mailed earlier confirms, and the page says the pulse is paused instead of promising one", async () => {
    invoke.mockImplementation(async () => ({ data: { success: true, confirmed: true, paused: MARKETING_PAUSED }, error: null }));
    window.history.replaceState(null, "", `/market-pulse/confirm#t=${TOKEN}`);
    render(<HelmetProvider><MemoryRouter><MarketPulseConfirm /></MemoryRouter></HelmetProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /yes, send me the pulse/i }));
    await waitFor(() => expect(screen.getByText(PC.donePaused)).toBeInTheDocument());
    expect(screen.queryByText(/first pulse arrives/i)).toBeNull();
    expect(PC.donePaused).toMatch(/paused/);
    expect(PC.donePaused).not.toMatch(/arrives within/);
  });

  it("positive control: an answer that is not paused keeps the promise of the first pulse", async () => {
    invoke.mockImplementation(async () => ({ data: { success: true, confirmed: true }, error: null }));
    window.history.replaceState(null, "", `/market-pulse/confirm#t=${TOKEN}`);
    render(<HelmetProvider><MemoryRouter><MarketPulseConfirm /></MemoryRouter></HelmetProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /yes, send me the pulse/i }));
    await waitFor(() => expect(screen.getByText(PC.done)).toBeInTheDocument());
  });
});
