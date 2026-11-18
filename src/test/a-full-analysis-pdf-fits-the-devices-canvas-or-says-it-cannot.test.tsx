/**
 * A FULL ANALYSIS PDF FITS THE DEVICE'S CANVAS, OR SAYS IT CANNOT (S14X-112;
 * bug round 2026-11-12).
 *
 * WHAT WAS WRONG. Each section of the report was captured at scale 2 whatever
 * its size. A long section on a phone asked for a canvas past what the
 * browser will draw (iOS Safari stops at about 16.7 million pixels, and every
 * browser at about 32,767 pixels on a side): the canvas came back empty, its
 * image was the empty data URL "data:,", and the buyer was handed a PDF of
 * blank pages, or no PDF and a toast saying only that it failed.
 *
 * NOW a section is captured at the scale its size allows (2 when it fits),
 * and one too tall for a single canvas is captured in windows (html2canvas's
 * y and height), each a whole number of pages, so every page is drawn once
 * and no canvas passes 16 million pixels or 32,000 on a side. A canvas that
 * still comes back empty is a failure the page names in the buyer's language
 * (paidAnalysis.pdf.device), never a blank PDF.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const { invoke, rpc, toasts, toastFn, pdfMode } = vi.hoisted(() => {
  const toasts: Array<{ title?: string; description?: string; variant?: string }> = [];
  return {
    invoke: vi.fn(),
    rpc: vi.fn(),
    toasts,
    toastFn: (t: { title?: string; description?: string; variant?: string }) => { toasts.push(t); },
    pdfMode: { device: false },
  };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastFn }), toast: toastFn }));
// The page's PDF button, with the export itself standing in: the device that cannot draw it.
vi.mock("@/lib/analysis-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analysis-pdf")>();
  return {
    ...actual,
    buildAnalysisPdf: async (...a: Parameters<typeof actual.buildAnalysisPdf>) => {
      if (pdfMode.device) throw new actual.PdfNotDrawnOnThisDevice("a canvas past the device's ceiling");
      return actual.buildAnalysisPdf(...a);
    },
  };
});
vi.mock("html2canvas", () => ({ default: async () => ({ width: 10, height: 10, toDataURL: () => "data:image/jpeg;base64,AAAA" }) }));
vi.mock("jspdf", () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    addPage() { return this; }
    addImage() { return this; }
    save() { return this; }
  },
}));

import i18n from "@/i18n";
import Success from "../pages/Success";
import {
  buildAnalysisPdf, capturePlan, MAX_CAPTURE_PIXELS, MAX_CAPTURE_SIDE, PdfNotDrawnOnThisDevice, type PdfLike,
} from "@/lib/analysis-pdf";

vi.setConfig(MOUNT_TEST_BUDGET);

afterEach(() => {
  cleanup();
  for (const el of document.querySelectorAll("[data-pdf-root]")) el.remove();
});

/** A section of w x h CSS pixels, laid out by fiat (jsdom lays nothing out). */
function page(sections: Record<string, [number, number]>): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-pdf-root", "");
  root.innerHTML = Object.keys(sections).map((id) => `<div id="${id}">x</div>`).join("");
  document.body.appendChild(root);
  for (const [id, [w, h]] of Object.entries(sections)) {
    const el = root.querySelector(`#${id}`)!;
    Object.defineProperty(el, "offsetWidth", { value: w });
    Object.defineProperty(el, "offsetHeight", { value: h });
  }
  return root;
}

type Call = { id: string; scale: number; y: number; height: number; canvasW: number; canvasH: number };

/** html2canvas as a browser with a canvas ceiling would answer, and a jsPDF that counts. */
function device(opts: { ceiling?: number; empty?: boolean } = {}) {
  const calls: Call[] = [];
  const images: string[] = [];
  let pages = 1;
  const pdf: PdfLike = {
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    addPage: () => { pages++; },
    addImage: (data) => { images.push(data); },
    save: () => undefined,
  };
  const html2canvas = async (el: HTMLElement, o: Record<string, unknown>) => {
    const scale = Number(o.scale);
    const y = Number(o.y ?? 0);
    const height = Number(o.height ?? el.offsetHeight);
    const canvasW = Math.floor(el.offsetWidth * scale);
    const canvasH = Math.floor(height * scale);
    calls.push({ id: el.id, scale, y, height, canvasW, canvasH });
    const over = canvasW * canvasH > (opts.ceiling ?? Infinity);
    return {
      width: opts.empty || over ? 0 : canvasW,
      height: opts.empty || over ? 0 : canvasH,
      toDataURL: () => (opts.empty || over ? "data:," : `img:${el.id}:${y}`),
    };
  };
  const crop = (c: { toDataURL: () => string }, y: number, h: number) => `${c.toDataURL()}@${y}+${h}`;
  return { calls, images, pdf, html2canvas, crop, pages: () => pages };
}

