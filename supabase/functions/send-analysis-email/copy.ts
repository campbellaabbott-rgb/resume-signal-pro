/**
 * THE FINISHED-ANALYSIS MAIL IN THE BUYER'S LANGUAGE (FA-1).
 *
 * The $5 analysis is written in the buyer's language since the paid-AI round
 * (analyze-resume/report-language.ts), but the mail that carries it went out
 * in English: a Spanish buyer on the Spanish site got a Spanish report under
 * an English heading, grade line, button and footer. The mail now speaks the
 * language the request names, else the one the checkout recorded for the
 * purchase (product_deliveries.metadata.language, written by stripe-webhook
 * from the session create-checkout opened in the page's language), else
 * English. en-GB is en, as in the purchase mail (send-product-email/copy.ts).
 *
 * Tone follows the site and the purchase mail: German, Spanish and Dutch
 * informal, French and Hindi formal, Brazilian Portuguese (você), Tagalog
 * (ikaw). "Resume Booster" stays a name in every language. The analysis
 * values (industry, keywords, the plan) are the report's own words and are
 * not translated here. Every language's link line names the same number of
 * days the success page states (SHARED_ANALYSIS_DAYS); the tests hold it.
 *
 * Import-free apart from the language list, so the Node tests import it.
 */
import { type CheckoutLanguage, checkoutLanguageOf } from "../_shared/checkout-policy.ts";

export type MailLanguage = CheckoutLanguage;

/** The language a value names (exact, then its base), else null. */
export function mailLanguageIn(language: unknown): MailLanguage | null {
  return checkoutLanguageOf({ language });
}

export type AnalysisMailCopy = {
  title: string;
  heading: string;
  thanks: string;
  scoreLabel: string;
  grade: { high: string; mid: string; low: string };
  industry: string;
  level: string;
  industryDefault: string;
  levelDefault: string;
  jobMatch: (score: number) => string;
  jobFit: { good: string; weak: string };
  actionPlan: string;
  issues: string;
  keywords: string;
  summary: string;
  open: string;
  /** How long the link works; names the success page's number of days. */
  link: string;
  /** Under the buyer's own link (the one that can delete the analysis). */
  ownerNote: string;
  questions: string;
  rights: (year: number) => string;
  subject: (score: number) => string;
};

const EN: AnalysisMailCopy = {
  title: "Your Resume Analysis Results",
  heading: "Your Resume Analysis is Ready!",
  thanks: "Thank you for using Resume Booster",
  scoreLabel: "ATS Compatibility Score",
  grade: {
    high: "Excellent! Your resume is well-optimized.",
    mid: "Good, but there's room for improvement.",
    low: "Needs work to pass ATS systems.",
  },
  industry: "Industry:",
  level: "Level:",
  industryDefault: "General",
  levelDefault: "Mid",
  jobMatch: (n) => `Job Match Score: ${n}%`,
  jobFit: {
    good: "Your resume aligns well for the target job description.",
    weak: "Your resume needs optimization for the target job description.",
  },
  actionPlan: "Your Action Plan",
  issues: "Issues to Fix",
  keywords: "Keywords to Add",
  summary: "Optimized Summary",
  open: "View Full Analysis →",
  link: "This link works for 90 days from the day your analysis was made. Open it and choose Save as PDF to keep your own copy.",
  ownerNote: "This link is your own: it opens the analysis with its delete button. To share the analysis, copy the share link on that page instead.",
  questions: "Questions? Just reply to this email.",
  rights: (y) => `© ${y} Resume Booster. All rights reserved.`,
  subject: (n) => `Your Resume Analysis is Ready! (ATS Score: ${n}/100)`,
};

