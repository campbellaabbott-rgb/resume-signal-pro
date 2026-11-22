/**
 * A TRANSLATED PAGE HAS ITS NAVIGATION IN ITS OWN LANGUAGE (SEO audit
 * 2026-11-18, CONTENT-N4).
 *
 * /fr/normes-cv/france, /es/industrias/* and the other translated pages print
 * their own words in their own language, but the header, the footer and the
 * skip link spoke the reader's: a reader (or Googlebot, which renders with an
 * en-US browser) saw "Companies hiring", "Pricing" and "Skip to main content"
 * around French text, 19 to 31% of the page's words in English. React's
 * Header and Footer now take the page's language from its address
 * (src/lib/locale-from-path.ts) and load its strings when they are not loaded
 * yet; everywhere else they follow the reader as before. The baked files are
 * read in seo-bake-crawler-output ("a translated page's shell").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { localeFromPath } from "@/lib/locale-from-path";

afterEach(cleanup);

const FR = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/fr.json"), "utf8"));
const ES = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/es.json"), "utf8"));

const mount = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Header />
    <Footer />
  </MemoryRouter>,
);

describe("the language an address names", () => {
  it("is the prefix of a translated page, and nothing elsewhere", () => {
    expect(localeFromPath("/fr/normes-cv/france")).toBe("fr");
    expect(localeFromPath("/es/industrias/healthcare")).toBe("es");
    expect(localeFromPath("/es/revisar-curriculum")).toBe("es");
    expect(localeFromPath("/de/lebenslauf-standards/germany")).toBe("de");
    expect(localeFromPath("/pt/padroes-cv/brazil")).toBe("pt");
    expect(localeFromPath("/nl/cv-normen/netherlands")).toBe("nl");
    for (const p of ["/", "/jobs", "/industries/healthcare", "/esports", "/french-jobs", "/jobs/company/de", null, undefined]) expect(localeFromPath(p)).toBeNull();
  });
});

describe("on a French page, for a reader whose browser says English", () => {
  it("the footer and the header name their links in French", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.hasResourceBundle("fr", "translation")).toBe(false);
    mount("/fr/normes-cv/france");
    await waitFor(() => expect(screen.getAllByText(FR.footer.links.companies).length).toBeGreaterThan(0));
    expect(screen.queryByText("Companies hiring")).toBeNull();
    const footer = screen.getByRole("contentinfo");
    expect(footer.getAttribute("lang")).toBe("fr");
    expect(footer.textContent).toContain(FR.footer.pricing);
    const banner = screen.getByRole("banner");
    expect(banner.getAttribute("lang")).toBe("fr");
    expect(banner.textContent).toContain(FR.header.companies);
    // The reader's own language is left as it was.
    expect(i18n.language).toBe("en");
  });
});

describe("on a Spanish page", () => {
  it("the footer is Spanish", async () => {
    await i18n.changeLanguage("en");
    mount("/es/industrias/healthcare");
    await waitFor(() => expect(screen.getAllByText(ES.footer.links.companies).length).toBeGreaterThan(0));
    expect(screen.getByRole("contentinfo").getAttribute("lang")).toBe("es");
  });
});

describe("on every other page", () => {
  it("the header and footer follow the reader, with no lang of their own", async () => {
    await i18n.changeLanguage("en");
    mount("/jobs");
    expect(screen.getAllByText("Companies hiring").length).toBeGreaterThan(0);
    expect(screen.getByRole("contentinfo").hasAttribute("lang")).toBe(false);
    expect(screen.getByRole("banner").hasAttribute("lang")).toBe(false);
  });
});
