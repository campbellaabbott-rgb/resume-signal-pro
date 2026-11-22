/**
 * A CONTACT CARD MISSING A PHONE NEVER SHOWS A TICK (sweep SCAN-02).
 *
 * The Contact and Sections cards counted from the scan's booleans (2/3, 4/5)
 * but chose their line from the scan's own missingItems and missingSections
 * lists. Those lists come back empty beside a false often enough (the model
 * fills them, the backup scanner never fills missingItems), and then the
 * card printed "✓ Easy for recruiters to reach you" under 2/3. The line now
 * comes from the same booleans as the count, and names each missing part in
 * the reader's language.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MetricCardsGrid } from "@/components/scorecard/MetricCardsGrid";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/shards/free-scan-page/${lng}.json`), true, true);
  await i18n.changeLanguage(lng);
}
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

function grid(contactInfo: Record<string, unknown> | null, sections: Record<string, unknown>) {
  return render(
    <TooltipProvider>
      <MetricCardsGrid
        atsScoreEstimate={70} formatGrade="B"
        quantificationScore={{ score: 50, verdict: "average" }}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [], ...sections } as never}
        contactInfo={contactInfo as never}
        bulletImpactScore={{ score: 50, verdict: "balanced" }}
        topStrength={null}
        redFlags={[]}
      />
    </TooltipProvider>,
  );
}
const card = (c: HTMLElement, metric: string) => c.querySelector<HTMLElement>(`[data-metric="${metric}"]`);

describe("the Contact card", () => {
  it("with no phone and an empty missing list says to add a phone, not a tick", async () => {
    await speak("en");
    const { container } = grid({ hasEmail: true, hasPhone: false, hasLinkedIn: true, missingItems: [] }, {});
    const contact = card(container, "contact")!;
    expect(contact.textContent).toContain("2/3");
    expect(contact.textContent).not.toContain("✓");
    expect(contact.textContent).toContain(i18n.t("freeScanPage.metric.contactAdd", { item: i18n.t("freeScanPage.metric.contact.phone") }));
  });

  it("names every part it lacks, in German, never the scan's English word", async () => {
    await speak("de");
    const { container } = grid({ hasEmail: false, hasPhone: false, hasLinkedIn: true, missingItems: ["email"] }, {});
    const text = card(container, "contact")!.textContent ?? "";
    expect(text).toContain("1/3");
    expect(text).toContain(i18n.t("freeScanPage.metric.contact.email"));
    expect(text).toContain(i18n.t("freeScanPage.metric.contact.phone"));
    expect(text).not.toMatch(/\bemail\b/);
  });

  it("ticks only when all three are there", async () => {
    await speak("en");
    const { container } = grid({ hasEmail: true, hasPhone: true, hasLinkedIn: true, missingItems: [] }, {});
    expect(card(container, "contact")!.textContent).toContain(`✓ ${i18n.t("freeScanPage.metric.contactAll")}`);
  });
});

describe("the Sections card", () => {
  it("with no summary and an empty missing list says to add a summary, not a tick", async () => {
    await speak("en");
    const { container } = grid({ hasEmail: true, hasPhone: true, hasLinkedIn: true, missingItems: [] }, { hasSummary: false, missingSections: [] });
    const sections = card(container, "sections")!;
    expect(sections.textContent).toContain("4/5");
    expect(sections.textContent).not.toContain("✓");
    expect(sections.textContent).toContain(i18n.t("freeScanPage.metric.sectionsAdd", { section: i18n.t("freeScanPage.metric.section.summary") }));
  });
});