describe("every capture fits the device", () => {
  it("a 900 x 9,000 section: no canvas past 16 million pixels (scale 2 asked for 32.4 million)", async () => {
    const d = device({ ceiling: 16_777_216 });
    await buildAnalysisPdf(page({ overview: [900, 9_000] }), { html2canvas: d.html2canvas, makePdf: () => d.pdf, crop: d.crop });
    expect(d.calls.length).toBeGreaterThan(0);
    for (const c of d.calls) {
      expect(c.canvasW * c.canvasH, `a capture of ${c.canvasW} x ${c.canvasH}`).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS);
      expect(c.canvasH).toBeLessThanOrEqual(MAX_CAPTURE_SIDE);
    }
    expect(d.images.length).toBeGreaterThan(0);
    for (const i of d.images) expect(i).not.toMatch(/^data:,/);
  });

  it("a 900 x 60,000 section is captured in windows, each a whole number of pages, covering it once", async () => {
    const d = device({ ceiling: 16_777_216 });
    await buildAnalysisPdf(page({ overview: [900, 60_000] }), { html2canvas: d.html2canvas, makePdf: () => d.pdf, crop: d.crop });
    expect(d.calls.length, "a section past the side limit was captured whole").toBeGreaterThan(1);
    let next = 0;
    for (const c of d.calls) {
      expect(c.y, "the windows skip or repeat part of the section").toBe(next);
      next = c.y + c.height;
      expect(c.canvasW * c.canvasH).toBeLessThanOrEqual(MAX_CAPTURE_PIXELS);
      expect(c.canvasH).toBeLessThanOrEqual(MAX_CAPTURE_SIDE);
    }
    expect(next, "the windows do not reach the end of the section").toBe(60_000);
    // A4 at 190 x 277 mm usable: a page is 277 / 190 of the section's width.
    const pageCss = (277 / 190) * 900;
    for (const c of d.calls.slice(0, -1)) {
      expect(c.height / pageCss, "a window ends mid-page").toBeCloseTo(Math.round(c.height / pageCss), 2);
    }
    // One page per page-height of the section, give or take the last part page: no sliver page.
    expect(d.pages()).toBe(Math.ceil(60_000 / pageCss));
  });

  it("a section that fits is still captured once at scale 2, as before", async () => {
    const d = device();
    await buildAnalysisPdf(page({ overview: [900, 1_200] }), { html2canvas: d.html2canvas, makePdf: () => d.pdf, crop: d.crop });
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0].scale).toBe(2);
    expect(d.calls[0].y).toBe(0);
  });

  it("the plan for an unmeasured section is today's: one capture at scale 2", () => {
    expect(capturePlan(0, 0, 1_000)).toEqual({ scale: 2, windows: null });
  });
});

describe("a canvas the device could not draw is a failure, never a blank page", () => {
  it("an empty canvas or the empty data URL rejects with PdfNotDrawnOnThisDevice", async () => {
    const d = device({ empty: true });
    await expect(buildAnalysisPdf(page({ overview: [900, 1_200] }), { html2canvas: d.html2canvas, makePdf: () => d.pdf, crop: d.crop }))
      .rejects.toBeInstanceOf(PdfNotDrawnOnThisDevice);
    expect(d.images, "a blank image was put in the PDF").toEqual([]);
  });

  it("a slice whose crop comes back empty rejects too", async () => {
    const d = device();
    await expect(buildAnalysisPdf(page({ overview: [900, 3_000] }), { html2canvas: d.html2canvas, makePdf: () => d.pdf, crop: () => "data:," }))
      .rejects.toBeInstanceOf(PdfNotDrawnOnThisDevice);
  });
});

describe("the page says so in the buyer's language", () => {
  const SHARE = "0123456789abcdef01234567";
  beforeEach(() => {
    toasts.length = 0;
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) =>
      name === "get_analysis_by_share_id"
        ? { data: [{ share_id: SHARE, analysis_result: { industry: "Software", atsScore: { score: 70, breakdown: {}, improvements: [] }, optimizedBullets: [], actionVerbs: [], keywords: [], redFlags: [] } }], error: null }
        : { data: null, error: null });
  });

  it("the device that cannot draw it: the toast names the device and a way that works", async () => {
    pdfMode.device = true;
    try {
      render(<MemoryRouter initialEntries={[`/success?session_id=cs_live_pdf_phone&share=${SHARE}`]}><Success /></MemoryRouter>);
      fireEvent.click(await screen.findByRole("button", { name: i18n.t("success.actions.downloadPdf") }, SLOW));
      await waitFor(() => expect(toasts.find((t) => t.variant === "destructive")).toBeTruthy(), SLOW);
      const words = i18n.t("paidAnalysis.pdf.device");
      expect(words).not.toBe("paidAnalysis.pdf.device");
      expect(toasts.find((t) => t.variant === "destructive")?.description).toBe(words);
    } finally {
      pdfMode.device = false;
    }
  });

  it("the words are in every language, and only English says them in English", () => {
    const shard = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/shards/paid", `${l}.json`), "utf8")).paidAnalysis;
    const en = shard("en").pdf?.device;
    expect(en).toBeTruthy();
    for (const l of ["de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      expect(shard(l).pdf?.device, l).toBeTruthy();
      expect(shard(l).pdf.device, `${l} says it in English`).not.toBe(en);
    }
  });
});
