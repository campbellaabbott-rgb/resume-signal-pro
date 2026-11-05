/**
 * THE SAVED-SEARCH DIGEST IN THE READER'S LANGUAGE (S13-102).
 *
 * The digest runs on a schedule with no request in hand, so its language is
 * the one kept on the saved search (user_job_searches.locale, 20261103240000:
 * written by the owner's page, in the language that page was read in).
 * NULL, or anything that is not one of the site's nine, is English. A saved
 * search's name and the words a person searched for stay as they wrote them.
 *
 * Every line that goes in the mail's HTML is HTML-safe text written here; a
 * value put into one arrives already escaped. The subjects are plain text.
 * Import-free apart from the shared language rule, so the Node tests import it.
 */
import { checkoutLanguageOf, type CheckoutLanguage } from "../_shared/checkout-policy.ts";

export type MailLanguage = CheckoutLanguage;

/** A stored locale, if it is one we write; otherwise English. */
export function storedLanguage(v: unknown): MailLanguage {
  return checkoutLanguageOf({ language: typeof v === "string" ? v : "" }) ?? "en";
}

/** The Intl locale a language's numbers are written in. Tagalog is Intl's Filipino. */
const NUMBER_LOCALE: Record<MailLanguage, string> = {
  en: "en-US", "en-GB": "en-GB", de: "de-DE", es: "es-ES", fr: "fr-FR", hi: "hi-IN", nl: "nl-NL", pt: "pt-BR", tl: "fil-PH",
};

/** A count the way this reader writes it. */
export function formatCount(n: number, lang: MailLanguage): string {
  return n.toLocaleString(NUMBER_LOCALE[lang]);
}

type Link = (text: string) => string;

export interface DigestCopy {
  tagline: string;
  /** The count arrives escaped; the bold tags are this line's. */
  countLine: (countHtml: string, n: number, strong: boolean) => string;
  lead: (nameHtml: string, n: number, strong: boolean) => string;
  seeAll: (countHtml: string) => string;
  tip: (link: Link) => string;
  footer: (link: Link) => string;
  view: string;
  postedToday: string;
  postedYesterday: string;
  postedDaysAgo: (d: number) => string;
  fitMatch: (pctHtml: string) => string;
  subjectFirstMatch: (count: string, n: number, name: string) => string;
  subjectStrong: (count: string, n: number, name: string) => string;
  /** `what` is the search's category in words, or the words searched for; null when it has neither. */
  subjectPlain: (count: string, n: number, what: string | null, name: string) => string;
  category: Record<string, string>;
}

const EN: DigestCopy = {
  tagline: "Saved search",
  countLine: (c, n, strong) => `<b>${c}</b> new ${strong ? (n === 1 ? "match for you" : "matches for you") : (n === 1 ? "opening" : "openings")} since we last checked`,
  lead: (nm, _n, strong) => `${strong ? "that clear your fit bar for" : "matching"} “${nm}”, pulled from companies' official job boards.`,
  seeAll: (c) => `See all ${c} on the board`,
  tip: (link) => `Tip: ${link("scan your resume")} against any posting before you apply.`,
  footer: (link) => `You turned on the digest for this saved search. ${link("Turn it off")}.`,
  view: "View",
  postedToday: "posted today",
  postedYesterday: "posted yesterday",
  postedDaysAgo: (d) => `posted ${d}d ago`,
  fitMatch: (p) => `${p}% match`,
  subjectFirstMatch: (c, n, name) => `We found it: ${c} ${n === 1 ? "match" : "matches"} for “${name}”`,
  subjectStrong: (c, n, name) => `${c} new strong ${n === 1 ? "match" : "matches"} for you — ${name}`,
  subjectPlain: (c, n, what, name) => `${c} new ${what ?? "job"} ${n === 1 ? "match" : "matches"} — ${name}`,
  category: {
    engineering: "engineering", data_ai: "data & AI", design: "design", product: "product",
    marketing: "marketing", sales: "sales", customer: "customer", finance: "finance",
    legal: "legal", people_hr: "people & HR", operations: "operations", healthcare: "healthcare",
    science: "science", education: "education", hospitality_retail: "retail & hospitality",
    security: "security", admin: "admin",
  },
};

