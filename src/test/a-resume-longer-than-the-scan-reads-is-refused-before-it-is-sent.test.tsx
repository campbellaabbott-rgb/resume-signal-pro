/**
 * A RÉSUMÉ LONGER THAN THE SCAN READS IS REFUSED BEFORE IT IS SENT
 * (register S13-008, the review of 2026-11-01).
 *
 * The client's cap matched the scanners' 50,000 characters, but nothing read
 * it on the free scan's path: validateResumeBeforeSend ran only in the
 * disabled background scan and the streaming hook. A 60,000-character paste
 * went to free-keyword-scan, which answered 400, and the page showed a scan
 * failure. Now the homepage says so as soon as the text is read and sends
 * nothing; the uploader says so under the box.
 *
 * The whole homepage is mounted; the uploader is reduced to the button that
 * starts the free scan with the pasted text, and the primary scanner's
 * caller is a spy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "@/i18n/locales/en.json";

const h = vi.hoisted(() => ({
  text: "",
  scan: vi.fn(async () => ({ data: null, error: { title: "x", description: "x" } })),
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => {
  const table = () => {
    const th: Record<string, unknown> = {};
    for (const k of ["select", "eq", "is", "not", "order", "limit", "gte", "lte", "in", "insert", "upsert", "update"]) th[k] = () => th;
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
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast, dismiss: vi.fn(), toasts: [] }), toast: h.toast }));
vi.mock("@/lib/resilient-edge-function", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, resilientCallers: { ...(real.resilientCallers as object), freeKeywordScan: h.scan } };
});
// The uploader, reduced to its free-scan button with the pasted text.
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: ({ onFreeScan }: { onFreeScan?: (text?: string, jd?: string) => void }) => (
    <button type="button" onClick={() => onFreeScan?.(h.text, "")}>scan</button>
  ),
}));

import Index from "@/pages/Index";
import { MAX_RESUME_LENGTH } from "@/lib/resume-validation";

vi.setConfig(MOUNT_TEST_BUDGET);

const LINE = "Registered Nurse, City Hospital, 2015 - 2024. Led a ward of 30 beds and trained 12 new staff. ";
const ofLength = (n: number) => LINE.repeat(Math.ceil(n / LINE.length)).slice(0, n);

beforeEach(() => { sessionStorage.clear(); h.scan.mockClear(); h.toast.mockClear(); });
afterEach(() => { cleanup(); sessionStorage.clear(); });

const mountAndScan = (text: string) => {
  h.text = text;
  render(<HelmetProvider><MemoryRouter initialEntries={["/"]}><Index /></MemoryRouter></HelmetProvider>);
  fireEvent.click(screen.getByRole("button", { name: "scan" }));
};

describe("the free scan's path refuses what the scanner refuses", () => {
  it("a 60,000-character résumé is never sent, and the visitor is told why", async () => {
    mountAndScan(ofLength(60_000));
    await waitFor(() => expect(h.toast.mock.calls.some(([arg]) => arg?.title === en.homepage.toast.resumeTooLong)).toBe(true));
    const said = h.toast.mock.calls.find(([arg]) => arg?.title === en.homepage.toast.resumeTooLong)![0];
    expect(said.variant).toBe("destructive");
    expect(said.description).toContain("60,000");
    expect(said.description).toContain(MAX_RESUME_LENGTH.toLocaleString("en-US"));
    // Give any stray await a turn: the scanner is still never called.
    await new Promise((r) => setTimeout(r, 50));
    expect(h.scan).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("rb_resume_text"), "a refused résumé was stored for a purchase").not.toBe(ofLength(60_000));
  });

  it("one at the cap is sent (the positive control)", async () => {
    mountAndScan(ofLength(MAX_RESUME_LENGTH));
    await waitFor(() => expect(h.scan).toHaveBeenCalled());
    expect(h.toast.mock.calls.some(([arg]) => arg?.title === en.homepage.toast.resumeTooLong)).toBe(false);
  });
});
