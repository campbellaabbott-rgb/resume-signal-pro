/**
 * THE TRUST PAGE LISTS EVERY COPY OF A RÉSUMÉ WITH ITS CLOCK -- rendered, so
 * the numbers a reader sees are the interpolated ones and never a
 * {{placeholder}} or a key. The copy-level guards are in
 * a-resume-never-rides-a-stripe-session.test.ts; this is the page itself.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import Trust from "@/pages/Trust";
import { AI_CACHE_MAX_HOURS, PRIVACY_EMAIL, REPORT_CACHE_DAYS, SHARED_ANALYSIS_DAYS, TEMP_RESUME_HOURS } from "@/lib/resume-retention";

// The page's neighbours are not what this test is about, and several of them
// read the network; each renders as nothing.
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/SocialProof", () => ({ SocialProof: () => null }));
vi.mock("@/components/HowItWorks", () => ({ HowItWorks: () => null }));
vi.mock("@/components/FAQ", () => ({ FAQ: () => null }));
vi.mock("@/components/ResumeBeforeAfter", () => ({ ResumeBeforeAfter: () => null }));
vi.mock("@/hooks/use-scan-totals", () => ({ useScanTotals: () => null }));

function renderTrust() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/trust"]}>
        <Trust />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe("/trust retention table", { timeout: 30_000 }, () => {
  it("renders every store with the clock the code enforces, and no placeholder", () => {
    const { container } = renderTrust();
    const section = container.querySelector("#retention") as HTMLElement;
    expect(section, "the #retention section is missing").toBeTruthy();
    const table = within(section).getByRole("table");
    const text = table.textContent ?? "";

    expect(within(table).getAllByRole("row").length).toBe(1 + 14);
    expect(text).toContain(`${TEMP_RESUME_HOURS} hours, then deleted`);
    expect(text).toContain(`${REPORT_CACHE_DAYS} days, then deleted`);
    expect(text).toContain(`${SHARED_ANALYSIS_DAYS} days, or until you press “Delete My Data” on the results page`);
    expect(text).toContain(PRIVACY_EMAIL);
    expect(text).toContain("Stripe receives no resume text, and no reference to it");
    // The AI cache is a store of its own, with its own clock.
    expect(text).toContain(`Up to ${AI_CACHE_MAX_HOURS} hours, then deleted`);
    // Local storage outlives the tab, and says so.
    expect(text).toContain("This browser's local storage, on your device");
    expect(text).toContain("the Clear Browser Data button on a paid results page clears all of it");
    expect(container.textContent).not.toMatch(/\{\{|\}\}|trustPage\./);
  });

  it("the free-scan card states both clocks", () => {
    renderTrust();
    expect(screen.getByText(new RegExp(`for ${TEMP_RESUME_HOURS} hours, so a checkout can use it.*for ${REPORT_CACHE_DAYS} days`))).toBeInTheDocument();
  });

  it("makes no categorical never-stored claim anywhere on the page", () => {
    const { container } = renderTrust();
    expect(container.textContent).not.toMatch(/never stored|zero storage|immediately discarded|in memory/i);
  });
});

/**
 * The review of 9fe3bc0d: the Trust page still said, in all nine locales, that
 * a CV leaves us for "the employers it applies to for you" when the apply
 * agent is turned on, and kept it "while you use the agent, which sends it to
 * the employers it applies to for you". The agent is switched off (the
 * 2026-10-11 apply pivot); both sentences now say so, and say how long a CV
 * given to it earlier is kept.
 */
describe("/trust says the apply agent is switched off and sends nothing", () => {
  const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
  // The old send claim, as each locale spelled it.
  const OLD: Record<(typeof LOCALES)[number], RegExp> = {
    en: /applies to for you/, "en-GB": /applies to for you/, de: /bei denen er sich für dich bewirbt/,
    es: /se postula por ti/, fr: /il postule pour vous/, hi: /आपकी ओर से आवेदन करता है/,
    nl: /namens jou solliciteert/, pt: /se candidata por si/, tl: /inaaplayan nito para sa iyo/,
  };
  const OFF: Record<(typeof LOCALES)[number], RegExp> = {
    en: /switched off/, "en-GB": /switched off/, de: /abgeschaltet/, es: /desactivado/, fr: /désactivé/,
    hi: /बंद है/, nl: /staat uit/, pt: /desligado/, tl: /Naka-off/,
  };

  it.each(LOCALES)("%s: neither sentence says the agent applies for the person, and both say it is off", async (l) => {
    const { default: d } = await import(`../i18n/locales/${l}.json`);
    for (const v of [d.trustPage.security.neverSold.description, d.trustPage.retention.rows.agent.howLong] as string[]) {
      expect(v).not.toMatch(OLD[l]);
      expect(v).toMatch(OFF[l]);
    }
    expect(d.trustPage.retention.rows.agent.howLong).toContain("{{email}}");
  });

  it("the rendered page says the agent sends nothing to employers", () => {
    const { container } = renderTrust();
    expect(container.textContent).toMatch(/Our apply agent is switched off and sends nothing to employers/);
    expect(container.textContent).not.toMatch(/applies to for you/);
  });
});
