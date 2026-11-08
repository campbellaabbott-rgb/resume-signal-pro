// @vitest-environment jsdom
/**
 * THE ANALYTICS BANNER GIVES WAY TO THE PHONE POSTING SHEET (hotfix H7; sweep
 * M-S14-001, reproduced live at 360x780 on 2026-11-08).
 *
 * A first-time visitor on a phone opens a posting: the sheet (Radix dialog,
 * fixed, layer 50) fills the screen with Apply, "Check my fit" and Save in its
 * footer, and the analytics banner (fixed at the bottom, layer 60, mounted in
 * its own root) stayed painted over that footer. While the dialog holds the
 * page the banner is inert (pointer-events none, aria-hidden), so a tap on it
 * fell through to the button beneath.
 *
 * jsdom lays nothing out, so "topmost under its own centre" is read the way
 * the stacking works: the sheet's buttons are on top unless some fixed layer
 * outside the sheet, above its z-index, is displayed. The stylesheet rules
 * that apply while the page is locked are taken from src/index.css itself and
 * put on the page, so the computed style is the shipped rule's.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";

vi.mock("@/lib/consent", async (orig) => ({ ...(await orig<typeof import("@/lib/consent")>()), analyticsConsent: () => "unset" }));

import { ConsentBanner } from "@/components/ConsentBanner";
import { PostingSheet } from "@/components/jobs/listing/PostingSheet";
import { PostingDetail } from "@/components/jobs/listing/PostingDetail";
import type { ListingJob } from "@/lib/listing/types";

const JOB: ListingJob = {
  id: "workday:mgmresorts~wd5~MGMCareers:R1", title: "Barista/Fountain Worker", company: "MGM Resorts",
  token: "mgmresorts~wd5~MGMCareers", source: "workday", location: "Las Vegas", postedAt: "2026-11-01",
  recheckedAt: "2026-11-07T11:00:00Z", applyUrl: "https://mgmresorts.wd5.myworkdayjobs.com/MGMCareers/job/Las-Vegas/Barista_R1",
};

/** Every rule of src/index.css that applies only while a dialog locks the page. */
function lockedPageRules(): string {
  const css = readFileSync(resolve(__dirname, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/(^|\n)\s*(body\[data-scroll-locked\][^{]*\{[^}]*\})/g)].map((m) => m[2]).join("\n");
}

function Board() {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <main>
        <button type="button" onClick={() => setOpen(true)}>Barista card</button>
      </main>
      <PostingSheet job={JOB} open={open} onClose={() => setOpen(false)} onApply={() => {}} onCheckFit={() => {}} onToggleSave={() => {}}>
        <PostingDetail job={JOB} surface="sheet" description={{ text: "Make coffee.", state: "loaded" }} />
      </PostingSheet>
    </MemoryRouter>
  );
}

const layerOf = (el: Element): number | null => {
  const m = /(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?:\s|$)/.exec(el.getAttribute("class") ?? "");
  return m ? Number(m[1] ?? m[2]) : null;
};
const displayed = (el: Element | null): boolean => {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    if (getComputedStyle(n).display === "none") return false;
  }
  return true;
};
/** Fixed layers outside the dialog, displayed, on a higher z-index than it: what could paint over its buttons. */
function layersOver(dialog: HTMLElement): Element[] {
  const own = layerOf(dialog) ?? 0;
  return [...document.querySelectorAll("[class]")].filter((el) => {
    if (dialog.contains(el) || el.contains(dialog)) return false;
    const z = layerOf(el);
    return z !== null && z > own && /(?:^|\s)fixed(?:\s|$)/.test(el.getAttribute("class") ?? "") && displayed(el);
  });
}

let style: HTMLStyleElement;
beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, "innerWidth", { value: 360, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 780, configurable: true });
  window.dispatchEvent(new Event("resize"));
  style = document.createElement("style");
  style.textContent = lockedPageRules();
  document.head.appendChild(style);
});
afterEach(() => {
  cleanup();
  style.remove();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("scroll-padding-bottom");
  document.documentElement.style.removeProperty("--consent-banner-h");
  document.body.style.removeProperty("padding-bottom");
});

function mount() {
  // The banner lives in its own root beside the app, as mountConsentBanner puts it.
  const bannerRoot = document.createElement("div");
  bannerRoot.id = "rb-consent-root";
  document.body.appendChild(bannerRoot);
  render(<Board />);
  render(<ConsentBanner />, { container: bannerRoot });
  const banner = document.querySelector<HTMLElement>("[data-consent-banner]");
  expect(banner, "an unanswered visitor sees the banner").not.toBeNull();
  return banner!;
}

describe("on a 360px phone, with the analytics question unanswered", () => {
  it("the stylesheet has a rule for the banner while a dialog locks the page", () => {
    expect(lockedPageRules()).toMatch(/body\[data-scroll-locked\]\s+\[data-consent-banner\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });

  it("the banner shows over the board while no sheet is open", () => {
    const banner = mount();
    expect(displayed(banner)).toBe(true);
  });

  it("with the posting open, Apply and Check my fit are the topmost layer: nothing outside the sheet paints over them", async () => {
    const banner = mount();
    fireEvent.click(screen.getByRole("button", { name: "Barista card" }));
    const dialog = await screen.findByRole("dialog", { name: JOB.title });
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
    const footer = dialog.querySelector("[data-posting-actions='short']")!;
    const apply = screen.getByRole("link", { name: /Apply on employer site/ });
    const fit = [...footer.querySelectorAll("button")].find((b) => /Check my fit/.test(b.textContent ?? ""));
    expect(footer.contains(apply), "Apply is in the sheet's footer").toBe(true);
    expect(fit, "Check my fit is in the sheet's footer").toBeTruthy();
    // The banner sits on a higher layer than the sheet: only being hidden keeps it off the footer.
    expect(layerOf(banner)!).toBeGreaterThan(layerOf(dialog)!);
    expect(layersOver(dialog), "a fixed layer above the sheet is still painted over its footer").toEqual([]);
    expect(getComputedStyle(banner).display).toBe("none");
  });

  it("the banner is back, still unanswered, when the sheet closes", async () => {
    const banner = mount();
    fireEvent.click(screen.getByRole("button", { name: "Barista card" }));
    await screen.findByRole("dialog", { name: JOB.title });
    expect(displayed(banner)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // The banner is a dialog of its own (non-modal): the sheet is the one named by the posting.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: JOB.title })).toBeNull());
    await waitFor(() => expect(document.body.hasAttribute("data-scroll-locked")).toBe(false));
    expect(document.querySelector("[data-consent-banner]"), "closing a sheet is not an answer").toBe(banner);
    expect(displayed(banner)).toBe(true);
    expect(screen.getByRole("button", { name: "Allow analytics" })).toBeTruthy();
  });
});
