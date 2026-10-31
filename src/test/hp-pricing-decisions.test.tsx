/**
 * THE REBUILT /pricing HOLDS EVERY OWNER DECISION OF 2026-10-17.
 *
 * Mounted for real (jsdom, the shipped components, English), with only the
 * backend, the session and the Pro account check faked:
 *
 *   1. No product the owner cut is ever rendered, in any state: the only
 *      one-off is the Full Analysis, and every dollar figure on the page is
 *      one of $0, $5, $45 or $49.
 *   2. Pro's perk list comes from ONE typed source (pro-perks-mirror.ts).
 *   3. Both buy buttons render as shipped, with src/config/seller.ts empty:
 *      sales stay on (the owner, 2026-10-27), no card says purchases open
 *      soon, and the seller line prints once both halves are set.
 *   4. "All sales are final." sits in the block of every buy control.
 *   5. No place is named as unsold: a buyer in the EU, the EEA, the UK or
 *      India checks out as on main (the owner, 2026-10-27: "Keep selling as
 *      today"), so no region notice, line or question is on the page.
 *   6. Go Pro needs a separate, unchecked, required renewal box.
 *   7. The page never says the word the owner banned for scans.
 *   8. A closed Full Analysis delivery gate and a closed Pro gate each give
 *      their own reason, and Pro's included Full Analysis hides with G2.
 *   9. Fit is free without an account, and the table says so.
 *  10. One open-postings figure, always with its count time.
 *  11. The FAQ answers sit in the DOM while their questions are closed.
 *  12. The structured data offers only what is on sale (as shipped: both).
 *  13. The preview's open state is labelled and never the route's.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { codeOf } from "./helpers/strip-comments";
import { readMainLocale } from "./helpers/locale-strings";
import { PASS, PRODUCTS, SUBSCRIPTIONS } from "@/config/products";

const h = vi.hoisted(() => ({
  user: null as null | { email: string },
  pro: { active: false, status: null as string | null, loading: false, trialing: false, linkPending: false, currentPeriodEnd: null },
  subscribe: vi.fn(async () => true),
  manage: vi.fn(async () => {}),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user, session: h.user ? { access_token: "jwt" } : null }) }));
vi.mock("@/hooks/useBoardVendorCounts", () => ({
  useBoardVendorCounts: () => ({ counts: { workday: 1 }, openTotal: 1040488, asOf: new Date("2026-10-17T22:45:00Z"), ready: true }),
}));
vi.mock("@/hooks/use-pro-subscription", () => ({
  PRO_CONFIRM_INTERVAL_MS: 3000,
  useProSubscription: () => ({
    pro: h.pro,
    subscribe: h.subscribe,
    manage: h.manage,
    actionLoading: false,
    refresh: async () => false,
    knownEmail: h.user?.email ?? "",
    justSubscribed: false,
    notConfirmedYet: false,
  }),
}));

import { PricingView } from "@/components/pricing/PricingView";
import { resolveSaleGates, type SaleGateInput } from "@/components/pricing/sale-gates";
import { PRO_PERK_ITEMS, visibleProPerks } from "@/components/pricing/pro-perks-mirror";
import { pricingJsonLd } from "@/components/pricing/pricing-jsonld";
import { FAQ_IDS } from "@/components/pricing/PricingFaq";
import { BUILDER_PRICE_USD, FULL_ANALYSIS_PRICE_USD, PRO_PRICE_USD } from "@/components/pricing/plan-facts";
import en from "@/i18n/shards/pricing/en.json";
import PricingPage from "@/pages/pricing/PricingPage";
import { HelmetProvider } from "react-helmet-async";

vi.setConfig(MOUNT_TEST_BUDGET);

const S = en.pricingPlans;
const MAIN_EN = readMainLocale("en.json") as { purchaseTerms: Record<string, string> };
/** An obviously fake identity, used only inside tests (owner decision: never invented in src). */
const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
const POSTINGS = { openTotal: 1040488, asOf: "2026-10-17T22:45:00Z" };

