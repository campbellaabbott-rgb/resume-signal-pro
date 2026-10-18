// PRO RENEWS ONLY FOR A BUYER WHO TICKED THE BOX THAT SAYS SO (owner decision
// 2026-10-17; California's automatic renewal law, Business and Professions
// Code 17600 and following, as amended by AB 2863).
//
// California asks for the buyer's affirmative consent to the automatic
// renewal terms, given separately from the rest of the purchase, and for a
// record of that consent. The Pro card shows its own box for it, unticked
// and separate from the Terms line (src/components/PurchaseTerms.tsx); the
// press sends `autoRenewConsent: true` only when that box was ticked
// (src/lib/purchase-terms.ts). create-subscription-checkout refuses a body
// without it (400, `reason: "auto_renew_consent_required"`) before Stripe is
// asked for anything, and for a body with it records which renewal wording
// the buyer agreed to, the Terms version the page showed and the time, in
// pro_auto_renew_consents (service_role only, 20261011151000) and on the
// Stripe session and the subscription's metadata. A session whose record
// cannot be written is expired and the buyer asked to try again: a plan sold
// without its consent on file is worse than a retry.
//
// The refusal deliberately carries no `consentRequired` field: that name is
// the EU/UK box's (checkout-policy.ts), and a page reads it as the EU switch
// being on.

import { type CheckoutLanguage } from "./checkout-policy.ts";
import { retiredLanguageOf } from "./apply-agent-retired.ts";

/**
 * The version of the box's words (src/components/PurchaseTerms.tsx,
 * purchaseTerms.autoRenewConsent). Change both together.
 */
export const AUTO_RENEW_CONSENT_VERSION = "2026-10-17";

/** The reason a page keys on. */
export const AUTO_RENEW_REQUIRED = "auto_renew_consent_required";

/** True only for the literal the page sends when the box was ticked. */
export function autoRenewConsentOf(body: unknown): boolean {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return b.autoRenewConsent === true;
}

const SENTENCE: Readonly<Record<CheckoutLanguage, string>> = {
  en: "Please tick the box that says Pro renews automatically every month until you cancel, then press again. Nothing was charged.",
  "en-GB": "Please tick the box that says Pro renews automatically every month until you cancel, then press again. Nothing was charged.",
  de: "Bitte setze das Häkchen bei dem Hinweis, dass sich Pro jeden Monat automatisch verlängert, bis du kündigst, und drücke dann erneut. Dir wurde nichts berechnet.",
  es: "Marca la casilla que dice que Pro se renueva automáticamente cada mes hasta que canceles y vuelve a pulsar. No se te ha cobrado nada.",
  fr: "Cochez la case indiquant que Pro se renouvelle automatiquement chaque mois jusqu'à ce que vous résiliiez, puis appuyez à nouveau. Rien ne vous a été facturé.",
  hi: "कृपया वह बॉक्स चुनें जिसमें लिखा है कि Pro रद्द करने तक हर महीने अपने-आप नवीनीकृत होता है, फिर दोबारा दबाएँ। आपसे कोई शुल्क नहीं लिया गया।",
  nl: "Vink het vakje aan dat zegt dat Pro elke maand automatisch wordt verlengd tot je opzegt, en druk dan opnieuw. Er is niets in rekening gebracht.",
  pt: "Marque a caixa que diz que o Pro é renovado automaticamente todo mês até você cancelar e pressione de novo. Nada foi cobrado de você.",
  tl: "Lagyan ng tsek ang kahon na nagsasabing awtomatikong nire-renew ang Pro bawat buwan hanggang kanselahin mo, saka pindutin muli. Walang siningil sa iyo.",
};

export function autoRenewRefusal(opts: { body?: unknown; acceptLanguage?: string | null }): {
  status: 400;
  body: { error: string; reason: typeof AUTO_RENEW_REQUIRED; autoRenewConsentRequired: true; language: CheckoutLanguage };
} {
  const language = retiredLanguageOf(opts.body ?? null, opts.acceptLanguage);
  return {
    status: 400,
    body: { error: SENTENCE[language] ?? SENTENCE.en, reason: AUTO_RENEW_REQUIRED, autoRenewConsentRequired: true, language },
  };
}

/** What the Stripe session and the subscription carry about the consent. */
export function autoRenewMetadata(consentedAt: string): Record<string, string> {
  return { auto_renew_consent: AUTO_RENEW_CONSENT_VERSION, auto_renew_consented_at: consentedAt };
}

// deno-lint-ignore no-explicit-any
type TableClient = { from: (table: string) => any };

export const AUTO_RENEW_RECORD_TIMEOUT_MS = 2500;

/**
 * Keep the consent on our side, keyed by the Stripe session. Never throws;
 * "failed" when the write errored or stalled (the caller then expires the
 * session and asks the buyer to try again).
 */
export async function recordAutoRenewConsent(
  db: TableClient,
  row: { stripeSessionId: string; userId: string; termsVersion: string | null; priceCents: number; consentedAt: string },
): Promise<"recorded" | "failed"> {
  if (!/^cs_[A-Za-z0-9_]{8,250}$/.test(row.stripeSessionId)) return "failed";
  try {
    const write = Promise.resolve(
      db.from("pro_auto_renew_consents").upsert({
        stripe_session_id: row.stripeSessionId,
        user_id: row.userId,
        renewal_terms_version: AUTO_RENEW_CONSENT_VERSION,
        terms_version: row.termsVersion,
        price_cents: row.priceCents,
        renewal_interval: "month",
        consented_at: row.consentedAt,
      }, { onConflict: "stripe_session_id", ignoreDuplicates: true }),
    ) as Promise<{ error?: { message?: string } | null }>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<{ error: { message: string } }>((resolve) => {
      timer = setTimeout(() => resolve({ error: { message: "timed out" } }), AUTO_RENEW_RECORD_TIMEOUT_MS);
    });
    const { error } = await Promise.race([write, timed]).finally(() => clearTimeout(timer));
    if (error) {
      console.error(`[AUTO-RENEW-CONSENT] ${row.stripeSessionId}: not recorded: ${error.message ?? "error"}`);
      return "failed";
    }
    return "recorded";
  } catch (err) {
    console.error(`[AUTO-RENEW-CONSENT] ${row.stripeSessionId}: threw: ${String(err).slice(0, 160)}`);
    return "failed";
  }
}
