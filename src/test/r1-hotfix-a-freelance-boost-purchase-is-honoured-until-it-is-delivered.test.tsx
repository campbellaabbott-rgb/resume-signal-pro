/**
 * R1 HOTFIX S13-082 (low): A FREELANCE BOOST PURCHASE IS HONOURED UNTIL IT IS
 * DELIVERED, AND A TAB THAT HAS ONE CAN STILL BUY ANOTHER.
 *
 * WHAT WAS WRONG. Since R1 the first script in index.html moves Stripe's
 * session_id out of /freelance-boost's address into this tab's stash, and the
 * page read it back with no end. After one $29 Boost every later visit to
 * /freelance-boost in the tab (the footer link, a reload) asked
 * recover-purchase for the OLD purchase and showed it, the buy buttons never
 * rendered (the session branch comes first), and "Start a new purchase"
 * lived only in the branch a session id skips, so no second Boost or $59
 * upgrade could be bought in that tab. startNewPurchase did not clear the
 * stash either.
 *
 * THE FIRST FIX WENT TOO FAR (fixer round, blocker). It honoured the stashed
 * id only on the document that captured it, so a reload, a mobile tab
 * restore or the app's own reload on a failed chunk dropped a PAID purchase
 * that was not delivered yet: a reload before the page mounted showed the
 * buy buttons to a buyer who had just paid, and a reload during generation
 * showed "open the link in your purchase email". It also compared two clocks
 * (the first script's Date.now() against performance.timeOrigin), and an
 * in-app link back to the page, the same document, still read the old
 * purchase back.
 *
 * WHAT HOLDS NOW (the real first script out of index.html, the real page,
 * the backend faked; each new document carries the performance.timeOrigin a
 * browser would give it, which the page no longer reads):
 *   - on Stripe's return the purchase is shown, as before, whatever the
 *     document's clock says;
 *   - a reload before the page ever mounted, and a reload during generation,
 *     still find the purchase: never the buy buttons, never the "bought on
 *     this device" box;
 *   - once the section is on screen the stash forgets the id, so a later
 *     visit in the tab, a reload or an in-app link alike, is a new visit: the
 *     "bought on this device" box, whose "Start a new purchase" brings back
 *     the buy buttons;
 *   - the page showing a delivered purchase offers "Start a new purchase",
 *     which forgets it in the stash and the address; the "already paid" box of
 *     a purchase not yet generated does not offer it;
 *   - (second fixer round) another payment return in the tab, a $5 Full
 *     Analysis on /success, no longer evicts a Boost paid and not yet
 *     generated: the stash keeps one session id per path;
 *   - (second fixer round) a Pro member's grant (pro_<id>) stays in the stash
 *     after delivery, so a reload, Back from the builder or an in-app link
 *     shows its section again: no purchase email names a grant, so the
 *     "open the link in your purchase email" box was a dead end.
 *
 * WAVE 4 MERGED MAIN (2026-10-25). Freelance Boost is no longer sold (wave 4's
 * product cuts: its checkout answers 410 and the page offers no buy button),
 * so the parts of this file that sold a second Boost now hold the opposite:
 * no page offers "Start a new purchase" or a buy button, a delivered
 * purchase still leaves the stash, and a later visit is still the "bought on
 * this device" box. Everything above about honouring a paid purchase until
 * it is delivered holds as written.
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
import { stashedSessionIdFor } from "@/lib/auth-fragment";

vi.setConfig(MOUNT_TEST_BUDGET);

const HEAD = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(readFileSync(resolve(__dirname, "../../index.html"), "utf8"))?.[1] ?? "";
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(HEAD)?.[1] ?? "";
/**
 * A full page load of `url` in this tab (a new document), `later` ms from
 * now, then the first script, as the browser runs it. The document's
 * performance.timeOrigin says when it started, as a browser's does; the
 * page must not need it.
 */
const arrive = (url: string, later = 0) => {
  const startedAt = Date.now() + later - 5;
  Object.defineProperty(performance, "timeOrigin", { configurable: true, get: () => startedAt });
  window.history.replaceState(null, "", url);
  new Function(SCRIPT)();
};
const page = () => render(<BrowserRouter><FreelanceBoost /></BrowserRouter>);
const stash = () => JSON.parse(sessionStorage.getItem("rb_url_stash") ?? "{}") as Record<string, unknown>;
const called = (fn: string) => h.invoke.mock.calls.filter((c) => c[0] === fn).map((c) => (c[1] as { body: { sessionId: string } }).body.sessionId);
const recovered = () => called("recover-purchase");
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
const buyButtons = () => screen.queryByRole("button", { name: /Boost my experience/ });

