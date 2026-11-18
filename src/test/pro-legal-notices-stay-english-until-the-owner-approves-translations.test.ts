// @vitest-environment node
/**
 * PRO'S CONFIRMATION AND THE EU/UK WITHDRAWAL ACKNOWLEDGEMENT STAY ENGLISH
 * (S14X-235, the owner's option "English").
 *
 * The checkout runs in the buyer's language, but the subscription
 * confirmation (Directive 2011/83/EU art. 8(7)) and the withdrawal
 * acknowledgement (art. 11(3)) are legal texts, and the Terms they point to
 * are English. The owner chose to keep both English until the Terms are
 * translated: translating them is eight legal texts to approve. This pins
 * that choice, so a later change cannot translate them without the owner:
 *   - noticeMail and withdrawalMail take no language, and write English;
 *   - every call site hands them the facts alone.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { noticeMail, withdrawalMail } from "../../supabase/functions/_shared/subscription-notice";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => codeOf(readFileSync(resolve(ROOT, f), "utf8"));
const FACTS = { planName: "Resume Booster Pro", amount: 4500, currency: "usd", interval: "month", trialEnd: null, accountUrl: "https://resumebooster.work/account", withdrawal: { until: "2026-12-01T00:00:00Z", contact: "billing@resumebooster.work" } };

describe("Pro's legal notices stay English (S14X-235: English)", () => {
  it("the confirmation and the acknowledgement are written in English", () => {
    const c = noticeMail("confirmation", FACTS);
    expect(c.subject).toBe("Your Resume Booster Pro subscription");
    expect(c.text).toContain("renews automatically until you cancel");
    expect(c.text).toContain("You may withdraw from this contract within 14 days");
    const w = withdrawalMail({ planName: "Resume Booster Pro", withdrawnAt: "2026-11-20T00:00:00Z", refund: null, accountUrl: FACTS.accountUrl });
    expect(w.subject).toBe("Your withdrawal from Resume Booster Pro");
  });

  it("neither writer takes a language, and no call site passes one", () => {
    expect(noticeMail.length).toBe(2);
    expect(withdrawalMail.length).toBe(1);
    const mod = code("supabase/functions/_shared/subscription-notice.ts");
    expect(mod).not.toMatch(/\blanguage\b|\blng\b|\blocale\b/);
    for (const f of ["supabase/functions/stripe-webhook/index.ts", "supabase/functions/withdraw-subscription/index.ts"]) {
      const src = code(f);
      const sites = [...src.matchAll(/\b(noticeMail|withdrawalMail)\(/g)];
      expect(sites.length, `${f} calls neither writer`).toBeGreaterThan(0);
      for (const m of sites) {
        const args = src.slice(m.index!, src.indexOf("});", m.index!) + 3);
        expect(args, `${f}: ${args.slice(0, 80)}`).not.toMatch(/language|lng|locale/);
      }
    }
  });
});
