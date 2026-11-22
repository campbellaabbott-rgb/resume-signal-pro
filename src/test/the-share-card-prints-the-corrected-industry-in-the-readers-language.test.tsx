/**
 * THE SHARE CARD PRINTS THE CORRECTED INDUSTRY IN THE READER'S LANGUAGE
 * (sweep SCAN-07).
 *
 * The image a reader downloads or posts printed the industry as the scan's id
 * ("data_engineering", "healthcare"), in English to every reader, and the
 * detected one even after the reader corrected it. It now prints the industry
 * in effect, named the way the rest of the report names it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

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
import { ShareableScoreCard } from "@/components/ShareableScoreCard";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { scanIndustryLabel } from "@/config/scan-industries";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/shards/free-scan-page/${lng}.json`), true, true);
  await i18n.changeLanguage(lng);
}
afterEach(async () => { cleanup(); localStorage.clear(); await i18n.changeLanguage("en"); });

// The card's "Industry" cell: the value under its label. Read by the label,
// so the same lookup reads the card before and after the fix.
function industryCell(root: ParentNode): string[] {
  const label = i18n.t("shareableCard.industry");
  return [...root.querySelectorAll("p")]
    .filter((p) => p.textContent === label)
    .map((p) => (p.nextElementSibling as HTMLElement | null)?.textContent ?? "");
}

describe("the share card", () => {
  it("names the industry in German, never as its id", async () => {
    await speak("de");
    const { container } = render(
      <ShareableScoreCard atsScore={71} formatGrade="B" industry="cybersecurity" experienceLevel="Mid" topStrength="" />,
    );
    const cells = industryCell(container);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell).toBe(scanIndustryLabel("cybersecurity", i18n.t.bind(i18n)));
      expect(cell).toBe(json("src/i18n/shards/free-scan-page/de.json").freeScanPage.industry.cybersecurity);
    }
  });

  it("a two-word id is said as words", async () => {
    await speak("en");
    const { container } = render(
      <ShareableScoreCard atsScore={71} formatGrade="B" industry="real_estate" experienceLevel="Mid" topStrength="" />,
    );
    for (const cell of industryCell(container)) expect(cell).not.toContain("_");
  });

  it("on the report, prints the industry the reader corrected to", async () => {
    await speak("de");
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="healthcare" atsScoreEstimate={63} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
          redFlags={[]} keywords={[]}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
          experienceLevel={{ level: "mid", yearsEstimate: "" } as never}
          onGetFullAnalysis={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.change(container.querySelector<HTMLSelectElement>("select[data-industry-select]")!, { target: { value: "cybersecurity" } });
    const cells = industryCell(document.body);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell).toBe(scanIndustryLabel("cybersecurity", i18n.t.bind(i18n)));
  });
});
