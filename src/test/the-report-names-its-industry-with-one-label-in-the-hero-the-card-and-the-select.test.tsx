/**
 * THE REPORT NAMES ITS INDUSTRY WITH ONE LABEL IN THE HERO, THE CARD AND THE
 * SELECT (register S13-018, its leftover RC-S13-018).
 *
 * The free report says which industry it scored a résumé for in three places,
 * and each had its own words for it. The "We read this as" select reads
 * src/config/scan-industries.ts, in the reader's language. The score hero
 * title-cased the raw id, so "hr" read "Hr" and "general" read "General". The
 * industry card kept a label map of its own, so "hr" read "Human Resources"
 * and "creative" read "Creative/Design". Both were English for every reader,
 * and the card's correction grid listed the scanner's ids by their English
 * labels even on a German page. An HR résumé was "HR" in the select, "Hr" in
 * the hero and "Human Resources" in the card.
 *
 * The hero, the card's heading, its "also considered" switches, its AI line
 * and its correction grid now say scanIndustryLabel(id, t), the select's own
 * words. Checked for every id the scanner knows, in English and in German,
 * and once on the whole report against the select it renders.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
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
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import i18n from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScoreHero } from "@/components/scorecard/ScoreHero";
import { IndustryConfidenceIndicator } from "@/components/IndustryConfidenceIndicator";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { SCAN_INDUSTRY_IDS, scanIndustryOptions } from "@/config/scan-industries";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  if (lng !== "en") {
    i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
    const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
    if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  }
  await i18n.changeLanguage(lng);
}
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const t = (key: string) => String(i18n.t(key));
/** The select's words for an id: the options the report's select is built from. */
const selectOptions = (current: string) => scanIndustryOptions(current, t);
const selectLabel = (id: string) => selectOptions(id).find((o) => o.value === id)!.label;

const heroIndustry = (id: string) => {
  const { container, unmount } = render(
    <TooltipProvider>
      <ScoreHero industry={id} atsScoreEstimate={64} experienceLevel={{ level: "mid", yearsEstimate: "6 years" }}
        formatGrade="B" redFlagsCount={1} keywordsCount={3} quickWinsCount={2} />
    </TooltipProvider>,
  );
  const text = container.querySelector("[data-hero-industry]")?.textContent ?? null;
  unmount();
  return text;
};
const cardIndustry = (id: string) => {
  const { container, unmount } = render(<TooltipProvider><IndustryConfidenceIndicator industry={id} /></TooltipProvider>);
  const text = container.querySelector("[data-industry-label]")?.textContent?.trim() ?? null;
  unmount();
  return text;
};

// The ids the select offers, plus three the scanner never lists (an older or
// streamed report): each is shown as itself, in the same words everywhere.
const IDS = [...SCAN_INDUSTRY_IDS, "supply_chain", "dataScience", "software"];

describe.each(["en", "de"])("in %s, for every id the scanner knows", (lng) => {
  for (const id of IDS) {
    it(`the hero and the card name '${id}' as the select does`, async () => {
      await speak(lng);
      const want = selectLabel(id);
      expect(heroIndustry(id), `the hero's words for ${id}`).toBe(want);
      expect(cardIndustry(id), `the card's words for ${id}`).toBe(want);
    });
  }
});

describe("the card's other places an industry is named", () => {
  const openCard = (container: HTMLElement) => fireEvent.click(within(container).getByText(i18n.t("industryConfidence.industry").trim()));

  for (const lng of ["en", "de"]) {
    it(`in ${lng}, the switches, the AI line and the correction grid say the select's words`, async () => {
      await speak(lng);
      const { container } = render(
        <TooltipProvider>
          <IndustryConfidenceIndicator
            industry="hr"
            industryDetection={{
              detected: "hr", confidence: "low", signals: [],
              aiSuggested: "creative",
              alternativeIndustriesWithReasons: [{ industry: "skilled_trades" }, { industry: "general" }],
            }}
          />
        </TooltipProvider>,
      );
      openCard(container);
      const text = container.textContent ?? "";
      for (const id of ["skilled_trades", "general"]) {
        expect(text, `the switch to ${id}`).toContain(selectLabel(id));
      }
      expect(text, "the AI line").toContain(String(i18n.t("industryConfidence.aiSuggested", { industry: selectLabel("creative") })));

      fireEvent.click(within(container).getByText(i18n.t("industryConfidence.correctIndustry")));
      const grid = container.querySelector<HTMLElement>(".grid.max-h-48");
      expect(grid, "the correction grid").not.toBeNull();
      const labels = [...grid!.querySelectorAll("button")].map((b) => b.textContent);
      expect(labels).toEqual(selectOptions("hr").map((o) => o.label));
    });
  }
});

describe("the whole report", () => {
  const mount = (industry: string) => render(
    <MemoryRouter>
      <FreeKeywordResults
        industry={industry} atsScoreEstimate={66} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
        redFlags={[]} keywords={[]} resumeText={"Jordan Probe\nPeople Partner\n- Ran hiring for 4 teams\n".repeat(3)}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );

  for (const [lng, id] of [["en", "hr"], ["en", "general"], ["de", "skilled_trades"], ["de", "hr"]] as const) {
    it(`in ${lng}, a '${id}' report says one label in the hero, the card and the select`, async () => {
      await speak(lng);
      const { container } = mount(id);
      const select = container.querySelector<HTMLSelectElement>("select[data-industry-select]");
      expect(select, "the industry select").not.toBeNull();
      const said = select!.options[select!.selectedIndex]?.textContent;
      expect(said).toBe(selectLabel(id));
      expect(container.querySelector("[data-hero-industry]")?.textContent, "the hero").toBe(said);
      expect(container.querySelector("[data-industry-label]")?.textContent?.trim(), "the card").toBe(said);
    });
  }
});
