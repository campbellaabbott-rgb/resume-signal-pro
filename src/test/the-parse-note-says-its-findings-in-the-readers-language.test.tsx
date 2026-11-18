/**
 * THE PARSE NOTE SAYS ITS FINDINGS IN THE READER'S LANGUAGE, AND NEVER
 * CALLS A NON-ENGLISH CV SECTIONLESS (NB-6, NB-17).
 *
 * The note above the report joined the scanner's English issue sentences
 * ("only 80 words extracted; no standard resume sections found") into an
 * English banner in every locale. And the scanner's section check reads
 * English headings only, so a clean German or Spanish CV was told no
 * standard sections were found, counted as a second problem, which made the
 * banner "may not have been read correctly", and the section audit showed
 * every section missing. The note now says each known issue by a key in the
 * reader's language; for a CV the scanner detected as another language the
 * sections finding is dropped and the verdict counted again from what is
 * left; and the section audit is not shown for such a CV.
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
const RESUME = "Juana Pérez\nIngeniera de datos, Acme, 2020 - actualidad\n- Construí canalizaciones que mueven dos mil millones de filas al día\n- Dirigí un equipo de cinco ingenieros";
vi.mock("@/components/ResumeUploader", () => ({
  ResumeUploader: (p: { onResumeDraftChange?: (t: string) => void; onFreeScan?: (t?: string) => void }) => (
    <div>
      <button type="button" onClick={() => p.onResumeDraftChange?.(RESUME)}>draft</button>
      <button type="button" onClick={() => p.onFreeScan?.(RESUME)}>scan</button>
    </div>
  ),
}));
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

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
  if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  await i18n.changeLanguage(lng);
}
/** The note module, or null where it does not exist. */
const notes = async () => {
  try { return await import("@/lib/scan-fallback") as unknown as { parseNoteFor?: (q: unknown, l?: unknown) => unknown }; } catch { return null; }
};
const ISSUES = ["only 80 words extracted", "no standard resume sections found"];

beforeEach(() => { freeScan.mockReset(); toast.mockReset(); try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ } });
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("the parse note", () => {
  it("names each known issue by a key, and keeps an unknown one as written", async () => {
    const parseNoteFor = (await notes())?.parseNoteFor;
    expect(parseNoteFor, "no parse-note reader").toBeTypeOf("function");
    expect(parseNoteFor!({ verdict: "poor", wordCount: 80, issues: [...ISSUES, "a new problem"] }, "en")).toEqual({
      verdict: "poor", issues: [{ key: "fewWords", n: 80 }, { key: "noSections" }, { text: "a new problem" }],
    });
  });

  it("drops the sections finding for a CV in another language and counts the verdict again", async () => {
    const parseNoteFor = (await notes())!.parseNoteFor!;
    expect(parseNoteFor({ verdict: "poor", wordCount: 80, issues: ISSUES }, "de")).toEqual({ verdict: "fair", issues: [{ key: "fewWords", n: 80 }] });
    expect(parseNoteFor({ verdict: "fair", wordCount: 600, issues: [ISSUES[1]] }, { code: "es", name: "Spanish" })).toBeNull();
    expect(parseNoteFor({ verdict: "good", wordCount: 600, issues: [] }, "en")).toBeNull();
  });

  it("is said in Spanish on the page, for a Spanish CV the scanner read as Spanish", async () => {
    await speak("es");
    freeScan.mockResolvedValue({
      data: { success: true, industry: "data_engineering", atsScoreEstimate: 64, keywords: [], redFlags: [], quickWins: [], detectedLanguage: "es", parseQuality: { verdict: "poor", wordCount: 80, issues: ISSUES } },
      error: null, attempts: 1, totalDuration: 1,
    });
    render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
    fireEvent.click(screen.getByRole("button", { name: "scan" }));
    const note = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-parse-note]");
      expect(el, "no parse note").not.toBeNull();
      return el!;
    }, SLOW);
    expect(note.dataset.parseNote).toBe("fair");
    const text = note.textContent ?? "";
    expect(text).toContain(i18n.t("freeScanPage.parse.issue.fewWords", { n: 80 }));
    expect(text).not.toMatch(/words extracted|no standard resume sections|may not have been read correctly/);
  });
});

describe("the intent block above the scan", () => {
  it("is said in Spanish", async () => {
    await speak("es");
    render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
    expect(await screen.findByText(i18n.t("freeScanPage.intent.heading"), { exact: false }, SLOW)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/Make your scan specific to you|Actively applying|Exploring options/);
  });
});

describe("the intent block's fields have names (NB-45)", () => {
  it("names the target-role field and says which situation chip is pressed", async () => {
    await speak("en");
    render(<HelmetProvider><MemoryRouter><Index /></MemoryRouter></HelmetProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "draft" }, SLOW));
    expect(await screen.findByRole("textbox", { name: i18n.t("freeScanPage.intent.targetRoleLabel") }, SLOW)).toBeTruthy();
    const chip = screen.getByRole("button", { name: new RegExp(i18n.t("freeScanPage.intent.situation.exploring")) });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });
});
