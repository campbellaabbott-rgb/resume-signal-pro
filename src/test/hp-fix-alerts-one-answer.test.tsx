/**
 * BOTH PAGES GIVE ONE ANSWER ABOUT ALERTS (gate G6).
 *
 * send-search-digest sends whatever the seller's state, as on main (no mail
 * waits for the seller since sales stay on, the owner, 2026-10-27), so the
 * pages name saved-search alerts unless the digest is ruled marketing mail
 * while the seller is unknown. The homepage once held that back while the
 * pricing page printed "email alerts" whatever the gate said. Walked over
 * every seller (none, or an obviously fake TEST SELLER) and every digest
 * ruling, rendered: the homepage's account strip and plan strip and the
 * pricing page either both name alerts or both leave them out. And in every
 * language, the pricing page's no-alerts sentences carry no word for alerts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import { HomeAccountStrip } from "@/components/home/HomeAccountStrip";
import { HomePlanStrip } from "@/components/home/HomePlanStrip";
import { PricingView } from "@/components/pricing/PricingView";
import { resolveSaleGates } from "@/components/pricing/sale-gates";
import { saleGates, type DigestMailClass } from "@/lib/home/sale-gates";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(() => cleanup());

const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
const NO_SELLER = { legalName: "", postalAddress: "" };
const POSTINGS = { openTotal: 1040488, asOf: "2026-10-17T22:45:00Z" };
const ALERT = /alert/i;

describe("rendered, for every seller and digest ruling", () => {
  for (const [sellerName, seller] of [["no seller", NO_SELLER], ["TEST SELLER", TEST_SELLER]] as const) {
    for (const digestMailClass of ["unruled", "marketing", "transactional"] as DigestMailClass[]) {
      it(`${sellerName}, digest ${digestMailClass}: both pages name alerts, or neither does`, () => {
        const home = saleGates({ seller, digestMailClass });
        const pricing = resolveSaleGates({ seller, digestMailClass });
        const expected = digestMailClass !== "marketing" || seller === TEST_SELLER;
        expect(home.alertsStatable).toBe(expected);

        const homeView = render(
          <MemoryRouter>
            <HomeAccountStrip alertsStatable={home.alertsStatable} />
            <HomePlanStrip gates={home} />
          </MemoryRouter>,
        );
        const homeSays = ALERT.test(homeView.container.textContent ?? "");
        cleanup();

        const pricingView = render(
          <MemoryRouter>
            <PricingView postings={POSTINGS} gates={pricing} />
          </MemoryRouter>,
        );
        const sentences = [
          pricingView.container.querySelector("[data-testid=pricing-sub]")?.textContent ?? "",
          pricingView.container.querySelector("[data-plan=free]")?.textContent ?? "",
        ];
        const pricingSays = ALERT.test(pricingView.container.textContent ?? "");
        expect(homeSays, "the homepage").toBe(expected);
        expect(pricingSays, "the pricing page").toBe(expected);
        for (const s of sentences) expect(ALERT.test(s), s).toBe(expected);
      });
    }
  }
});

describe("the no-alerts sentences, in every language", () => {
  const WORD: Record<string, RegExp> = {
    en: /alert/i, "en-GB": /alert/i, de: /benachrichtigung/i, es: /alerta/i, fr: /alerte/i, hi: /अलर्ट/, nl: /melding/i, pt: /alerta/i, tl: /alert/i,
  };
  for (const [lng, word] of Object.entries(WORD)) {
    it(`${lng}: each of the three sentences has a no-alerts form without the word, and the alerts form keeps it`, () => {
      const p = (JSON.parse(readFileSync(resolve(__dirname, `../i18n/shards/pricing/${lng}.json`), "utf8")) as {
        pricingPlans: Record<string, Record<string, string>>;
      }).pricingPlans;
      const pairs: Array<[string, string | undefined, string | undefined]> = [
        ["head.sub", p.head.sub, p.head.subNoAlerts],
        ["free.saved", p.free.saved, p.free.savedNoAlerts],
        ["limits.rowSaved", p.limits.rowSaved, p.limits.rowSavedNoAlerts],
      ];
      for (const [key, withAlerts, without] of pairs) {
        expect(without, `${lng} ${key}NoAlerts`).toBeTruthy();
        expect(word.test(withAlerts ?? ""), `${lng} ${key}`).toBe(true);
        expect(word.test(without ?? ""), `${lng} ${key}NoAlerts: ${without}`).toBe(false);
      }
    });
  }
});
