/**
 * THE SHARE CARD'S RING IS DRAWN AS AN SVG ARC (S14X-210), AND A CARD WITH
 * NO NAME SAYS "YOUR RESULTS" (NB-16).
 *
 * The score ring was a CSS conic-gradient. html2canvas, which turns the card
 * into the downloaded and copied image, does not draw conic gradients, so
 * every image showed a flat disc whatever the score. The ring is now a track
 * circle and an arc whose dash is the score's share of the circumference,
 * which the preview and the image both draw.
 *
 * A résumé with no name gave the heading "Your's Results", and every word
 * of the card was English in every language. The heading is "Your results"
 * with no name, and "Jane's results" with one, in the reader's language.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: async () => ({ error: null }) }), rpc: async () => ({ data: null, error: null }) },
}));
vi.mock("html2canvas", () => ({ default: vi.fn() }));

import i18n from "@/i18n";
import { ShareableScoreCard } from "@/components/ShareableScoreCard";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
  if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  await i18n.changeLanguage(lng);
}
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const card = (props: Partial<Parameters<typeof ShareableScoreCard>[0]> = {}) =>
  render(<ShareableScoreCard atsScore={72} formatGrade="B" industry="Technology" experienceLevel="Mid" topStrength="Clear dates" {...props} />);

describe("the score ring", () => {
  it("is an SVG arc covering the score's share of the circle", async () => {
    await speak("en");
    const { container } = card();
    const arc = container.querySelector("circle[data-score-arc]");
    expect(arc, "no arc: the ring is not drawn as SVG").not.toBeNull();
    const [dash, gap] = (arc!.getAttribute("stroke-dasharray") ?? "").split(/\s+/).map(Number);
    const circumference = 2 * Math.PI * Number(arc!.getAttribute("r"));
    expect(dash / circumference).toBeCloseTo(0.72, 3);
    expect(gap).toBeCloseTo(circumference, 3);
  });

  it("draws no conic gradient, which the image capture cannot draw", async () => {
    await speak("en");
    const { container } = card();
    for (const el of container.querySelectorAll<HTMLElement>("[style]")) {
      expect(el.getAttribute("style") ?? "").not.toMatch(/conic-gradient/);
    }
  });
});

describe("the heading", () => {
  it("with no name says Your results, never Your's", async () => {
    await speak("en");
    const { container } = card({ candidateName: null });
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Your's|Your&apos;s|'s Results/);
    expect(text).toContain(i18n.t("freeScanPage.share.yourResults"));
  });

  it("with a name says it in the reader's language", async () => {
    await speak("es");
    const { container } = card({ candidateName: "Jane" });
    fireEvent.click(screen.getByRole("button", { name: i18n.t("shareableCard.preview") }));
    const text = container.textContent ?? "";
    expect(text).toContain(i18n.t("shareableCard.results", { name: "Jane" }));
    expect(text).not.toMatch(/Jane's Results|Resume ATS Score|Top Strength|Format Grade|Preview of your downloadable/);
  });
});
