/**
 * THE HOMEPAGE READS ONLY THE FILE ON SCREEN, AND A REPEATED DRAFT IS NO EDIT
 * (registers S11-030, S11-031; the page's half of S11-033 and S11-035).
 *
 * Index.handleFileSelect never cleared the old résumé and had no sequence
 * guard, so two reads landing out of order left the FIRST file's text as the
 * one scanned and bought, and a read that finished after Clear brought the
 * cleared résumé back. A failed read reset only the page's own pick, so the
 * uploader kept saying "uploaded". handleResumeDraftChange nulled the report
 * whenever the uploader re-sent an unchanged draft. And a damaged file or an
 * unreadable PDF answered in the server's English.
 *
 * Rendered with the real page; the uploader is reduced to the props Index
 * hands it, and the parse calls are held open so their order can be chosen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

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
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      from: table,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
const clearCaches = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-streaming-scan", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  clearAllClientScanCaches: clearCaches,
}));

type Answer = { data: unknown; error: unknown; errorBody?: Record<string, unknown> | null; attempts: number; totalDuration: number };
const pending = vi.hoisted(() => [] as Array<{ name: string; resolve: (a: Answer) => void }>);
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  const held = (form: unknown) => new Promise<Answer>((resolve) => {
    const file = (form as FormData).get("file") as File;
    pending.push({ name: file.name, resolve });
  });
  return { ...actual, resilientCallers: { ...actual.resilientCallers, parsePdf: held, parseDocx: held } };
});

const TEXT = (who: string) => `${who}\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions`;

// The uploader, reduced to what Index hands it.
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: (p: { onFileSelect: (f: File) => void; onClearResume?: () => void; onResumeDraftChange?: (t: string) => void; resumeText?: string; isLoading?: boolean; uploadResetSignal?: number }) => (
    <div>
      <button type="button" onClick={() => p.onFileSelect(new File(["%PDF-1.4 a"], "first.pdf", { type: "application/pdf" }))}>pick first</button>
      <button type="button" onClick={() => p.onFileSelect(new File(["%PDF-1.4 b"], "second.pdf", { type: "application/pdf" }))}>pick second</button>
      <button type="button" onClick={() => p.onClearResume?.()}>clear</button>
      <button type="button" onClick={() => p.onResumeDraftChange?.(TEXT("Pasted Person"))}>draft</button>
      <output data-testid="resume">{p.resumeText ?? ""}</output>
      <output data-testid="loading">{String(!!p.isLoading)}</output>
      <output data-testid="upload-reset">{String(p.uploadResetSignal ?? 0)}</output>
    </div>
  ),
}));

import Index from "@/pages/Index";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => {
  cleanup(); toast.mockReset(); clearCaches.mockReset(); pending.length = 0;
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});

function mount() {
  render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
}
const resume = () => screen.getByTestId("resume").textContent ?? "";
const ok = (who: string): Answer => ({ data: { success: true, text: TEXT(who), pages: 1 }, error: null, attempts: 1, totalDuration: 1 });
async function answer(name: string, a: Answer) {
  const i = pending.findIndex((p) => p.name === name);
  expect(i, `no read in flight for ${name}`).toBeGreaterThanOrEqual(0);
  const [p] = pending.splice(i, 1);
  await act(async () => { p.resolve(a); await new Promise((r) => setTimeout(r, 0)); });
}

describe("S11-030: only the file on screen becomes the résumé", () => {
  it("two reads landing out of order leave the SECOND file's text", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "pick first" }));
    fireEvent.click(screen.getByRole("button", { name: "pick second" }));
    await waitFor(() => expect(pending.length).toBe(2));
    await answer("second.pdf", ok("Second Person"));
    expect(resume()).toContain("Second Person");
    await answer("first.pdf", ok("First Person"));
    expect(resume(), "the first file's late answer replaced the second").toContain("Second Person");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("picking a new file clears the old résumé while it is read", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "pick first" }));
    await waitFor(() => expect(pending.length).toBe(1));
    await answer("first.pdf", ok("First Person"));
    expect(resume()).toContain("First Person");
    fireEvent.click(screen.getByRole("button", { name: "pick second" }));
    await waitFor(() => expect(resume()).toBe(""));
  });

  it("a read that finishes after Clear does not bring the cleared résumé back", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "pick first" }));
    await waitFor(() => expect(pending.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await answer("first.pdf", ok("First Person"));
    expect(resume()).toBe("");
  });

  it("a failed read tells the uploader to drop the file, in the visitor's language when the file is damaged", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "pick first" }));
    await waitFor(() => expect(pending.length).toBe(1));
    const before = Number(screen.getByTestId("upload-reset").textContent);
    await answer("first.pdf", {
      data: null, attempts: 1, totalDuration: 1,
      error: { title: "Error", description: "This file looks damaged or isn't a real PDF.", isRetryable: true },
      errorBody: { success: false, code: "damaged_file", error: "This file looks damaged or isn't a real PDF." },
    });
    expect(Number(screen.getByTestId("upload-reset").textContent)).toBe(before + 1);
    expect(resume()).toBe("");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "This file can't be read" }));
  });

  it("an accepted PDF that lost characters says so, and how to get them read", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "pick first" }));
    await waitFor(() => expect(pending.length).toBe(1));
    await answer("first.pdf", { data: { success: true, text: TEXT("प्रिया शर्मा"), pages: 1, notice: "unread_characters", unreadCharacters: 31 }, error: null, attempts: 1, totalDuration: 1 });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Some characters couldn't be read" }));
    expect(JSON.stringify(toast.mock.calls)).toContain("31");
  });
});

describe("S11-031: the same draft again is no edit", () => {
  it("a repeated draft clears no cache and no report", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "draft" }));
    await waitFor(() => expect(resume()).toContain("Pasted Person"));
    const after = clearCaches.mock.calls.length;
    expect(after).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "draft" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(clearCaches.mock.calls.length, "an unchanged draft was treated as an edit").toBe(after);
  });
});