const DE: AnalysisMailCopy = {
  title: "Die Ergebnisse deiner Lebenslauf-Analyse",
  heading: "Deine Lebenslauf-Analyse ist fertig!",
  thanks: "Danke, dass du Resume Booster nutzt",
  scoreLabel: "ATS-Kompatibilitätswert",
  grade: {
    high: "Ausgezeichnet! Dein Lebenslauf ist gut optimiert.",
    mid: "Gut, aber es gibt noch Luft nach oben.",
    low: "Muss überarbeitet werden, um ATS-Systeme zu bestehen.",
  },
  industry: "Branche:",
  level: "Erfahrungsstufe:",
  industryDefault: "Allgemein",
  levelDefault: "Mittel",
  jobMatch: (n) => `Übereinstimmung mit der Stelle: ${n} %`,
  jobFit: {
    good: "Dein Lebenslauf passt gut zur Stellenbeschreibung.",
    weak: "Dein Lebenslauf sollte für die Stellenbeschreibung optimiert werden.",
  },
  actionPlan: "Dein Aktionsplan",
  issues: "Zu behebende Probleme",
  keywords: "Hinzuzufügende Keywords",
  summary: "Optimierte Zusammenfassung",
  open: "Vollständige Analyse ansehen →",
  link: "Dieser Link funktioniert 90 Tage ab dem Tag, an dem deine Analyse erstellt wurde. Öffne ihn und wähle „Als PDF speichern“, um eine eigene Kopie zu behalten.",
  ownerNote: "Dieser Link gehört dir: Er öffnet die Analyse mit ihrer Schaltfläche zum Löschen. Wenn du die Analyse teilen möchtest, kopiere stattdessen den Freigabelink auf dieser Seite.",
  questions: "Fragen? Antworte einfach auf diese E-Mail.",
  rights: (y) => `© ${y} Resume Booster. Alle Rechte vorbehalten.`,
  subject: (n) => `Deine Lebenslauf-Analyse ist fertig! (ATS-Wert: ${n}/100)`,
};

const ES: AnalysisMailCopy = {
  title: "Resultados de tu análisis de currículum",
  heading: "¡Tu análisis de currículum está listo!",
  thanks: "Gracias por usar Resume Booster",
  scoreLabel: "Puntuación de compatibilidad ATS",
  grade: {
    high: "¡Excelente! Tu currículum está bien optimizado.",
    mid: "Bien, pero hay margen de mejora.",
    low: "Necesita trabajo para superar los sistemas ATS.",
  },
  industry: "Sector:",
  level: "Nivel:",
  industryDefault: "General",
  levelDefault: "Intermedio",
  jobMatch: (n) => `Coincidencia con la oferta: ${n} %`,
  jobFit: {
    good: "Tu currículum encaja bien con la descripción del puesto.",
    weak: "Tu currículum necesita optimizarse para la descripción del puesto.",
  },
  actionPlan: "Tu plan de acción",
  issues: "Problemas que corregir",
  keywords: "Palabras clave que añadir",
  summary: "Resumen optimizado",
  open: "Ver el análisis completo →",
  link: "Este enlace funciona durante 90 días desde el día en que se hizo tu análisis. Ábrelo y elige Guardar como PDF para conservar tu propia copia.",
  ownerNote: "Este enlace es solo tuyo: abre el análisis con su botón para borrarlo. Para compartir el análisis, copia en su lugar el enlace para compartir de esa página.",
  questions: "¿Preguntas? Responde a este correo.",
  rights: (y) => `© ${y} Resume Booster. Todos los derechos reservados.`,
  subject: (n) => `¡Tu análisis de currículum está listo! (Puntuación ATS: ${n}/100)`,
};

const FR: AnalysisMailCopy = {
  title: "Les résultats de votre analyse de CV",
  heading: "Votre analyse de CV est prête !",
  thanks: "Merci d'utiliser Resume Booster",
  scoreLabel: "Score de compatibilité ATS",
  grade: {
    high: "Excellent ! Votre CV est bien optimisé.",
    mid: "Bien, mais il reste une marge de progression.",
    low: "Des améliorations sont nécessaires pour passer les systèmes ATS.",
  },
  industry: "Secteur :",
  level: "Niveau :",
  industryDefault: "Général",
  levelDefault: "Intermédiaire",
  jobMatch: (n) => `Correspondance avec l'offre : ${n} %`,
  jobFit: {
    good: "Votre CV correspond bien à la description du poste.",
    weak: "Votre CV doit être optimisé pour la description du poste.",
  },
  actionPlan: "Votre plan d'action",
  issues: "Problèmes à corriger",
  keywords: "Mots-clés à ajouter",
  summary: "Résumé optimisé",
  open: "Voir l'analyse complète →",
  link: "Ce lien fonctionne pendant 90 jours à compter du jour où votre analyse a été réalisée. Ouvrez-le et choisissez Enregistrer au format PDF pour garder votre propre copie.",
  ownerNote: "Ce lien vous est personnel : il ouvre l'analyse avec son bouton de suppression. Pour partager l'analyse, copiez plutôt le lien de partage sur cette page.",
  questions: "Des questions ? Répondez simplement à cet e-mail.",
  rights: (y) => `© ${y} Resume Booster. Tous droits réservés.`,
  subject: (n) => `Votre analyse de CV est prête ! (Score ATS : ${n}/100)`,
};

