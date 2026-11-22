/**
 * A FALLBACK REPORT IN FRENCH PRINTS NO ENGLISH FINDING (register NB-18).
 *
 * When the main scanner is down, free-keyword-scan's backup writes the report
 * from fixed English sentences, and gives each a stable code (formatIssueCode
 * 'automated_review_only'; red flag 'duty_not_result'; quick wins
 * 'add_numbers' and 'rewrite_passive_openers'; next action
 * 'number_top_three'). The page printed the English sentence to every reader.
 * A finding that carries one of the five codes now prints the
 * freeScanPage.fallback text for that code; the bullet a red flag quotes
 * stays as the reader wrote it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
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
import { FreeKeywordResults, FALLBACK_CODES } from "@/components/FreeKeywordResults";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const LANGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];

beforeAll(async () => {
  i18n.addResourceBundle("fr", "translation", json("src/i18n/locales/fr.json"), true, true);
  i18n.addResourceBundle("fr", "translation", json("src/i18n/shards/free-scan-page/fr.json"), true, true);
  await i18n.changeLanguage("fr");
});
afterEach(() => cleanup());

// The backup's sentences, as free-keyword-scan/index.ts writes them.
const ENGLISH = [
  "Automated formatting review only",
  "A bullet reads as a duty, not a result",
  "Add numbers to your unquantified bullets",
  "Rewrite bullets that start with passive phrases",
  "Add a concrete number to each of your top 3 bullets",
  "Quantified impact is the single strongest screening signal",
  "starts with",
  "Est. impact",
];
const BULLET = "Responsible for the weekly payroll run";

function fallbackReport() {
  return render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="general" atsScoreEstimate={52} formatGrade="C"
        formatIssue="Automated formatting review only — AI review was unavailable for this scan."
        formatIssueCode="automated_review_only"
        resumeLength={{ currentPages: 1, recommendedPages: 1, verdict: "just_right" } as never}
        redFlags={[{
          issue: "A bullet reads as a duty, not a result",
          code: "duty_not_result",
          impact: `"${BULLET}" — starts with "Responsible for"`,
          severity: "moderate",
        }]}
        quickWins={[
          { fix: "Add numbers to your unquantified bullets — metrics are the fastest score lift", code: "add_numbers", timeEstimate: "15 min", impact: "high", scoreImpact: 6, category: "quantification" },
          { fix: 'Rewrite bullets that start with passive phrases ("Responsible for", "Helped with")', code: "rewrite_passive_openers", timeEstimate: "10 min", impact: "high", scoreImpact: 5, category: "content" },
        ] as never}
        nextBestAction={{ action: "Add a concrete number to each of your top 3 bullets", code: "number_top_three", why: "Quantified impact is the single strongest screening signal", estimatedImpact: "+5-8 pts" }}
        keywords={[]}
        resumeText={`Camille Probe\nGestionnaire de paie\n- ${BULLET}\n`.repeat(3)}
        sectionCheck={{ hasContact: true, hasSummary: false, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: ["summary"] } as never}
        contactInfo={{ hasEmail: true, hasPhone: true, hasLinkedIn: false, missingItems: [] } as never}
        reportVerdict="complete"
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("a backup report read in French", () => {
  it("prints none of the backup's English sentences", () => {
    const { container } = fallbackReport();
    const text = container.textContent ?? "";
    expect(ENGLISH.filter((s) => text.includes(s))).toEqual([]);
  });

  it("prints each coded finding's French text, and keeps the bullet it quotes", () => {
    const { container } = fallbackReport();
    const text = container.textContent ?? "";
    for (const code of ["duty_not_result", "add_numbers", "rewrite_passive_openers", "number_top_three"]) {
      expect(text, code).toContain(i18n.t(`freeScanPage.fallback.${code}`));
    }
    expect(text).toContain(`"${BULLET}" — ${i18n.t("freeScanPage.fallback.startsWith", { opener: "Responsible for" })}`);
    expect(text).toContain(i18n.t("freeScanPage.fallback.numberTopThreeWhy"));
    expect(text).toContain(i18n.t("freeScanPage.report.estImpact", { impact: i18n.t("freeScanPage.fallback.numberTopThreeImpact") }));
  });

  it("an uncoded finding is still the scan's own sentence", () => {
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="general" atsScoreEstimate={52} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
          redFlags={[{ issue: "Une lacune de deux ans", impact: "x", severity: "moderate" }]}
          keywords={[]}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
          onGetFullAnalysis={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("Une lacune de deux ans");
  });
});

describe("the five codes", () => {
  it("are the backup scanner's own, and each has a text in all nine languages", () => {
    const server = readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan/index.ts"), "utf8");
    for (const code of FALLBACK_CODES) expect(server, code).toContain(`'${code}'`);
    for (const lng of LANGS) {
      const fallback = json(`src/i18n/shards/free-scan-page/${lng}.json`).freeScanPage.fallback;
      for (const code of FALLBACK_CODES) expect(typeof fallback[code], `${lng} ${code}`).toBe("string");
    }
  });
});