/** Delivered earlier: recover-purchase finds its saved section. */
const FIRST = "cs_live_BOOSTBOOSTAA";
/** Paid, nothing generated yet: recover-purchase finds nothing, generation makes it. */
const UNDELIVERED = "cs_live_BOOSTNOTYETB";
/** A Pro member's included Boost, delivered earlier: a grant, never a Stripe session, and no purchase email names it. */
const GRANT = "pro_0f8fad5b-d9cb-469f-a165-70867728950e";
const section = (header: string) => ({ structure: "projects_section", structureNote: "", header, scopeStatement: "", projects: [], transitionParagraph: "", gapHandling: "", keywordCoverage: null });
const DRAFT = {
  projects: [{ clientType: "a 10-person dental practice", problem: "", deliverable: "A booking site", toolsSkills: "", outcome: "", duration: "", paymentBand: "", repeatOrReferral: "" }],
  targetRole: "UX Designer", jobPosting: "", employmentTimeline: "", situation: "alongside", workMode: "freelance",
};
let generation: () => Promise<unknown>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.purchaseProduct.mockClear();
  generation = async () => ({ data: { success: true, data: section("The new purchase's section") }, error: null });
  h.invoke.mockReset().mockImplementation(async (fn: string, o: { body: { sessionId?: string } }) => {
    if (fn === "recover-purchase") {
      if (o.body.sessionId === GRANT) return { data: { success: true, found: true, purchases: [{ productType: "freelance_transition_pro", generatedContent: section("The Pro member's section") }] }, error: null };
      return o.body.sessionId === FIRST
        ? { data: { success: true, found: true, purchases: [{ productType: "freelance_boost", generatedContent: section("The first purchase's section") }] }, error: null }
        : { data: { success: true, found: false, purchases: [] }, error: null };
    }
    if (fn === "generate-freelance-boost") return generation();
    return { data: null, error: null };
  });
});
afterEach(() => {
  cleanup();
  delete (performance as unknown as Record<string, unknown>).timeOrigin;
  window.history.replaceState(null, "", "/");
});

describe("a paid Freelance Boost not yet delivered is never dropped", () => {
  it("is shown on Stripe's return, and the stash lets the id go once it is on screen", async () => {
    arrive(`/freelance-boost?session_id=${FIRST}`);
    expect(window.location.search, "the session id stayed in the address").toBe("");
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    expect(recovered()).toEqual([FIRST]);
    await waitFor(() => expect(stash().session_id, "a delivered purchase stayed in the stash").toBeUndefined());
  });

  it("a reload before the page ever mounted (a slow page after Stripe, a failed chunk) still finds the purchase and generates it", async () => {
    localStorage.setItem("freelanceBoostIntake", JSON.stringify(DRAFT));
    arrive(`/freelance-boost?session_id=${UNDELIVERED}`);
    // No mount: the page reloads 3 s later. A new document, a clean address.
    arrive("/freelance-boost", 3_000);
    page();
    expect(await screen.findByText("The new purchase's section", {}, SLOW)).toBeInTheDocument();
    expect(recovered(), "a reload before mount lost the paid purchase").toEqual([UNDELIVERED]);
    expect(called("generate-freelance-boost")).toEqual([UNDELIVERED]);
    expect(buyButtons(), "a buyer who had just paid was shown the buy buttons").toBeNull();
    expect(screen.queryByText(en.freelanceBoost.boughtHereTitle)).toBeNull();
  });

  it("a reload during generation still finds the purchase: no buy buttons, no 'bought on this device' box", async () => {
    localStorage.setItem("freelanceBoostIntake", JSON.stringify(DRAFT));
    generation = () => new Promise(() => { /* the section is still being written when the page reloads */ });
    arrive(`/freelance-boost?session_id=${UNDELIVERED}`);
    page();
    await waitFor(() => expect(called("generate-freelance-boost")).toEqual([UNDELIVERED]), SLOW);
    cleanup();
    h.invoke.mockClear();

    arrive("/freelance-boost", 15_000);
    page();
    await waitFor(() => expect(recovered(), "a reload during generation lost the paid purchase").toEqual([UNDELIVERED]), SLOW);
    await settle();
    expect(buyButtons()).toBeNull();
    expect(screen.queryByText(en.freelanceBoost.boughtHereTitle), "delivery was left to the purchase email").toBeNull();
  });

  it("a document whose clock reads ahead of the first script's (a backward wall-clock step, WebKit after sleep) still honours its own purchase", async () => {
    arrive(`/freelance-boost?session_id=${FIRST}`, 5_000);
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    expect(recovered(), "the capture load itself was refused by a cross-clock comparison").toEqual([FIRST]);
    expect(buyButtons()).toBeNull();
  });

  it("the 'already paid' box of a purchase not yet generated does not offer 'Start a new purchase' (it invited paying again)", async () => {
    arrive(`/freelance-boost?session_id=${UNDELIVERED}`);
    page();
    expect(await screen.findByRole("button", { name: /Generate my section \(already paid\)/ }, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en.freelanceBoost.startNewPurchase })).toBeNull();
    expect(stash().session_id, "an undelivered purchase left the stash").toBe(UNDELIVERED);
  });
});

