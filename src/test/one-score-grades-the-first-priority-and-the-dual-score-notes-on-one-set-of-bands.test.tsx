/**
 * ONE SCORE GRADES THE FIRST PRIORITY AND THE DUAL-SCORE NOTES ON ONE SET OF
 * BANDS (RC-S13-019).
 *
 * The report reads every ATS grade from src/lib/score-bands.ts (85/70/50,
 * the scanner's rubric). Two surfaces still graded on their own cut points:
 * the personalised insights put a red alarm on the first priority below 60,
 * so a 55 was amber "fair" in the hero and red two cards later; and the
 * dual-score card printed the note the backup scanner wrote, which graded at
 * 75/55 and in English, so a 72 read "Acceptable" under a green "Good". The
 * first priority is red only on the report's "weak" band now, and the two
 * notes are said from the report's own bands in the reader's language.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { PersonalizedInsights } from "@/components/PersonalizedInsights";
import { EnhancedAnalysisDisplay } from "@/components/EnhancedAnalysisDisplay";
import { TooltipProvider } from "@/components/ui/tooltip";

const ROOT = resolve(__dirname, "../..");
const shard = resolve(ROOT, "src/i18n/shards/free-scan-page/en.json");
if (existsSync(shard)) i18n.addResourceBundle("en", "translation", JSON.parse(readFileSync(shard, "utf8")), true, true);
afterEach(() => cleanup());

const firstPriority = (score: number) => {
  const { container } = render(
    <MemoryRouter>
      <PersonalizedInsights industry="technology" experienceLevel={{ level: "mid", yearsEstimate: "5" }} atsScore={score} hasJobDescription={false} currentRole="Data Engineer" />
    </MemoryRouter>,
  );
  const heading = [...container.querySelectorAll("h4")].find((h) => h.textContent === i18n.t("personalizedInsights.yourTopPriorities"));
  expect(heading, "the priorities heading").toBeTruthy();
  const first = heading!.parentElement!.querySelector<HTMLElement>(".space-y-2 > div");
  expect(first, "the first priority").not.toBeNull();
  return first!;
};

describe("the first priority", () => {
  it("is no red alarm at 55, which the report grades fair", () => {
    expect(firstPriority(55).className).not.toMatch(/destructive/);
  });
  it("is a red alarm at 45, which the report grades weak", () => {
    expect(firstPriority(45).className).toMatch(/destructive/);
  });
});

describe("the dual-score notes", () => {
  it("say the report's band for a 72, never the backup scanner's note", () => {
    const { container } = render(
      <TooltipProvider>
        <EnhancedAnalysisDisplay
          atsScore={72}
          dualScore={{ atsCompatibility: 72, recruiterImpact: 48, atsNote: "Acceptable: may need adjustments", recruiterNote: "Needs work: add numbers" }}
        />
      </TooltipProvider>,
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("Acceptable: may need adjustments");
    expect(text).not.toContain("Needs work: add numbers");
    expect(text).toContain(i18n.t("freeScanPage.band.ats.good"));
    expect(text).toContain(i18n.t("freeScanPage.band.recruiter.weak"));
  });
});