const HI: AnalysisMailCopy = {
  title: "आपके रिज़्यूमे विश्लेषण के नतीजे",
  heading: "आपका रिज़्यूमे विश्लेषण तैयार है!",
  thanks: "Resume Booster इस्तेमाल करने के लिए धन्यवाद",
  scoreLabel: "ATS संगतता स्कोर",
  grade: {
    high: "बहुत बढ़िया! आपका रिज़्यूमे अच्छी तरह ऑप्टिमाइज़ है।",
    mid: "अच्छा है, लेकिन सुधार की गुंजाइश है।",
    low: "ATS सिस्टम पार करने के लिए इस पर काम करने की ज़रूरत है।",
  },
  industry: "उद्योग:",
  level: "स्तर:",
  industryDefault: "सामान्य",
  levelDefault: "मध्यम",
  jobMatch: (n) => `जॉब मैच स्कोर: ${n}%`,
  jobFit: {
    good: "आपका रिज़्यूमे लक्षित जॉब विवरण से अच्छी तरह मेल खाता है।",
    weak: "लक्षित जॉब विवरण के लिए आपके रिज़्यूमे को ऑप्टिमाइज़ करने की ज़रूरत है।",
  },
  actionPlan: "आपकी कार्य योजना",
  issues: "ठीक करने वाली समस्याएँ",
  keywords: "जोड़ने के लिए कीवर्ड",
  summary: "ऑप्टिमाइज़ किया गया सारांश",
  open: "पूरा विश्लेषण देखें →",
  link: "यह लिंक आपका विश्लेषण बनने के दिन से 90 दिन तक काम करता है। इसे खोलें और अपनी कॉपी रखने के लिए \"PDF के रूप में सहेजें\" चुनें।",
  ownerNote: "यह लिंक सिर्फ़ आपके लिए है: यह विश्लेषण को उसे हटाने वाले बटन के साथ खोलता है। विश्लेषण साझा करने के लिए, इसके बजाय उस पेज से शेयर लिंक कॉपी करें।",
  questions: "कोई सवाल? बस इस ईमेल का जवाब दें।",
  rights: (y) => `© ${y} Resume Booster. सर्वाधिकार सुरक्षित।`,
  subject: (n) => `आपका रिज़्यूमे विश्लेषण तैयार है! (ATS स्कोर: ${n}/100)`,
};

const NL: AnalysisMailCopy = {
  title: "De resultaten van je cv-analyse",
  heading: "Je cv-analyse is klaar!",
  thanks: "Bedankt dat je Resume Booster gebruikt",
  scoreLabel: "ATS-compatibiliteitsscore",
  grade: {
    high: "Uitstekend! Je cv is goed geoptimaliseerd.",
    mid: "Goed, maar er is ruimte voor verbetering.",
    low: "Er is werk nodig om door ATS-systemen te komen.",
  },
  industry: "Sector:",
  level: "Niveau:",
  industryDefault: "Algemeen",
  levelDefault: "Medior",
  jobMatch: (n) => `Match met de vacature: ${n}%`,
  jobFit: {
    good: "Je cv sluit goed aan op de vacaturetekst.",
    weak: "Je cv moet worden geoptimaliseerd voor de vacaturetekst.",
  },
  actionPlan: "Je actieplan",
  issues: "Op te lossen problemen",
  keywords: "Toe te voegen trefwoorden",
  summary: "Geoptimaliseerde samenvatting",
  open: "Bekijk de volledige analyse →",
  link: "Deze link werkt 90 dagen vanaf de dag waarop je analyse is gemaakt. Open hem en kies Opslaan als pdf om je eigen kopie te houden.",
  ownerNote: "Deze link is alleen voor jou: hij opent de analyse met de knop om hem te verwijderen. Wil je de analyse delen, kopieer dan de deellink op die pagina.",
  questions: "Vragen? Beantwoord gewoon deze e-mail.",
  rights: (y) => `© ${y} Resume Booster. Alle rechten voorbehouden.`,
  subject: (n) => `Je cv-analyse is klaar! (ATS-score: ${n}/100)`,
};