type GateCase = { name: string; input: SaleGateInput | undefined };
const SHIPPED: GateCase = { name: "as shipped (no seller, both switches on)", input: undefined };
const OPEN: GateCase = { name: "seller set, every gate open", input: { seller: TEST_SELLER, fullAnalysisDelivered: true, proWatched: true } };
const SWITCHES_OFF: GateCase = { name: "both sale switches off", input: { fullAnalysisDelivered: false, proWatched: false } };
const PREVIEW: GateCase = { name: "preview forced open", input: { previewOpen: true } };
const ALL_CASES = [SHIPPED, SWITCHES_OFF, OPEN, PREVIEW];

function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const m = query.match(/min-width:\s*(\d+)px/);
    return {
      matches: m ? width >= Number(m[1]) : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

function mount(input: SaleGateInput | undefined, postings: { openTotal: number | null; asOf: string | null } = POSTINGS, extra: Record<string, unknown> = {}) {
  const gates = resolveSaleGates(input);
  return render(
    <MemoryRouter initialEntries={["/pricing"]}>
      <Routes>
        <Route path="/pricing" element={<PricingView postings={postings} gates={gates} {...extra} />} />
        <Route path="/auth" element={<p data-testid="auth-page">auth</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const buyButtons = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-buy]")];
const textOf = (c: HTMLElement) => (c.textContent ?? "").replace(/\s+/g, " ");

beforeAll(() => {
  // PurchaseTerms asks create-checkout whether the EU/UK switch is on: answered here, never sent.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ euUkSales: false }), { status: 200 })));
});
beforeEach(() => {
  h.user = null;
  h.pro = { active: false, status: null, loading: false, trialing: false, linkPending: false, currentPeriodEnd: null };
  h.subscribe.mockClear();
  h.manage.mockClear();
  setViewport(375);
});
afterEach(() => cleanup());

describe("1. no cut product is ever rendered", () => {
  const CUT_NAMES = [
    ...Object.entries(PRODUCTS).filter(([id]) => id !== "fullAnalysis").map(([, p]) => p.name),
    SUBSCRIPTIONS.agent.name,
    PASS.name,
  ];
  for (const width of [375, 1280]) {
    for (const c of ALL_CASES) {
      it(`${c.name}, ${width}px`, () => {
        setViewport(width);
        const { container } = mount(c.input);
        const text = textOf(container);
        for (const name of CUT_NAMES) expect(text, name).not.toContain(name);
        expect(text).not.toMatch(/Freelance|Transition Pro|Scan Pack|Premium|Morning Queue/i);
        const dollars = [...new Set([...text.matchAll(/\$\s?(\d[\d,.]*)/g)].map((m) => Number(m[1].replace(/,/g, ""))))];
        for (const d of dollars) expect([0, FULL_ANALYSIS_PRICE_USD, PRO_PRICE_USD, BUILDER_PRICE_USD], `a $${d} figure`).toContain(d);
      });
    }
  }
});

describe("2. Pro's perks come from one typed source", () => {
  it("the card prints exactly the mirror's items, in order, through their keys", () => {
    const { container } = mount(OPEN.input);
    const keys = [...container.querySelectorAll("[data-testid=pro-perks] [data-perk]")].map((e) => e.getAttribute("data-perk"));
    expect(keys).toEqual(PRO_PERK_ITEMS.map((p) => p.key));
  });

  it("every item's key is a main-locale key whose English matches the item's text", () => {
    // Switch-over step 6: the list is wave 4's (proPlan.perks.*, in the main
    // locales); the pricing shard keeps no perk strings of its own.
    const main = readMainLocale("en.json") as { proPlan: { perks: Record<string, string> } };
    for (const p of PRO_PERK_ITEMS) {
      expect(p.key, p.key).toMatch(/^proPlan\.perks\./);
      expect(main.proPlan.perks[p.key.replace(/^proPlan\.perks\./, "")], p.key).toBe(p.text);
    }
    expect((S.pro as Record<string, unknown>).perks, "the pricing shard keeps no perk strings").toBeUndefined();
  });

  it("no other pricing source types a perk's words", () => {
    const dir = resolve(__dirname, "../components/pricing");
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && f !== "pro-perks-mirror.ts");
    for (const f of files) {
      const code = codeOf(readFileSync(join(dir, f), "utf8"));
      for (const p of PRO_PERK_ITEMS) expect(code, `${f} types "${p.text}"`).not.toContain(p.text.slice(0, 24));
    }
  });

  it("Pro's list says nothing the owner removed", () => {
    for (const p of PRO_PERK_ITEMS) expect(p.text).not.toMatch(new RegExp(["Freelance", "Transition", "un" + "limited", "all-access", "future tools", "every paid tool"].join("|"), "i"));
  });
});

describe("3. both buy buttons with no seller named (sales stay on, owner 2026-10-27)", () => {
  it("as shipped: both buttons, no gate note, and nothing opens soon", () => {
    const { container } = mount(undefined);
    expect(buyButtons(container).map((b) => b.getAttribute("data-buy"))).toEqual(["full-analysis", "pro"]);
    expect(container.querySelector("[data-gate]")).toBeNull();
    expect(textOf(container)).not.toMatch(/open soon/i);
    expect(textOf(container)).not.toMatch(/Sold by/);
  });

  it("half an identity prints no seller line, and the buttons stay", () => {
    for (const seller of [{ legalName: "TEST SELLER", postalAddress: "" }, { legalName: "  ", postalAddress: "TEST ADDRESS" }]) {
      const { container } = mount({ seller });
      expect(buyButtons(container).map((b) => b.getAttribute("data-buy"))).toEqual(["full-analysis", "pro"]);
      expect(textOf(container)).not.toMatch(/Sold by/);
      cleanup();
    }
  });

  it("with both halves set, the seller line prints beside the buttons", () => {
    const { container } = mount(OPEN.input);
    expect(buyButtons(container).map((b) => b.getAttribute("data-buy"))).toEqual(["full-analysis", "pro"]);
    expect(textOf(container)).toContain("Sold by TEST SELLER, TEST ADDRESS, NOWHERE.");
  });

  it("no source outside the tests carries the fake identity", () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
        return /\.(ts|tsx|json)$/.test(n) ? [p] : [];
      });
    for (const f of walk(resolve(__dirname, ".."))) expect(readFileSync(f, "utf8"), f).not.toContain("TEST SELLER");
  });
});