describe("a paid Freelance Boost not yet delivered survives another payment return in the tab (second fixer round)", () => {
  it("a $5 Full Analysis bought in the same tab before the Boost was generated does not evict it: back on the page, the Boost is still the purchase", async () => {
    localStorage.setItem("freelanceBoostIntake", JSON.stringify(DRAFT));
    generation = () => new Promise(() => { /* still being written when the buyer leaves for another checkout */ });
    arrive(`/freelance-boost?session_id=${UNDELIVERED}`);
    page();
    await waitFor(() => expect(called("generate-freelance-boost")).toEqual([UNDELIVERED]), SLOW);
    cleanup();
    h.invoke.mockClear();

    // Another Stripe return in this tab: the first script stashes the $5 purchase for /success.
    arrive("/success?session_id=cs_live_FULLANALYSIS1", 10_000);
    arrive("/freelance-boost", 30_000);
    page();
    await waitFor(() => expect(recovered(), "a /success return evicted the paid, undelivered Boost").toEqual([UNDELIVERED]), SLOW);
    await settle();
    expect(screen.queryByText(en.freelanceBoost.boughtHereTitle), "a paid purchase not yet generated was left to the purchase email").toBeNull();
    expect(buyButtons(), "a buyer who had paid was offered the buy buttons again").toBeNull();
    expect(stashedSessionIdFor("/success", null).id, "the Boost's id took the /success purchase's place").toBe("cs_live_FULLANALYSIS1");
  });
});

describe("a Pro member's included Boost (a grant: no purchase email names it)", () => {
  it("stays in the tab after it is delivered: a reload, Back from the builder or an in-app link shows the section again, and nothing offers a new purchase", async () => {
    arrive(`/freelance-boost?session_id=${GRANT}`);
    page();
    expect(await screen.findByText("The Pro member's section", {}, SLOW)).toBeInTheDocument();
    await settle();
    expect(stash().session_id, "a delivered grant left the stash, and no email can bring it back").toBe(GRANT);
    cleanup();
    h.invoke.mockClear();

    arrive("/freelance-boost", 20_000);
    page();
    expect(await screen.findByText("The Pro member's section", {}, SLOW)).toBeInTheDocument();
    expect(recovered(), "a reload after delivery could not reach the grant's section").toEqual([GRANT]);
    expect(screen.queryByText(en.freelanceBoost.openYourLink), "a Pro member was sent to a purchase email that does not exist").toBeNull();
    cleanup();
    h.invoke.mockClear();

    window.history.pushState(null, "", "/");
    window.history.pushState(null, "", "/freelance-boost");
    page();
    expect(await screen.findByText("The Pro member's section", {}, SLOW)).toBeInTheDocument();
    // Freelance Boost is no longer sold (wave 4): no new purchase is offered.
    expect(screen.queryByRole("button", { name: en.freelanceBoost.startNewPurchase })).toBeNull();
    expect(buyButtons()).toBeNull();
    expect(stash().session_id, "a delivered grant left the stash").toBe(GRANT);
  });
});

describe("a delivered Freelance Boost is not read back by a later visit in the tab", () => {
  it("a reload after delivery is a new visit, which sells nothing (Freelance Boost is no longer sold)", async () => {
    arrive(`/freelance-boost?session_id=${FIRST}`);
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(stash().session_id).toBeUndefined());
    cleanup();
    h.invoke.mockClear();

    arrive("/freelance-boost", 60_000);
    page();
    expect(await screen.findByText(en.freelanceBoost.boughtHereTitle, {}, SLOW)).toBeInTheDocument();
    await settle();
    expect(recovered(), "a later visit read the old purchase back").toEqual([]);
    expect(screen.queryByText("The first purchase's section")).toBeNull();
    expect(screen.queryByRole("button", { name: en.freelanceBoost.startNewPurchase })).toBeNull();
    expect(buyButtons()).toBeNull();
    expect(screen.queryByRole("button", { name: /Full transition kit/ })).toBeNull();
  });

  it("an in-app link back to the page (the same document, no new load) is a new visit too", async () => {
    arrive(`/freelance-boost?session_id=${FIRST}`);
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    cleanup();
    h.invoke.mockClear();
    // The footer's <Link to="/freelance-boost">: history moves, no document starts, the first script does not run.
    window.history.pushState(null, "", "/");
    window.history.pushState(null, "", "/freelance-boost");
    page();
    expect(await screen.findByText(en.freelanceBoost.boughtHereTitle, {}, SLOW)).toBeInTheDocument();
    await settle();
    expect(recovered(), "an in-app revisit read the old purchase back").toEqual([]);
    expect(buyButtons()).toBeNull();
  });

  it("the page showing a delivered purchase offers no new purchase, and the stash still lets the id go", async () => {
    arrive(`/freelance-boost?session_id=${FIRST}`);
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(stash().session_id, "the delivered purchase stayed in the stash").toBeUndefined());
    expect(screen.queryByRole("button", { name: en.freelanceBoost.startNewPurchase })).toBeNull();
    expect(buyButtons()).toBeNull();
    expect(h.purchaseProduct).not.toHaveBeenCalled();
  });

  it("the purchase id still in the address (storage blocked) shows that purchase and offers no other", async () => {
    window.history.replaceState(null, "", `/freelance-boost?session_id=${FIRST}&utm_source=mail`);
    page();
    expect(await screen.findByText("The first purchase's section", {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en.freelanceBoost.startNewPurchase })).toBeNull();
    expect(buyButtons()).toBeNull();
  });
});
