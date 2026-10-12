/**
 * THE BUILDER CARD ASKS FOR INTEREST AND SELLS NOTHING (owner decision
 * 2026-10-11: a "Builder API (planned)" card at $49 a month to test demand;
 * billing only after a written request).
 *
 * /data-api shows the card beside the other access tiers, under the anchor
 * the /v1 refusals point at (#builder). Its price is the constant in
 * src/config/builder-plan.ts, interpolated; it says "planned" and that
 * nothing is charged; and its only action is an email request. No checkout
 * function is called, no buy button exists, no Stripe link is on the card.
 * Mounted for real with only the backend faked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import en from "../i18n/locales/en.json";

const invoke = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import DataApi from "../pages/DataApi";
import { BUILDER_PLAN_PRICE_USD, BUILDER_PLAN_MAIL_SUBJECT, BUILDER_PLAN_ANCHOR } from "@/config/builder-plan";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(cleanup);

const mount = () => render(<HelmetProvider><MemoryRouter initialEntries={["/data-api"]}><DataApi /></MemoryRouter></HelmetProvider>);

describe("the Builder API card on /data-api", () => {
  it("sits under the #builder anchor, names the planned price from the constant, and says it is not on sale", () => {
    mount();
    const card = document.getElementById(BUILDER_PLAN_ANCHOR)!;
    expect(card, "no element carries the anchor the /v1 refusals point at").not.toBeNull();
    expect(card.hasAttribute("data-builder-card")).toBe(true);
    const text = card.textContent ?? "";
    expect(text).toContain(en.dataApiPage.builderName);
    expect(text).toContain(`$${BUILDER_PLAN_PRICE_USD} a month, planned`);
    expect(BUILDER_PLAN_PRICE_USD).toBe(49);
    expect(text).toContain(en.dataApiPage.builderNotYet);
    expect(text).toMatch(/No feeds or resale/);
  });

  it("its only action is an email request with the subject the owner counts, and nothing on it can take money", () => {
    mount();
    const card = document.getElementById(BUILDER_PLAN_ANCHOR)!;
    const links = [...card.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    const href = links[0].getAttribute("href")!;
    expect(href).toMatch(/^mailto:/);
    expect(decodeURIComponent(href.split("subject=")[1])).toBe(BUILDER_PLAN_MAIL_SUBJECT);
    expect(links[0].textContent).toContain(en.dataApiPage.builderCta);
    expect(card.querySelector("button, form, input")).toBeNull();
    expect(card.innerHTML).not.toMatch(/stripe|checkout/i);
  });

  it("the page calls no checkout of any kind", () => {
    mount();
    const fns = invoke.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(fns.filter((f) => /checkout/i.test(f))).toEqual([]);
  });
});
