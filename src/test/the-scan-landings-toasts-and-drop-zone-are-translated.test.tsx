/**
 * THE SCAN LANDING'S TOASTS AND DROP ZONE ARE TRANSLATED (S14X-253).
 *
 * Three things on the scanner's landing spoke English in every language:
 * the uploader's "Unsupported file type" toast for a dropped spreadsheet
 * (the keys homepage.toast.unsupportedFileType* exist in every locale and
 * were not used), the "Scan credit used" receipt after a credit-paid scan,
 * and the hero's drop-zone sentence, whose keys no locale had, so t() fell
 * back to its English default everywhere. Each now reads a key the reader's
 * locale has.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "gte", "lte", "insert", "upsert", "update", "delete"]) chain[k] = () => chain;
  Object.assign(chain, {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));
const freeScan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, freeKeywordScan: freeScan } };
});
const RESUME = vi.hoisted(() => "Juana Pérez\nIngeniera de datos, Acme, 2020 - actualidad\n- Construí canalizaciones que mueven dos mil millones de filas al día\n- Dirigí un equipo de cinco ingenieros");
// The page's uploader is the real one, with two buttons beside it that hand
// the page a draft and press the scan, as the uploader does.
vi.mock("@/components/ResumeUploader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ResumeUploader")>();
  const Real = actual.ResumeUploader;
  return {
    ...actual,
    ResumeUploader: (p: Parameters<typeof Real>[0]) => (
      <>
        <Real {...p} />
        <button type="button" onClick={() => p.onResumeDraftChange?.(RESUME)}>draft</button>
        <button type="button" onClick={() => p.onFreeScan?.(RESUME)}>scan</button>
      </>
    ),
  };
});
vi.mock("@/components/FreeKeywordResults", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  FreeKeywordResults: () => <div data-testid="report" />,
}));
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import i18n from "@/i18n";
import Index from "@/pages/Index";
import { Hero } from "@/components/Hero";
import { ResumeUploader } from "@/components/ResumeUploader";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
  if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  await i18n.changeLanguage(lng);
}
beforeEach(() => { toast.mockReset(); freeScan.mockReset(); try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ } });
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("in Spanish", () => {
  it("a dropped spreadsheet is refused in Spanish", async () => {
    await speak("es");
    render(<MemoryRouter><ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} /></MemoryRouter>);
    const panel = document.getElementById("resume-upload-panel")!;
    const file = new File(["a,b"], "cv.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.drop(panel, { dataTransfer: { files: [file] } });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: i18n.t("homepage.toast.unsupportedFileType"),
      description: i18n.t("homepage.toast.unsupportedFileTypeDescription"),
    }));
    expect(JSON.stringify(toast.mock.calls)).not.toContain("Unsupported file type");
  });

  it("the hero's drop zone says its sentence in Spanish", async () => {
    await speak("es");
    const { container } = render(<MemoryRouter><Hero onFileSelect={vi.fn()} /></MemoryRouter>);
    const label = container.querySelector('label input[type="file"]')!.closest("label")!;
    expect(label.textContent).toContain(i18n.t("freeScanPage.hero.dropzone"));
    expect(label.textContent).not.toMatch(/drop your resume here/i);
  });

  it("a credit-paid scan's receipt is in Spanish", async () => {
    await speak("es");
    freeScan.mockResolvedValue({
      data: { success: true, industry: "data_engineering", atsScoreEstimate: 64, keywords: [], redFlags: [], quickWins: [], creditUsed: true, creditsRemaining: 3 },
      error: null, attempts: 1, totalDuration: 1,
    });
    render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
    fireEvent.click(screen.getByRole("button", { name: "scan" }));
    await waitFor(() => expect(toast.mock.calls.some(([a]) => (a as { title?: string }).title === i18n.t("freeScanPage.toast.creditUsedTitle"))).toBe(true), SLOW);
    expect(JSON.stringify(toast.mock.calls)).not.toContain("Scan credit used");
  });
});
