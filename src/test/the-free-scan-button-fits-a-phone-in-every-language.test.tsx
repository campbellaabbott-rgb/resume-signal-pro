/**
 * THE FREE-SCAN BUTTON FITS A PHONE IN EVERY LANGUAGE (S14X-020).
 *
 * The uploader's scan button was a fixed 64px-high, no-wrap row: the label,
 * the icon and a FREE pill. In German, Spanish, French, Portuguese and
 * Tagalog the label alone is wider than a 360px phone, so the button ran
 * past the screen and the pill was cut off. Now the label wraps inside a
 * button that grows, and the pill shows from the sm breakpoint up. jsdom
 * cannot measure width, so this holds the classes that make it wrap; the
 * 360px measurement is the verify line.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn(async () => ({ data: null, error: null })) }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
  if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  await i18n.changeLanguage(lng);
}
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions";

describe("the scan button wraps instead of running off a phone", () => {
  for (const lng of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
    it(lng, async () => {
      await speak(lng);
      render(<MemoryRouter><ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={vi.fn()} hasContent resumeText={RESUME} /></MemoryRouter>);
      const button = screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]'))!;
      expect(button.textContent).toContain(i18n.t("uploader.getFreeAnalysis"));
      const classes = button.className.split(/\s+/);
      expect(classes).toContain("whitespace-normal");
      expect(classes).toContain("h-auto");
      expect(classes).not.toContain("whitespace-nowrap");
      expect(classes, "a fixed height cuts a wrapped label").not.toContain("h-16");
      const pill = [...button.querySelectorAll("span")].find((s) => s.textContent === i18n.t("hero.freeBadge"))!;
      expect(pill.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
    });
  }
});
