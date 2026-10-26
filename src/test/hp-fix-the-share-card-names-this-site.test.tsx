/**
 * THE SHARE CARD NAMES THIS SITE (review round of 2026-10-26).
 *
 * The free report's downloadable score card said "Powered by
 * resumescanner.ai" and "Get your free resume score at resumescanner.ai", and
 * its LinkedIn text sent readers there too: a domain that is not this site's
 * (it resolves to a third party). Every seeker who shared a score advertised
 * someone else. The card now names the trading name (src/config/seller.ts,
 * never translated) and the scanner's own address, in the reader's language,
 * and no language keeps the other domain.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { TRADING_NAME } from "@/config/seller";
import { ShareableScoreCard } from "@/components/ShareableScoreCard";
import { codeOf } from "./helpers/strip-comments";

vi.mock("@/lib/track-transport", () => ({ postTrackEvent: () => {} }));
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const ROOT = resolve(__dirname, "../..");
const OTHER_DOMAIN = /resumescanner/i;

const card = (
  <ShareableScoreCard candidateName="Jane" atsScore={88} formatGrade="B" industry="data_engineering" experienceLevel="Mid Level" topStrength="Pipelines" />
);

describe("the score card", () => {
  it("is powered by this site and sends the reader to its scanner", () => {
    render(card);
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(OTHER_DOMAIN);
    expect(text).toContain(TRADING_NAME);
    expect(text).toContain("resumebooster.work/resume-checker");
  });

  it("the LinkedIn share opens this site's scanner", async () => {
    const opened: string[] = [];
    vi.stubGlobal("open", (url: string) => { opened.push(url); return null; });
    render(card);
    fireEvent.click(screen.getByRole("button", { name: /linkedin/i }));
    await vi.waitFor(() => expect(opened.length).toBe(1));
    expect(decodeURIComponent(opened[0])).toContain("https://resumebooster.work/resume-checker");
    vi.unstubAllGlobals();
    expect(codeOf(readFileSync(resolve(ROOT, "src/components/ShareableScoreCard.tsx"), "utf8"))).not.toMatch(OTHER_DOMAIN);
  });
});

describe("the card's strings", () => {
  it("no language names the other domain, and each one's line names the scanner's address", () => {
    const files = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(9);
    for (const f of files) {
      const s = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales", f), "utf8")).shareableCard ?? {};
      expect(JSON.stringify(s), f).not.toMatch(OTHER_DOMAIN);
      expect(s.getScore, `${f} getScore`).toContain("{{site}}");
      // The card prints the trading name, and LinkedIn takes the address alone,
      // so the brand and share-text strings are gone.
      expect(s.brand, `${f} brand`).toBeUndefined();
      expect(s.shareText, `${f} shareText`).toBeUndefined();
    }
  });
});
