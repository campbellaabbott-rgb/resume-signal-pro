// @vitest-environment node
/**
 * THE PURCHASE MAIL SPEAKS THE BUYER'S LANGUAGE (S12-114).
 *
 * Every delivery mail went out in English whatever language the buyer bought
 * in. The still-sold products this mail serves (the Full Resume Analysis and
 * the two Freelance Boost tiers), the mail that asks a buyer for what an order
 * is missing (needs_input), and the mail that says a delayed payment failed
 * (payment_failed) now render in the site's nine languages, chosen from the
 * language the checkout recorded. The shipped send-product-email handler runs
 * with only Resend and the database faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { CHECKOUT_LANGUAGES } from "../../supabase/functions/_shared/checkout-policy";
import { KEPT_PRODUCTS, MAIL_COPY, NEEDS_REASONS } from "../../supabase/functions/send-product-email/copy";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const SERVICE = "service_harness_key_0123456789abcdef0123456789";
const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: "re_harness" };
const sent: Array<{ from: string; to: string[]; subject: string; html: string }> = [];
const logged: Array<Record<string, unknown>> = [];
let mailer: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__spe = { sent, logged };
  mailer = await loadEdgeHandler("send-product-email", {
    "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__spe.sent.push(m); return { data: { id: 're_1' }, error: null }; } }; } }",
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => ({ rpc: async (n, a) => { globalThis.__spe.logged.push({ n, ...a }); return { data: null, error: null }; } });",
  });
}, 120_000);

beforeEach(() => { sent.length = 0; logged.length = 0; });

async function mail(body: Record<string, unknown>) {
  const res = await mailer(new Request("https://harness.supabase.co/functions/v1/send-product-email", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ email: "buyer@example.com", productName: "Full Resume Analysis", ...body }),
  }));
  return res.status;
}

const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&#039;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("a still-sold product's purchase mail", () => {
  it("is German for a German buyer: subject, header, steps and button, the link unchanged", async () => {
    expect(await mail({ productType: "full_analysis", sessionId: "cs_live_abcdefghijkl", language: "de" })).toBe(200);
    const m = sent[0];
    expect(m.subject).toContain("Vollständige Lebenslauf-Analyse: Kauf öffnen");
    const text = visible(m.html);
    expect(text).toContain("Danke für deinen Kauf!");
    expect(text).toContain("Öffne deine Analyse mit dem Button unten");
    expect(text).toContain("Kauf öffnen →");
    expect(text, "an English line was left in the German mail").not.toMatch(/Thank You for Your Purchase|How It Works|Open your purchase/);
    expect(m.html).toContain('href="https://resumebooster.work/success?session_id=cs_live_abcdefghijkl"');
    expect(m.html).toContain('lang="de"');
    expect(logged[0]).toMatchObject({ p_email_type: "product_full_analysis", p_status: "sent" });
  });

  it("follows the base of a regional tag (fr-CA is French), and is English for an unknown or missing one", async () => {
    await mail({ productType: "freelance_boost", productName: "Freelance Boost", sessionId: "cs_live_abcdefghijkl", language: "fr-CA" });
    expect(visible(sent[0].html)).toContain("Merci pour votre achat !");
    await mail({ productType: "freelance_boost", productName: "Freelance Boost", sessionId: "cs_live_abcdefghijkl", language: "xx" });
    await mail({ productType: "freelance_boost", productName: "Freelance Boost", sessionId: "cs_live_abcdefghijkl" });
    expect(visible(sent[1].html)).toContain("Thank You for Your Purchase!");
    expect(visible(sent[2].html)).toContain("Thank You for Your Purchase!");
  });

  it("every language has every line, and none of the eight others is the English one", () => {
    for (const lang of CHECKOUT_LANGUAGES) {
      const c = MAIL_COPY[lang];
      expect(c, `${lang} has no copy`).toBeTruthy();
      for (const p of KEPT_PRODUCTS) {
        expect(c.kept[p].howItWorks.length).toBe(MAIL_COPY.en.kept[p].howItWorks.length);
        expect(c.kept[p].nextSteps.length).toBe(MAIL_COPY.en.kept[p].nextSteps.length);
        for (const line of [c.kept[p].tagline, ...c.kept[p].howItWorks, ...c.kept[p].nextSteps]) expect(line.trim().length).toBeGreaterThan(5);
      }
      for (const r of NEEDS_REASONS) expect(c.needs.lead[r]("X")).toContain("X");
      if (lang === "en" || lang === "en-GB") continue;
      expect(c.shell.thanks, `${lang} reuses the English header`).not.toBe(MAIL_COPY.en.shell.thanks);
      expect(c.kept.full_analysis.tagline).not.toBe(MAIL_COPY.en.kept.full_analysis.tagline);
      expect(c.failed.body).not.toBe(MAIL_COPY.en.failed.body);
    }
  });

  it("a retired product's mail keeps the English copy its past buyer was sold with", async () => {
    await mail({ productType: "cover_letter", productName: "Cover Letter", sessionId: "cs_live_abcdefghijkl", language: "de", generatedContent: { coverLetter: "Dear team" } });
    expect(sent[0].subject).toContain("Your Cover Letter is Ready!");
  });
});

describe("the notice that asks for what an order is missing (needs_input)", () => {
  it("asks for the posting in the buyer's language, never says ready, and opens the purchase", async () => {
    expect(await mail({ kind: "needs_input", reason: "job_posting_required", productType: "apply_assistant", productName: "Apply Assistant", sessionId: "cs_live_abcdefghijkl", language: "es" })).toBe(200);
    const m = sent[0];
    expect(m.subject).toBe("Apply Assistant: necesitamos algo más de ti");
    const text = visible(m.html);
    expect(text).toContain("Responde a este correo con la oferta");
    expect(text).not.toMatch(/ready|listo/i);
    expect(m.html).toContain("https://resumebooster.work/product-success?session_id=cs_live_abcdefghijkl&amp;product=applyAssistant");
    expect(logged[0]).toMatchObject({ p_email_type: "product_needs_input" });
  });

  it("refuses a needs_input mail that names no reason", async () => {
    expect(await mail({ kind: "needs_input", productType: "cover_letter", sessionId: "cs_live_abcdefghijkl" })).toBe(400);
    expect(await mail({ kind: "something_else", productType: "cover_letter" })).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe("the notice that a delayed payment failed (payment_failed)", () => {
  it("says nothing was charged, in the buyer's language, and where to try again", async () => {
    await mail({ kind: "payment_failed", productType: "full_analysis", sessionId: "cs_live_abcdefghijkl", language: "nl" });
    const m = sent[0];
    expect(m.subject).toBe("Je betaling voor Volledige cv-analyse is niet gelukt");
    expect(visible(m.html)).toContain("er is niets in rekening gebracht en niets geleverd");
    expect(m.html).toContain('href="https://resumebooster.work/"');
  });
});
