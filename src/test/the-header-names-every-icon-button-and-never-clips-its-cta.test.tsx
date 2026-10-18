/**
 * THE HEADER NAMES EVERY ICON BUTTON AND NEVER CLIPS ITS CALL TO ACTION.
 *
 * Audit 2026-10-11 (company pages, finding "Header defects"):
 *   - at 375px the credits icon button (aria-haspopup=dialog) had no
 *     accessible name: a screen reader said "button" (WCAG 4.1.2);
 *   - at 1280px in German the "Get Started" button was cut off at the right
 *     edge, because the nav row and the action cluster shared one line with
 *     nothing reserving the CTA's width.
 *
 * jsdom lays nothing out, so the clipping half is held two ways: here, by the
 * structure that makes clipping impossible (the action cluster and both CTAs
 * never shrink, the nav row is the part that gives way, under lg it is a
 * menu); and in the design-system pass's headless measurement at 1024, 1280
 * and 375 in de, fr, nl and hi, recorded in its report. The naming half is
 * checked in all nine languages, because a key missing in one language falls
 * back to English or to nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within, cleanup, isInaccessible } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { computeAccessibleName } from "dom-accessibility-api";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import { Header } from "@/components/Header";

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;

beforeAll(async () => {
  // jsdom loads no stylesheet. These two utilities are installed exactly as
  // Tailwind defines them and no responsive variant is: so the page is laid
  // out as a PHONE sees it (every sm:/lg:/xl: rule off), and a name that
  // lives in a "hidden lg:inline" span is missing here exactly as it is on a
  // 375px screen. That is the shape of the audit's unnamed credits button.
  const style = document.createElement("style");
  style.textContent = ".hidden{display:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}";
  document.head.appendChild(style);
  for (const l of LOCALES) {
    if (l === "en") continue;
    const mod = await import(`../i18n/locales/${l}.json`);
    i18n.addResourceBundle(l, "translation", mod.default, true, true);
  }
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

function mount() {
  return render(
    <MemoryRouter initialEntries={["/jobs"]}>
      <Header />
    </MemoryRouter>,
  );
}

describe.each(LOCALES)("in %s", (lng) => {
  it("at phone width every button and link in the header has a name, and the phone CTA's name is its visible word", async () => {
    await i18n.changeLanguage(lng);
    mount();
    const banner = screen.getByRole("banner");
    const controls = ([...banner.querySelectorAll("button, a[href]")] as HTMLElement[]).filter((el) => !isInaccessible(el));
    // logo, credits, Start, Menu at least.
    expect(controls.length).toBeGreaterThanOrEqual(4);
    const unnamed = controls.filter((el) => !computeAccessibleName(el).trim()).map((el) => el.outerHTML.slice(0, 120));
    expect(unnamed, `unnamed controls in ${lng}`).toEqual([]);

    // The credits trigger is named in this language, not by an English fallback.
    const credits = i18n.t("header.credits", { lng });
    expect(credits).not.toBe("header.credits");
    expect(within(banner).getByRole("button", { name: new RegExp(credits.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })).toBeTruthy();

    // The phone CTA: accessible name === visible text (WCAG 2.5.3).
    const start = i18n.t("header.start", { lng });
    const phoneCta = within(banner).getByRole("button", { name: start });
    expect(phoneCta.textContent?.trim()).toBe(start);
    // So is the desktop CTA, in every language: no aria-label that could
    // drop the visible word (es/pt read "Empezar…"/"Comece agora…" over
    // "Comenzar"/"Começar").
    const desktopCta = banner.querySelector(`button[data-header-cta="desktop"]`) as HTMLElement;
    expect(desktopCta.hasAttribute("aria-label")).toBe(false);
    expect(desktopCta.textContent?.trim()).toBe(i18n.t("header.getStarted", { lng }));
    cleanup();
  });
});

describe("the call to action cannot be clipped", () => {
  it("both CTAs and the action cluster never shrink; the nav row is what gives way", async () => {
    await i18n.changeLanguage("de");
    mount();
    const banner = screen.getByRole("banner");
    // Hidden at phone width (display:none), so found by its marker.
    const desktopCta = banner.querySelector(`button[data-header-cta="desktop"]`) as HTMLElement;
    expect(desktopCta).toBeTruthy();
    const phoneCta = within(banner).getByRole("button", { name: i18n.t("header.start", { lng: "de" }) });
    for (const cta of [desktopCta, phoneCta]) {
      expect(cta.className).toMatch(/\bshrink-0\b/);
      expect(cta.className).toMatch(/\bwhitespace-nowrap\b/);
      expect(cta.className).not.toMatch(/\btruncate\b|\boverflow-hidden\b/);
    }
    expect(desktopCta.className).toMatch(/\bhidden\b.*\blg:inline-flex\b/);
    expect(phoneCta.className).toMatch(/\blg:hidden\b/);
    // The cluster holding them never shrinks.
    expect(desktopCta.parentElement!.className).toMatch(/\bshrink-0\b/);
    // The nav row appears only from lg; under it, everything is in the menu.
    const nav = banner.querySelector(`nav[aria-label="${i18n.t("header.mainNavAriaLabel", { lng: "de" })}"]`) as HTMLElement;
    expect(nav).toBeTruthy();
    expect(nav.className).toMatch(/\bhidden\b/);
    expect(nav.className).toMatch(/\blg:flex\b/);
    expect(within(banner).getByRole("button", { name: i18n.t("header.menu", { lng: "de" }) }).className).toMatch(/\blg:hidden\b/);
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("the header sits on layer 40, under every sheet and dialog", () => {
    mount();
    expect(screen.getByRole("banner").className).toMatch(/\bz-40\b/);
    cleanup();
  });
});

describe("the menu sheet holds every destination, the language list and the account", () => {
  it("opens as a named dialog with a named close button", async () => {
    await i18n.changeLanguage("en");
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const dialog = screen.getByRole("dialog", { name: "Site menu" });
    const hrefs = within(dialog).getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const to of ["/jobs", "/companies", "/agents", "/pricing", "/explore", "/guides", "/trust", "/changelog", "/auth"]) {
      expect(hrefs).toContain(to);
    }
    expect(within(dialog).getByRole("button", { name: "Deutsch" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Close menu" })).toBeTruthy();
    cleanup();
  });
});
