/**
 * THE FULL ANALYSIS AS A PDF (hotfix 2026-11-10: H2, M-S14-004, M-S14-085;
 * and S10-061).
 *
 * What was wrong:
 *   - BLANK PAGES (M-S14-004). The report's cards fade in (animate-fade-in:
 *     opacity 0 to 1, with per-card delays), and html2canvas draws the clone
 *     it makes of the page with each element's opacity at that instant, so a
 *     card still in its delay came out invisible. Every capture now starts by
 *     switching animations and transitions off in the clone and drawing every
 *     animated element at its final opacity.
 *   - A CARD LEFT OUT (M-S14-085). The PDF captured elements with an id, and
 *     the Quantification Opportunities card had none. It has its own section
 *     now, and the sections captured are named here, once each.
 *   - THE SAME TOP SLICE ON EVERY PAGE (S10-061). A section taller than a
 *     page was drawn whole at the same position on each page, so every page
 *     showed its top. It is now cut into page-sized slices, each drawn once.
 *   - DUPLICATES. Every element with an id was captured, the report's own
 *     wrapper and the sections nested in the overview among them, so most of
 *     the report appeared two or three times.
 *
 * Pure apart from the default slice cropper (a canvas): html2canvas and jsPDF
 * are passed in, so the tests run the whole export with fakes.
 */

/**
 * The report's top-level sections, in page order: what the PDF captures, each
 * once. Every result card on the page sits inside one of them
 * (src/test/the-full-analysis-pdf-draws-every-card-once-at-full-opacity.test.tsx).
 */
export const PDF_SECTION_IDS = [
  "overview",
  "linkedin",
  "summary",
  "industry",
  "skills",
  "quantification",
  "metrics",
  "bullets",
  "verbs",
  "keywords",
  "redflags",
  "actionplan",
] as const;

/** The page's dark background, behind every capture and slice. */
export const PDF_BACKGROUND = "#0a0a0f";

/**
 * Injected into html2canvas's clone before it draws: no animation or
 * transition runs, and every animated element is drawn at its final opacity.
 */
export const PDF_CAPTURE_CSS =
  "*,*::before,*::after{animation:none!important;transition:none!important}" +
  "[class*=\"animate-\"]{opacity:1!important}";

/** html2canvas's onclone: the clone is drawn as the finished page. */
export function prepareCloneForCapture(doc: Document): void {
  const style = doc.createElement("style");
  style.setAttribute("data-pdf-capture", "");
  style.textContent = PDF_CAPTURE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/** The sections to capture, in order; the root itself when none is shown. */
export function sectionsForPdf(
  root: HTMLElement,
  shown: (el: HTMLElement) => boolean = (el) => el.offsetHeight > 0,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const id of PDF_SECTION_IDS) {
    const el = root.querySelector(`#${id}`);
    if (el instanceof HTMLElement && shown(el)) out.push(el);
  }
  return out.length > 0 ? out : [root];
}

/** A tall capture cut into page-sized slices: [start, height] in canvas pixels. */
export function pageSlices(totalPx: number, pagePx: number): Array<{ y: number; h: number }> {
  const step = Math.max(1, Math.floor(pagePx));
  const out: Array<{ y: number; h: number }> = [];
  for (let y = 0; y < totalPx; y += step) out.push({ y, h: Math.min(step, totalPx - y) });
  return out;
}

type CanvasLike = { width: number; height: number; toDataURL: (type?: string, quality?: number) => string };

export type PdfLike = {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  addPage(): unknown;
  addImage(data: string, format: string, x: number, y: number, w: number, h: number, alias?: string, compression?: string): unknown;
  save(name: string): unknown;
};

export type PdfDeps = {
  html2canvas: (el: HTMLElement, opts: Record<string, unknown>) => Promise<CanvasLike>;
  makePdf: () => PdfLike;
  /** One slice of a tall capture, as a JPEG data URL. */
  crop?: (canvas: CanvasLike, y: number, h: number) => string;
};

/** The default slice cropper: a canvas of the slice's height, drawn from the capture. */
function cropWithCanvas(canvas: CanvasLike, y: number, h: number): string {
  const slice = document.createElement("canvas");
  slice.width = canvas.width;
  slice.height = h;
  const ctx = slice.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas to cut the page from");
  ctx.fillStyle = PDF_BACKGROUND;
  ctx.fillRect(0, 0, slice.width, h);
  ctx.drawImage(canvas as unknown as CanvasImageSource, 0, y, canvas.width, h, 0, 0, canvas.width, h);
  return slice.toDataURL("image/jpeg", 0.92);
}

const MARGIN_MM = 10;
const GAP_MM = 5;

/** The analysis under `root`, drawn section by section into a new PDF. */
export async function buildAnalysisPdf(root: HTMLElement, deps: PdfDeps): Promise<PdfLike> {
  const pdf = deps.makePdf();
  const crop = deps.crop ?? cropWithCanvas;
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const usableWidth = pdfWidth - MARGIN_MM * 2;
  const usableHeight = pdfHeight - MARGIN_MM * 2;

  let y = MARGIN_MM;
  let pageHasContent = false;
  for (const section of sectionsForPdf(root)) {
    const canvas = await deps.html2canvas(section, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: PDF_BACKGROUND,
      onclone: (doc: Document) => prepareCloneForCapture(doc),
    });
    if (!canvas.width || !canvas.height) continue;
    const pxPerMm = canvas.width / usableWidth;
    const heightMm = canvas.height / pxPerMm;

    if (heightMm <= usableHeight) {
      if (pageHasContent && y + heightMm > pdfHeight - MARGIN_MM) {
        pdf.addPage();
        y = MARGIN_MM;
      }
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN_MM, y, usableWidth, heightMm);
      y += heightMm + GAP_MM;
      pageHasContent = true;
      continue;
    }

    // Taller than a page: a fresh page, then one slice per page.
    if (pageHasContent) {
      pdf.addPage();
      y = MARGIN_MM;
    }
    const slices = pageSlices(canvas.height, usableHeight * pxPerMm);
    slices.forEach((s, i) => {
      if (i > 0) {
        pdf.addPage();
        y = MARGIN_MM;
      }
      const sliceMm = s.h / pxPerMm;
      pdf.addImage(crop(canvas, s.y, s.h), "JPEG", MARGIN_MM, y, usableWidth, sliceMm);
      y += sliceMm + GAP_MM;
    });
    pageHasContent = true;
  }
  return pdf;
}
