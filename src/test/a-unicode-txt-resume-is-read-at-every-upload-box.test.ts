/**
 * A UNICODE .TXT RÉSUMÉ IS READ AT EVERY UPLOAD BOX (S14X-283, the call-sites
 * half; the reader itself is ingest-parsers' readTextFile).
 *
 * WHAT WAS WRONG. Five boxes read an uploaded .txt with the File's own text
 * reader, which decodes UTF-8 and nothing else: the scanner's landing, the
 * board's résumé drop, the success page's recovery upload, Shortlist's
 * candidate upload and the résumé recovery panel. Notepad's "Unicode" and
 * Word's "Unicode Text" save UTF-16 behind a byte-order mark, so each box took
 * a NUL beside every letter, and the landing scanned that. The reader that
 * honours the mark existed (src/lib/resumeText) and no box called it.
 *
 * WHAT HOLDS NOW, each box mounted with the backend faked: a UTF-16LE .txt
 * dropped there reaches what the box feeds as the original text with no NUL
 * (the landing's session copy, the board's fit request, the recovery box,
 * the candidate box, the panel's analysis handler), and a binary file renamed
 * .txt is refused at the landing in the reader's words, not scanned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

vi.setConfig(MOUNT_TEST_BUDGET);

type Answer = { data: unknown; error: unknown };
const backend = vi.hoisted(() => ({
  invoked: [] as Array<{ fn: string; body: Record<string, unknown> }>,
  invoke: (_fn: string, _body: Record<string, unknown>): Answer => ({ data: null, error: null }),
  rows: (_table: string): unknown[] => [],
}));
vi.mock("@/integrations/supabase/client", () => {
  // Any query chain: every builder call returns the chain, and it answers
  // when awaited (a list) or asked for one row.
  const chain = (table: string): unknown => {
    const p: unknown = new Proxy({}, {
      get(_t, k) {
        if (k === "then") return (ok: (v: Answer) => unknown, no?: (e: unknown) => unknown) => Promise.resolve({ data: backend.rows(table), error: null }).then(ok, no);
        if (k === "single" || k === "maybeSingle") return async () => ({ data: null, error: null });
        return () => p;
      },
    });
    return p;
  };
  return {
    supabase: {
      from: (table: string) => chain(table),
      rpc: async () => ({ data: null, error: null }),
      functions: {
        invoke: async (fn: string, opts?: { body?: unknown }) => {
          const body = (opts?.body && typeof opts.body === "object" && !(opts.body instanceof FormData) ? opts.body : {}) as Record<string, unknown>;
          backend.invoked.push({ fn, body });
          return backend.invoke(fn, body);
        },
      },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
const auth = vi.hoisted(() => ({ current: { session: null, user: null, loading: false } as Record<string, unknown> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.current, safeNextPath: (s: string) => s }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));
// Tracking is off the network: every tracker a page asks for is a no-op.
const trackers = vi.hoisted(() => new Proxy({} as Record<string | symbol, unknown>, { get: (t, k) => (t[k] ??= () => undefined) }));
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => trackers }));
vi.mock("@/hooks/use-funnel-tracking", async (orig) => ({ ...(await orig<typeof import("@/hooks/use-funnel-tracking")>()), useFunnelTracking: () => trackers }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/LiveMatches", () => ({ LiveMatches: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));
const freeScan = vi.hoisted(() => vi.fn(async () => ({ data: null, error: null })));
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return { ...actual, resilientCallers: { ...actual.resilientCallers, freeKeywordScan: freeScan } };
});
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import i18n from "@/i18n";
import Index from "@/pages/Index";
import Jobs from "@/pages/Jobs";
import ProductSuccess from "@/pages/ProductSuccess";
import Shortlist from "@/pages/Shortlist";
import { ResumeRecovery } from "@/components/ResumeRecovery";

/** A résumé with letters UTF-8 and UTF-16 spell differently, long enough for every box. */
const RESUME = "Jane Doe, ingénieure logiciel à Lyon. Neuf ans de Python, de Kubernetes et de données; une équipe de cinq. ".repeat(2).trim();

