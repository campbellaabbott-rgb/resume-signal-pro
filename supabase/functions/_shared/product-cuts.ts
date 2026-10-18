// THE PRODUCTS WE STOPPED SELLING, AND WHAT A BUYER IS TOLD (owner decisions
// 2026-10-12, the product line, and 2026-10-17).
//
// The one-off catalogue was cut to the $5 Full Analysis (create-checkout). On
// 2026-10-17 Freelance Boost and Transition Pro were removed too, and they are
// not part of Pro. Everything below is no longer sold: create-product-checkout
// (and create-scan-pack-checkout for the scan packs) answers a purchase of one
// with this module's refusal, BEFORE the rate limiter, a Pro grant or Stripe,
// so nothing is counted, granted or charged. Past buyers keep what they
// bought for PAST_BUYER_DAYS: their success pages, saved copies and the
// recovery link do not read this list.
//
// The refusal mirrors the retired agent products' (apply-agent-retired.ts):
// HTTP 410, `retired: true`, the reason a page keys on, and one sentence in
// the buyer's language that says nothing was charged, that an earlier
// purchase keeps working, and where the same help now lives. Product names
// stay in English in every language, as the site's own copy keeps them.
//
// src/config/products.ts hides every one of these ids (HIDDEN_PRODUCT_IDS),
// and src/test/w4b-the-cut-products-are-sold-nowhere.test.ts holds the two
// lists equal, so a page cannot offer what the server refuses.

import { type CheckoutLanguage } from "./checkout-policy.ts";
import { RETIRED_REASON, RETIRED_STATUS, retiredLanguageOf } from "./apply-agent-retired.ts";

/** How long a past buyer's link and saved copy keep working (owner decision). */
export const PAST_BUYER_DAYS = 90;

/**
 * create-scan-pack-checkout's own switch (its purchase path stays, dormant,
 * until the simplify wave deletes it). Typed `boolean`, not its literal, so
 * the dormant path still type-checks as reachable.
 */
export const SCAN_PACKS_ON_SALE: boolean = false;

type Cut = { productType: string; name: string; tail: "writing" | "scans" | "reports" };

/** Every product id the checkouts refuse, keyed as the page's ProductId is. */
export const CUT_PRODUCTS: Readonly<Record<string, Cut>> = Object.freeze({
  basicKeywordFix: { productType: "basic_keyword_fix", name: "Keyword Fix", tail: "writing" },
  coverLetter: { productType: "cover_letter", name: "Cover Letter", tail: "writing" },
  premiumPackage: { productType: "premium_package", name: "Premium Resume Package", tail: "writing" },
  atsDefense: { productType: "ats_defense", name: "ATS Defense", tail: "reports" },
  careerSnapshot: { productType: "career_snapshot", name: "Career Snapshot", tail: "reports" },
  graduateGamePlan: { productType: "graduate_gameplan", name: "Graduate Game Plan", tail: "reports" },
  interviewCoach: { productType: "interview_coach", name: "Interview Coach", tail: "writing" },
  careerPathSimulator: { productType: "career_path_simulator", name: "Career Path Simulator", tail: "reports" },
  scanPack: { productType: "scan_pack", name: "Scan Packs", tail: "scans" },
  freelanceBoost: { productType: "freelance_boost", name: "Freelance Boost", tail: "writing" },
  freelanceTransitionPro: { productType: "freelance_transition_pro", name: "Freelance Boost Transition Pro", tail: "writing" },
});

export const CUT_PRODUCT_IDS: readonly string[] = Object.freeze(Object.keys(CUT_PRODUCTS));

export function isCutProduct(productId: unknown): boolean {
  return typeof productId === "string" && Object.prototype.hasOwnProperty.call(CUT_PRODUCTS, productId);
}

type Lines = {
  opening: (name: string) => string;
  pastBuyers: string;
  writing: string;
  reports: string;
  scans: string;
};

const EN: Lines = {
  opening: (n) => `${n} is no longer sold, and nothing was charged.`,
  pastBuyers: `If you bought it before, your link keeps working for ${PAST_BUYER_DAYS} days.`,
  writing: "Tailored résumés, cover letters and interview prep now come with a free account and with Pro.",
  reports: "The $5 Full Analysis is still on sale, and tailored résumés, cover letters and interview prep come with a free account and with Pro.",
  scans: "A free account scans more each day, and Pro has no daily cap on scans.",
};

