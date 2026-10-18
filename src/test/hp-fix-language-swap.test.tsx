/**
 * A LANGUAGE NEVER SHIFTS THE PAGE, AND CHANGING IT NEVER DROPS FOCUS.
 *
 * Measured on hp/integration 70e4e525 (Playwright, cold load with the
 * browser's locale):
 *   - the homepage first rendered in English and then swapped to the
 *     reader's language: CLS 0.18 at 375 px in de, es and fr, where the
 *     target is 0.1 (spec 0.02). The pricing page waited for its strings and
 *     showed no shift.
 *   - but the pricing page waited on EVERY language change: picking Deutsch
 *     in its own footer unmounted the page's content and the footer itself,
 *     so focus fell to <body> and the reader was thrown to the top
 *     (WCAG 2.4.3). The homepage kept both.
 *   - the pricing loader waited for the main locale with no deadline, so a
 *     main locale that never loads would leave the page blank for good.
 *
 * Both pages now gate only their FIRST render on the reader's strings and
 * keep what they show mounted from then on; the footer is never gated; and
 * each loader stops waiting for the main locale after its deadline. Each
 * test uses a language no other test touches: the loaders remember what
 * they merged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    from: () => stubTable(),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import HomePage from "@/pages/home/HomePage";
import PricingPage from "@/pages/pricing/PricingPage";
import { loadPricingStrings, pricingStringsMerged } from "@/components/pricing/use-pricing-strings";

vi.setConfig({ ...MOUNT_TEST_BUDGET, testTimeout: 30_000 });
const SLOW = { timeout: 15_000 } as const;

type Tree = Record<string, Record<string, Record<string, string>>>;
const homeH1 = (lng: string) => (JSON.parse(readFileSync(resolve(__dirname, `../lib/home/strings/${lng}.json`), "utf8")) as Tree).home.hero.title;
const EN_H1 = homeH1("en");

beforeEach(async () => {
  await act(async () => { await i18n.changeLanguage("en"); });
});
afterEach(async () => {
  cleanup();
  await act(async () => { await i18n.changeLanguage("en"); });
});

function mount(page: "home" | "pricing") {
  return render(
    <HelmetProvider>
      <MemoryRouter>{page === "home" ? <HomePage /> : <PricingPage />}</MemoryRouter>
    </HelmetProvider>,
  );
}

/** Every <h1> text the page ever shows, from mount on. */
function watchH1(root: HTMLElement): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  const read = () => {
    for (const h of root.querySelectorAll("h1")) {
      const text = (h.textContent ?? "").trim();
      if (text && seen[seen.length - 1] !== text) seen.push(text);
    }
  };
  read();
  const mo = new MutationObserver(read);
  mo.observe(root, { subtree: true, childList: true, characterData: true });
  return { seen, stop: () => mo.disconnect() };
}

describe("the first render waits for the reader's language", () => {
  it("homepage in German: no English frame, then the German headline", async () => {
    await act(async () => { void i18n.changeLanguage("de"); });
    const { container } = mount("home");
    const h1s = watchH1(container);
    expect(container.querySelector("footer"), "the footer is never gated").not.toBeNull();
    await waitFor(() => expect(container.querySelector("main h1")?.textContent).toBe(homeH1("de")), SLOW);
    h1s.stop();
    expect(h1s.seen, "an English headline was shown before the German one").not.toContain(EN_H1);
  });
});

describe("a later language change keeps the page and the focus", () => {
  for (const [page, lng] of [["pricing", "es"], ["home", "nl"]] as const) {
    it(`${page}: switching to ${lng} keeps <main>'s content, the footer and the focused control`, async () => {
      const { container } = mount(page);
      await waitFor(() => expect(container.querySelector("main h1")).not.toBeNull(), SLOW);
      const footerLink = container.querySelector<HTMLElement>("footer a[href], footer button");
      expect(footerLink).not.toBeNull();
      footerLink!.focus();
      expect(document.activeElement).toBe(footerLink);

      await act(async () => { void i18n.changeLanguage(lng); });
      // At once, before the new strings land: nothing was unmounted.
      expect(container.querySelector("main h1"), "the page's content unmounted on a language change").not.toBeNull();
      expect(container.querySelector("footer"), "the footer unmounted on a language change").not.toBeNull();
      expect(document.activeElement, "focus fell out of the footer").toBe(footerLink);
      expect(footerLink!.isConnected).toBe(true);
    });
  }
});

describe("the pricing loader has a deadline", () => {
  it("a main locale that never lands still lets the page render, after the wait", async () => {
    const lng = "pt";
    if (i18n.hasResourceBundle(lng, "translation")) i18n.removeResourceBundle(lng, "translation");
    expect(pricingStringsMerged(lng)).toBe(false);
    await loadPricingStrings(lng, 60);
    expect(pricingStringsMerged(lng)).toBe(true);
  });
});
