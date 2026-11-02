/**
 * THE CLAIM MAILS IN THE CLAIMANT'S LANGUAGE (S13-102).
 *
 * The verification mail is written in the language of the page the claim
 * was made from (body.language, then the browser's Accept-Language), and that
 * language is kept on the claim (company_claims.locale, 20261103195000) for
 * the "verified" mail the owner's decision sends later. Anything unknown is
 * English. The company's name is passed in already escaped.
 */
import { checkoutLanguageOf, type CheckoutLanguage } from "../_shared/checkout-policy.ts";

export type MailLanguage = CheckoutLanguage;

/** The page's language, else the browser's first preference we carry, else English. */
export function mailLanguageOf(body: unknown, acceptLanguage: string | null | undefined): MailLanguage {
  const fromBody = checkoutLanguageOf(body);
  if (fromBody) return fromBody;
  for (const part of String(acceptLanguage ?? "").split(",").slice(0, 6)) {
    const tag = part.split(";")[0].trim();
    const lang = tag ? checkoutLanguageOf({ language: tag }) : null;
    if (lang) return lang;
  }
  return "en";
}

/** A stored locale, if it is one we write; otherwise English. */
export function storedLanguage(v: unknown): MailLanguage {
  return checkoutLanguageOf({ language: typeof v === "string" ? v : "" }) ?? "en";
}

export interface ClaimCopy {
  verifySubject: (name: string) => string;
  verifyAsk: (nameHtml: string) => string;
  verifyButton: string;
  verifyNote: string;
  verifyIgnore: string;
  verifiedSubject: (name: string) => string;
  verifiedBody: (nameHtml: string) => string;
  verifiedNote: string;
}

const EN: ClaimCopy = {
  verifySubject: (n) => `Verify your claim of ${n} on Resume Booster`,
  verifyAsk: (n) => `Someone (hopefully you) asked to claim the <b>${n}</b> company profile on resumebooster.work using this address.`,
  verifyButton: "Verify this claim",
  verifyNote: "Verification confirms your identity as an employer contact. It never changes the hiring data we show — fills, re-listing patterns, and badges are computed from public postings and are not editable by anyone, including verified employers.",
  verifyIgnore: "If you didn't request this, ignore this email — nothing happens without the click.",
  verifiedSubject: (n) => `Your claim of ${n} is verified`,
  verifiedBody: (n) => `Your claim of <b>${n}</b> on resumebooster.work has been reviewed and verified. The company page now shows a Verified employer badge:`,
  verifiedNote: "Verification confirms identity only — the hiring data shown is computed from public postings and is not editable by anyone, including verified employers.",
};

