/**
 * THE PDF SUMMARY DRAWS ONLY WHAT ITS FONT HAS, IN THE READER'S LANGUAGE
 * (NB-7, S14X-057).
 *
 * "Download PDF summary" drew its lines with jsPDF's built-in Helvetica,
 * which draws WinAnsi (Windows-1252) and nothing else. The score line ended
 * in an arrow and each critical finding began with a cross mark, so both
 * came out as clipped, letter-spaced garbage; and every line was English in
 * every language. The lines are now the reader's language with ASCII marks;
 * when a line still holds a character the font cannot draw (a Hindi
 * reader), the same lines go to the browser's print dialog instead, on a
 * page whose text is escaped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
const pdf = vi.hoisted(() => ({ drawn: [] as string[], made: 0, saved: 0 }));
vi.mock("jspdf", () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 595 } };
    constructor() { pdf.made += 1; }
    setFontSize() {}
    setFont() {}
    setTextColor() {}
    splitTextToSize(text: string) { return [text]; }
    text(lines: string[] | string) { pdf.drawn.push(...(Array.isArray(lines) ? lines : [lines])); }
    save() { pdf.saved += 1; }
  },
}));
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import i18n from "@/i18n";
import * as Report from "@/components/FreeKeywordResults";
import { unsupportedPdfCharacters } from "@/lib/pdf-text-support";
import { FIX_PLAN_BASIS } from "@/lib/report-basis";

const { FreeKeywordResults } = Report;
const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
  if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  await i18n.changeLanguage(lng);
}
beforeEach(() => { pdf.drawn = []; pdf.made = 0; pdf.saved = 0; });
afterEach(async () => {
  cleanup();
  document.querySelectorAll("[data-summary-print]").forEach((f) => f.remove());
  await i18n.changeLanguage("en");
});

async function download(extra: Record<string, unknown> = {}) {
  render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="data_engineering" atsScoreEstimate={62} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
        redFlags={[]} keywords={[]} resumeText={"Jordan Probe\nData Engineer, Acme Corp, 2019 - Present\n- Built pipelines that moved two billion rows a day\n".repeat(2)}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        contactInfo={{ hasEmail: false, hasPhone: true, hasLinkedIn: true, missingItems: ["email"] } as never}
        projectedScore={78} scoreBand={{ low: 58, high: 66 }}
        reportVerdict="complete"
        reportMeta={{ reportId: "A1B2C3", engineVersion: "v9", generatedAt: "2026-11-10T12:00:00Z", industry: "data_engineering", industryConfidence: "high", benchmarkSource: "estimated" }}
        onGetFullAnalysis={vi.fn()}
        {...(extra as object)}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: i18n.t("freeResults.enterprise.downloadPdf", "Download PDF summary") }));
}

describe("the PDF summary", () => {
  it("in English draws every line with characters the font has: no arrow, no cross mark", async () => {
    await speak("en");
    await download();
    await waitFor(() => expect(pdf.saved).toBe(1));
    expect(pdf.drawn.length).toBeGreaterThan(4);
    for (const line of pdf.drawn) expect(unsupportedPdfCharacters(line), `undrawable in "${line}"`).toEqual([]);
    expect(pdf.drawn.join("\n")).toContain(i18n.t("freeScanPage.pdf.projected", { score: 78 }));
  });

  it("in Spanish is written in Spanish", async () => {
    await speak("es");
    await download();
    await waitFor(() => expect(pdf.saved).toBe(1));
    const all = pdf.drawn.join("\n");
    expect(all).toContain(i18n.t("freeScanPage.pdf.title"));
    expect(all).toContain(i18n.t("freeScanPage.pdf.score", { score: 62 }));
    expect(all).not.toMatch(/RESUME DIAGNOSTIC REPORT|after fixes|Subject:/);
    for (const line of pdf.drawn) expect(unsupportedPdfCharacters(line)).toEqual([]);
  });

  it("in Hindi goes to the print dialog, never to a PDF the font cannot draw", async () => {
    await speak("hi");
    await download();
    await waitFor(() => expect(document.querySelector("[data-summary-print]")).not.toBeNull());
    expect(pdf.made, "a jsPDF document was made for Devanagari").toBe(0);
  });

  it("names the basis of its projection and prints the fix plan's basis right under its steps", async () => {
    // The switch-over's figure guard pinned these two claims to the English
    // block; the block is now written in the reader's language, so the claims
    // are checked on what is drawn.
    await speak("en");
    await download({
      scoreBreakdown: { keywords: 41, format: 80, quantification: 25 },
      fixRoadmap: { steps: [{ order: 1, step: "Add the size of the billing team", minutes: 5, scoreImpact: 6, projectedScoreAfter: 68 }], totalMinutes: 5, finalProjectedScore: 68 },
    });
    await waitFor(() => expect(pdf.saved).toBe(1));
    expect(pdf.drawn.join("\n")).toMatch(/about 78 after fixes \(a rough guide\)/);
    const step = pdf.drawn.findIndex((l) => l.startsWith("1. Add the size of the billing team"));
    expect(step, "the plan's step was drawn").toBeGreaterThan(-1);
    expect(pdf.drawn[step + 1]).toBe(FIX_PLAN_BASIS);
    expect(pdf.drawn).toContain("Breakdown: keywords 41%  ·  format 80%  ·  quantification 25%");
  });

  it("escapes every line on the print page", () => {
    const html = Report.summaryPrintHtml([{ text: '<img src=x onerror="alert(1)">', size: 10, bold: false, color: [0, 0, 0] }], "hi");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("the lane's strings", () => {
  // The report's figure guard reads the main locales, not this shard: a
  // percentage or a multiplier written here would print unread. Each figure's
  // sign stays in the code beside the number it prints, where the guard reads it.
  const FIGURE = /[0-9}]\s?[%％]|[0-9]\s?[×x](?![0-9\w])|(?<![0-9]\s?)×\s?[0-9]|\b(?:percent|per cent|prozent|pour cent|por ciento|por cento|procent|porsyento|प्रतिशत)\b/iu;
  const walk = (o: unknown, p: string, out: Array<[string, string]>) => {
    if (typeof o === "string") out.push([p, o]);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k, out);
    return out;
  };
  for (const lng of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
    it(`${lng}: print no percentage or multiplier`, () => {
      const found = walk(json(`src/i18n/shards/free-scan-page/${lng}.json`), "", []).filter(([, v]) => FIGURE.test(v));
      expect(found).toEqual([]);
    });
  }
});