export const DIGEST_COPY: Record<MailLanguage, DigestCopy> = {
  en: EN,
  "en-GB": {
    ...EN,
    tip: (link) => `Tip: ${link("scan your CV")} against any job advert before you apply.`,
  },
  de: {
    tagline: "Gespeicherte Suche",
    countLine: (c, n, strong) => `<b>${c}</b> ${strong ? (n === 1 ? "neuer Treffer für Sie" : "neue Treffer für Sie") : (n === 1 ? "neue Stelle" : "neue Stellen")} seit unserer letzten Prüfung`,
    lead: (nm, n, strong) => strong
      ? `${n === 1 ? "der Ihre Passungsschwelle" : "die Ihre Passungsschwelle"} für „${nm}“ ${n === 1 ? "erreicht" : "erreichen"}, direkt von den offiziellen Jobbörsen der Unternehmen.`
      : `passend zu „${nm}“, direkt von den offiziellen Jobbörsen der Unternehmen.`,
    seeAll: (c) => `Alle ${c} auf der Jobbörse ansehen`,
    tip: (link) => `Tipp: ${link("Scannen Sie Ihren Lebenslauf")} gegen eine Stellenanzeige, bevor Sie sich bewerben.`,
    footer: (link) => `Sie haben den Digest für diese gespeicherte Suche aktiviert. ${link("Deaktivieren")}.`,
    view: "Ansehen",
    postedToday: "heute veröffentlicht",
    postedYesterday: "gestern veröffentlicht",
    postedDaysAgo: (d) => `vor ${d} Tagen veröffentlicht`,
    fitMatch: (p) => `${p} % Passung`,
    subjectFirstMatch: (c, _n, name) => `Gefunden: ${c} Treffer für „${name}“`,
    subjectStrong: (c, n, name) => `${c} ${n === 1 ? "neuer starker" : "neue starke"} Treffer für Sie — ${name}`,
    subjectPlain: (c, n, what, name) => `${c} ${n === 1 ? "neuer" : "neue"} Treffer${what ? ` für ${what}` : ""} — ${name}`,
    category: {
      engineering: "Engineering", data_ai: "Daten & KI", design: "Design", product: "Produkt",
      marketing: "Marketing", sales: "Vertrieb", customer: "Kundenservice", finance: "Finanzen",
      legal: "Recht", people_hr: "HR", operations: "Operations", healthcare: "Gesundheitswesen",
      science: "Wissenschaft", education: "Bildung", hospitality_retail: "Handel & Gastgewerbe",
      security: "Sicherheit", admin: "Verwaltung",
    },
  },
  es: {
    tagline: "Búsqueda guardada",
    countLine: (c, n, strong) => `<b>${c}</b> ${strong ? (n === 1 ? "nueva coincidencia para ti" : "nuevas coincidencias para ti") : (n === 1 ? "nueva vacante" : "nuevas vacantes")} desde nuestra última revisión`,
    lead: (nm, n, strong) => strong
      ? `que ${n === 1 ? "supera" : "superan"} tu umbral de encaje para “${nm}”, de las bolsas de empleo oficiales de las empresas.`
      : `que ${n === 1 ? "coincide" : "coinciden"} con “${nm}”, de las bolsas de empleo oficiales de las empresas.`,
    seeAll: (c) => `Ver todas (${c}) en la bolsa de empleo`,
    tip: (link) => `Consejo: ${link("escanea tu currículum")} contra cualquier oferta antes de postularte.`,
    footer: (link) => `Activaste el resumen de esta búsqueda guardada. ${link("Desactivarlo")}.`,
    view: "Ver",
    postedToday: "publicada hoy",
    postedYesterday: "publicada ayer",
    postedDaysAgo: (d) => `publicada hace ${d} días`,
    fitMatch: (p) => `${p} % de encaje`,
    subjectFirstMatch: (c, n, name) => `Lo encontramos: ${c} ${n === 1 ? "coincidencia" : "coincidencias"} para “${name}”`,
    subjectStrong: (c, n, name) => `${c} ${n === 1 ? "nueva coincidencia fuerte" : "nuevas coincidencias fuertes"} para ti — ${name}`,
    subjectPlain: (c, n, what, name) => `${c} ${n === 1 ? "nueva coincidencia" : "nuevas coincidencias"}${what ? ` de ${what}` : ""} — ${name}`,
    category: {
      engineering: "ingeniería", data_ai: "datos e IA", design: "diseño", product: "producto",
      marketing: "marketing", sales: "ventas", customer: "atención al cliente", finance: "finanzas",
      legal: "legal", people_hr: "personas y selección", operations: "operaciones", healthcare: "salud",
      science: "ciencia", education: "educación", hospitality_retail: "hostelería y retail",
      security: "seguridad", admin: "administración",
    },
  },
  fr: {
    tagline: "Recherche enregistrée",
    countLine: (c, n, strong) => `<b>${c}</b> ${strong ? (n > 1 ? "nouvelles correspondances pour vous" : "nouvelle correspondance pour vous") : (n > 1 ? "nouvelles offres" : "nouvelle offre")} depuis notre dernière vérification`,
    lead: (nm, n, strong) => strong
      ? `${n > 1 ? "qui atteignent" : "qui atteint"} votre seuil d'adéquation pour « ${nm} », ${n > 1 ? "issues" : "issue"} des sites d'emploi officiels des entreprises.`
      : `correspondant à « ${nm} », ${n > 1 ? "issues" : "issue"} des sites d'emploi officiels des entreprises.`,
    seeAll: (c) => `Tout voir (${c}) sur le site d'emploi`,
    tip: (link) => `Conseil : ${link("scannez votre CV")} face à une offre avant de candidater.`,
    footer: (link) => `Vous avez activé le digest de cette recherche enregistrée. ${link("Le désactiver")}.`,
    view: "Voir",
    postedToday: "publiée aujourd'hui",
    postedYesterday: "publiée hier",
    postedDaysAgo: (d) => `publiée il y a ${d} jours`,
    fitMatch: (p) => `${p} % d'adéquation`,
    subjectFirstMatch: (c, n, name) => `Trouvé : ${c} ${n > 1 ? "correspondances" : "correspondance"} pour « ${name} »`,
    subjectStrong: (c, n, name) => `${c} ${n > 1 ? "nouvelles correspondances fortes" : "nouvelle correspondance forte"} pour vous — ${name}`,
    subjectPlain: (c, n, what, name) => `${c} ${n > 1 ? "nouvelles correspondances" : "nouvelle correspondance"}${what ? ` pour ${what}` : ""} — ${name}`,
    category: {
      engineering: "ingénierie", data_ai: "data et IA", design: "design", product: "produit",
      marketing: "marketing", sales: "vente", customer: "relation client", finance: "finance",
      legal: "juridique", people_hr: "RH", operations: "opérations", healthcare: "santé",
      science: "sciences", education: "éducation", hospitality_retail: "hôtellerie et commerce",
      security: "sécurité", admin: "administration",
    },
  },
  hi: {
    tagline: "सहेजी गई खोज",
    countLine: (c, n, strong) => `पिछली जाँच के बाद से <b>${c}</b> ${strong ? (n === 1 ? "नया मिलान आपके लिए" : "नए मिलान आपके लिए") : (n === 1 ? "नया पद" : "नए पद")}`,
    lead: (nm, n, strong) => strong
      ? `जो “${nm}” के लिए आपकी फ़िट सीमा ${n === 1 ? "पार करता है" : "पार करते हैं"}, कंपनियों के आधिकारिक जॉब बोर्ड से।`
      : `“${nm}” से मेल खाते हुए, कंपनियों के आधिकारिक जॉब बोर्ड से।`,
    seeAll: (c) => `बोर्ड पर सभी ${c} देखें`,
    tip: (link) => `सुझाव: आवेदन करने से पहले किसी भी पोस्टिंग के सामने ${link("अपना रिज़्यूमे स्कैन करें")}।`,
    footer: (link) => `आपने इस सहेजी गई खोज के लिए डाइजेस्ट चालू किया था। ${link("इसे बंद करें")}।`,
    view: "देखें",
    postedToday: "आज पोस्ट हुआ",
    postedYesterday: "कल पोस्ट हुआ",
    postedDaysAgo: (d) => `${d} दिन पहले पोस्ट हुआ`,
    fitMatch: (p) => `${p}% मिलान`,
    subjectFirstMatch: (c, _n, name) => `मिल गया: “${name}” के लिए ${c} मिलान`,
    subjectStrong: (c, n, name) => `आपके लिए ${c} ${n === 1 ? "नया मज़बूत मिलान" : "नए मज़बूत मिलान"} — ${name}`,
    subjectPlain: (c, n, what, name) => `${what ? `${what} के ` : ""}${c} ${n === 1 ? "नया मिलान" : "नए मिलान"} — ${name}`,
    category: {
      engineering: "इंजीनियरिंग", data_ai: "डेटा और AI", design: "डिज़ाइन", product: "प्रोडक्ट",
      marketing: "मार्केटिंग", sales: "सेल्स", customer: "कस्टमर सपोर्ट", finance: "फ़ाइनेंस",
      legal: "लीगल", people_hr: "एचआर", operations: "ऑपरेशन्स", healthcare: "हेल्थकेयर",
      science: "साइंस", education: "शिक्षा", hospitality_retail: "रिटेल और आतिथ्य",
      security: "सिक्योरिटी", admin: "एडमिन",
    },
  },
  nl: {
    tagline: "Opgeslagen zoekopdracht",
    countLine: (c, n, strong) => `<b>${c}</b> ${strong ? (n === 1 ? "nieuwe match voor jou" : "nieuwe matches voor jou") : (n === 1 ? "nieuwe vacature" : "nieuwe vacatures")} sinds onze laatste controle`,
    lead: (nm, n, strong) => strong
      ? `die jouw matchdrempel ${n === 1 ? "haalt" : "halen"} voor “${nm}”, rechtstreeks van de officiële vacaturebanken van bedrijven.`
      : `passend bij “${nm}”, rechtstreeks van de officiële vacaturebanken van bedrijven.`,
    seeAll: (c) => `Bekijk alle ${c} op de vacaturebank`,
    tip: (link) => `Tip: ${link("scan je cv")} tegen een vacature voordat je solliciteert.`,
    footer: (link) => `Je hebt de digest voor deze opgeslagen zoekopdracht aangezet. ${link("Uitzetten")}.`,
    view: "Bekijken",
    postedToday: "vandaag geplaatst",
    postedYesterday: "gisteren geplaatst",
    postedDaysAgo: (d) => `${d} dagen geleden geplaatst`,
    fitMatch: (p) => `${p}% match`,
    subjectFirstMatch: (c, n, name) => `Gevonden: ${c} ${n === 1 ? "match" : "matches"} voor “${name}”`,
    subjectStrong: (c, n, name) => `${c} ${n === 1 ? "nieuwe sterke match" : "nieuwe sterke matches"} voor jou — ${name}`,
    subjectPlain: (c, n, what, name) => `${c} ${n === 1 ? "nieuwe match" : "nieuwe matches"}${what ? ` voor ${what}` : ""} — ${name}`,
    category: {
      engineering: "engineering", data_ai: "data & AI", design: "design", product: "product",
      marketing: "marketing", sales: "sales", customer: "klantenservice", finance: "financiën",
      legal: "juridisch", people_hr: "HR", operations: "operations", healthcare: "zorg",
      science: "wetenschap", education: "onderwijs", hospitality_retail: "horeca & retail",
      security: "beveiliging", admin: "administratie",
    },
  },
  pt: {
    tagline: "Busca salva",
    countLine: (c, n, strong) => `<b>${c}</b> ${strong ? (n === 1 ? "nova correspondência para você" : "novas correspondências para você") : (n === 1 ? "nova vaga" : "novas vagas")} desde a nossa última verificação`,
    lead: (nm, n, strong) => strong
      ? `que ${n === 1 ? "atinge" : "atingem"} seu limite de encaixe para “${nm}”, dos murais oficiais de vagas das empresas.`
      : `que ${n === 1 ? "corresponde" : "correspondem"} a “${nm}”, dos murais oficiais de vagas das empresas.`,
    seeAll: (c) => `Ver todas (${c}) no mural de vagas`,
    tip: (link) => `Dica: ${link("escaneie seu currículo")} contra qualquer vaga antes de se candidatar.`,
    footer: (link) => `Você ativou o resumo desta busca salva. ${link("Desativar")}.`,
    view: "Ver",
    postedToday: "publicada hoje",
    postedYesterday: "publicada ontem",
    postedDaysAgo: (d) => `publicada há ${d} dias`,
    fitMatch: (p) => `${p}% de encaixe`,
    subjectFirstMatch: (c, n, name) => `Encontramos: ${c} ${n === 1 ? "correspondência" : "correspondências"} para “${name}”`,
    subjectStrong: (c, n, name) => `${c} ${n === 1 ? "nova correspondência forte" : "novas correspondências fortes"} para você — ${name}`,
    subjectPlain: (c, n, what, name) => `${c} ${n === 1 ? "nova correspondência" : "novas correspondências"}${what ? ` de ${what}` : ""} — ${name}`,
    category: {
      engineering: "engenharia", data_ai: "dados e IA", design: "design", product: "produto",
      marketing: "marketing", sales: "vendas", customer: "atendimento ao cliente", finance: "finanças",
      legal: "jurídico", people_hr: "pessoas e recrutamento", operations: "operações", healthcare: "saúde",
      science: "ciências", education: "educação", hospitality_retail: "hotelaria e varejo",
      security: "segurança", admin: "administrativo",
    },
  },
  tl: {
    tagline: "Naka-save na paghahanap",
    countLine: (c, _n, strong) => `<b>${c}</b> ${strong ? "bagong tugma para sa iyo" : "bagong bakante"} mula noong huli naming pagsusuri`,
    lead: (nm, _n, strong) => strong
      ? `na pumasa sa fit bar mo para sa “${nm}”, mula sa mga opisyal na job board ng mga kumpanya.`
      : `na tumutugma sa “${nm}”, mula sa mga opisyal na job board ng mga kumpanya.`,
    seeAll: (c) => `Tingnan ang lahat ng ${c} sa board`,
    tip: (link) => `Tip: ${link("i-scan ang resume mo")} laban sa anumang posting bago mag-apply.`,
    footer: (link) => `Binuksan mo ang digest para sa naka-save na paghahanap na ito. ${link("Isara ito")}.`,
    view: "Tingnan",
    postedToday: "na-post ngayon",
    postedYesterday: "na-post kahapon",
    postedDaysAgo: (d) => `na-post ${d} araw na ang nakalipas`,
    fitMatch: (p) => `${p}% tugma`,
    subjectFirstMatch: (c, _n, name) => `Nahanap namin: ${c} tugma para sa “${name}”`,
    subjectStrong: (c, _n, name) => `${c} bagong malakas na tugma para sa iyo — ${name}`,
    subjectPlain: (c, _n, what, name) => `${c} bagong tugma${what ? ` sa ${what}` : ""} — ${name}`,
    category: {
      engineering: "engineering", data_ai: "data at AI", design: "design", product: "product",
      marketing: "marketing", sales: "sales", customer: "customer service", finance: "finance",
      legal: "legal", people_hr: "HR", operations: "operasyon", healthcare: "healthcare",
      science: "agham", education: "edukasyon", hospitality_retail: "hospitality at retail",
      security: "seguridad", admin: "admin",
    },
  },
};