export const CLAIM_COPY: Record<MailLanguage, ClaimCopy> = {
  en: EN,
  "en-GB": EN,
  de: {
    verifySubject: (n) => `Bestätigen Sie Ihren Anspruch auf ${n} bei Resume Booster`,
    verifyAsk: (n) => `Jemand (hoffentlich Sie) hat mit dieser Adresse beantragt, das Unternehmensprofil von <b>${n}</b> auf resumebooster.work zu beanspruchen.`,
    verifyButton: "Diesen Anspruch bestätigen",
    verifyNote: "Die Bestätigung weist Sie als Kontakt des Arbeitgebers aus. Sie ändert nie die Einstellungsdaten, die wir zeigen — Besetzungen, Muster erneuter Ausschreibungen und Abzeichen werden aus öffentlichen Stellenanzeigen berechnet und sind von niemandem bearbeitbar, auch nicht von bestätigten Arbeitgebern.",
    verifyIgnore: "Wenn Sie das nicht beantragt haben, ignorieren Sie diese E-Mail — ohne Klick passiert nichts.",
    verifiedSubject: (n) => `Ihr Anspruch auf ${n} ist bestätigt`,
    verifiedBody: (n) => `Ihr Anspruch auf <b>${n}</b> auf resumebooster.work wurde geprüft und bestätigt. Die Unternehmensseite zeigt jetzt das Abzeichen „Bestätigter Arbeitgeber“:`,
    verifiedNote: "Die Bestätigung weist nur die Identität aus — die gezeigten Einstellungsdaten werden aus öffentlichen Stellenanzeigen berechnet und sind von niemandem bearbeitbar, auch nicht von bestätigten Arbeitgebern.",
  },
  es: {
    verifySubject: (n) => `Verifica tu reclamación de ${n} en Resume Booster`,
    verifyAsk: (n) => `Alguien (esperamos que tú) pidió reclamar el perfil de empresa de <b>${n}</b> en resumebooster.work con esta dirección.`,
    verifyButton: "Verificar esta reclamación",
    verifyNote: "La verificación confirma tu identidad como contacto de la empresa. Nunca cambia los datos de contratación que mostramos: las coberturas, los patrones de republicación y las insignias se calculan a partir de ofertas públicas y nadie puede editarlos, ni siquiera las empresas verificadas.",
    verifyIgnore: "Si no lo pediste, ignora este correo: no pasa nada sin el clic.",
    verifiedSubject: (n) => `Tu reclamación de ${n} está verificada`,
    verifiedBody: (n) => `Tu reclamación de <b>${n}</b> en resumebooster.work se ha revisado y verificado. La página de la empresa ahora muestra la insignia de empresa verificada:`,
    verifiedNote: "La verificación solo confirma la identidad: los datos de contratación que se muestran se calculan a partir de ofertas públicas y nadie puede editarlos, ni siquiera las empresas verificadas.",
  },
  fr: {
    verifySubject: (n) => `Vérifiez votre revendication de ${n} sur Resume Booster`,
    verifyAsk: (n) => `Quelqu'un (vous, nous l'espérons) a demandé à revendiquer le profil d'entreprise de <b>${n}</b> sur resumebooster.work avec cette adresse.`,
    verifyButton: "Vérifier cette revendication",
    verifyNote: "La vérification confirme votre identité en tant que contact de l'employeur. Elle ne modifie jamais les données de recrutement que nous affichons : les postes pourvus, les republications et les badges sont calculés à partir d'offres publiques et ne sont modifiables par personne, pas même par les employeurs vérifiés.",
    verifyIgnore: "Si vous n'avez rien demandé, ignorez cet e-mail : rien ne se passe sans le clic.",
    verifiedSubject: (n) => `Votre revendication de ${n} est vérifiée`,
    verifiedBody: (n) => `Votre revendication de <b>${n}</b> sur resumebooster.work a été examinée et vérifiée. La page de l'entreprise affiche désormais le badge Employeur vérifié :`,
    verifiedNote: "La vérification confirme uniquement l'identité : les données de recrutement affichées sont calculées à partir d'offres publiques et ne sont modifiables par personne, pas même par les employeurs vérifiés.",
  },
  hi: {
    verifySubject: (n) => `Resume Booster पर ${n} के अपने दावे की पुष्टि करें`,
    verifyAsk: (n) => `किसी ने (उम्मीद है आपने) इस पते से resumebooster.work पर <b>${n}</b> की कंपनी प्रोफ़ाइल का दावा करने को कहा है।`,
    verifyButton: "इस दावे की पुष्टि करें",
    verifyNote: "पुष्टि आपकी पहचान को नियोक्ता के संपर्क के रूप में साबित करती है। यह हमारे दिखाए हायरिंग डेटा को कभी नहीं बदलती — भरे गए पद, दोबारा लिस्टिंग के पैटर्न और बैज सार्वजनिक पोस्टिंग से गिने जाते हैं और इन्हें कोई भी नहीं बदल सकता, सत्यापित नियोक्ता भी नहीं।",
    verifyIgnore: "अगर आपने यह नहीं माँगा, तो इस ईमेल को अनदेखा करें — बिना क्लिक के कुछ नहीं होता।",
    verifiedSubject: (n) => `${n} पर आपका दावा सत्यापित हो गया है`,
    verifiedBody: (n) => `resumebooster.work पर <b>${n}</b> के आपके दावे की समीक्षा और पुष्टि हो गई है। कंपनी पेज पर अब सत्यापित नियोक्ता का बैज दिखता है:`,
    verifiedNote: "पुष्टि केवल पहचान साबित करती है — दिखाया गया हायरिंग डेटा सार्वजनिक पोस्टिंग से गिना जाता है और इसे कोई भी नहीं बदल सकता, सत्यापित नियोक्ता भी नहीं।",
  },
  nl: {
    verifySubject: (n) => `Bevestig je claim op ${n} bij Resume Booster`,
    verifyAsk: (n) => `Iemand (hopelijk jij) vroeg met dit adres om het bedrijfsprofiel van <b>${n}</b> op resumebooster.work te claimen.`,
    verifyButton: "Deze claim bevestigen",
    verifyNote: "Bevestiging toont aan dat je een contactpersoon van de werkgever bent. Het verandert nooit de wervingsgegevens die we tonen — vervulde vacatures, herplaatsingspatronen en badges worden berekend uit openbare vacatures en zijn door niemand te bewerken, ook niet door bevestigde werkgevers.",
    verifyIgnore: "Heb je dit niet aangevraagd? Negeer deze e-mail dan — zonder klik gebeurt er niets.",
    verifiedSubject: (n) => `Je claim op ${n} is bevestigd`,
    verifiedBody: (n) => `Je claim op <b>${n}</b> op resumebooster.work is beoordeeld en bevestigd. De bedrijfspagina toont nu de badge Bevestigde werkgever:`,
    verifiedNote: "Bevestiging toont alleen de identiteit aan — de getoonde wervingsgegevens worden berekend uit openbare vacatures en zijn door niemand te bewerken, ook niet door bevestigde werkgevers.",
  },
  pt: {
    verifySubject: (n) => `Verifique sua reivindicação de ${n} no Resume Booster`,
    verifyAsk: (n) => `Alguém (esperamos que você) pediu para reivindicar o perfil da empresa <b>${n}</b> no resumebooster.work usando este endereço.`,
    verifyButton: "Verificar esta reivindicação",
    verifyNote: "A verificação confirma sua identidade como contato da empresa. Ela nunca muda os dados de contratação que mostramos — vagas preenchidas, padrões de republicação e selos são calculados a partir de vagas públicas e ninguém pode editá-los, nem mesmo empresas verificadas.",
    verifyIgnore: "Se você não pediu isso, ignore este e-mail — nada acontece sem o clique.",
    verifiedSubject: (n) => `Sua reivindicação de ${n} foi verificada`,
    verifiedBody: (n) => `Sua reivindicação de <b>${n}</b> no resumebooster.work foi analisada e verificada. A página da empresa agora mostra o selo de empregador verificado:`,
    verifiedNote: "A verificação confirma apenas a identidade — os dados de contratação mostrados são calculados a partir de vagas públicas e ninguém pode editá-los, nem mesmo empresas verificadas.",
  },
  tl: {
    verifySubject: (n) => `I-verify ang iyong claim sa ${n} sa Resume Booster`,
    verifyAsk: (n) => `May humiling (sana ikaw) na i-claim ang company profile ng <b>${n}</b> sa resumebooster.work gamit ang address na ito.`,
    verifyButton: "I-verify ang claim na ito",
    verifyNote: "Kinukumpirma ng verification na isa kang contact ng employer. Hindi nito kailanman binabago ang hiring data na ipinapakita namin — ang mga napunang posisyon, mga pattern ng muling pag-post, at mga badge ay kinukuwenta mula sa mga pampublikong posting at walang sinumang makakapag-edit nito, kahit ang mga verified na employer.",
    verifyIgnore: "Kung hindi ikaw ang humiling nito, huwag pansinin ang email na ito — walang mangyayari kung walang click.",
    verifiedSubject: (n) => `Na-verify na ang iyong claim sa ${n}`,
    verifiedBody: (n) => `Nasuri at na-verify na ang iyong claim sa <b>${n}</b> sa resumebooster.work. Ipinapakita na ngayon ng company page ang Verified employer badge:`,
    verifiedNote: "Pagkakakilanlan lang ang kinukumpirma ng verification — ang hiring data na ipinapakita ay kinukuwenta mula sa mga pampublikong posting at walang sinumang makakapag-edit nito, kahit ang mga verified na employer.",
  },
};
