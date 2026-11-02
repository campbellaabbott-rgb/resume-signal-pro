/**
 * THE PULSE'S MAILS IN THE READER'S LANGUAGE (S13-102).
 *
 * The confirmation mail is written in the language of the page that asked
 * for it (body.language, then the browser's Accept-Language), and the monthly
 * pulse in the language stored when the address confirmed
 * (market_pulse_subscribers.locale). Anything unknown is English. The keywords
 * themselves stay as the table spells them: they are what a résumé is
 * checked for. Every line is HTML-safe text written here (lastScan's bold
 * tags are ours); a value put into a line arrives already escaped.
 *
 * Import-free apart from the shared language rule, so the Node tests import it.
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

type Industry = "technology" | "finance" | "data_science" | "marketing" | "sales" | "consulting" | "healthcare" | "product_management" | "general";

const INDUSTRY: Record<MailLanguage, Record<Industry, string>> = {
  en: { technology: "technology", finance: "finance", data_science: "data science", marketing: "marketing", sales: "sales", consulting: "consulting", healthcare: "healthcare", product_management: "product management", general: "general" },
  "en-GB": { technology: "technology", finance: "finance", data_science: "data science", marketing: "marketing", sales: "sales", consulting: "consulting", healthcare: "healthcare", product_management: "product management", general: "general" },
  de: { technology: "Technologie", finance: "Finanzen", data_science: "Data Science", marketing: "Marketing", sales: "Vertrieb", consulting: "Beratung", healthcare: "Gesundheitswesen", product_management: "Produktmanagement", general: "Allgemein" },
  es: { technology: "tecnología", finance: "finanzas", data_science: "ciencia de datos", marketing: "marketing", sales: "ventas", consulting: "consultoría", healthcare: "salud", product_management: "gestión de producto", general: "perfil general" },
  fr: { technology: "technologie", finance: "finance", data_science: "science des données", marketing: "marketing", sales: "vente", consulting: "conseil", healthcare: "santé", product_management: "gestion de produit", general: "généraliste" },
  hi: { technology: "टेक्नोलॉजी", finance: "फ़ाइनेंस", data_science: "डेटा साइंस", marketing: "मार्केटिंग", sales: "सेल्स", consulting: "कंसल्टिंग", healthcare: "हेल्थकेयर", product_management: "प्रोडक्ट मैनेजमेंट", general: "सामान्य" },
  nl: { technology: "technologie", finance: "financiën", data_science: "data science", marketing: "marketing", sales: "sales", consulting: "consultancy", healthcare: "zorg", product_management: "productmanagement", general: "algemene functies" },
  pt: { technology: "tecnologia", finance: "finanças", data_science: "ciência de dados", marketing: "marketing", sales: "vendas", consulting: "consultoria", healthcare: "saúde", product_management: "gestão de produto", general: "perfil geral" },
  tl: { technology: "technology", finance: "finance", data_science: "data science", marketing: "marketing", sales: "sales", consulting: "consulting", healthcare: "healthcare", product_management: "product management", general: "pangkalahatang larangan" },
};

/** One of our industry keys in the reader's words; an unknown key in English words. */
export function industryLabel(industry: string, lang: MailLanguage): string {
  return (INDUSTRY[lang] as Record<string, string>)[industry] ?? industry.replace(/_/g, " ");
}

export interface PulseCopy {
  confirmSubject: string;
  confirmHeading: string;
  confirmAsk: (industry: string) => string;
  confirmNothing: string;
  confirmButton: string;
  confirmExpiry: string;
  tagline: string;
  headline: (industry: string) => string;
  curated: (industry: string) => string;
  progressTitle: string;
  progressAcross: (n: number) => string;
  trendUp: string;
  trendFlat: string;
  trendDown: string;
  coreKeywords: string;
  oftenExpected: string;
  /** The score arrives escaped; the bold tags are ours. */
  lastScan: (scoreHtml: string) => string;
  freshScan: string;
  rescanButton: string;
  confirmedOn: (date: string | null) => string;
  unsubscribe: string;
  noLogin: string;
  subject: (industry: string) => string;
}

