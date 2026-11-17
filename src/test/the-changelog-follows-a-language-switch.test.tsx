/**
 * THE CHANGELOG FOLLOWS A LANGUAGE SWITCH (S14X-179, M-S14-155).
 *
 * What was wrong: /changelog fetched its release-note strings (their own lazy
 * bundle, src/i18n/changelog/<lng>.json) in an effect that ran once, at
 * mount. Switching the language from the header's picker loaded the new
 * language's main strings but never its release notes, so every entry stayed
 * in English (the fallback whose notes loaded at mount) until a reload.
 *
 * Now the load is keyed on the interface language: each switch fetches that
 * language's notes, the list shows its skeleton until they are in, and a slow
 * load for a language the reader has already left cannot mark the current one
 * ready. The keyed effect calls the loader directly; it does not listen for
 * languageChanged, because the loader emits that event itself and a listener
 * that calls it would call itself again.
 *
 * The test renders the page (header, footer and head tags stubbed), reads the
 * newest entry's title in English, then switches to Spanish, French and back
 * to Spanish, and waits for that entry's title in each language's own notes.
 * Each title is read from the locale files, never typed here.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { changelog } from "@/data/changelog";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import Changelog from "@/pages/Changelog";

vi.setConfig(MOUNT_TEST_BUDGET);

vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));

const NOTES = resolve(__dirname, "../i18n/changelog");
type Notes = { changelogEntries: Record<string, { title: string; description: string }> };
const notes = (lng: string): Notes => JSON.parse(readFileSync(resolve(NOTES, `${lng}.json`), "utf8")) as Notes;
const NEWEST = changelog[0].id;
const title = (lng: string) => notes(lng).changelogEntries[NEWEST].title;

afterAll(async () => { await act(async () => { await i18n.changeLanguage("en"); }); });

describe("the changelog page and the language picker", () => {
  it("the three languages the test switches through have their own title for the newest entry", () => {
    const seen = new Set(["en", "es", "fr"].map(title));
    expect(seen.size).toBe(3);
  });

  it("each switch shows the newest entry in the language just chosen, and a switch back works too", async () => {
    await act(async () => { await i18n.changeLanguage("en"); });
    const { container } = render(<MemoryRouter><Changelog /></MemoryRouter>);
    await screen.findByText(title("en"), undefined, SLOW);

    for (const lng of ["es", "fr", "es"]) {
      await act(async () => { await i18n.changeLanguage(lng); });
      await screen.findByText(title(lng), undefined, SLOW);
      // The list says which language's notes it holds, and no other
      // language's title for the same entry is left on the page.
      await waitFor(() => expect(container.querySelector("[data-changelog-lng]")?.getAttribute("data-changelog-lng")).toBe(lng), SLOW);
      for (const other of ["en", "es", "fr"].filter((l) => l !== lng)) expect(screen.queryByText(title(other))).toBeNull();
    }
  });
});
