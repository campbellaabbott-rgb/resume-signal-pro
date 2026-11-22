/**
 * A CORRECTED INDUSTRY REACHES THE TIPS, THE COACH AND THE SHARE CARD
 * (register S10-147).
 *
 * The reader can correct the industry the scan detected, and the report said
 * the correction "changes every recommendation below". The keyword cards and
 * the live matches took the corrected industry; the personalised tips, the
 * interview coach and the share card were still handed the detected one, so
 * a nurse corrected to cybersecurity kept the nurse's tips. All three now get
 * the industry in effect. The score, the findings and the format advice are
 * the scan's own, written for the industry it read, so the note under a
 * low-confidence detection now says what a correction changes and what waits
 * for the next scan, in the reader's language, instead of "every
 * recommendation".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
// Signed in, so the interview coach is mounted rather than the sign-in ask.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "probe@example.com" }, session: null }) }));
const handed = vi.hoisted(() => ({ tips: [] as string[], coach: [] as string[], share: [] as string[] }));
vi.mock("@/components/PersonalizedInsights", () => ({
  PersonalizedInsights: (p: { industry: string }) => { handed.tips.push(p.industry); return null; },
}));
vi.mock("@/components/InterviewCoach", () => ({
  InterviewCoach: (p: { industry: string }) => { handed.coach.push(p.industry); return null; },
}));
vi.mock("@/components/ShareableScoreCard", () => ({
  ShareableScoreCard: (p: { industry: string }) => { handed.share.push(p.industry); return null; },
}));
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import i18n from "@/i18n";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { scanIndustryLabel } from "@/config/scan-industries";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeEach(async () => {
  handed.tips = []; handed.coach = []; handed.share = [];
  localStorage.clear();
  await i18n.changeLanguage("en");
});
afterEach(() => cleanup());

function report(extra: { detectionQualityScore?: number } = {}) {
  return render(
    <MemoryRouter>
      <FreeKeywordResults
        {...extra}
        industry="healthcare" atsScoreEstimate={63} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
        redFlags={[]} keywords={[]}
        resumeText={"Jordan Probe\nRegistered Nurse, St. Mary's, 2018 - Present\n- Cared for 20 patients a shift\n".repeat(3)}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        formatRecommendation={{
          recommendedStyle: "traditional",
          layoutAdvice: { columns: "one_column", useColor: false, visualElements: "minimal", rationale: "r" },
          industryNorms: [{ norm: "Licences near the top", importance: "must_have" }],
          avoidList: ["Photos"],
          currentFormatAssessment: { isAppropriate: true, mainIssue: "", quickFix: "" },
          templateSuggestion: "t",
        }}
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("after the reader corrects healthcare to cybersecurity", () => {
  it("the tips, the coach and the share card are handed cybersecurity", () => {
    const { container } = report();
    expect(handed.tips.at(-1)).toBe("healthcare");
    const select = container.querySelector<HTMLSelectElement>("select[data-industry-select]")!;
    fireEvent.change(select, { target: { value: "cybersecurity" } });
    expect(handed.tips.at(-1), "the personalised tips").toBe("cybersecurity");
    expect(handed.coach.at(-1), "the interview coach").toBe("cybersecurity");
    expect(handed.share.at(-1), "the share card").toBe("cybersecurity");
  });

  it("the format advice, written for the detected industry, names that industry in words", () => {
    const { container } = report();
    fireEvent.change(container.querySelector<HTMLSelectElement>("select[data-industry-select]")!, { target: { value: "cybersecurity" } });
    const text = container.textContent ?? "";
    const label = scanIndustryLabel("healthcare", i18n.t.bind(i18n));
    expect(text).toContain(i18n.t("freeResults.formatRecommendationSection.subtitle", { style: "traditional", industry: label }));
    expect(text).not.toContain(i18n.t("freeResults.formatRecommendationSection.subtitle", { style: "traditional", industry: "cybersecurity" }));
  });
});

describe("the note under a low-confidence detection", () => {
  const json = (p: string) => JSON.parse(readFileSync(resolve(__dirname, "../..", p), "utf8"));

  it("says, in French, that the tips follow a correction and the format advice stays the scan's", async () => {
    i18n.addResourceBundle("fr", "translation", json("src/i18n/locales/fr.json"), true, true);
    i18n.addResourceBundle("fr", "translation", json("src/i18n/shards/free-scan-page/fr.json"), true, true);
    await i18n.changeLanguage("fr");
    const { container } = report({ detectionQualityScore: 30 });
    const detected = scanIndustryLabel("healthcare", i18n.t.bind(i18n));
    const said = i18n.t("freeScanPage.detection.body", { industry: detected });
    expect(said).not.toBe("freeScanPage.detection.body");
    expect(container.querySelector("[data-detection-note]")?.textContent?.trim()).toBe(said);
    // A correction does not rewrite the scan, so the note still names the
    // industry the scan read, the one the format advice was written for.
    fireEvent.change(container.querySelector<HTMLSelectElement>("select[data-industry-select]")!, { target: { value: "cybersecurity" } });
    expect(container.querySelector("[data-detection-note]")?.textContent?.trim()).toBe(said);
    const text = container.textContent ?? "";
    for (const english of ["changes every recommendation", "Industry auto-detected", "based on limited signals"]) {
      expect(text, english).not.toContain(english);
    }
  });

  it("is written in all nine languages, each naming the industry it read twice", () => {
    for (const lng of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const d = json(`src/i18n/shards/free-scan-page/${lng}.json`).freeScanPage.detection;
      expect(typeof d?.title, `${lng} title`).toBe("string");
      expect(d.body.split("{{industry}}").length - 1, `${lng} body`).toBe(2);
    }
  });
});