const PT: AnalysisMailCopy = {
  title: "Resultados da sua análise de currículo",
  heading: "Sua análise de currículo está pronta!",
  thanks: "Obrigado por usar o Resume Booster",
  scoreLabel: "Pontuação de compatibilidade com ATS",
  grade: {
    high: "Excelente! Seu currículo está bem otimizado.",
    mid: "Bom, mas ainda há espaço para melhorar.",
    low: "Precisa de ajustes para passar pelos sistemas ATS.",
  },
  industry: "Setor:",
  level: "Nível:",
  industryDefault: "Geral",
  levelDefault: "Pleno",
  jobMatch: (n) => `Compatibilidade com a vaga: ${n}%`,
  jobFit: {
    good: "Seu currículo está bem alinhado com a descrição da vaga.",
    weak: "Seu currículo precisa ser otimizado para a descrição da vaga.",
  },
  actionPlan: "Seu plano de ação",
  issues: "Problemas a corrigir",
  keywords: "Palavras-chave para adicionar",
  summary: "Resumo otimizado",
  open: "Ver a análise completa →",
  link: "Este link funciona por 90 dias a partir do dia em que sua análise foi feita. Abra-o e escolha Salvar como PDF para guardar sua própria cópia.",
  ownerNote: "Este link é só seu: ele abre a análise com o botão para excluí-la. Para compartilhar a análise, copie o link de compartilhamento dessa página.",
  questions: "Dúvidas? É só responder a este e-mail.",
  rights: (y) => `© ${y} Resume Booster. Todos os direitos reservados.`,
  subject: (n) => `Sua análise de currículo está pronta! (Pontuação ATS: ${n}/100)`,
};

const TL: AnalysisMailCopy = {
  title: "Mga resulta ng pagsusuri ng iyong résumé",
  heading: "Handa na ang pagsusuri ng iyong résumé!",
  thanks: "Salamat sa paggamit ng Resume Booster",
  scoreLabel: "Iskor ng ATS compatibility",
  grade: {
    high: "Napakahusay! Maayos na naka-optimize ang iyong résumé.",
    mid: "Maganda, pero may puwang pa para gumanda.",
    low: "Kailangan pa itong ayusin para makapasa sa mga ATS system.",
  },
  industry: "Industriya:",
  level: "Antas:",
  industryDefault: "Pangkalahatan",
  levelDefault: "Katamtaman",
  jobMatch: (n) => `Tugma sa trabaho: ${n}%`,
  jobFit: {
    good: "Bagay na bagay ang iyong résumé sa job description.",
    weak: "Kailangang i-optimize ang iyong résumé para sa job description.",
  },
  actionPlan: "Ang iyong action plan",
  issues: "Mga isyung aayusin",
  keywords: "Mga keyword na idadagdag",
  summary: "Na-optimize na summary",
  open: "Tingnan ang buong pagsusuri →",
  link: "Gumagana ang link na ito nang 90 araw mula sa araw na ginawa ang iyong pagsusuri. Buksan ito at piliin ang Save as PDF para magtabi ng sarili mong kopya.",
  ownerNote: "Para sa iyo lang ang link na ito: binubuksan nito ang pagsusuri kasama ang button para burahin ito. Para ibahagi ang pagsusuri, kopyahin na lang ang share link sa pahinang iyon.",
  questions: "May tanong? Sumagot lang sa email na ito.",
  rights: (y) => `© ${y} Resume Booster. Nakalaan ang lahat ng karapatan.`,
  subject: (n) => `Handa na ang pagsusuri ng iyong résumé! (ATS score: ${n}/100)`,
};

export const ANALYSIS_MAIL_COPY: Readonly<Record<MailLanguage, AnalysisMailCopy>> = {
  en: EN,
  "en-GB": EN,
  de: DE,
  es: ES,
  fr: FR,
  hi: HI,
  nl: NL,
  pt: PT,
  tl: TL,
};