export const PULSE_COPY: Record<MailLanguage, PulseCopy> = {
  en: {
    confirmSubject: "Confirm your monthly market pulse",
    confirmHeading: "Confirm your monthly market pulse",
    confirmAsk: (i) => `Someone, hopefully you, asked us to email this address once a month with the core keywords our scanner checks ${i} resumes for.`,
    confirmNothing: "Nothing is sent unless you confirm.",
    confirmButton: "Confirm the monthly pulse",
    confirmExpiry: "The link works once and expires in 7 days. If this wasn't you, ignore this email: without a click, this address gets no market pulse.",
    tagline: "Market pulse",
    headline: (i) => `The core keywords our scanner checks ${i} resumes for.`,
    curated: (i) => `From our curated ${i} keyword list, not a count of this month's postings.`,
    progressTitle: "Your progress",
    progressAcross: (n) => `Across your last ${n} scans:`,
    trendUp: " — keep going.",
    trendFlat: " — a fresh scan could move it.",
    trendDown: " — worth a fresh look at the fix plan.",
    coreKeywords: "Core keywords",
    oftenExpected: "Often expected",
    lastScan: (s) => `Your last scan scored <b>${s}/100</b>. `,
    freshScan: "A fresh scan against a posting you want takes about 60 seconds and is free.",
    rescanButton: "Rescan my resume free",
    confirmedOn: (d) => `You confirmed this monthly pulse${d ? ` on ${d}` : ""} by clicking the link we emailed you.`,
    unsubscribe: "Unsubscribe",
    noLogin: "— no login needed.",
    subject: (i) => `Your ${i} market pulse: the keywords to check your resume for`,
  },
  "en-GB": {
    confirmSubject: "Confirm your monthly market pulse",
    confirmHeading: "Confirm your monthly market pulse",
    confirmAsk: (i) => `Someone, hopefully you, asked us to email this address once a month with the core keywords our scanner checks ${i} CVs for.`,
    confirmNothing: "Nothing is sent unless you confirm.",
    confirmButton: "Confirm the monthly pulse",
    confirmExpiry: "The link works once and expires in 7 days. If this wasn't you, ignore this email: without a click, this address gets no market pulse.",
    tagline: "Market pulse",
    headline: (i) => `The core keywords our scanner checks ${i} CVs for.`,
    curated: (i) => `From our curated ${i} keyword list, not a count of this month's postings.`,
    progressTitle: "Your progress",
    progressAcross: (n) => `Across your last ${n} scans:`,
    trendUp: " — keep going.",
    trendFlat: " — a fresh scan could move it.",
    trendDown: " — worth a fresh look at the fix plan.",
    coreKeywords: "Core keywords",
    oftenExpected: "Often expected",
    lastScan: (s) => `Your last scan scored <b>${s}/100</b>. `,
    freshScan: "A fresh scan against a job advert you want takes about 60 seconds and is free.",
    rescanButton: "Rescan my CV free",
    confirmedOn: (d) => `You confirmed this monthly pulse${d ? ` on ${d}` : ""} by clicking the link we emailed you.`,
    unsubscribe: "Unsubscribe",
    noLogin: "— no login needed.",
    subject: (i) => `Your ${i} market pulse: the keywords to check your CV for`,
  },
  de: {
    confirmSubject: "Bestätigen Sie Ihren monatlichen Markt-Puls",
    confirmHeading: "Bestätigen Sie Ihren monatlichen Markt-Puls",
    confirmAsk: (i) => `Jemand, hoffentlich Sie, hat uns gebeten, dieser Adresse einmal im Monat die zentralen Keywords zu schicken, auf die unser Scanner Lebensläufe im Bereich ${i} prüft.`,
    confirmNothing: "Ohne Ihre Bestätigung wird nichts gesendet.",
    confirmButton: "Monatlichen Puls bestätigen",
    confirmExpiry: "Der Link funktioniert einmal und läuft nach 7 Tagen ab. Wenn Sie das nicht waren, ignorieren Sie diese E-Mail: Ohne Klick erhält diese Adresse keinen Markt-Puls.",
    tagline: "Markt-Puls",
    headline: (i) => `Die zentralen Keywords, auf die unser Scanner Lebensläufe im Bereich ${i} prüft.`,
    curated: (i) => `Aus unserer kuratierten Keyword-Liste für ${i}, keine Zählung der Stellenanzeigen dieses Monats.`,
    progressTitle: "Ihr Fortschritt",
    progressAcross: (n) => `Über Ihre letzten ${n} Scans:`,
    trendUp: " — weiter so.",
    trendFlat: " — ein neuer Scan könnte etwas bewegen.",
    trendDown: " — ein neuer Blick auf den Verbesserungsplan lohnt sich.",
    coreKeywords: "Zentrale Keywords",
    oftenExpected: "Oft erwartet",
    lastScan: (s) => `Ihr letzter Scan erreichte <b>${s}/100</b>. `,
    freshScan: "Ein neuer Scan gegen eine Stellenanzeige, die Sie interessiert, dauert etwa 60 Sekunden und ist kostenlos.",
    rescanButton: "Lebenslauf kostenlos neu scannen",
    confirmedOn: (d) => `Sie haben diesen monatlichen Puls${d ? ` am ${d}` : ""} über den Link bestätigt, den wir Ihnen gemailt haben.`,
    unsubscribe: "Abbestellen",
    noLogin: "— ohne Anmeldung.",
    subject: (i) => `Ihr Markt-Puls für ${i}: die Keywords, auf die Sie Ihren Lebenslauf prüfen sollten`,
  },
  es: {
    confirmSubject: "Confirma tu pulso mensual del mercado",
    confirmHeading: "Confirma tu pulso mensual del mercado",
    confirmAsk: (i) => `Alguien, esperamos que tú, nos pidió enviar a esta dirección, una vez al mes, las palabras clave principales que nuestro escáner revisa en los currículums de ${i}.`,
    confirmNothing: "No se envía nada si no confirmas.",
    confirmButton: "Confirmar el pulso mensual",
    confirmExpiry: "El enlace funciona una sola vez y caduca en 7 días. Si no fuiste tú, ignora este correo: sin un clic, esta dirección no recibe ningún pulso del mercado.",
    tagline: "Pulso del mercado",
    headline: (i) => `Las palabras clave principales que nuestro escáner revisa en los currículums de ${i}.`,
    curated: (i) => `De nuestra lista seleccionada de palabras clave de ${i}, no un recuento de las ofertas de este mes.`,
    progressTitle: "Tu progreso",
    progressAcross: (n) => `En tus últimos ${n} escaneos:`,
    trendUp: " — sigue así.",
    trendFlat: " — un nuevo escaneo podría moverlo.",
    trendDown: " — vale la pena revisar de nuevo el plan de mejoras.",
    coreKeywords: "Palabras clave principales",
    oftenExpected: "Esperadas a menudo",
    lastScan: (s) => `Tu último escaneo obtuvo <b>${s}/100</b>. `,
    freshScan: "Un nuevo escaneo contra una oferta que te interese tarda unos 60 segundos y es gratis.",
    rescanButton: "Volver a escanear mi currículum gratis",
    confirmedOn: (d) => `Confirmaste este pulso mensual${d ? ` el ${d}` : ""} con el enlace que te enviamos por correo.`,
    unsubscribe: "Darse de baja",
    noLogin: "— sin iniciar sesión.",
    subject: (i) => `Tu pulso del mercado de ${i}: las palabras clave que debe tener tu currículum`,
  },
  fr: {
    confirmSubject: "Confirmez votre pouls mensuel du marché",
    confirmHeading: "Confirmez votre pouls mensuel du marché",
    confirmAsk: (i) => `Quelqu'un, vous nous l'espérons, nous a demandé d'envoyer à cette adresse, une fois par mois, les mots-clés essentiels que notre scanner vérifie dans les CV du domaine ${i}.`,
    confirmNothing: "Rien n'est envoyé sans votre confirmation.",
    confirmButton: "Confirmer le pouls mensuel",
    confirmExpiry: "Le lien fonctionne une seule fois et expire dans 7 jours. Si ce n'était pas vous, ignorez cet e-mail : sans clic, cette adresse ne reçoit aucun pouls du marché.",
    tagline: "Pouls du marché",
    headline: (i) => `Les mots-clés essentiels que notre scanner vérifie dans les CV du domaine ${i}.`,
    curated: (i) => `Tirés de notre liste de mots-clés sélectionnés pour le domaine ${i}, et non d'un décompte des offres de ce mois.`,
    progressTitle: "Votre progression",
    progressAcross: (n) => `Sur vos ${n} derniers scans :`,
    trendUp: " — continuez.",
    trendFlat: " — un nouveau scan pourrait le faire bouger.",
    trendDown: " — le plan de corrections mérite un nouveau coup d'œil.",
    coreKeywords: "Mots-clés essentiels",
    oftenExpected: "Souvent attendus",
    lastScan: (s) => `Votre dernier scan a obtenu <b>${s}/100</b>. `,
    freshScan: "Un nouveau scan face à une offre qui vous intéresse prend environ 60 secondes et est gratuit.",
    rescanButton: "Rescanner mon CV gratuitement",
    confirmedOn: (d) => `Vous avez confirmé ce pouls mensuel${d ? ` le ${d}` : ""} en cliquant sur le lien que nous vous avons envoyé.`,
    unsubscribe: "Se désabonner",
    noLogin: "— sans connexion.",
    subject: (i) => `Votre pouls du marché ${i} : les mots-clés à vérifier dans votre CV`,
  },
  hi: {
    confirmSubject: "अपने मासिक मार्केट पल्स की पुष्टि करें",
    confirmHeading: "अपने मासिक मार्केट पल्स की पुष्टि करें",
    confirmAsk: (i) => `किसी ने, उम्मीद है आपने, हमसे कहा कि इस पते पर महीने में एक बार वे मुख्य कीवर्ड्स भेजें जिन्हें हमारा स्कैनर ${i} रिज़्यूमे में जाँचता है।`,
    confirmNothing: "आपकी पुष्टि के बिना कुछ नहीं भेजा जाता।",
    confirmButton: "मासिक पल्स की पुष्टि करें",
    confirmExpiry: "यह लिंक एक बार काम करता है और 7 दिनों में समाप्त हो जाता है। अगर यह आप नहीं थे, तो इस ईमेल को अनदेखा करें: बिना क्लिक के इस पते पर कोई मार्केट पल्स नहीं आएगा।",
    tagline: "मार्केट पल्स",
    headline: (i) => `वे मुख्य कीवर्ड्स जिन्हें हमारा स्कैनर ${i} रिज़्यूमे में जाँचता है।`,
    curated: (i) => `हमारी चुनी हुई ${i} कीवर्ड सूची से, इस महीने की पोस्टिंग की गिनती नहीं।`,
    progressTitle: "आपकी प्रगति",
    progressAcross: (n) => `आपके पिछले ${n} स्कैन में:`,
    trendUp: " — ऐसे ही जारी रखें।",
    trendFlat: " — एक नया स्कैन इसे बदल सकता है।",
    trendDown: " — सुधार योजना पर एक नई नज़र डालना ठीक रहेगा।",
    coreKeywords: "मुख्य कीवर्ड्स",
    oftenExpected: "अक्सर अपेक्षित",
    lastScan: (s) => `आपके पिछले स्कैन का स्कोर <b>${s}/100</b> था। `,
    freshScan: "आपकी पसंद की किसी पोस्टिंग के सामने नया स्कैन लगभग 60 सेकंड लेता है और मुफ़्त है।",
    rescanButton: "मेरा रिज़्यूमे मुफ़्त में फिर से स्कैन करें",
    confirmedOn: (d) => `आपने${d ? ` ${d} को` : ""} हमारे भेजे लिंक पर क्लिक करके इस मासिक पल्स की पुष्टि की थी।`,
    unsubscribe: "अनसब्सक्राइब करें",
    noLogin: "— लॉगिन की ज़रूरत नहीं।",
    subject: (i) => `आपका ${i} मार्केट पल्स: वे कीवर्ड्स जिन पर अपना रिज़्यूमे जाँचें`,
  },
  nl: {
    confirmSubject: "Bevestig je maandelijkse marktpuls",
    confirmHeading: "Bevestig je maandelijkse marktpuls",
    confirmAsk: (i) => `Iemand, hopelijk jij, vroeg ons dit adres één keer per maand de belangrijkste trefwoorden te mailen waarop onze scanner cv's in ${i} controleert.`,
    confirmNothing: "Er wordt niets verstuurd tenzij je bevestigt.",
    confirmButton: "Maandelijkse puls bevestigen",
    confirmExpiry: "De link werkt één keer en verloopt na 7 dagen. Was jij dit niet? Negeer deze e-mail dan: zonder klik krijgt dit adres geen marktpuls.",
    tagline: "Marktpuls",
    headline: (i) => `De belangrijkste trefwoorden waarop onze scanner cv's in ${i} controleert.`,
    curated: (i) => `Uit onze samengestelde trefwoordenlijst voor ${i}, geen telling van de vacatures van deze maand.`,
    progressTitle: "Je voortgang",
    progressAcross: (n) => `Over je laatste ${n} scans:`,
    trendUp: " — ga zo door.",
    trendFlat: " — een nieuwe scan kan het in beweging brengen.",
    trendDown: " — het verbeterplan is een nieuwe blik waard.",
    coreKeywords: "Belangrijkste trefwoorden",
    oftenExpected: "Vaak verwacht",
    lastScan: (s) => `Je laatste scan scoorde <b>${s}/100</b>. `,
    freshScan: "Een nieuwe scan tegen een vacature die je wilt, duurt ongeveer 60 seconden en is gratis.",
    rescanButton: "Mijn cv gratis opnieuw scannen",
    confirmedOn: (d) => `Je hebt deze maandelijkse puls${d ? ` op ${d}` : ""} bevestigd via de link die we je mailden.`,
    unsubscribe: "Afmelden",
    noLogin: "— zonder in te loggen.",
    subject: (i) => `Je marktpuls voor ${i}: de trefwoorden om je cv op te controleren`,
  },
  pt: {
    confirmSubject: "Confirme seu pulso mensal do mercado",
    confirmHeading: "Confirme seu pulso mensal do mercado",
    confirmAsk: (i) => `Alguém, esperamos que você, nos pediu para enviar a este endereço, uma vez por mês, as principais palavras-chave que nosso scanner verifica em currículos de ${i}.`,
    confirmNothing: "Nada é enviado sem a sua confirmação.",
    confirmButton: "Confirmar o pulso mensal",
    confirmExpiry: "O link funciona uma vez e expira em 7 dias. Se não foi você, ignore este e-mail: sem um clique, este endereço não recebe nenhum pulso do mercado.",
    tagline: "Pulso do mercado",
    headline: (i) => `As principais palavras-chave que nosso scanner verifica em currículos de ${i}.`,
    curated: (i) => `Da nossa lista selecionada de palavras-chave de ${i}, não uma contagem das vagas deste mês.`,
    progressTitle: "Seu progresso",
    progressAcross: (n) => `Nos seus últimos ${n} escaneamentos:`,
    trendUp: " — continue assim.",
    trendFlat: " — um novo escaneamento pode mudar isso.",
    trendDown: " — vale dar uma nova olhada no plano de correções.",
    coreKeywords: "Principais palavras-chave",
    oftenExpected: "Frequentemente esperadas",
    lastScan: (s) => `Seu último escaneamento marcou <b>${s}/100</b>. `,
    freshScan: "Um novo escaneamento contra uma vaga que você quer leva cerca de 60 segundos e é grátis.",
    rescanButton: "Escanear meu currículo de novo grátis",
    confirmedOn: (d) => `Você confirmou este pulso mensal${d ? ` em ${d}` : ""} clicando no link que enviamos por e-mail.`,
    unsubscribe: "Cancelar inscrição",
    noLogin: "— sem precisar entrar.",
    subject: (i) => `Seu pulso do mercado de ${i}: as palavras-chave para conferir no seu currículo`,
  },
  tl: {
    confirmSubject: "Kumpirmahin ang iyong buwanang market pulse",
    confirmHeading: "Kumpirmahin ang iyong buwanang market pulse",
    confirmAsk: (i) => `May humiling, sana ikaw, na i-email namin sa address na ito minsan isang buwan ang mga pangunahing keyword na sinusuri ng aming scanner sa mga resume sa ${i}.`,
    confirmNothing: "Walang ipapadala hangga't hindi mo kinukumpirma.",
    confirmButton: "Kumpirmahin ang buwanang pulse",
    confirmExpiry: "Isang beses lang gagana ang link at mag-e-expire ito sa loob ng 7 araw. Kung hindi ikaw ito, huwag pansinin ang email na ito: kung walang click, walang market pulse na matatanggap ang address na ito.",
    tagline: "Market pulse",
    headline: (i) => `Ang mga pangunahing keyword na sinusuri ng aming scanner sa mga resume sa ${i}.`,
    curated: (i) => `Mula sa aming piniling listahan ng keyword para sa ${i}, hindi bilang ng mga posting ngayong buwan.`,
    progressTitle: "Ang iyong progreso",
    progressAcross: (n) => `Sa huli mong ${n} scan:`,
    trendUp: " — ituloy mo lang.",
    trendFlat: " — baka maigalaw ito ng bagong scan.",
    trendDown: " — sulit na balikan ang fix plan.",
    coreKeywords: "Mga pangunahing keyword",
    oftenExpected: "Madalas hinahanap",
    lastScan: (s) => `Ang huli mong scan ay nakakuha ng <b>${s}/100</b>. `,
    freshScan: "Ang bagong scan laban sa posting na gusto mo ay tumatagal nang mga 60 segundo at libre.",
    rescanButton: "I-rescan nang libre ang resume ko",
    confirmedOn: (d) => `Kinumpirma mo ang buwanang pulse na ito${d ? ` noong ${d}` : ""} sa pag-click sa link na in-email namin sa iyo.`,
    unsubscribe: "Mag-unsubscribe",
    noLogin: "— hindi kailangang mag-log in.",
    subject: (i) => `Ang iyong ${i} market pulse: ang mga keyword na dapat suriin sa resume mo`,
  },
};
