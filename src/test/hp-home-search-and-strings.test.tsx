/**
 * THE SEARCH GOES WHERE THE BOARD READS IT, AND THE FIRST RENDER WAITS FOR
 * THE MAIN LOCALE THAT CARRIES THE HOME STRINGS.
 *
 *   - The hero's form asks /jobs with q and location (Jobs.tsx reads both);
 *     "Remote", in English or the reader's own word, is the work mode
 *     (mode=remote), not a place called Remote. The try chips go to the
 *     same addresses.
 *   - the homepage's strings are a string shard, so they land with the main
 *     locale; the first render waits for that main locale (useLocaleReady),
 *     and stops waiting after MAIN_WAIT_MS when it never lands.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import i18n from "@/i18n";
import { mergeShards } from "@/i18n/merge-shards";
import { HomeSearchHero } from "@/components/home/HomeSearchHero";
import { searchHref, TRY_CHIPS } from "@/lib/home/search";
import { MAIN_WAIT_MS, useLocaleReady } from "@/lib/home/use-locale-ready";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

describe("the hero's search", () => {
  it("builds the board's address from the two fields", () => {
    expect(searchHref("", "", "Remote")).toBe("/jobs");
    expect(searchHref(" registered nurse ", "", "Remote")).toBe("/jobs?q=registered+nurse");
    expect(searchHref("nurse", "Columbus, OH", "Remote")).toBe("/jobs?q=nurse&location=Columbus%2C+OH");
    expect(searchHref("nurse", "remote", "Remote")).toBe("/jobs?q=nurse&mode=remote");
    expect(searchHref("", "Télétravail", "Télétravail")).toBe("/jobs?mode=remote");
    expect(searchHref("", "Remote", "Télétravail")).toBe("/jobs?mode=remote");
  });

  it("submitting navigates to /jobs in place; the chips link the same addresses", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomeSearchHero openTotal={null} asOf={null} />} />
          <Route path="/jobs" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(TRY_CHIPS.map((c) => c.to)).toEqual(["/jobs?q=nurse", "/jobs?q=data+analyst", "/jobs?mode=remote", "/jobs?q=accountant", "/jobs?q=warehouse"]);
    expect(screen.getByRole("link", { name: "Remote" })).toHaveAttribute("href", "/jobs?mode=remote");
    fireEvent.change(screen.getByLabelText("Job title, skill or company"), { target: { value: "pharmacist" } });
    fireEvent.change(screen.getByLabelText("Place, or Remote"), { target: { value: "Denver, CO" } });
    fireEvent.click(screen.getByRole("button", { name: "Search jobs" }));
    expect(screen.getByTestId("where").textContent).toBe("/jobs?q=pharmacist&location=Denver%2C+CO");
  });

  it("prints no count line until the count has arrived (no number without its date)", () => {
    render(<MemoryRouter><HomeSearchHero openTotal={null} asOf={null} /></MemoryRouter>);
    expect(document.querySelector("[data-home-count]")!.textContent).toBe("");
  });
});

describe("the first-render gate reads the main locale, which carries the shards", () => {
  it("English is ready at once, with the homepage's shard merged under the main bundle", () => {
    expect(i18n.t("home.hero.title", { lng: "en" })).toBe("Live jobs, straight from employers' own hiring systems.");
    expect(i18n.t("pricingPlans.head.h1", { lng: "en" })).not.toBe("pricingPlans.head.h1");
    expect(i18n.t("header.jobs", { lng: "en" })).toBe("Jobs");
    const { result } = renderHook(() => useLocaleReady());
    expect(result.current).toBe(true);
  });

  it("another language waits for its main locale, and its shard strings arrive with it", async () => {
    const lng = "nl";
    const inst = i18next.createInstance();
    await inst.use(initReactI18next).init({ lng, fallbackLng: "en", resources: { en: { translation: { header: { jobs: "Jobs" } } } }, interpolation: { escapeValue: false } });
    const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={inst}>{children}</I18nextProvider>;
    const { result } = renderHook(() => useLocaleReady(), { wrapper });
    expect(result.current, "ready before the Dutch main locale landed").toBe(false);
    const nl = (await import("@/i18n/locales/nl.json")).default as Record<string, unknown>;
    const shard = (await import("@/i18n/shards/home/nl.json")).default as Record<string, unknown>;
    act(() => { inst.addResourceBundle(lng, "translation", mergeShards(nl, [{ name: "home", bundle: shard }])); });
    await waitFor(() => expect(result.current).toBe(true));
    expect(inst.t("home.hero.submit")).toBe("Vacatures zoeken");
  });

  it("a main locale that never lands still opens the gate after MAIN_WAIT_MS", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const inst = i18next.createInstance();
      void inst.use(initReactI18next).init({ lng: "pt", fallbackLng: "en", initImmediate: false, resources: { en: { translation: {} } } });
      const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={inst}>{children}</I18nextProvider>;
      const { result } = renderHook(() => useLocaleReady(), { wrapper });
      expect(result.current).toBe(false);
      act(() => { vi.advanceTimersByTime(MAIN_WAIT_MS - 10); });
      expect(result.current).toBe(false);
      act(() => { vi.advanceTimersByTime(20); });
      expect(result.current).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
