/**
 * THE SKIP LINK SPEAKS THE READER'S LANGUAGE (S14X-177).
 *
 * WHAT WAS WRONG. index.html writes the skip link, the first thing a keyboard
 * or screen-reader user meets on every page, as "Skip to main content" inside
 * <body>, outside React. Nothing ever changed it: skip-link.ts and
 * SkipLinkFallback.tsx moved where the link lands, never its words or its
 * language, and no locale carried a skip key. A German reader heard English
 * read with German pronunciation rules (the document says lang="de").
 *
 * WHAT HOLDS NOW:
 *   - once the app knows the reader's language and its strings have loaded,
 *     the shell's link says siteShell.skipToMain in that language and carries
 *     its lang; a change of language follows;
 *   - while a language's strings are still loading the link keeps English and
 *     says lang="en", so its words and its lang never disagree;
 *   - index.html is not edited: its static English link, a direct child of
 *     <body>, is the fallback until the app runs, and the only link touched;
 *   - every language but English (and en-GB) has its own words.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import i18n from "@/i18n";
import { mergeShards } from "@/i18n/merge-shards";
import { LOCALE_FILES, readMainLocale, readShards } from "./helpers/locale-strings";
import { SkipLinkFallback } from "@/components/SkipLinkFallback";

const ROOT = resolve(__dirname, "../..");
const shard = (lng: string) =>
  (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/site-shell/${lng}.json`), "utf8")) as { siteShell: { skipToMain?: string } }).siteShell.skipToMain;

/** A reader's language as the site loads it: the main locale with its shards merged in. */
async function readIn(lng: string): Promise<void> {
  i18n.addResourceBundle(lng, "translation", mergeShards(readMainLocale(`${lng}.json`), readShards(`${lng}.json`)), true, true);
  await i18n.changeLanguage(lng);
}

/** index.html's link, placed where index.html places it: first in <body>, before #root. */
function shellLink(): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = "#main-content";
  a.textContent = "\n      Skip to main content\n    ";
  document.body.prepend(a);
  return a;
}

afterEach(async () => {
  cleanup();
  document.body.innerHTML = "";
  await i18n.changeLanguage("en");
});

describe("the shell's skip link follows the reader's language", () => {
  it("German: the shard's words and lang de; French after a change of language", async () => {
    const link = shellLink();
    await readIn("de");
    render(<SkipLinkFallback />);
    expect(shard("de"), "the German shard has no siteShell.skipToMain").toBeTruthy();
    expect(link.textContent).toBe(shard("de"));
    expect(link.getAttribute("lang")).toBe("de");

    await readIn("fr");
    await new Promise((r) => setTimeout(r, 0));
    expect(link.textContent).toBe(shard("fr"));
    expect(link.getAttribute("lang")).toBe("fr");
  });

  it("English keeps its words and says lang en", async () => {
    const link = shellLink();
    render(<SkipLinkFallback />);
    expect(link.textContent).toBe("Skip to main content");
    expect(link.getAttribute("lang")).toBe("en");
  });

  it("a language whose strings have not loaded yet keeps English, and says so", () => {
    const link = shellLink();
    const loading = createInstance();
    void loading.init({
      lng: "nl",
      fallbackLng: "en",
      resources: { en: { translation: { siteShell: { skipToMain: "Skip to main content" } } } },
      initAsync: false,
    });
    render(
      <I18nextProvider i18n={loading}>
        <SkipLinkFallback />
      </I18nextProvider>,
    );
    expect(link.textContent).toBe("Skip to main content");
    expect(link.getAttribute("lang"), "Dutch lang on English words").toBe("en");
  });

  it("only the shell's own link is touched, not a page's", async () => {
    const shell = shellLink();
    const root = document.createElement("div");
    root.id = "root";
    const pages = document.createElement("a");
    pages.href = "#main-content";
    pages.textContent = "page link";
    root.appendChild(pages);
    document.body.appendChild(root);
    await readIn("de");
    render(<SkipLinkFallback />);
    expect(shell.textContent).toBe(shard("de"));
    expect(pages.textContent).toBe("page link");
    expect(pages.hasAttribute("lang")).toBe(false);
  });
});

describe("the words, and the link they land on", () => {
  it("index.html still serves the English link as a direct child of <body>, the fallback the app replaces", () => {
    const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
    const body = html.slice(html.indexOf("<body"));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const links = doc.querySelectorAll('body > a[href="#main-content"]');
    expect(links.length, "the localiser finds index.html's link by `body > a[href=\"#main-content\"]`").toBe(1);
    expect(links[0].textContent?.trim()).toBe("Skip to main content");
    expect(body.indexOf('href="#main-content"')).toBeLessThan(body.indexOf('id="root"'));
  });

  it("every language has its own words, and English is English", () => {
    for (const f of LOCALE_FILES) {
      const lng = f.replace(/\.json$/, "");
      const words = shard(lng);
      expect(typeof words === "string" && words.trim().length > 0, `${lng} has no siteShell.skipToMain`).toBe(true);
      if (lng === "en" || lng === "en-GB") expect(words).toBe("Skip to main content");
      else expect(words, `${lng} prints the English words`).not.toBe("Skip to main content");
    }
  });
});
