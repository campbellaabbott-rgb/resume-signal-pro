/**
 * A CRASH IN ONE PAGE STAYS IN THAT PAGE, AND BACK LEAVES IT (NB-40).
 *
 * WHAT WAS WRONG. The app had one error boundary, outside the router. A
 * render error on any page replaced the whole site with the crash screen, and
 * the boundary never cleared its error: Back, a link or a typed address
 * changed the URL under a crash screen that stayed. Its only ways on were
 * Refresh and a mail address.
 *
 * WHAT HOLDS NOW, with the real boundary and the real crash screen inside a
 * router (only the analytics transport faked):
 *   - a crash inside a page leaves the rest of the shell mounted;
 *   - Back leaves the crash screen for the page before, and so does a move
 *     to another address;
 *   - the crash screen links the homepage, in the reader's language;
 *   - App.tsx keeps the root boundary outside the router as the last resort,
 *     and wraps the routes, inside the router, in the route boundary.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from "react-router-dom";
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

vi.mock("@/lib/track-transport", () => ({ postTrackEvent: vi.fn(), getVisitorId: () => "v" }));

import { RouteErrorBoundary } from "@/components/ErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("a page that cannot render");
}

let go: NavigateFunction;
function Shell() {
  go = useNavigate();
  return <header>the site's header</header>;
}

const mount = (start: string) =>
  render(
    <MemoryRouter initialEntries={[start]}>
      <Shell />
      <RouteErrorBoundary>
        <Routes>
          <Route path="/fine" element={<p>a page that works</p>} />
          <Route path="/other" element={<p>another page</p>} />
          <Route path="/broken" element={<Boom />} />
        </Routes>
      </RouteErrorBoundary>
    </MemoryRouter>,
  );

const crashShown = () => screen.queryByRole("heading", { level: 1, name: "Something went wrong" }) !== null;

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

describe("a crash inside a page", () => {
  it("leaves the rest of the site mounted", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount("/fine");
    act(() => go("/broken"));
    expect(crashShown(), "the crash screen did not show").toBe(true);
    expect(screen.getByText("the site's header"), "the crash took the whole site with it").toBeTruthy();
  });

  it("Back leaves the crash screen for the page before", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount("/fine");
    act(() => go("/broken"));
    expect(crashShown()).toBe(true);
    act(() => go(-1));
    expect(crashShown(), "Back changed the address and left the crash screen").toBe(false);
    expect(screen.getByText("a page that works")).toBeTruthy();
  });

  it("a move to another address leaves it too, and the broken page crashes again if it is opened again", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount("/broken");
    expect(crashShown()).toBe(true);
    act(() => go("/other"));
    expect(screen.getByText("another page")).toBeTruthy();
    act(() => go("/broken"));
    expect(crashShown()).toBe(true);
  });

  it("the crash screen links the homepage, in the reader's language", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount("/broken");
    expect(screen.getByRole("link", { name: "Go to the homepage" }).getAttribute("href")).toBe("/");
    cleanup();
    await readIn("de");
    mount("/broken");
    const home = screen.getByRole("link", { name: i18n.t("siteShell.crashHome") });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.textContent).not.toBe("Go to the homepage");
  });
});

describe("the app's boundaries", () => {
  const app = codeOf(readFileSync(resolve(__dirname, "../App.tsx"), "utf8"));
  const at = (s: string) => {
    const i = app.indexOf(s);
    expect(i, `App.tsx has no ${s}`).toBeGreaterThan(-1);
    return i;
  };

  it("the root boundary stays outside the router, and the route boundary wraps the routes inside it", () => {
    const order = [
      at("<ErrorBoundary>"),
      at("<BrowserRouter>"),
      at("<RouteErrorBoundary>"),
      at("<Routes>"),
      at("</Routes>"),
      at("</RouteErrorBoundary>"),
      at("</BrowserRouter>"),
      at("</ErrorBoundary>"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
