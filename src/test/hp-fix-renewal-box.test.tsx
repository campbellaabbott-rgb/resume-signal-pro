/**
 * GO PRO HAS EXACTLY ONE RENEWAL BOX, IN WAVE 4'S WORDS (gate G7).
 *
 * Wave 4 ships the server side of the renewal consent (owner decision
 * 2026-10-17; California's automatic renewal law as amended by AB 2863):
 * create-subscription-checkout refuses a body without `autoRenewConsent:
 * true`, which purchaseTerms() sends only when PurchaseTerms' own box
 * ([data-auto-renew-box]) beside the pressed button was ticked, and records
 * AUTO_RENEW_CONSENT_VERSION with the time. The pricing page's Pro block
 * once carried a stand-in box; switch-over step 8 deleted it, and the block
 * shows PurchaseTerms (with its box) above Go Pro.
 *
 *   - The Pro buy block renders exactly one renewal box: PurchaseTerms'.
 *   - Its English is wave 4's sentence, read from PurchaseTerms, so the words
 *     the buyer ticks are the words the server's version names.
 *   - The block records no consent version or field of its own.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { codeOf } from "./helpers/strip-comments";

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
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { email: "member@example.com" }, session: { access_token: "jwt" } }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  PRO_CONFIRM_INTERVAL_MS: 3000,
  useProSubscription: () => ({
    pro: { active: false, status: null, loading: false, trialing: false, linkPending: false, currentPeriodEnd: null },
    subscribe: vi.fn(async () => true),
    manage: vi.fn(async () => {}),
    actionLoading: false,
    refresh: async () => false,
    knownEmail: "member@example.com",
    justSubscribed: false,
    notConfirmedYet: false,
  }),
}));

import { PricingView } from "@/components/pricing/PricingView";
import { resolveSaleGates, type SaleGateInput } from "@/components/pricing/sale-gates";
import en from "@/i18n/shards/pricing/en.json";

vi.setConfig(MOUNT_TEST_BUDGET);
beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ euUkSales: false }), { status: 200 })));
});
afterEach(() => cleanup());

const TEST_SELLER = { legalName: "TEST SELLER", postalAddress: "TEST ADDRESS, NOWHERE" };
const POSTINGS = { openTotal: 1040488, asOf: "2026-10-17T22:45:00Z" };
const CASES: Array<[string, SaleGateInput]> = [
  ["preview forced open", { previewOpen: true }],
  ["seller set, every gate open (wired to the account)", { seller: TEST_SELLER, fullAnalysisDelivered: true, proWatched: true }],
];

/** Wave 4's sentence: read from PurchaseTerms when its default is there, else as wave 4 wrote it on 2026-10-17. */
function waveFourSentence(): string {
  const src = readFileSync(resolve(__dirname, "../components/PurchaseTerms.tsx"), "utf8");
  const m = src.match(/purchaseTerms\.autoRenewConsent",\s*"([^"]+)"/);
  return m ? m[1] : "I agree that Pro renews automatically every month at {{price}} until I cancel, and that I can cancel any time from my account.";
}

describe("the Pro buy block", () => {
  for (const [name, input] of CASES) {
    it(`${name}: exactly one renewal box, unticked and required`, () => {
      const { container } = render(
        <MemoryRouter>
          <PricingView postings={POSTINGS} gates={resolveSaleGates(input)} />
        </MemoryRouter>,
      );
      const block = container.querySelector<HTMLElement>("[data-buy-block=pro]");
      expect(block).not.toBeNull();
      const boxes = block!.querySelectorAll("[data-auto-renew-box]");
      expect(boxes.length, "two renewal boxes: delete the stand-in (switch-over step 8)").toBe(1);
      const checkboxes = block!.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
      expect(checkboxes.length).toBe(1);
      expect(checkboxes[0].checked).toBe(false);
      expect(checkboxes[0].required).toBe(true);
      expect(boxes[0].textContent).toBe(waveFourSentence().replace("{{price}}", "$45"));
    });
  }

  it("the box is PurchaseTerms' own, in wave 4's sentence, and the pricing strings keep no copy of it", () => {
    // Switch-over step 8 deleted the stand-in and its string.
    expect((en.pricingPlans.pro as Record<string, unknown>).consent).toBeUndefined();
    const main = JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales/en.json"), "utf8")) as { purchaseTerms: Record<string, string> };
    expect(main.purchaseTerms.autoRenewConsent).toBe(waveFourSentence());
  });

  it("records no consent version or field of its own: the server stores wave 4's", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../components/pricing/BuyBlock.tsx"), "utf8"));
    expect(code).not.toMatch(/RENEWAL_CONSENT_VERSION|RenewalConsentRecord|renewalConsent\b/);
  });
});
