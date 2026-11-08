/**
 * THE FULL ANALYSIS PDF DRAWS EVERY CARD, ONCE, AT FULL OPACITY (hotfix
 * 2026-11-10: H2, M-S14-004 and M-S14-085; S10-061).
 *
 * What was wrong:
 *   - the report's cards fade in, and html2canvas drew them mid-fade, so the
 *     $5 report's PDF came out blank or nearly so;
 *   - the Quantification Opportunities card had no section id, and the PDF
 *     captured only elements with one, so it was left out;
 *   - every element with an id was captured, the report's wrapper and the
 *     sections nested in the overview among them, so most of the report
 *     appeared two or three times;
 *   - a section taller than a page was drawn whole on every page, so every
 *     page showed its top.
 * What holds now, rendered and run with html2canvas and jsPDF faked:
 *   - every result card on the page sits inside one of the sections the PDF
 *     captures, the quantification card included;
 *   - every capture first switches animations and transitions off in the
 *     clone and draws every animated element at its final opacity;
 *   - each section is captured once, in order;
 *   - a tall section is cut into page-sized slices, each drawn once.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import i18n from "@/i18n";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";
import { buildAnalysisPdf, PDF_CAPTURE_CSS, PDF_SECTION_IDS, pageSlices, type PdfLike } from "@/lib/analysis-pdf";

afterEach(() => {
  cleanup();
  // jsdom's id lookups go through the document: a page left from one test
  // would hide the next test's sections of the same id.
  for (const el of document.querySelectorAll("[data-pdf-root]")) el.remove();
});

const FULL: AnalysisData = {
  industry: "technology",
  experienceLevel: "senior",
  hasLinkedIn: false,
  atsScore: { score: 71, breakdown: { jobTitleMatch: 10, skillsMatch: 20, actionVerbUsage: 10, keywordCoverage: 15, formattingScore: 16 }, improvements: ["Lead with impact"] },
  readabilityMetrics: { grade: "B", bulletPointClarity: "ok", jargonLevel: "low", suggestions: ["Shorter bullets"] },
  formatRecommendations: { currentIssues: ["Two columns"], recommendations: ["One column"], sectionOrder: ["Summary", "Experience"] },
  atsParsingIssues: { detectedIssues: ["A table"], severity: "medium", criticalFixes: ["Remove the table"] },
  resumeLength: { recommendedPages: 2, currentAssessment: "Right length", reasoning: "Senior" },
  summaryRewrite: { professionalSummary: "Platform engineer who ships.", linkedInHeadline: "Platform engineer" },
  industryInsights: { whatRecruitersLookFor: "Scale", competitiveAdvantage: "Depth", commonMistakes: "Vagueness" },
  skillsGap: { missingTechnical: ["Terraform"], missingSoft: ["Mentoring"], recommendations: "Learn Terraform" },
  quantificationOpportunities: [{ context: "Improved the pipeline", suggestion: "Say by how much", example: "Cut build time 40%" }],
  achievementMetrics: {
    roleType: "Platform engineer",
    typicalMetrics: [{ category: "Speed", metricName: "Build time", howToMeasure: "CI", exampleRange: "20-50%", bulletExample: "Cut build time 40%" }],
    missingFromResume: ["Uptime"],
    quickWins: ["Add uptime"],
  },
  optimizedBullets: [{ original: "Did work", improved: "Shipped work", reason: "Clearer" }],
  actionVerbs: [{ weak: "did", strong: "shipped" }],
  keywords: ["Kubernetes", "Terraform"],
  redFlags: ["A gap"],
  actionPlan: ["Step one"],
};

const SECTION_SELECTOR = PDF_SECTION_IDS.map((id) => `#${id}`).join(",");

describe("every card on the page is in a section the PDF captures", () => {
  it("each rendered result card sits inside an exported section, the quantification card included", () => {
    const { container } = render(<AnalysisResults data={FULL} />);
    const cards = [...container.querySelectorAll("[data-result-card]")];
    expect(cards.length, "too few cards rendered for this to prove anything").toBeGreaterThanOrEqual(10);
    const outside = cards.filter((c) => !c.closest(SECTION_SELECTOR)).map((c) => c.querySelector("h3")?.textContent);
    expect(outside, "cards the PDF never captures").toEqual([]);
    const quantification = container.querySelector("#quantification");
    expect(quantification?.textContent).toContain(i18n.t("analysisResults.quantificationOpportunities"));
  });

  it("no exported section sits inside another, so nothing is captured twice", () => {
    const { container } = render(<AnalysisResults data={FULL} />);
    for (const id of PDF_SECTION_IDS) {
      const el = container.querySelector(`#${id}`);
      if (!el) continue;
      expect(el.parentElement?.closest(SECTION_SELECTOR), `#${id} is inside another exported section`).toBeNull();
    }
  });

  it("a posting read up to its cap is said so at the top of the report, which the PDF captures", () => {
    const { container } = render(<AnalysisResults data={{ ...FULL, inputsClipped: { jobDescription: { from: 25_000, to: 20_000 } } }} />);
    const note = container.querySelector("[data-testid='inputs-clipped']");
    expect(note?.closest("#overview")).toBeTruthy();
    expect(note?.textContent).toBe(i18n.t("paidAnalysis.clipped.posting", { max: (20_000).toLocaleString() }));
  });
});

type Capture = { id: string; css: string };

function fakes(heights: Record<string, number>) {
  const captures: Capture[] = [];
  const crops: Array<[number, number]> = [];
  const images: Array<{ data: string; y: number; h: number }> = [];
  let pages = 1;
  const pdf: PdfLike = {
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    addPage: () => { pages++; },
    addImage: (data, _f, _x, y, _w, h) => { images.push({ data, y, h }); },
    save: () => undefined,
  };
  const html2canvas = async (el: HTMLElement, opts: Record<string, unknown>) => {
    const clone = document.implementation.createHTMLDocument("clone");
    (opts.onclone as (d: Document) => void)(clone);
    captures.push({ id: el.id, css: [...clone.querySelectorAll("style[data-pdf-capture]")].map((s) => s.textContent).join("") });
    const height = heights[el.id] ?? 400;
    return { width: 1900, height, toDataURL: () => `whole:${el.id}` };
  };
  return { captures, crops, images, pdf, html2canvas, pages: () => pages, crop: (_c: unknown, y: number, h: number) => { crops.push([y, h]); return `slice:${y}`; } };
}

function page(ids: string[]): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-pdf-root", "");
  root.innerHTML = `<section id="analysis-results">${ids.map((id) => `<div id="${id}"><div id="${id}-nested">x</div></div>`).join("")}</section>`;
  document.body.appendChild(root);
  return root;
}

describe("the export", () => {
  it("every capture first stops the page's animations and draws animated cards at full opacity", async () => {
    const f = fakes({});
    await buildAnalysisPdf(page(["overview", "quantification"]), { html2canvas: f.html2canvas, makePdf: () => f.pdf, crop: f.crop });
    expect(f.captures.length).toBeGreaterThan(0);
    for (const c of f.captures) {
      expect(c.css, `#${c.id} was captured with its animations running`).toBe(PDF_CAPTURE_CSS);
    }
    expect(PDF_CAPTURE_CSS).toContain("animation:none!important");
    expect(PDF_CAPTURE_CSS).toContain("opacity:1!important");
  });

  it("each top-level section is captured once, in page order, and neither the wrapper nor a nested id", async () => {
    const f = fakes({});
    const root = page(["overview", "summary", "quantification", "metrics", "actionplan"]);
    // jsdom lays nothing out, so every section reads 0 high: shown here by fiat.
    for (const el of root.querySelectorAll<HTMLElement>("[id]")) Object.defineProperty(el, "offsetHeight", { value: 100 });
    await buildAnalysisPdf(root, { html2canvas: f.html2canvas, makePdf: () => f.pdf, crop: f.crop });
    expect(f.captures.map((c) => c.id)).toEqual(["overview", "summary", "quantification", "metrics", "actionplan"]);
  });

  it("a section taller than a page is drawn as page-sized slices, not its top on every page", async () => {
    // 190 mm usable width at 10 px/mm; 277 mm usable height = 2,770 px a page.
    const f = fakes({ overview: 2_770 * 3 + 500 });
    const root = page(["overview"]);
    Object.defineProperty(root.querySelector("#overview"), "offsetHeight", { value: 100 });
    await buildAnalysisPdf(root, { html2canvas: f.html2canvas, makePdf: () => f.pdf, crop: f.crop });
    expect(f.crops).toEqual([[0, 2_770], [2_770, 2_770], [5_540, 2_770], [8_310, 500]]);
    expect(f.images.map((i) => i.data)).toEqual(["slice:0", "slice:2770", "slice:5540", "slice:8310"]);
    expect(f.pages()).toBe(4);
    expect(pageSlices(10, 4)).toEqual([{ y: 0, h: 4 }, { y: 4, h: 4 }, { y: 8, h: 2 }]);
  });
});
