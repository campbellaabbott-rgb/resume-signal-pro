/**
 * AN OLD TAB AFTER A DEPLOY LOADS THE NEW VERSION AND FILES NO CRASH (NB-41).
 *
 * WHAT WAS WRONG. A deploy renames the lazy chunks, so a tab opened before it
 * fails to load the next page it visits. main.tsx's vite:preloadError handler
 * reloaded the tab, but it cancelled the event every time first, even when it
 * then decided not to reload: the cancelled import resolved to nothing, React
 * threw while the reload was still on its way, the crash screen flashed and
 * the boundary filed a crash report for every such navigation.
 *
 * WHAT HOLDS NOW:
 *   - the handler cancels the event only when it reloads, marks the page as
 *     reloading first, and reloads once; a second failure inside its guard is
 *     left alone;
 *   - while the page reloads, the boundary shows "Loading the new version"
 *     in the reader's language and files nothing;
 *   - a chunk the browser could not fetch is treated the same, in Chrome's,
 *     Firefox's and Safari's words, with or without the mark;
 *   - an ordinary crash is still the crash screen, and still filed;
 *   - main.tsx hands the event to the handler and cancels nothing itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { codeOf } from "./helpers/strip-comments";
import { readMainLocale, readShards } from "./helpers/locale-strings";
import { mergeShards } from "@/i18n/merge-shards";

/** A reader's language, as the site loads it: the main locale with its shards merged in. */
async function readIn(lng: string): Promise<void> {
  i18n.addResourceBundle(lng, "translation", mergeShards(readMainLocale(`${lng}.json`), readShards(`${lng}.json`)), true, true);
  await i18n.changeLanguage(lng);
}

const posted = vi.fn();
vi.mock("@/lib/track-transport", () => ({ postTrackEvent: (...a: unknown[]) => posted(...a), getVisitorId: () => "v" }));

import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  RELOAD_GUARD_MS,
  RELOAD_KEY,
  isReloadingForNewVersion,
  reloadForNewVersion,
  resetNewVersionReloadForTests,
} from "@/lib/new-version-reload";

function Boom({ error }: { error: Error }): JSX.Element {
  throw error;
}
const crashWith = (error: Error) => render(<ErrorBoundary><Boom error={error} /></ErrorBoundary>);
const preloadError = () => new Event("vite:preloadError", { cancelable: true });
const crashesFiled = () => posted.mock.calls.filter(([b]) => (b as { testName?: string }).testName === "client_error");
const NOW = 1_800_000_000_000;

beforeEach(() => {
  sessionStorage.clear();
  resetNewVersionReloadForTests();
  posted.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  resetNewVersionReloadForTests();
  await i18n.changeLanguage("en");
});

describe("the vite:preloadError handler", () => {
  it("cancels the event, marks the page as reloading and reloads, once", () => {
    const ev = preloadError();
    const reload = vi.fn();
    expect(reloadForNewVersion(ev, reload, NOW)).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isReloadingForNewVersion()).toBe(true);
    expect(sessionStorage.getItem(RELOAD_KEY)).toBe(String(NOW));
  });

  it("leaves a second failure inside its guard alone: no loop, and the import's own error reaches the boundary", () => {
    sessionStorage.setItem(RELOAD_KEY, String(NOW - RELOAD_GUARD_MS + 5_000));
    const ev = preloadError();
    const reload = vi.fn();
    expect(reloadForNewVersion(ev, reload, NOW)).toBe(false);
    expect(ev.defaultPrevented, "a cancelled import resolves to nothing and React throws over it").toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(isReloadingForNewVersion()).toBe(false);
  });

  it("still reloads when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const reload = vi.fn();
    expect(reloadForNewVersion(preloadError(), reload, NOW)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("the error boundary during a deploy", () => {
  it("while the page reloads, a render error shows Loading the new version and files nothing", () => {
    reloadForNewVersion(preloadError(), () => {}, NOW);
    crashWith(new TypeError("Cannot read properties of undefined (reading 'default')"));
    expect(screen.getByRole("status").textContent).toContain("Loading the new version…");
    expect(screen.queryByRole("heading", { name: "Something went wrong" }), "the crash screen flashed during the reload").toBeNull();
    expect(crashesFiled(), "a deploy was filed as a crash").toEqual([]);
  });

  for (const [browser, message] of [
    ["Chrome", "Failed to fetch dynamically imported module: https://resumebooster.work/assets/Jobs-Cq3x9a1F.js"],
    ["Firefox", "error loading dynamically imported module: https://resumebooster.work/assets/Jobs-Cq3x9a1F.js"],
    ["Safari", "Importing a module script failed."],
  ] as const) {
    it(`a chunk the browser could not fetch (${browser}) shows the same and files nothing, without the mark`, () => {
      crashWith(new TypeError(message));
      expect(screen.getByRole("status").textContent).toContain("Loading the new version…");
      expect(screen.getByRole("button", { name: "Reload now" })).toBeTruthy();
      expect(crashesFiled()).toEqual([]);
    });
  }

  it("speaks the reader's language", async () => {
    await readIn("de");
    crashWith(new TypeError("Importing a module script failed."));
    expect(screen.getByRole("status").textContent).toContain(i18n.t("siteShell.newVersion.loading"));
    expect(screen.getByRole("status").textContent).not.toContain("Loading the new version");
  });

  it("an ordinary crash is still the crash screen, and still filed", () => {
    crashWith(new Error("Cannot read properties of undefined (reading 'map')"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Something went wrong");
    expect(crashesFiled()).toHaveLength(1);
  });
});

describe("main.tsx", () => {
  const main = codeOf(readFileSync(resolve(__dirname, "../main.tsx"), "utf8"));
  it("hands vite:preloadError to the handler and cancels nothing itself", () => {
    expect(main).toMatch(/addEventListener\("vite:preloadError", \(event\) => \{\s*reloadForNewVersion\(event\);\s*\}\)/);
    expect(main.includes("preventDefault"), "main.tsx cancels the event before deciding to reload").toBe(false);
  });
});
