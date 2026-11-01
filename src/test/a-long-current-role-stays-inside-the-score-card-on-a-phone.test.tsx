/**
 * A LONG CURRENT ROLE STAYS INSIDE THE SCORE CARD ON A PHONE (register
 * S13-023).
 *
 * At 375 px the hero laid a 140 px gauge beside its info block, and the
 * "Current Role:" chip was inline-flex with only its inner span capped at
 * 200 px. "Registered Nurse" pushed the chip past the card (layout width 397
 * against a card edge of 359) and the whole page scrolled sideways.
 *
 * jsdom lays nothing out, so this holds the classes that make the browser do
 * it: below sm the gauge stacks above the info block, the info block may
 * shrink (min-w-0), and the chip is capped at its container (max-w-full,
 * min-w-0) with the role, not the label, truncating.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScoreHero } from "@/components/scorecard/ScoreHero";

beforeAll(() => {
  Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
  window.dispatchEvent(new Event("resize"));
});

const ROLES = ["RN", "Registered Nurse", "HR Business Partner", "Senior Director of Clinical Operations and Patient Experience Strategy"];

const mount = (currentRole: string) => render(
  <TooltipProvider>
    <ScoreHero industry="healthcare" currentRole={currentRole} atsScoreEstimate={64}
      experienceLevel={{ level: "mid", yearsEstimate: "6 years" }} formatGrade="B"
      redFlagsCount={1} keywordsCount={3} quickWinsCount={2} />
  </TooltipProvider>,
);

const classes = (el: Element | null | undefined) => new Set((el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));

describe("the hero at 375 px", () => {
  for (const role of ROLES) {
    it(`'${role}' cannot widen the card`, () => {
      const { container, unmount } = mount(role);
      const row = container.querySelector("[data-hero-row]");
      const rowCls = classes(row);
      expect(rowCls.has("flex-col"), "the gauge and the info block sit side by side on a phone").toBe(true);
      expect(rowCls.has("sm:flex-row")).toBe(true);

      const info = container.querySelector("[data-hero-info]");
      const infoCls = classes(info);
      expect(infoCls.has("min-w-0")).toBe(true);
      expect(infoCls.has("w-full") || infoCls.has("max-w-full")).toBe(true);

      const chip = container.querySelector("[data-current-role-chip]");
      expect(chip?.textContent).toContain(role);
      const chipCls = classes(chip);
      expect(chipCls.has("max-w-full"), "the chip is not capped at its container").toBe(true);
      expect(chipCls.has("min-w-0")).toBe(true);
      expect(chipCls.has("inline-flex") && !chipCls.has("max-w-full"), "inline-flex with no cap").toBe(false);

      const roleText = chip?.querySelector("[data-current-role]");
      const roleCls = classes(roleText);
      expect(roleCls.has("truncate")).toBe(true);
      expect(roleCls.has("min-w-0")).toBe(true);
      expect([...roleCls].some((c) => /^max-w-\[\d+px\]$/.test(c)), "a fixed pixel cap wider than a phone's card").toBe(false);
      for (const fixed of Array.from(chip?.children ?? []).filter((c) => c !== roleText)) {
        expect(classes(fixed).has("shrink-0"), "the icon or the label shrank instead of the role").toBe(true);
      }
      unmount();
    });
  }
});