describe("4. 'All sales are final.' beside every buy control", () => {
  for (const c of [OPEN, PREVIEW]) {
    for (const width of [375, 1280]) {
      it(`${c.name}, ${width}px`, () => {
        setViewport(width);
        const { container } = mount(c.input);
        const buttons = buyButtons(container);
        expect(buttons.length).toBe(2);
        for (const b of buttons) {
          const block = b.closest("[data-buy-block]");
          expect(block, b.getAttribute("data-buy")!).not.toBeNull();
          const finals = block!.querySelectorAll("[data-final-sale]");
          expect(finals.length).toBe(1);
          expect(finals[0].textContent).toBe(S.buy.finalSale);
          // No region line: a buyer in the EU, the EEA, the UK or India checks out as on main.
          expect(block!.querySelectorAll("[data-region-line]").length).toBe(0);
        }
      });
    }
  }
});

describe("5. no place is named as unsold (owner, 2026-10-27: keep selling as today)", () => {
  for (const width of [375, 1280]) {
    it(`${width}px: no region notice, line or question, and both buttons`, () => {
      setViewport(width);
      const { container } = mount(SHIPPED.input);
      expect(container.querySelector("[data-notice=region]")).toBeNull();
      expect(container.querySelector("[data-region-line]")).toBeNull();
      expect(container.querySelector("[data-faq=region]")).toBeNull();
      expect(textOf(container)).not.toMatch(/EU, the EEA, the UK or India|registered for VAT|GST in India/);
      expect(buyButtons(container).length).toBe(2);
    });
  }

  it("no string on the page names a place checkout refuses, or a billing address", () => {
    const all = JSON.stringify(en);
    expect(all).not.toMatch(/billing address|refuses addresses/i);
    expect(all).not.toMatch(/EU, the EEA, the UK or India|registered for VAT|GST/);
  });
});

