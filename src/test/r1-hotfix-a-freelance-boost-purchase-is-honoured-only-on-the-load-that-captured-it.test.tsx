/**
 * R1 HOTFIX S13-082 (low): A FREELANCE BOOST PURCHASE IS HONOURED ONLY ON THE
 * LOAD THAT CAPTURED IT, AND A PAGE SHOWING ONE CAN STILL START ANOTHER.
 *
 * WHAT WAS WRONG. Since R1 the first script in index.html moves Stripe's
 * session_id out of /freelance-boost's address into this tab's stash, and the
 * page read it back with no age or this-load check. After one $29 Boost every
 * later visit to /freelance-boost in the tab (a reload, the footer link)
 * asked recover-purchase for the OLD purchase and showed it, the buy buttons
 * never rendered (the session branch comes first), and "Start a new purchase"
 * lived only in the branch a session id skips, so no second Boost or $59
 * upgrade could be bought in that tab. startNewPurchase did not clear the
 * stash either.
 *
 * WHAT HOLDS NOW (the real first script out of index.html, the real page,
 * the backend faked; a later load is a document that started after the
 * capture, which is what performance.timeOrigin says in a browser):
 *   - on Stripe's return the purchase is shown, as before;
 *   - a later load of the page in the same tab does not read the old
 *     purchase back: it shows the "bought on this device" box, whose "Start
 *     a new purchase" brings back the buy buttons;
 *   - the page showing a purchase offers "Start a new purchase" too, and it
 *     forgets the purchase in the stash and the address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const h = vi.hoisted(() => ({ invoke: vi.fn(), purchaseProduct: vi.fn(async () => null) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => h.invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/hooks/use-product-checkout", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-product-checkout")>()),
  useProductCheckout: () => ({ purchaseProduct: h.purchaseProduct, isLoading: false, currentProduct: null }),
}));
vi.mock("@/hooks/use-conversion-tracking", () => ({ useConversionTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackButtonClick: vi.fn() }) }));
vi.mock("@/hooks/use-funnel-tracking", () => ({ useFunnelTracking: () => ({ trackPurchaseCompleted: vi.fn(), trackProductClicked: vi.fn(), trackCheckoutStarted: vi.fn() }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

import FreelanceBoost from "../pages/FreelanceBoost";

vi.setConfig(MOUNT_TEST_BUDGET);

const HEAD = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(readFileSync(resolve(__dirname, "../../index.html"), "utf8"))?.[1] ?? "";
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(HEAD)?.[1] ?? "";
/**
 * A full page load of `url` in this tab, the document starting at `startedAt`
 * (performance.timeOrigin), then the first script, as the browser runs it.
 */
const arrive = (url: string, startedAt = Date.now() - 50) => {
  Object.defineProperty(performance, "timeOrigin", { configurable: true, get: () => startedAt });
  window.history.replaceState(null, "", url);
  new Function(SCRIPT)();
};
const page = () => render(<BrowserRouter><FreelanceBoost /></BrowserRouter>);
const stash = () => JSON.parse(sessionStorage.getItem("rb_url_stash") ?? "{}") as Record<string, unknown>;
const recovered = () => h.invoke.mock.calls.filter((c) => c[0] === "recover-purchase").map((c) => (c[1] as { body: { sessionId: string } }).body.sessionId);

const FIRST = "cs_live_BOOSTBOOSTAA";
const SECTION = { structure: "projects_section", structureNote: "", header: "The first purchase's section", scopeStatement: "", projects: [], transitionParagraph: "", gapHandling: "", keywordCoverage: null };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.purchaseProduct.mockClear();
  h.invoke.mockReset().mockImplementation(async (fn: string, o: { body: { sessionId?: string } }) => fn === "recover-purchase" && o.body.sessionId === FIRST
    ? { data: { success: true, found: true, purchases: [{ productType: "freelance_boost", generatedContent: SECTION }] }, error: null }
    : { data: { success: true, found: false, purchases: [] }, error: null });
});
afterEach(() => {
  cleanup();
  delete (performance as unknown as Record<string, unknown>).timeOrigin;
  window.history.replaceState(null, "", "/");
});

describe("the Freelance Boost a tab bought", () => {
  it("is shown on Stripe's return (the load that captured it)", async () => {
    arrive(`/freelance-boost?session_id=${FIRST}`);
    expect(window.location.search, "the session id stayed in the address").toBe("");
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    expect(recovered()).toEqual([FIRST]);
  });

  it("is not read back on a later load of the page in the same tab, which can sell again", async () => {
    arrive(`/freelance-boost?session_id=${FIRST}`);
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    cleanup();
    h.invoke.mockClear();

    // The footer link or a reload: a new document, started after the capture.
    arrive("/freelance-boost", Date.now() + 60_000);
    page();
    expect(await screen.findByText(en.freelanceBoost.boughtHereTitle, {}, SLOW)).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(recovered(), "a later visit read the old purchase back").toEqual([]);
    expect(screen.queryByText("The first purchase's section")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: en.freelanceBoost.startNewPurchase }));
    expect(await screen.findByRole("button", { name: /Boost my experience/ }, SLOW)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Full transition kit/ })).toBeInTheDocument();
  });

  it("the page showing the purchase offers 'Start a new purchase', which forgets it in the stash and brings back the buy buttons", async () => {
    arrive(`/freelance-boost?session_id=${FIRST}`);
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.freelanceBoost.startNewPurchase }));
    expect(await screen.findByRole("button", { name: /Boost my experience/ }, SLOW)).toBeInTheDocument();
    expect(screen.queryByText("The first purchase's section")).toBeNull();
    expect(stash().session_id, "the old purchase stayed in the stash").toBeUndefined();
    cleanup();
    h.invoke.mockClear();
    // Back to the page in the same document (an in-app link): still a new purchase.
    page();
    expect(await screen.findByRole("button", { name: /Boost my experience/ }, SLOW)).toBeInTheDocument();
    expect(recovered()).toEqual([]);
  });

  it("the purchase id still in the address (storage blocked) is forgotten there too", async () => {
    window.history.replaceState(null, "", `/freelance-boost?session_id=${FIRST}&utm_source=mail`);
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.freelanceBoost.startNewPurchase }));
    await waitFor(() => expect(window.location.search).toBe("?utm_source=mail"));
    expect(await screen.findByRole("button", { name: /Boost my experience/ }, SLOW)).toBeInTheDocument();
  });
});
