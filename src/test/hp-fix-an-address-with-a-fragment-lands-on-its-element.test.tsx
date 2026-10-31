/**
 * AN ADDRESS WITH A FRAGMENT LANDS ON THE ELEMENT IT NAMES (review round of
 * 2026-10-26; src/lib/scroll-to-fragment.ts says why).
 *
 * A fresh load of /pricing#pro ended at the footer (Chrome anchored to the
 * baked card, which React's page pushed down before the baked nodes went),
 * and a client-side navigation to /pricing#pro or /data-api#builder opened at
 * the top, because ScrollToTop scrolled to 0 on every new path and nothing
 * read the fragment. Section 99's headless check holds the first on the
 * published build; this holds the logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { ScrollToTop } from "@/components/ScrollToTop";
import { scrollToFragment } from "@/lib/scroll-to-fragment";

let scrolledTo: string[] = [];
beforeEach(() => {
  scrolledTo = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolledTo.push(this.id); });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

/** A page whose sections arrive late, as /pricing's do while its locale loads. */
function LatePricing() {
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), 500); return () => clearTimeout(t); }, []);
  return shown ? <main><section id="free">Free</section><section id="pro">Pro</section></main> : null;
}
function Auth() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/pricing#pro", { replace: true })}>signed in</button>;
}
const app = (entry: string) => (
  <MemoryRouter initialEntries={[entry]}>
    <ScrollToTop />
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/pricing" element={<LatePricing />} />
      <Route path="/data-api" element={<main><div id="builder">Builder</div></main>} />
      <Route path="/resume-checker" element={<main><div id="upload">Uploader</div></main>} />
    </Routes>
  </MemoryRouter>
);

describe("ScrollToTop with a fragment", () => {
  it("Go Pro's return from sign-in lands on the Pro card once it renders", async () => {
    render(app("/auth"));
    fireEvent.click(screen.getByText("signed in"));
    expect(scrolledTo).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(scrolledTo).toEqual(["pro"]);
  });

  it("the Builder link opens /data-api on its card", async () => {
    render(app("/data-api#builder"));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(scrolledTo).toEqual(["builder"]);
  });

  it("leaves #upload to the scanner, which scrolls to its own uploader", async () => {
    render(app("/resume-checker#upload"));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(scrolledTo).toEqual([]);
  });
});

describe("a fresh load of a baked page", () => {
  function bakedPage() {
    document.body.innerHTML = '<div id="root"><div data-app-mount style="display:contents"></div><section id="pro" data-plan="pro">baked</section></div>';
    return document.querySelector<HTMLElement>("[data-app-mount]")!;
  }

  it("waits for React's element and never scrolls to the baked node about to be removed", async () => {
    const mount = bakedPage();
    Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
    scrollToFragment("#pro", { firstLoad: true });
    expect(scrolledTo).toEqual([]);
    const react = document.createElement("section");
    react.id = "pro";
    mount.appendChild(react);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(scrolledTo).toEqual(["pro"]);
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(react);
  });

  it("the reader's own scroll before the element arrives wins", async () => {
    const mount = bakedPage();
    scrollToFragment("#pro", { firstLoad: true });
    window.dispatchEvent(new Event("wheel"));
    const react = document.createElement("section");
    react.id = "pro";
    mount.appendChild(react);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(scrolledTo).toEqual([]);
  });

  it("a page already scrolled with no baked anchor was scrolled by the reader: nothing moves", async () => {
    document.body.innerHTML = '<div id="root"><div data-app-mount style="display:contents"><section id="pricing-faq">faq</section></div></div>';
    Object.defineProperty(window, "scrollY", { value: 400, configurable: true });
    scrollToFragment("#pricing-faq", { firstLoad: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(scrolledTo).toEqual([]);
  });
});