/** Each language's lines. en-GB is en, as everywhere on the site. */
export const CUT_LINES: Readonly<Record<CheckoutLanguage, Lines>> = {
  en: EN,
  "en-GB": EN,
  de: {
    opening: (n) => `${n} wird nicht mehr verkauft, und dir wurde nichts berechnet.`,
    pastBuyers: `Wenn du es früher gekauft hast, funktioniert dein Link noch ${PAST_BUYER_DAYS} Tage.`,
    writing: "Angepasste Lebensläufe, Anschreiben und Interviewvorbereitung gibt es jetzt mit einem kostenlosen Konto und mit Pro.",
    reports: "Die Full Analysis für 5 $ gibt es weiterhin, und angepasste Lebensläufe, Anschreiben und Interviewvorbereitung gibt es mit einem kostenlosen Konto und mit Pro.",
    scans: "Ein kostenloses Konto scannt mehr pro Tag, und Pro scannt ohne Tageslimit.",
  },
  es: {
    opening: (n) => `${n} ya no se vende y no se te ha cobrado nada.`,
    pastBuyers: `Si lo compraste antes, tu enlace sigue funcionando durante ${PAST_BUYER_DAYS} días.`,
    writing: "Los currículums adaptados, las cartas de presentación y la preparación de entrevistas ahora vienen con una cuenta gratuita y con Pro.",
    reports: "El Full Analysis de 5 $ sigue a la venta, y los currículums adaptados, las cartas de presentación y la preparación de entrevistas vienen con una cuenta gratuita y con Pro.",
    scans: "Una cuenta gratuita escanea más cada día, y Pro escanea sin límite diario.",
  },
  fr: {
    opening: (n) => `${n} n'est plus vendu, et rien ne vous a été facturé.`,
    pastBuyers: `Si vous l'avez acheté auparavant, votre lien reste valable ${PAST_BUYER_DAYS} jours.`,
    writing: "Les CV adaptés, les lettres de motivation et la préparation aux entretiens sont désormais inclus avec un compte gratuit et avec Pro.",
    reports: "La Full Analysis à 5 $ reste en vente, et les CV adaptés, les lettres de motivation et la préparation aux entretiens sont inclus avec un compte gratuit et avec Pro.",
    scans: "Un compte gratuit analyse davantage chaque jour, et Pro analyse sans limite quotidienne.",
  },
  hi: {
    opening: (n) => `${n} अब नहीं बेचा जाता, और आपसे कोई शुल्क नहीं लिया गया।`,
    pastBuyers: `अगर आपने इसे पहले खरीदा था, तो आपका लिंक ${PAST_BUYER_DAYS} दिनों तक काम करता रहेगा।`,
    writing: "नौकरी के अनुसार बना रिज़्यूमे, कवर लेटर और इंटरव्यू की तैयारी अब मुफ़्त खाते और Pro के साथ मिलती है।",
    reports: "$5 का Full Analysis अभी भी बिक्री पर है, और नौकरी के अनुसार बना रिज़्यूमे, कवर लेटर और इंटरव्यू की तैयारी मुफ़्त खाते और Pro के साथ मिलती है।",
    scans: "मुफ़्त खाता हर दिन ज़्यादा स्कैन करता है, और Pro बिना दैनिक सीमा के स्कैन करता है।",
  },
  nl: {
    opening: (n) => `${n} wordt niet meer verkocht, en er is niets in rekening gebracht.`,
    pastBuyers: `Heb je het eerder gekocht, dan blijft je link nog ${PAST_BUYER_DAYS} dagen werken.`,
    writing: "Aangepaste cv's, sollicitatiebrieven en sollicitatievoorbereiding krijg je nu bij een gratis account en bij Pro.",
    reports: "De Full Analysis van $5 is nog te koop, en aangepaste cv's, sollicitatiebrieven en sollicitatievoorbereiding krijg je bij een gratis account en bij Pro.",
    scans: "Een gratis account scant meer per dag, en Pro scant zonder daglimiet.",
  },
  pt: {
    opening: (n) => `${n} não é mais vendido, e nada foi cobrado de você.`,
    pastBuyers: `Se você comprou antes, seu link continua funcionando por ${PAST_BUYER_DAYS} dias.`,
    writing: "Currículos adaptados, cartas de apresentação e preparação para entrevistas agora vêm com uma conta gratuita e com o Pro.",
    reports: "A Full Analysis de US$ 5 continua à venda, e currículos adaptados, cartas de apresentação e preparação para entrevistas vêm com uma conta gratuita e com o Pro.",
    scans: "Uma conta gratuita faz mais análises por dia, e o Pro analisa sem limite diário.",
  },
  tl: {
    opening: (n) => `Hindi na ibinebenta ang ${n}, at walang siningil sa iyo.`,
    pastBuyers: `Kung binili mo ito dati, gagana pa ang link mo sa loob ng ${PAST_BUYER_DAYS} araw.`,
    writing: "Kasama na ngayon sa libreng account at sa Pro ang iniangkop na résumé, cover letter at paghahanda sa interview.",
    reports: "Ibinebenta pa rin ang $5 na Full Analysis, at kasama sa libreng account at sa Pro ang iniangkop na résumé, cover letter at paghahanda sa interview.",
    scans: "Mas maraming scan bawat araw ang libreng account, at walang pang-araw-araw na limit ang Pro.",
  },
};

/** The whole sentence a buyer reads, in one language. */
export function cutSentence(productId: string, language: CheckoutLanguage): string {
  const cut = CUT_PRODUCTS[productId];
  const l = CUT_LINES[language] ?? EN;
  if (!cut) return l.opening("This product");
  return `${l.opening(cut.name)} ${l.pastBuyers} ${l[cut.tail]}`;
}

export interface CutCheckoutAnswer {
  status: typeof RETIRED_STATUS;
  body: {
    retired: true;
    reason: typeof RETIRED_REASON;
    cut: true;
    product: string;
    language: CheckoutLanguage;
    error: string;
    pricing: string;
  };
}

/**
 * The refusal a cut product's checkout returns. `origin` is the caller's
 * checkoutOrigin (only our own hosts), so a preview build links to itself.
 */
export function cutCheckoutAnswer(
  productId: string,
  opts: { body: unknown; acceptLanguage?: string | null; origin: string },
): CutCheckoutAnswer {
  const language = retiredLanguageOf(opts.body, opts.acceptLanguage);
  return {
    status: RETIRED_STATUS,
    body: {
      retired: true,
      reason: RETIRED_REASON,
      cut: true,
      product: CUT_PRODUCTS[productId]?.productType ?? String(productId),
      language,
      error: cutSentence(productId, language),
      pricing: `${opts.origin.replace(/\/+$/, "")}/pricing`,
    },
  };
}
