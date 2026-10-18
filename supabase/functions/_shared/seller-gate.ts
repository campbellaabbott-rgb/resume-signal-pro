// NO SALE UNTIL THE SELLER HAS A NAME AND A POSTAL ADDRESS (owner decision
// 2026-10-17; California Business and Professions Code 17538(d)).
//
// California asks a seller who takes payment online to show its legal name
// and a street address before the buyer pays. The owner has not given either
// yet: _shared/seller-identity.ts (kept equal to src/config/seller.ts by a
// test) holds two empty strings, and an identity is never invented. Until both
// are set, every checkout that would open a paid Stripe session (the $5 Full
// Analysis in create-checkout, Pro in create-subscription-checkout, and
// create-product-checkout should a product there ever be sold again) answers
// 409 with `error: "seller_identity_missing"` and a sentence in the buyer's
// language, before Stripe is asked for anything. The pages show no buy button
// while it is so (src/lib/purchases-open.ts reads the frontend's copy), and
// create-checkout's GET says `purchasesOpen` so the deploy verifier can read
// the state without buying.
//
// A Pro member's included Full Analysis is not a sale (nothing is charged),
// so create-checkout mints it before this gate is asked.

import { sellerIdentity, SELLER, type SellerIdentity } from "./seller.ts";
import { type CheckoutLanguage } from "./checkout-policy.ts";
import { retiredLanguageOf } from "./apply-agent-retired.ts";

/** The code a page keys on. */
export const SELLER_MISSING = "seller_identity_missing";

/** HTTP 409: the request is fine, the shop is not open yet. */
export const SELLER_MISSING_STATUS = 409;

/** True once the seller's legal name and postal address are both set. */
export function purchasesOpen(s: SellerIdentity = SELLER): boolean {
  return sellerIdentity(s) !== null;
}

const SENTENCE: Readonly<Record<CheckoutLanguage, string>> = {
  en: "Purchases open soon: we are adding the seller details the law asks us to show before you pay. Nothing was charged.",
  "en-GB": "Purchases open soon: we are adding the seller details the law asks us to show before you pay. Nothing was charged.",
  de: "Käufe sind bald möglich: Wir ergänzen die Angaben zum Verkäufer, die wir vor der Zahlung zeigen müssen. Dir wurde nichts berechnet.",
  es: "Las compras se abrirán pronto: estamos añadiendo los datos del vendedor que la ley nos pide mostrar antes del pago. No se te ha cobrado nada.",
  fr: "Les achats ouvrent bientôt : nous ajoutons les informations sur le vendeur que la loi nous demande d'afficher avant le paiement. Rien ne vous a été facturé.",
  hi: "खरीदारी जल्द शुरू होगी: हम विक्रेता की वह जानकारी जोड़ रहे हैं जो कानून के अनुसार भुगतान से पहले दिखानी होती है। आपसे कोई शुल्क नहीं लिया गया।",
  nl: "Kopen kan binnenkort: we voegen de verkopersgegevens toe die we volgens de wet vóór de betaling moeten tonen. Er is niets in rekening gebracht.",
  pt: "As compras abrem em breve: estamos adicionando os dados do vendedor que a lei exige mostrar antes do pagamento. Nada foi cobrado de você.",
  tl: "Malapit nang magbukas ang pagbili: idinadagdag namin ang mga detalye ng nagbebenta na hinihingi ng batas bago ka magbayad. Walang siningil sa iyo.",
};

export interface SellerMissingAnswer {
  status: typeof SELLER_MISSING_STATUS;
  body: { error: typeof SELLER_MISSING; message: string; purchasesOpen: false; language: CheckoutLanguage };
}

/** The refusal, or null while the shop is open. */
export function sellerGate(
  opts: { body?: unknown; acceptLanguage?: string | null },
  s: SellerIdentity = SELLER,
): SellerMissingAnswer | null {
  if (purchasesOpen(s)) return null;
  const language = retiredLanguageOf(opts.body ?? null, opts.acceptLanguage);
  return {
    status: SELLER_MISSING_STATUS,
    body: { error: SELLER_MISSING, message: SENTENCE[language] ?? SENTENCE.en, purchasesOpen: false, language },
  };
}