/** The bytes Notepad's "Unicode" writes: FF FE, then UTF-16 little-endian. */
function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out.set([0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) & 0xff;
    out[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  return out;
}
const unicodeTxt = () => new File([utf16le(RESUME)], "resume.txt", { type: "text/plain" });
const choose = (input: Element, file: File) => fireEvent.change(input, { target: { files: [file] } });
/** The landing's drop panel (ResumeUploader's), once the page has drawn it. */
async function uploadPanel(): Promise<HTMLElement> {
  await waitFor(() => expect(document.getElementById("resume-upload-panel"), "the landing's upload panel moved").not.toBeNull(), SLOW);
  return document.getElementById("resume-upload-panel")!;
}

beforeEach(() => {
  backend.invoked.length = 0;
  backend.invoke = () => ({ data: null, error: null });
  backend.rows = () => [];
  auth.current = { session: null, user: null, loading: false };
  toast.mockReset();
  freeScan.mockClear();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  window.history.replaceState({}, "", "/");
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await act(async () => { await i18n.changeLanguage("en"); }); });

describe("a UTF-16 .txt dropped into each upload box is read as the text it holds", () => {
  it("the scanner's landing keeps the résumé, not a NUL between its letters", async () => {
    render(h(MemoryRouter, null, h(Index)));
    fireEvent.drop(await uploadPanel(), { dataTransfer: { files: [unicodeTxt()] } });
    await waitFor(() => expect(sessionStorage.getItem("rb_resume_text")).toBe(RESUME), SLOW);
  });

  it("the board's résumé drop asks for the fit of the text itself", async () => {
    window.history.replaceState({}, "", "/jobs");
    render(h(MemoryRouter, null, h(Jobs)));
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull(), SLOW);
    choose(document.querySelector('input[type="file"]')!, unicodeTxt());
    await waitFor(() => expect(backend.invoked.find((c) => c.fn === "job-fit" && c.body.action === "fit-terms")?.body.resumeText).toBe(RESUME), SLOW);
  });

  it("the success page's recovery upload fills its box with the text", async () => {
    backend.invoke = (fn) => fn === "verify-product-purchase"
      ? { data: { verified: true, isFirstUse: false, customerEmail: "b@example.com", generatedContent: null, inProgress: false, hasResumeData: false }, error: null }
      : { data: null, error: null };
    render(h(MemoryRouter, { initialEntries: ["/product-success?session_id=cs_test_unicode_txt&product=careerSnapshot"] }, h(ProductSuccess)));
    const input = await screen.findByLabelText(new RegExp(en.productSuccess.recovery.yourResume), { selector: "input" }, SLOW);
    choose(input, unicodeTxt());
    await waitFor(() => expect((screen.getByPlaceholderText(en.productSuccess.recovery.pasteResumePlaceholder) as HTMLTextAreaElement).value).toBe(RESUME), SLOW);
  });

  it("Shortlist's candidate upload fills the candidate box with the text", async () => {
    auth.current = { session: { user: { id: "u-1" } }, user: { id: "u-1", email: "hr@example.com" }, loading: false };
    backend.rows = (table) => table === "shortlist_roles"
      ? [{ id: "role-1", title: "Data Engineer", jd_text: "Senior data engineer: Airflow, dbt and Snowflake.", jd_version: 1, jurisdiction: "OTHER", created_at: "2026-10-01T00:00:00Z" }]
      : [];
    render(h(MemoryRouter, null, h(Shortlist)));
    fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }, SLOW));
    const box = await screen.findByPlaceholderText(/Paste the candidate's resume text/, {}, SLOW) as HTMLTextAreaElement;
    choose(box.parentElement!.querySelector('input[type="file"]')!, unicodeTxt());
    await waitFor(() => expect(box.value).toBe(RESUME), SLOW);
  });

  it("the résumé recovery panel hands the analysis the text", async () => {
    const ready = vi.fn();
    render(h(ResumeRecovery, { onResumeTextReady: ready }));
    choose(screen.getByLabelText(en.resumeRecovery.dropHere), unicodeTxt());
    const go = await screen.findByRole("button", { name: /Generate Analysis/ }, SLOW);
    await waitFor(() => expect(go).toBeEnabled(), SLOW);
    fireEvent.click(go);
    expect(ready).toHaveBeenCalledWith(RESUME);
  });
});

describe("a file that is still not text after the mark is honoured", () => {
  it("is refused at the scanner's landing in the reader's words, and nothing is kept or scanned", async () => {
    render(h(MemoryRouter, null, h(Index)));
    const panel = await uploadPanel();
    const binary = new File([new Uint8Array(400).map((_, i) => (i * 37) % 32)], "resume.txt", { type: "text/plain" });
    fireEvent.drop(panel, { dataTransfer: { files: [binary] } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: i18n.t("ingestParsers.refusal.txtUnreadable"),
      description: i18n.t("ingestParsers.refusal.txtUnreadableDescription"),
      variant: "destructive",
    })), SLOW);
    expect(i18n.t("ingestParsers.refusal.txtUnreadable")).not.toBe("ingestParsers.refusal.txtUnreadable");
    expect(sessionStorage.getItem("rb_resume_text")).toBeNull();
    expect(freeScan).not.toHaveBeenCalled();
  });
});