describe("6. Go Pro needs a separate, unchecked, required renewal box", () => {
  it("the box starts empty, is required, and sits above Go Pro in the button's block", () => {
    const { container } = mount(PREVIEW.input);
    const block = container.querySelector<HTMLElement>("[data-buy-block=pro]")!;
    // PurchaseTerms' own box, the one purchaseTerms() reads (switch-over step 8).
    const box = block.querySelector<HTMLInputElement>("[data-auto-renew-box] input")!;
    expect(block.querySelectorAll("input[type=checkbox]").length).toBe(1);
    expect(box.checked).toBe(false);
    expect(box.required).toBe(true);
    expect(box.getAttribute("aria-required")).toBe("true");
    expect(box.id).not.toBe("");
    const label = block.querySelector(`label[for="${box.id}"]`)!;
    expect(label.textContent).toBe(MAIN_EN.purchaseTerms.autoRenewConsent.replace("{{price}}", `$${PRO_PRICE_USD}`));
    const button = block.querySelector("[data-buy=pro]")!;
    expect(box.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Go Pro with the box empty starts nothing, says why and moves focus to the box", () => {
    const pressed = vi.fn();
    const { container } = mount(PREVIEW.input, POSTINGS, { onPreviewPress: pressed });
    const block = container.querySelector<HTMLElement>("[data-buy-block=pro]")!;
    fireEvent.click(block.querySelector("[data-buy=pro]")!);
    expect(pressed).not.toHaveBeenCalled();
    const box = block.querySelector<HTMLInputElement>("[data-auto-renew-box] input")!;
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(S.pro.consentError);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(box);
    fireEvent.click(box);
    fireEvent.click(block.querySelector("[data-buy=pro]")!);
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("wired to the account: no checkout until the box is ticked, then one, for the signed-in address", () => {
    h.user = { email: "member@example.com" };
    const { container } = mount(OPEN.input);
    const block = container.querySelector<HTMLElement>("[data-buy-block=pro]")!;
    fireEvent.click(block.querySelector("[data-buy=pro]")!);
    expect(h.subscribe).not.toHaveBeenCalled();
    fireEvent.click(block.querySelector("input[type=checkbox]")!);
    fireEvent.click(block.querySelector("[data-buy=pro]")!);
    expect(h.subscribe).toHaveBeenCalledTimes(1);
    expect(h.subscribe).toHaveBeenCalledWith("member@example.com");
  });

  it("signed out, a ticked Go Pro goes to sign-in first", () => {
    const { container } = mount(OPEN.input);
    const block = container.querySelector<HTMLElement>("[data-buy-block=pro]")!;
    fireEvent.click(block.querySelector("input[type=checkbox]")!);
    fireEvent.click(block.querySelector("[data-buy=pro]")!);
    expect(h.subscribe).not.toHaveBeenCalled();
    expect(screen.getByTestId("auth-page")).toBeTruthy();
  });

  it("a member sees Manage, and an account that owes sees Update payment, never a second Go Pro", () => {
    h.user = { email: "member@example.com" };
    h.pro = { ...h.pro, active: true, status: "active" };
    let { container } = mount(OPEN.input);
    expect(container.querySelector("[data-buy=pro]")).toBeNull();
    expect(container.querySelector("[data-pro-state=active]")?.textContent).toContain(S.pro.manage);
    cleanup();
    h.pro = { ...h.pro, active: false, status: "past_due" };
    ({ container } = mount(OPEN.input));
    expect(container.querySelector("[data-buy=pro]")).toBeNull();
    expect(container.querySelector("[data-pro-state=owing]")?.textContent).toContain(S.pro.updatePayment);
  });
});

describe("7. never the banned word for scans", () => {
  it("in every state and width, rendered", () => {
    for (const width of [375, 1280]) {
      for (const c of ALL_CASES) {
        setViewport(width);
        const { container } = mount(c.input);
        expect(textOf(container)).not.toMatch(new RegExp("un" + "limited|all-access|now and future", "i"));
        cleanup();
      }
    }
  });

  it("Pro's scans say 'no daily cap'", () => {
    const { container } = mount(OPEN.input);
    expect(container.querySelector('[data-perk="proPlan.perks.noDailyScanCap"]')?.textContent).toBe("No daily cap on scans");
    expect(container.querySelector("[data-row=scans]")?.textContent).toContain(S.limits.noScanCap);
  });
});

describe("8. each switched-off card gives its own reason", () => {
  it("both switches off: the Full Analysis and Pro say why, differently", () => {
    const { container } = mount(SWITCHES_OFF.input);
    expect(buyButtons(container)).toEqual([]);
    const fa = container.querySelector("[data-plan=full-analysis] [data-gate]")!;
    const pro = container.querySelector("[data-plan=pro] [data-gate]")!;
    expect(fa.getAttribute("data-gate")).toBe("delivery");
    expect(fa.textContent).toBe(S.buy.gateFaDelivery);
    expect(pro.getAttribute("data-gate")).toBe("watched");
    expect(pro.textContent).toBe(S.buy.gateProWatched);
    expect(new Set([S.buy.gateFaDelivery, S.buy.gateProWatched]).size).toBe(2);
    expect(`${S.buy.gateFaDelivery} ${S.buy.gateProWatched}`).not.toMatch(/open soon|seller/i);
  });

  it("Pro's included Full Analysis shows only while the Full Analysis is on sale", () => {
    const included = "proPlan.perks.fullAnalysisIncluded";
    let { container } = mount(SWITCHES_OFF.input);
    expect(container.querySelector(`[data-perk="${included}"]`)).toBeNull();
    expect(visibleProPerks({ fullAnalysisOnSale: false }).map((p) => p.key)).not.toContain(included);
    cleanup();
    ({ container } = mount(OPEN.input));
    expect(container.querySelector(`[data-perk="${included}"]`)?.textContent).toBe(`The $${FULL_ANALYSIS_PRICE_USD} Full Analysis included`);
  });

  it("the Full Analysis prints no delivery time while its switch is off", () => {
    const { container } = mount(SWITCHES_OFF.input);
    expect(textOf(container)).not.toMatch(/minute or two|usually ready/i);
  });
});

describe("9. fit is free without an account", () => {
  it("listed under 'No account needed', and Included for signed out in the table at both widths", () => {
    for (const width of [375, 1280]) {
      setViewport(width);
      const { container } = mount(SHIPPED.input);
      const free = container.querySelector<HTMLElement>("[data-plan=free]")!;
      const groups = [...free.querySelectorAll("h3")].map((g) => g.textContent);
      expect(groups).toEqual([S.free.groupNoAccount, S.free.groupAccount]);
      const fit = free.querySelector("[data-testid=fit-signed-out]")!;
      const noAccountList = free.querySelectorAll("ul")[0];
      expect(noAccountList.contains(fit)).toBe(true);
      const row = container.querySelector("[data-row=fit]")!;
      expect(row.textContent).toContain(S.limits.fitBrowser);
      expect(row.textContent).not.toContain(S.limits.notIncluded);
      cleanup();
    }
  });

  it("the table agrees with job-fit, which checks no session", () => {
    const fn = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-fit/index.ts"), "utf8"));
    expect(fn).not.toMatch(/auth\.getUser|getClaims|requireUser|requireAuth|sign_in_required/);
  });
});

describe("10. one open-postings figure, always with its count time", () => {
  it("prints openTotal with 'counted <date>, <time> UTC' in a machine-readable time", () => {
    const { container } = mount(SHIPPED.input);
    expect(container.querySelector("[data-testid=open-postings-count]")?.textContent).toBe("Search 1,040,488 open postings");
    const stamp = container.querySelector("[data-testid=open-postings-stamp]")!;
    expect(stamp.tagName).toBe("TIME");
    expect(stamp.getAttribute("datetime")).toBe("2026-10-17T22:45:00.000Z");
    expect(stamp.textContent).toBe("counted 17 Oct 2026, 22:45 UTC");
  });

  it("prints no number without a count time, and none without a count", () => {
    for (const postings of [{ openTotal: 1040488, asOf: null }, { openTotal: null, asOf: "2026-10-17T22:45:00Z" }]) {
      const { container } = mount(SHIPPED.input, postings);
      expect(container.querySelector("[data-testid=open-postings-count]")).toBeNull();
      expect(textOf(container.querySelector("[data-plan=free]")!)).not.toMatch(/\d{1,3},\d{3}/);
      expect(textOf(container)).toContain(S.free.searchNoCount);
      cleanup();
    }
  });
});

describe("11. the FAQ is in the DOM while closed", () => {
  it("every answer is present and no question is open", () => {
    const { container } = mount(SHIPPED.input);
    const items = [...container.querySelectorAll<HTMLDetailsElement>("[data-faq]")];
    expect(items.map((d) => d.getAttribute("data-faq"))).toEqual([...FAQ_IDS]);
    for (const d of items) {
      expect(d.open).toBe(false);
      expect(d.querySelector("p")?.textContent?.length ?? 0).toBeGreaterThan(40);
    }
    expect(textOf(container)).toContain("reply to your receipt and we make it again at no charge");
    expect(textOf(container)).toContain("Cancel online from your account, the same way you signed up");
  });

  it("the phone's compare section keeps both columns in the DOM while closed", () => {
    const { container } = mount(SHIPPED.input);
    const d = container.querySelector<HTMLDetailsElement>("[data-testid=adds-details]")!;
    expect(d.open).toBe(false);
    expect(d.textContent).toContain(S.adds.free1);
    expect(d.textContent).toContain(S.adds.fa2);
  });
});

describe("12. the structured data offers only what is on sale", () => {
  const names = (input: SaleGateInput | undefined) => ((pricingJsonLd(resolveSaleGates(input)).offers as Array<{ name: string }>) ?? []).map((o) => o.name);
  it("as shipped both paid products, with no seller named; free only with both switches off", () => {
    expect(names(SHIPPED.input)).toEqual(["Free", "Full Analysis", "Pro"]);
    expect(names(SWITCHES_OFF.input)).toEqual(["Free"]);
    expect(names(PREVIEW.input)).toEqual(["Free"]);
    expect(names(OPEN.input)).toEqual(["Free", "Full Analysis", "Pro"]);
    expect(names({ fullAnalysisDelivered: true, proWatched: false })).toEqual(["Free", "Full Analysis"]);
  });
});

describe("13. the preview's open state is labelled and never the route's", () => {
  it("each buy block carries the preview label", () => {
    const { container } = mount(PREVIEW.input, POSTINGS, { preview: { label: <p data-preview-label="">PREVIEW</p>, sellerNote: <p data-preview-seller="">seller</p> } });
    for (const b of buyButtons(container)) expect(b.closest("[data-buy-block]")!.querySelector("[data-preview-label]")).not.toBeNull();
  });

  it("the route passes no gate input, and no route file imports the preview", () => {
    const page = codeOf(readFileSync(resolve(__dirname, "../pages/pricing/PricingPage.tsx"), "utf8"));
    expect(page).not.toMatch(/previewOpen:\s*true|from ["']@\/preview|from ["']\.\.\/\.\.\/preview/);
    expect(resolveSaleGates().previewOpen).toBe(false);
  });

  it("the Builder card sells nothing", () => {
    const { container } = mount(OPEN.input);
    const card = container.querySelector<HTMLElement>("[data-testid=builder-card]")!;
    expect(card.querySelector("button")).toBeNull();
    const hrefs = [...card.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/data-api#builder"]);
    expect(card.querySelector("[data-testid=builder-quota]")?.textContent).toBe("Proposed: 5,000 calls a day; set before launch.");
    expect(textOf(card)).toContain(`$${BUILDER_PRICE_USD} a month`);
    // "Planned" once in the name and once in the chip, never a third time in
    // the price (review round 2026-10-26).
    expect(textOf(card)).not.toMatch(/a month, planned/i);
  });
});

describe("the full route, as shipped", () => {
  it("mounts with the real header and footer and both buy buttons, with no seller named", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <HelmetProvider>
          <MemoryRouter initialEntries={["/pricing"]}>
            <PricingPage />
          </MemoryRouter>
        </HelmetProvider>,
      ));
    });
    expect(container.querySelector("main#main-content h1")?.textContent).toBe(S.head.h1);
    expect(container.querySelector("header")).not.toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
    expect([...container.querySelectorAll("[data-buy]")].map((b) => b.getAttribute("data-buy"))).toEqual(["full-analysis", "pro"]);
    expect(container.querySelectorAll("[data-gate]").length).toBe(0);
    expect(container.querySelector("[data-testid=open-postings-count]")?.textContent).toBe("Search 1,040,488 open postings");
    const ld = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(ld.offers.map((o: { name: string }) => o.name)).toEqual(["Free", "Full Analysis", "Pro"]);
  });
});
