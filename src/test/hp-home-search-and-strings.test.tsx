/**
 * THE SEARCH GOES WHERE THE BOARD READS IT, AND THE HOME STRINGS NEVER STOP
 * THE MAIN LOCALE LOADING.
 *
 *   - The hero's form asks /jobs with q and location (Jobs.tsx reads both);
 *     "Remote", in English or the reader's own word, is the work mode
 *     (mode=remote), not a place called Remote. The try chips go to the
 *     same addresses.
 *   - src/i18n/index.ts loadLocale skips a language that already has a
 *     bundle, so the homepage's strings for a language are added only after
 *     the main file for it has arrived (or after a wait, when it never does).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "i18next";
import { HomeSearchHero } from "@/components/home/HomeSearchHero";
import { searchHref, TRY_CHIPS } from "@/lib/home/search";
import { homeStringsFile, loadHomeStrings, MAIN_WAIT_MS } from "@/lib/home/strings";

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

describe("the home strings loader", () => {
  it("maps each interface language to its file (fr-CA reads fr; an unknown code reads none)", () => {
    expect(homeStringsFile("de")).toBe("./strings/de.json");
    expect(homeStringsFile("fr-CA")).toBe("./strings/fr.json");
    expect(homeStringsFile("en-GB")).toBe("./strings/en-GB.json");
    expect(homeStringsFile("xx")).toBeNull();
  });

  it("English is merged on load, under the main bundle", () => {
    expect(i18n.t("home.hero.title", { lng: "en" })).toBe("Live jobs, straight from employers' own hiring systems.");
    expect(i18n.t("header.jobs", { lng: "en" })).toBe("Jobs");
  });

  it("waits for the main file of a language before adding the home strings", async () => {
    expect(i18n.hasResourceBundle("nl", "translation")).toBe(false);
    const done = loadHomeStrings("nl");
    await new Promise((r) => setTimeout(r, 50));
    // The home file has loaded by now, but adding it would make loadLocale skip Dutch.
    expect(i18n.hasResourceBundle("nl", "translation")).toBe(false);
    i18n.addResourceBundle("nl", "translation", { header: { jobs: "Vacatures" } });
    await done;
    expect(i18n.t("header.jobs", { lng: "nl" })).toBe("Vacatures");
    expect(i18n.t("home.hero.submit", { lng: "nl" })).toBe("Vacatures zoeken");
  });

  it("adds them anyway once the wait runs out, when the main file never arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      expect(i18n.hasResourceBundle("pt", "translation")).toBe(false);
      const done = loadHomeStrings("pt");
      await vi.advanceTimersByTimeAsync(MAIN_WAIT_MS + 10);
      await done;
      expect(i18n.t("home.hero.submit", { lng: "pt" })).toBe("Buscar vagas");
    } finally {
      vi.useRealTimers();
    }
  });
});
