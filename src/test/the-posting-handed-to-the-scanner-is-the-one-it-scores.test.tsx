/**
 * THE POSTING HANDED TO THE SCANNER IS THE ONE IT SCORES (sweep S11-008).
 *
 * WHAT WAS WRONG. A visitor scanned against posting A, and the scan saved A's
 * description to the tab's session. They then pressed "Check my fit" on
 * posting B (the board, or a posting page), which writes the hand-off and
 * opens "/". On mount the hand-off effect set B and announced "Job
 * description loaded -- B". The session-restore effect ran next in the same
 * commit, still holding the first render's empty description, and set A on
 * top of it. React kept the last update, the uploader showed A, and the scan
 * scored the résumé against A while the toast named B. Every fit check after
 * the first in a tab was against the previous posting.
 *
 * WHAT HOLDS NOW, on the whole homepage mounted with both session keys
 * seeded: the description the uploader receives is the handed-off one, and
 * the session now holds it too, so a reload keeps B rather than bringing A
 * back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { JD_HANDOFF_KEY } from "@/lib/jd-handoff";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "order", "limit", "gte", "lte", "in"]) th[k] = () => th;
    th.maybeSingle = async () => ({ data: null });
    th.single = async () => ({ data: null });
    th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
    return th;
  };
  return {
    supabase: {
      functions: { invoke: async () => ({ data: null, error: null }) },
      from: table,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
// The uploader, reduced to what it is handed: the description the scan sends.
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: ({ jobDescriptionText }: { jobDescriptionText?: string }) => (
    <pre data-testid="scan-jd">{jobDescriptionText ?? ""}</pre>
  ),
}));

import Index from "@/pages/Index";

vi.setConfig(MOUNT_TEST_BUDGET);

const POSTING_A = "POSTING A. Senior payroll analyst at Alpha Co. Reconcile multi-state payroll, own the quarterly filings, and partner with HR on audits.";
const POSTING_B = "POSTING B. Staff data engineer at Beta Co. Build streaming pipelines in Kafka and Flink, own the warehouse models and mentor two engineers.";

beforeEach(() => {
  sessionStorage.clear();
  // The previous scan in this tab saved A whole (persistScanInputs).
  sessionStorage.setItem("rb_resume_text", "Jane Candidate, data engineer. ".repeat(8));
  sessionStorage.setItem("rb_job_description_text", POSTING_A);
  // Then "Check my fit" on posting B.
  sessionStorage.setItem(JD_HANDOFF_KEY, JSON.stringify({ jd: POSTING_B, title: "Staff data engineer", company: "Beta Co" }));
});
afterEach(() => { cleanup(); sessionStorage.clear(); });

describe("a hand-off arriving over a restored session", () => {
  it("scores the posting that was handed over, not the one the last scan saved", async () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(screen.getByTestId("scan-jd").textContent).not.toBe(""));
    expect(screen.getByTestId("scan-jd").textContent, "the restored session overwrote the hand-off").toBe(POSTING_B);
  });

  it("keeps the handed-off posting in the session, so a reload does not bring the old one back", async () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(screen.getByTestId("scan-jd").textContent).not.toBe(""));
    expect(sessionStorage.getItem("rb_job_description_text")).toBe(POSTING_B);
    expect(sessionStorage.getItem(JD_HANDOFF_KEY), "the hand-off is read once").toBeNull();
  });

  it("a restored session with no hand-off still restores its own posting", async () => {
    sessionStorage.removeItem(JD_HANDOFF_KEY);
    render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
    await waitFor(() => expect(screen.getByTestId("scan-jd").textContent).toBe(POSTING_A));
  });
});
