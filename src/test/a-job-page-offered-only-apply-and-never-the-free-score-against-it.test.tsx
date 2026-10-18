// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * A JOB PAGE OFFERED ONLY "APPLY" AND NEVER THE FREE SCORE AGAINST IT.
 *
 * WHAT WAS WRONG. The posting page holds the employer's whole description,
 * and the scanner on "/" already reads a posting handed to it (the board's
 * "Check my fit" writes it, Index reads it on mount and pre-fills the job
 * description). Yet the page's one action was Apply: 23 of 40 sampled posting
 * descriptions promise a résumé check (commercial-readiness plan, 2026-10-08)
 * and the page offered none.
 *
 * WHAT THIS HOLDS. A live posting with a description shows "Score my résumé
 * against this job (free)"; pressing it stores the posting for the scanner
 * through the same hand-off the scanner reads, lands on "/#upload", and is
 * counted (with the page view that is its denominator). A description too
 * short for the scanner to accept offers no button that would do nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowAnalytics } from "./helpers/analytics-consent";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { takeJdHandoff } from "@/lib/jd-handoff";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: [] }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import JobPosting from "../pages/JobPosting";

const PATH = "/jobs/posting/greenhouse/acme/4012345";
const DESCRIPTION = "We are hiring a staff accountant to own month-end close, reconciliations and audit support. ".repeat(4);
const row = () => ({
  id: "greenhouse:acme:4012345", title: "Staff Accountant", company: "Acme", location: "Austin, TX", country: "US",
  workMode: null, token: "acme", source: "greenhouse", postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  missingSince: null, applyUrl: "https://boards.greenhouse.io/acme/jobs/4012345", salary: null, agency: false,
});

function Scanner() {
  const loc = useLocation();
  return <div data-testid="scanner">{`${loc.pathname}${loc.hash}`}</div>;
}
const at = () =>
  render(
    <MemoryRouter initialEntries={[PATH]}>
      <Routes>
        <Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} />
        <Route path="/" element={<Scanner />} />
      </Routes>
    </MemoryRouter>,
  );
function hookFetch() {
  vi.stubEnv("DEV", false);
  const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ status: "recorded" }), { status: 200 }));
  vi.stubGlobal("fetch", spy);
  return () =>
    spy.mock.calls
      .filter(([u]) => String(u).endsWith("/functions/v1/track-ab-event"))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { testName: string; variant: string; metadata?: { page?: string } });
}

beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); sessionStorage.clear(); allowAnalytics(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearBoardBudgetRefusal(); });

describe("a job page offers the free score against its own posting", () => {
  it("the button hands the posting to the scanner, lands on the uploader, and is counted with its page view", async () => {
    const sent = hookFetch();
    invoke.mockResolvedValue({ data: { job: row(), description: DESCRIPTION }, error: null });
    at();
    const button = await screen.findByRole("button", { name: "Score my résumé against this job (free)" });
    await waitFor(() => expect(sent().some((b) => b.testName === "job_page" && b.variant === "posting_view")).toBe(true));
    expect(sent().find((b) => b.variant === "posting_view")!.metadata?.page).toBe(PATH);

    fireEvent.click(button);
    expect((await screen.findByTestId("scanner")).textContent).toBe("/#upload");
    await waitFor(() => expect(sent().some((b) => b.testName === "job_page" && b.variant === "score_against_job")).toBe(true));
    // What the scanner will read on mount: this posting, whole.
    expect(takeJdHandoff()).toEqual({
      jd: DESCRIPTION, title: "Staff Accountant", company: "Acme", applyUrl: "https://boards.greenhouse.io/acme/jobs/4012345",
    });
  });

  it("Apply stays, and stays first", async () => {
    invoke.mockResolvedValue({ data: { job: row(), description: DESCRIPTION }, error: null });
    at();
    const score = await screen.findByRole("button", { name: "Score my résumé against this job (free)" });
    const apply = screen.getByRole("link", { name: /Apply on Acme's own site/ });
    expect(apply.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a description the scanner would refuse offers no button", async () => {
    invoke.mockResolvedValue({ data: { job: row(), description: "Short blurb." }, error: null });
    at();
    await screen.findByRole("heading", { level: 1, name: "Staff Accountant" });
    expect(screen.queryByRole("button", { name: /Score my résumé/ })).toBeNull();
  });
});
