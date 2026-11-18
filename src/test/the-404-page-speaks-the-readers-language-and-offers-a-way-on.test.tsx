/**
 * THE 404 PAGE SPEAKS THE READER'S LANGUAGE AND OFFERS A WAY ON (NB-44,
 * NB-43).
 *
 * WHAT WAS WRONG. Its one link was an English literal in all nine languages,
 * it offered nowhere to go but the homepage, it kept the previous page's tab
 * title, and it wrote a console error for every mistyped address.
 *
 * WHAT HOLDS NOW, with the real page in a router:
 *   - the homepage link reads the main locale's notFound.returnHome, and the
 *     board and pricing sit beside it, in the reader's language;
 *   - the tab says the page was not found, in the reader's language;
 *   - nothing is written to the console as an error;
 *   - the page still tells search engines noindex, and takes it away when it
 *     unmounts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import NotFound from "@/pages/NotFound";
import { codeOf } from "./helpers/strip-comments";
import { readMainLocale, readShards } from "./helpers/locale-strings";
import { mergeShards } from "@/i18n/merge-shards";

/** A reader's language, as the site loads it: the main locale with its shards merged in. */
async function readIn(lng: string): Promise<void> {
  i18n.addResourceBundle(lng, "translation", mergeShards(readMainLocale(`${lng}.json`), readShards(`${lng}.json`)), true, true);
  await i18n.changeLanguage(lng);
}

const mount = () =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/zz-not-real"]}>
        <Routes><Route path="*" element={<NotFound />} /></Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
const noindex = () => [...document.head.querySelectorAll('meta[name="robots"]')].some((m) => /noindex/.test(m.getAttribute("content") ?? ""));

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  document.head.innerHTML = "";
  await i18n.changeLanguage("en");
});

describe("the 404 page", () => {
  it("offers the homepage, the board and pricing, in the reader's language", async () => {
    await readIn("de");
    mount();
    const links = screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      [i18n.t("notFound.returnHome"), "/"],
      [i18n.t("siteShell.notFound.jobs"), "/jobs"],
      [i18n.t("siteShell.notFound.pricing"), "/pricing"],
    ]);
    expect(links.map(([text]) => text), "an English link on a German page").not.toContain("Return to Home");
  });

  it("names the tab in the reader's language", async () => {
    mount();
    await waitFor(() => expect(document.title).toBe("Page not found — Resume Booster"));
    cleanup();
    await readIn("fr");
    mount();
    await waitFor(() => expect(document.title).toBe(`${i18n.t("siteShell.notFound.title")} — Resume Booster`));
    expect(document.title).not.toContain("Page not found");
  });

  it("writes no console error for a mistyped address", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    expect(error).not.toHaveBeenCalled();
  });

  it("still says noindex, and takes it away when it unmounts", () => {
    mount();
    expect(noindex()).toBe(true);
    cleanup();
    expect(noindex()).toBe(false);
  });

  it("types no English sentence of its own", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../pages/NotFound.tsx"), "utf8"));
    expect(code).not.toMatch(/>\s*Return to Home\s*</);
    expect(code).not.toMatch(/console\.error/);
  });
});
