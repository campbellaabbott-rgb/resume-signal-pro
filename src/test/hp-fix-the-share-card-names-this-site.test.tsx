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
import { ShareableScoreCard, SHARE_SITE } from "@/components/ShareableScoreCard";
import { ShareScoreCard } from "@/components/ReportInsightCards";
import { codeOf } from "./helpers/strip-comments";

vi.mock("@/lib/track-transport", () => ({ postTrackEvent: () => {} }));
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });

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

/**
 * THE CANVAS CARD TOO (the review of 2026-10-27). The report draws a second
 * share card, an image on a canvas (ShareScoreCard), and shares it through the
 * phone's share sheet. It still sent readers to the bare domain for the scan,
 * which since the switch-over is the job search; the card's figures are all
 * the reader's own (the score, and a before/after from this browser's history).
 */
describe("the canvas share card", () => {
  const BARE_ROOT = /resumebooster\.work(?!\/resume-checker)/;

  function fakeCanvas() {
    const drawn: string[] = [];
    const target: Record<string, unknown> = {
      fillText: (s: string) => { drawn.push(String(s)); },
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop() {} }),
    };
    const ctx = new Proxy(target, { get: (t, k: string) => (k in t ? t[k] : () => {}), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,");
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb: BlobCallback) { cb(new Blob(["x"], { type: "image/png" })); });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    return drawn;
  }

  for (const [label, props] of [
    ["a first score", { atsScore: 71, industry: "technology" }],
    ["a before/after", { atsScore: 71, industry: "technology", previousScore: 58 }],
  ] as const) {
    it(`${label}: the image and the share text name the scanner's own address`, async () => {
      const drawn = fakeCanvas();
      const shared: Array<{ text?: string }> = [];
      const nav = navigator as Navigator & { share?: unknown; canShare?: unknown };
      const before = { share: nav.share, canShare: nav.canShare };
      Object.assign(nav, { share: async (d: { text?: string }) => { shared.push(d); }, canShare: () => true });
      try {
        render(<ShareScoreCard {...props} />);
        fireEvent.click(screen.getByRole("button", { name: /^png$/i }));
        const image = drawn.join(" | ");
        expect(image).toContain(SHARE_SITE);
        expect(image).not.toMatch(BARE_ROOT);
        fireEvent.click(screen.getByRole("button", { name: /^share$/i }));
        await vi.waitFor(() => expect(shared.length).toBe(1));
        expect(shared[0].text).toContain(SHARE_SITE);
        expect(shared[0].text).not.toMatch(BARE_ROOT);
      } finally {
        Object.assign(nav, before);
      }
    });
  }

  it("the source names the scanner through SHARE_SITE, never the bare domain", () => {
    const code = codeOf(readFileSync(resolve(ROOT, "src/components/ReportInsightCards.tsx"), "utf8"));
    expect(code).not.toMatch(BARE_ROOT);
    expect(code).toMatch(/\bSHARE_SITE\b/);
  });
});
