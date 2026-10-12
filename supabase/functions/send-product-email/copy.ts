/**
 * THE PURCHASE MAIL IN THE BUYER'S LANGUAGE (S12-114).
 *
 * Every delivery mail went out in English whatever language the buyer bought
 * in. The products still sold that this mail serves (the Full Resume Analysis
 * and the two Freelance Boost tiers: their mail is the link back to the page
 * that makes them), the mail that asks a buyer for what an order is missing,
 * and the mail that says a delayed payment failed are written here in the
 * site's nine languages (checkout-policy.ts CHECKOUT_LANGUAGES). en-GB is en,
 * as everywhere on the site. The products no longer sold keep their English
 * mail: only a past buyer's saved copy is ever mailed for them.
 *
 * Tone follows the site: German, Spanish and Dutch informal, French and Hindi
 * formal, Brazilian Portuguese (você), Tagalog (ikaw). "Freelance Boost" stays
 * a name in every language, as on the site.
 *
 * Import-free apart from the language list, so the Node tests import it.
 */
import { type CheckoutLanguage, checkoutLanguageOf } from "../_shared/checkout-policy.ts";

export type MailLanguage = CheckoutLanguage;

/** The language a request names (exact, then its base), else English. */
export function mailLanguageOf(language: unknown): MailLanguage {
  return checkoutLanguageOf({ language }) ?? "en";
}

export type Shell = {
  thanks: string;
  howItWorks: string;
  nextSteps: string;
  open: string;
  keep: string;
  questions: string;
  brand: string;
  subjectOpen: (name: string) => string;
};

export type KeptProduct = "full_analysis" | "freelance_boost" | "freelance_transition_pro";
export const KEPT_PRODUCTS: readonly KeptProduct[] = ["full_analysis", "freelance_boost", "freelance_transition_pro"];

export type ProductCopy = { name: string; tagline: string; howItWorks: string[]; nextSteps: string[] };

export type NeedsReason = "job_posting_required" | "resume_missing" | "resume_expired";
export const NEEDS_REASONS: readonly NeedsReason[] = ["job_posting_required", "resume_missing", "resume_expired"];

export type NeedsCopy = {
  subject: (name: string) => string;
  lead: Record<NeedsReason, (name: string) => string>;
  action: { job: string; resume: string };
};

export type FailedCopy = { subject: (name: string) => string; body: string; action: string; button: string };

type Lines = { shell: Shell; kept: Record<KeptProduct, ProductCopy>; needs: NeedsCopy; failed: FailedCopy };

const EN: Lines = {
  shell: {
    thanks: "Thank You for Your Purchase!",
    howItWorks: "How It Works",
    nextSteps: "Your Next Steps",
    open: "Open your purchase →",
    keep: "Keep this email: the button opens your purchase on any device, and the recovery form on that page accepts this reference. Order reference (session ID):",
    questions: "Questions? Reply to this email or contact support.",
    brand: "Resume Booster - Land your dream job with an ATS-optimized resume",
    subjectOpen: (name) => `Your ${name}: open your purchase`,
  },
  kept: {
    full_analysis: {
      name: "Full Resume Analysis",
      tagline: "Your Full Resume Analysis is paid for. It runs on the page the button below opens",
      howItWorks: [
        "Your analysis runs on the page Checkout returned you to",
        "If that page closed before the analysis finished, the button below opens it again",
        "On a device that does not hold your resume, the page asks you to upload it; you won't be charged again",
        "When the analysis is ready, we email you a link to the finished report",
      ],
      nextSteps: [
        "Open your analysis with the button below",
        "Upload your resume if the page asks for it",
        "Read your score breakdown and the fixes it lists",
        "Keep the report email: its link opens the finished analysis on any device",
      ],
    },
    freelance_boost: {
      name: "Freelance Boost",
      tagline: "Your Freelance Boost purchase is saved to the link below",
      howItWorks: [
        "Open the link below and check your intake answers: who each project was for and what you delivered",
        "Press Generate to build your experience section; you won't be charged again",
        "Once your section is generated, the same link shows it again on any device",
      ],
      nextSteps: [
        "Open your purchase with the button below",
        "Fill in or check your intake answers",
        "Generate your experience section",
        "Copy it into your resume",
      ],
    },
    freelance_transition_pro: {
      name: "Freelance Boost — Transition Pro",
      tagline: "Your Freelance Boost Transition Pro purchase is saved to the link below",
      howItWorks: [
        "Open the link below and check your intake answers: who each project was for and what you delivered",
        "Press Generate to build your experience section, transition cover letter and LinkedIn About; you won't be charged again",
        "Once they are generated, the same link shows them again on any device",
      ],
      nextSteps: [
        "Open your purchase with the button below",
        "Fill in or check your intake answers",
        "Generate your section, cover letter and LinkedIn About",
        "Copy them into your application",
      ],
    },
  },
  needs: {
    subject: (name) => `${name}: we need one more thing from you`,
    lead: {
      job_posting_required: (name) => `${name} is made for one job posting, and none was attached to your purchase, so we could not make it automatically.`,
      resume_missing: (name) => `No résumé was attached to your purchase (${name}), so we could not make it automatically.`,
      resume_expired: (name) => `The résumé for your purchase (${name}) is no longer stored (we keep résumés for 24 hours), so we could not make it automatically.`,
    },
    action: {
      job: "Reply to this email with the job posting (the link or the text) and we will make it and send it to you. You will not be charged again.",
      resume: "Reply to this email with your résumé (and the job posting, if you bought this for one) and we will make it and send it to you. You will not be charged again.",
    },
  },
  failed: {
    subject: (name) => `Your payment for ${name} did not go through`,
    body: "Your bank did not complete the payment, so nothing was charged and nothing was delivered.",
    action: "You can try again with another payment method.",
    button: "Try again",
  },
};

const DE: Lines = {
  shell: {
    thanks: "Danke für deinen Kauf!",
    howItWorks: "So funktioniert es",
    nextSteps: "Deine nächsten Schritte",
    open: "Kauf öffnen →",
    keep: "Bewahre diese E-Mail auf: Der Button öffnet deinen Kauf auf jedem Gerät, und das Wiederherstellungsformular auf dieser Seite akzeptiert diese Referenz. Bestellreferenz (Session-ID):",
    questions: "Fragen? Antworte einfach auf diese E-Mail oder kontaktiere den Support.",
    brand: "Resume Booster – mit einem ATS-optimierten Lebenslauf zum Traumjob",
    subjectOpen: (name) => `${name}: Kauf öffnen`,
  },
  kept: {
    full_analysis: {
      name: "Vollständige Lebenslauf-Analyse",
      tagline: "Deine vollständige Lebenslauf-Analyse ist bezahlt. Sie läuft auf der Seite, die der Button unten öffnet",
      howItWorks: [
        "Deine Analyse läuft auf der Seite, zu der dich der Checkout zurückgeleitet hat",
        "Wurde diese Seite geschlossen, bevor die Analyse fertig war, öffnet der Button unten sie erneut",
        "Auf einem Gerät, das deinen Lebenslauf nicht hat, bittet dich die Seite, ihn hochzuladen; es wird dir nichts erneut berechnet",
        "Sobald die Analyse fertig ist, schicken wir dir per E-Mail einen Link zum fertigen Bericht",
      ],
      nextSteps: [
        "Öffne deine Analyse mit dem Button unten",
        "Lade deinen Lebenslauf hoch, wenn die Seite danach fragt",
        "Lies deine Punkteaufschlüsselung und die genannten Verbesserungen",
        "Bewahre die Bericht-E-Mail auf: Ihr Link öffnet die fertige Analyse auf jedem Gerät",
      ],
    },
    freelance_boost: {
      name: "Freelance Boost",
      tagline: "Dein Freelance-Boost-Kauf ist unter dem Link unten gespeichert",
      howItWorks: [
        "Öffne den Link unten und prüfe deine Angaben: für wen jedes Projekt war und was du geliefert hast",
        "Starte die Erstellung deines Erfahrungsabschnitts; es wird dir nichts erneut berechnet",
        "Sobald dein Abschnitt erstellt ist, zeigt ihn derselbe Link auf jedem Gerät wieder an",
      ],
      nextSteps: [
        "Öffne deinen Kauf mit dem Button unten",
        "Fülle deine Angaben aus oder prüfe sie",
        "Erstelle deinen Erfahrungsabschnitt",
        "Kopiere ihn in deinen Lebenslauf",
      ],
    },
    freelance_transition_pro: {
      name: "Freelance Boost — Transition Pro",
      tagline: "Dein Kauf von Freelance Boost Transition Pro ist unter dem Link unten gespeichert",
      howItWorks: [
        "Öffne den Link unten und prüfe deine Angaben: für wen jedes Projekt war und was du geliefert hast",
        "Starte die Erstellung deines Erfahrungsabschnitts, deines Anschreibens für den Wechsel und deines LinkedIn-Infotexts; es wird dir nichts erneut berechnet",
        "Sobald sie erstellt sind, zeigt sie derselbe Link auf jedem Gerät wieder an",
      ],
      nextSteps: [
        "Öffne deinen Kauf mit dem Button unten",
        "Fülle deine Angaben aus oder prüfe sie",
        "Erstelle deinen Abschnitt, dein Anschreiben und deinen LinkedIn-Infotext",
        "Kopiere sie in deine Bewerbung",
      ],
    },
  },
  needs: {
    subject: (name) => `${name}: Wir brauchen noch etwas von dir`,
    lead: {
      job_posting_required: (name) => `${name} wird für eine bestimmte Stellenanzeige erstellt, und deinem Kauf war keine beigefügt. Deshalb konnten wir es nicht automatisch erstellen.`,
      resume_missing: (name) => `Deinem Kauf (${name}) war kein Lebenslauf beigefügt. Deshalb konnten wir das Ergebnis nicht automatisch erstellen.`,
      resume_expired: (name) => `Der Lebenslauf zu deinem Kauf (${name}) ist nicht mehr gespeichert (wir bewahren Lebensläufe 24 Stunden auf). Deshalb konnten wir das Ergebnis nicht automatisch erstellen.`,
    },
    action: {
      job: "Antworte auf diese E-Mail mit der Stellenanzeige (Link oder Text), dann erstellen wir es und schicken es dir. Es wird dir nichts erneut berechnet.",
      resume: "Antworte auf diese E-Mail mit deinem Lebenslauf (und der Stellenanzeige, falls du für eine bestimmte Stelle gekauft hast), dann erstellen wir es und schicken es dir. Es wird dir nichts erneut berechnet.",
    },
  },
  failed: {
    subject: (name) => `Deine Zahlung für ${name} wurde nicht abgeschlossen`,
    body: "Deine Bank hat die Zahlung nicht abgeschlossen. Es wurde nichts berechnet und nichts geliefert.",
    action: "Du kannst es mit einer anderen Zahlungsart erneut versuchen.",
    button: "Erneut versuchen",
  },
};

const ES: Lines = {
  shell: {
    thanks: "¡Gracias por tu compra!",
    howItWorks: "Cómo funciona",
    nextSteps: "Tus próximos pasos",
    open: "Abrir tu compra →",
    keep: "Guarda este correo: el botón abre tu compra en cualquier dispositivo, y el formulario de recuperación de esa página acepta esta referencia. Referencia del pedido (ID de sesión):",
    questions: "¿Preguntas? Responde a este correo o contacta con soporte.",
    brand: "Resume Booster - Consigue el trabajo que quieres con un currículum optimizado para ATS",
    subjectOpen: (name) => `${name}: abre tu compra`,
  },
  kept: {
    full_analysis: {
      name: "Análisis completo del currículum",
      tagline: "Tu Análisis completo del currículum ya está pagado. Se realiza en la página que abre el botón de abajo",
      howItWorks: [
        "Tu análisis se realiza en la página a la que te devolvió el pago",
        "Si esa página se cerró antes de que terminara el análisis, el botón de abajo la vuelve a abrir",
        "En un dispositivo que no tiene tu currículum, la página te pide que lo subas; no se te cobrará de nuevo",
        "Cuando el análisis esté listo, te enviamos por correo un enlace al informe terminado",
      ],
      nextSteps: [
        "Abre tu análisis con el botón de abajo",
        "Sube tu currículum si la página te lo pide",
        "Lee el desglose de tu puntuación y las correcciones que indica",
        "Guarda el correo del informe: su enlace abre el análisis terminado en cualquier dispositivo",
      ],
    },
    freelance_boost: {
      name: "Freelance Boost",
      tagline: "Tu compra de Freelance Boost está guardada en el enlace de abajo",
      howItWorks: [
        "Abre el enlace de abajo y revisa tus respuestas: para quién fue cada proyecto y qué entregaste",
        "Genera tu sección de experiencia; no se te cobrará de nuevo",
        "Una vez generada tu sección, el mismo enlace la vuelve a mostrar en cualquier dispositivo",
      ],
      nextSteps: [
        "Abre tu compra con el botón de abajo",
        "Completa o revisa tus respuestas",
        "Genera tu sección de experiencia",
        "Cópiala en tu currículum",
      ],
    },
    freelance_transition_pro: {
      name: "Freelance Boost — Transition Pro",
      tagline: "Tu compra de Freelance Boost Transition Pro está guardada en el enlace de abajo",
      howItWorks: [
        "Abre el enlace de abajo y revisa tus respuestas: para quién fue cada proyecto y qué entregaste",
        "Genera tu sección de experiencia, tu carta de presentación para el cambio y tu texto «Acerca de» de LinkedIn; no se te cobrará de nuevo",
        "Una vez generados, el mismo enlace los vuelve a mostrar en cualquier dispositivo",
      ],
      nextSteps: [
        "Abre tu compra con el botón de abajo",
        "Completa o revisa tus respuestas",
        "Genera tu sección, tu carta de presentación y tu texto «Acerca de» de LinkedIn",
        "Cópialos en tu solicitud",
      ],
    },
  },
  needs: {
    subject: (name) => `${name}: necesitamos algo más de ti`,
    lead: {
      job_posting_required: (name) => `${name} se prepara para una oferta de empleo concreta, y tu compra no incluía ninguna, así que no pudimos prepararlo automáticamente.`,
      resume_missing: (name) => `Tu compra (${name}) no incluía ningún currículum, así que no pudimos prepararla automáticamente.`,
      resume_expired: (name) => `El currículum de tu compra (${name}) ya no está guardado (guardamos los currículums 24 horas), así que no pudimos prepararla automáticamente.`,
    },
    action: {
      job: "Responde a este correo con la oferta (el enlace o el texto) y lo prepararemos y te lo enviaremos. No se te cobrará de nuevo.",
      resume: "Responde a este correo con tu currículum (y la oferta, si lo compraste para una en concreto) y lo prepararemos y te lo enviaremos. No se te cobrará de nuevo.",
    },
  },
  failed: {
    subject: (name) => `Tu pago de ${name} no se completó`,
    body: "Tu banco no completó el pago, así que no se cobró nada y no se entregó nada.",
    action: "Puedes volver a intentarlo con otro método de pago.",
    button: "Intentar de nuevo",
  },
};

const FR: Lines = {
  shell: {
    thanks: "Merci pour votre achat !",
    howItWorks: "Comment ça marche",
    nextSteps: "Vos prochaines étapes",
    open: "Ouvrir votre achat →",
    keep: "Conservez cet e-mail : le bouton ouvre votre achat sur n'importe quel appareil, et le formulaire de récupération de cette page accepte cette référence. Référence de commande (ID de session) :",
    questions: "Des questions ? Répondez à cet e-mail ou contactez l'assistance.",
    brand: "Resume Booster - Décrochez le poste de vos rêves avec un CV optimisé pour les ATS",
    subjectOpen: (name) => `${name} : ouvrez votre achat`,
  },
  kept: {
    full_analysis: {
      name: "Analyse complète du CV",
      tagline: "Votre Analyse complète du CV est payée. Elle s'exécute sur la page qu'ouvre le bouton ci-dessous",
      howItWorks: [
        "Votre analyse s'exécute sur la page vers laquelle le paiement vous a renvoyé",
        "Si cette page a été fermée avant la fin de l'analyse, le bouton ci-dessous la rouvre",
        "Sur un appareil qui n'a pas votre CV, la page vous demande de le téléverser ; rien ne vous sera facturé à nouveau",
        "Quand l'analyse est prête, nous vous envoyons par e-mail un lien vers le rapport terminé",
      ],
      nextSteps: [
        "Ouvrez votre analyse avec le bouton ci-dessous",
        "Téléversez votre CV si la page le demande",
        "Lisez le détail de votre score et les corrections proposées",
        "Conservez l'e-mail du rapport : son lien ouvre l'analyse terminée sur n'importe quel appareil",
      ],
    },
    freelance_boost: {
      name: "Freelance Boost",
      tagline: "Votre achat Freelance Boost est enregistré sous le lien ci-dessous",
      howItWorks: [
        "Ouvrez le lien ci-dessous et vérifiez vos réponses : pour qui était chaque projet et ce que vous avez livré",
        "Générez votre section expérience ; rien ne vous sera facturé à nouveau",
        "Une fois votre section générée, le même lien l'affiche à nouveau sur n'importe quel appareil",
      ],
      nextSteps: [
        "Ouvrez votre achat avec le bouton ci-dessous",
        "Remplissez ou vérifiez vos réponses",
        "Générez votre section expérience",
        "Copiez-la dans votre CV",
      ],
    },
    freelance_transition_pro: {
      name: "Freelance Boost — Transition Pro",
      tagline: "Votre achat Freelance Boost Transition Pro est enregistré sous le lien ci-dessous",
      howItWorks: [
        "Ouvrez le lien ci-dessous et vérifiez vos réponses : pour qui était chaque projet et ce que vous avez livré",
        "Générez votre section expérience, votre lettre de motivation de reconversion et votre section « Infos » LinkedIn ; rien ne vous sera facturé à nouveau",
        "Une fois générés, le même lien les affiche à nouveau sur n'importe quel appareil",
      ],
      nextSteps: [
        "Ouvrez votre achat avec le bouton ci-dessous",
        "Remplissez ou vérifiez vos réponses",
        "Générez votre section, votre lettre de motivation et votre section « Infos » LinkedIn",
        "Copiez-les dans votre candidature",
      ],
    },
  },
  needs: {
    subject: (name) => `${name} : il nous manque quelque chose`,
    lead: {
      job_posting_required: (name) => `${name} est préparé pour une offre d'emploi précise, et aucune n'était jointe à votre achat : nous n'avons donc pas pu le préparer automatiquement.`,
      resume_missing: (name) => `Aucun CV n'était joint à votre achat (${name}) : nous n'avons donc pas pu le préparer automatiquement.`,
      resume_expired: (name) => `Le CV de votre achat (${name}) n'est plus conservé (nous gardons les CV 24 heures) : nous n'avons donc pas pu le préparer automatiquement.`,
    },
    action: {
      job: "Répondez à cet e-mail avec l'offre (le lien ou le texte) : nous le préparerons et vous l'enverrons. Rien ne vous sera facturé à nouveau.",
      resume: "Répondez à cet e-mail avec votre CV (et l'offre, si vous l'avez acheté pour un poste précis) : nous le préparerons et vous l'enverrons. Rien ne vous sera facturé à nouveau.",
    },
  },
  failed: {
    subject: (name) => `Votre paiement pour ${name} n'a pas abouti`,
    body: "Votre banque n'a pas finalisé le paiement : rien n'a été facturé et rien n'a été livré.",
    action: "Vous pouvez réessayer avec un autre moyen de paiement.",
    button: "Réessayer",
  },
};

const HI: Lines = {
  shell: {
    thanks: "आपकी खरीद के लिए धन्यवाद!",
    howItWorks: "यह कैसे काम करता है",
    nextSteps: "आपके अगले कदम",
    open: "अपनी खरीद खोलें →",
    keep: "यह ईमेल सँभालकर रखें: बटन आपकी खरीद को किसी भी डिवाइस पर खोलता है, और उस पेज का रिकवरी फ़ॉर्म यह संदर्भ स्वीकार करता है। ऑर्डर संदर्भ (सेशन ID):",
    questions: "कोई सवाल? इस ईमेल का जवाब दें या सपोर्ट से संपर्क करें।",
    brand: "Resume Booster - ATS-अनुकूल रिज़्यूमे के साथ अपनी पसंद की नौकरी पाएँ",
    subjectOpen: (name) => `${name}: अपनी खरीद खोलें`,
  },
  kept: {
    full_analysis: {
      name: "पूर्ण रिज़्यूमे विश्लेषण",
      tagline: "आपके पूर्ण रिज़्यूमे विश्लेषण का भुगतान हो चुका है। यह नीचे दिए गए बटन से खुलने वाले पेज पर चलता है",
      howItWorks: [
        "आपका विश्लेषण उस पेज पर चलता है जिस पर भुगतान के बाद आप लौटे थे",
        "अगर विश्लेषण पूरा होने से पहले वह पेज बंद हो गया था, तो नीचे दिया गया बटन उसे फिर से खोलता है",
        "जिस डिवाइस पर आपका रिज़्यूमे नहीं है, वहाँ पेज आपसे उसे अपलोड करने को कहता है; आपसे दोबारा शुल्क नहीं लिया जाएगा",
        "विश्लेषण तैयार होने पर हम आपको तैयार रिपोर्ट का लिंक ईमेल करते हैं",
      ],
      nextSteps: [
        "नीचे दिए गए बटन से अपना विश्लेषण खोलें",
        "अगर पेज माँगे तो अपना रिज़्यूमे अपलोड करें",
        "अपने स्कोर का विवरण और उसमें बताए गए सुधार पढ़ें",
        "रिपोर्ट वाला ईमेल सँभालकर रखें: उसका लिंक तैयार विश्लेषण किसी भी डिवाइस पर खोलता है",
      ],
    },
    freelance_boost: {
      name: "Freelance Boost",
      tagline: "आपकी Freelance Boost खरीद नीचे दिए गए लिंक पर सहेजी गई है",
      howItWorks: [
        "नीचे दिया गया लिंक खोलें और अपने जवाब जाँचें: हर प्रोजेक्ट किसके लिए था और आपने क्या डिलीवर किया",
        "अपना अनुभव वाला सेक्शन बनाएँ; आपसे दोबारा शुल्क नहीं लिया जाएगा",
        "सेक्शन बन जाने के बाद वही लिंक उसे किसी भी डिवाइस पर फिर से दिखाता है",
      ],
      nextSteps: [
        "नीचे दिए गए बटन से अपनी खरीद खोलें",
        "अपने जवाब भरें या जाँचें",
        "अपना अनुभव वाला सेक्शन बनाएँ",
        "उसे अपने रिज़्यूमे में कॉपी करें",
      ],
    },
    freelance_transition_pro: {
      name: "Freelance Boost — Transition Pro",
      tagline: "आपकी Freelance Boost Transition Pro खरीद नीचे दिए गए लिंक पर सहेजी गई है",
      howItWorks: [
        "नीचे दिया गया लिंक खोलें और अपने जवाब जाँचें: हर प्रोजेक्ट किसके लिए था और आपने क्या डिलीवर किया",
        "अपना अनुभव वाला सेक्शन, करियर बदलाव के लिए कवर लेटर और LinkedIn का About सेक्शन बनाएँ; आपसे दोबारा शुल्क नहीं लिया जाएगा",
        "इनके बन जाने के बाद वही लिंक इन्हें किसी भी डिवाइस पर फिर से दिखाता है",
      ],
      nextSteps: [
        "नीचे दिए गए बटन से अपनी खरीद खोलें",
        "अपने जवाब भरें या जाँचें",
        "अपना सेक्शन, कवर लेटर और LinkedIn का About सेक्शन बनाएँ",
        "उन्हें अपने आवेदन में कॉपी करें",
      ],
    },
  },
  needs: {
    subject: (name) => `${name}: हमें आपसे एक चीज़ और चाहिए`,
    lead: {
      job_posting_required: (name) => `${name} किसी एक नौकरी के विज्ञापन के लिए बनाया जाता है, और आपकी खरीद के साथ कोई विज्ञापन नहीं जुड़ा था, इसलिए हम इसे अपने आप नहीं बना सके।`,
      resume_missing: (name) => `आपकी खरीद (${name}) के साथ कोई रिज़्यूमे नहीं जुड़ा था, इसलिए हम इसे अपने आप नहीं बना सके।`,
      resume_expired: (name) => `आपकी खरीद (${name}) का रिज़्यूमे अब सहेजा हुआ नहीं है (हम रिज़्यूमे 24 घंटे तक रखते हैं), इसलिए हम इसे अपने आप नहीं बना सके।`,
    },
    action: {
      job: "इस ईमेल के जवाब में नौकरी का विज्ञापन (लिंक या टेक्स्ट) भेजें, हम इसे बनाकर आपको भेज देंगे। आपसे दोबारा शुल्क नहीं लिया जाएगा।",
      resume: "इस ईमेल के जवाब में अपना रिज़्यूमे भेजें (और नौकरी का विज्ञापन भी, अगर आपने यह किसी खास नौकरी के लिए खरीदा था), हम इसे बनाकर आपको भेज देंगे। आपसे दोबारा शुल्क नहीं लिया जाएगा।",
    },
  },
  failed: {
    subject: (name) => `${name} के लिए आपका भुगतान पूरा नहीं हुआ`,
    body: "आपके बैंक ने भुगतान पूरा नहीं किया, इसलिए न कोई शुल्क लिया गया और न ही कुछ डिलीवर किया गया।",
    action: "आप किसी दूसरे भुगतान तरीके से फिर से कोशिश कर सकते हैं।",
    button: "फिर से कोशिश करें",
  },
};

const NL: Lines = {
  shell: {
    thanks: "Bedankt voor je aankoop!",
    howItWorks: "Zo werkt het",
    nextSteps: "Je volgende stappen",
    open: "Open je aankoop →",
    keep: "Bewaar deze e-mail: de knop opent je aankoop op elk apparaat, en het herstelformulier op die pagina accepteert deze referentie. Bestelreferentie (sessie-ID):",
    questions: "Vragen? Beantwoord deze e-mail of neem contact op met support.",
    brand: "Resume Booster - Kom aan je droombaan met een ATS-geoptimaliseerd cv",
    subjectOpen: (name) => `${name}: open je aankoop`,
  },
  kept: {
    full_analysis: {
      name: "Volledige cv-analyse",
      tagline: "Je Volledige cv-analyse is betaald. Hij draait op de pagina die de knop hieronder opent",
      howItWorks: [
        "Je analyse draait op de pagina waar je na het betalen naar terugkeerde",
        "Werd die pagina gesloten voordat de analyse klaar was, dan opent de knop hieronder hem opnieuw",
        "Op een apparaat zonder je cv vraagt de pagina je om het te uploaden; er wordt niets opnieuw in rekening gebracht",
        "Zodra de analyse klaar is, mailen we je een link naar het afgeronde rapport",
      ],
      nextSteps: [
        "Open je analyse met de knop hieronder",
        "Upload je cv als de pagina erom vraagt",
        "Lees de uitsplitsing van je score en de verbeteringen die erin staan",
        "Bewaar de rapportmail: de link opent de afgeronde analyse op elk apparaat",
      ],
    },
    freelance_boost: {
      name: "Freelance Boost",
      tagline: "Je Freelance Boost-aankoop is opgeslagen onder de link hieronder",
      howItWorks: [
        "Open de link hieronder en controleer je antwoorden: voor wie elk project was en wat je hebt opgeleverd",
        "Genereer je werkervaringssectie; er wordt niets opnieuw in rekening gebracht",
        "Zodra je sectie is gegenereerd, toont dezelfde link hem opnieuw op elk apparaat",
      ],
      nextSteps: [
        "Open je aankoop met de knop hieronder",
        "Vul je antwoorden in of controleer ze",
        "Genereer je werkervaringssectie",
        "Kopieer hem naar je cv",
      ],
    },
    freelance_transition_pro: {
      name: "Freelance Boost — Transition Pro",
      tagline: "Je Freelance Boost Transition Pro-aankoop is opgeslagen onder de link hieronder",
      howItWorks: [
        "Open de link hieronder en controleer je antwoorden: voor wie elk project was en wat je hebt opgeleverd",
        "Genereer je werkervaringssectie, je motivatiebrief voor de overstap en je LinkedIn-info; er wordt niets opnieuw in rekening gebracht",
        "Zodra ze zijn gegenereerd, toont dezelfde link ze opnieuw op elk apparaat",
      ],
      nextSteps: [
        "Open je aankoop met de knop hieronder",
        "Vul je antwoorden in of controleer ze",
        "Genereer je sectie, je motivatiebrief en je LinkedIn-info",
        "Kopieer ze naar je sollicitatie",
      ],
    },
  },
  needs: {
    subject: (name) => `${name}: we hebben nog iets van je nodig`,
    lead: {
      job_posting_required: (name) => `${name} wordt gemaakt voor één specifieke vacature, en bij je aankoop zat er geen, dus konden we het niet automatisch maken.`,
      resume_missing: (name) => `Bij je aankoop (${name}) zat geen cv, dus konden we het niet automatisch maken.`,
      resume_expired: (name) => `Het cv van je aankoop (${name}) is niet meer opgeslagen (we bewaren cv's 24 uur), dus konden we het niet automatisch maken.`,
    },
    action: {
      job: "Beantwoord deze e-mail met de vacature (de link of de tekst), dan maken we het en sturen we het je toe. Er wordt niets opnieuw in rekening gebracht.",
      resume: "Beantwoord deze e-mail met je cv (en de vacature, als je het voor een specifieke baan kocht), dan maken we het en sturen we het je toe. Er wordt niets opnieuw in rekening gebracht.",
    },
  },
  failed: {
    subject: (name) => `Je betaling voor ${name} is niet gelukt`,
    body: "Je bank heeft de betaling niet afgerond, dus er is niets in rekening gebracht en niets geleverd.",
    action: "Je kunt het opnieuw proberen met een andere betaalmethode.",
    button: "Opnieuw proberen",
  },
};

const PT: Lines = {
  shell: {
    thanks: "Obrigado pela sua compra!",
    howItWorks: "Como funciona",
    nextSteps: "Seus próximos passos",
    open: "Abrir sua compra →",
    keep: "Guarde este e-mail: o botão abre sua compra em qualquer dispositivo, e o formulário de recuperação dessa página aceita esta referência. Referência do pedido (ID da sessão):",
    questions: "Dúvidas? Responda a este e-mail ou fale com o suporte.",
    brand: "Resume Booster - Conquiste a vaga dos seus sonhos com um currículo otimizado para ATS",
    subjectOpen: (name) => `${name}: abra sua compra`,
  },
  kept: {
    full_analysis: {
      name: "Análise completa do currículo",
      tagline: "Sua Análise completa do currículo está paga. Ela é feita na página que o botão abaixo abre",
      howItWorks: [
        "Sua análise é feita na página para a qual o pagamento levou você de volta",
        "Se essa página foi fechada antes de a análise terminar, o botão abaixo a abre de novo",
        "Em um dispositivo que não tem seu currículo, a página pede que você o envie; nada será cobrado de novo",
        "Quando a análise ficar pronta, enviamos por e-mail um link para o relatório concluído",
      ],
      nextSteps: [
        "Abra sua análise com o botão abaixo",
        "Envie seu currículo se a página pedir",
        "Leia o detalhamento da sua pontuação e as correções indicadas",
        "Guarde o e-mail do relatório: o link dele abre a análise concluída em qualquer dispositivo",
      ],
    },
    freelance_boost: {
      name: "Freelance Boost",
      tagline: "Sua compra do Freelance Boost está salva no link abaixo",
      howItWorks: [
        "Abra o link abaixo e confira suas respostas: para quem foi cada projeto e o que você entregou",
        "Gere sua seção de experiência; nada será cobrado de novo",
        "Depois que sua seção for gerada, o mesmo link a mostra de novo em qualquer dispositivo",
      ],
      nextSteps: [
        "Abra sua compra com o botão abaixo",
        "Preencha ou confira suas respostas",
        "Gere sua seção de experiência",
        "Copie-a para o seu currículo",
      ],
    },
    freelance_transition_pro: {
      name: "Freelance Boost — Transition Pro",
      tagline: "Sua compra do Freelance Boost Transition Pro está salva no link abaixo",
      howItWorks: [
        "Abra o link abaixo e confira suas respostas: para quem foi cada projeto e o que você entregou",
        "Gere sua seção de experiência, sua carta de apresentação para a transição e seu texto \"Sobre\" do LinkedIn; nada será cobrado de novo",
        "Depois que forem gerados, o mesmo link os mostra de novo em qualquer dispositivo",
      ],
      nextSteps: [
        "Abra sua compra com o botão abaixo",
        "Preencha ou confira suas respostas",
        "Gere sua seção, sua carta de apresentação e seu texto \"Sobre\" do LinkedIn",
        "Copie-os para a sua candidatura",
      ],
    },
  },
  needs: {
    subject: (name) => `${name}: precisamos de mais uma coisa sua`,
    lead: {
      job_posting_required: (name) => `${name} é feito para uma vaga específica, e nenhuma vaga veio com a sua compra, então não conseguimos prepará-lo automaticamente.`,
      resume_missing: (name) => `Nenhum currículo veio com a sua compra (${name}), então não conseguimos prepará-la automaticamente.`,
      resume_expired: (name) => `O currículo da sua compra (${name}) não está mais armazenado (guardamos currículos por 24 horas), então não conseguimos prepará-la automaticamente.`,
    },
    action: {
      job: "Responda a este e-mail com a vaga (o link ou o texto) e nós vamos prepará-lo e enviar para você. Nada será cobrado de novo.",
      resume: "Responda a este e-mail com o seu currículo (e a vaga, se você comprou para uma específica) e nós vamos prepará-lo e enviar para você. Nada será cobrado de novo.",
    },
  },
  failed: {
    subject: (name) => `Seu pagamento de ${name} não foi concluído`,
    body: "Seu banco não concluiu o pagamento, então nada foi cobrado e nada foi entregue.",
    action: "Você pode tentar de novo com outra forma de pagamento.",
    button: "Tentar de novo",
  },
};

const TL: Lines = {
  shell: {
    thanks: "Salamat sa iyong pagbili!",
    howItWorks: "Paano ito gumagana",
    nextSteps: "Ang mga susunod mong hakbang",
    open: "Buksan ang iyong binili →",
    keep: "Itago ang email na ito: binubuksan ng button ang iyong binili sa kahit anong device, at tinatanggap ng recovery form sa pahinang iyon ang reference na ito. Order reference (session ID):",
    questions: "May tanong? Sagutin ang email na ito o makipag-ugnayan sa support.",
    brand: "Resume Booster - Makuha ang pinapangarap mong trabaho gamit ang resume na optimized para sa ATS",
    subjectOpen: (name) => `${name}: buksan ang iyong binili`,
  },
  kept: {
    full_analysis: {
      name: "Buong Pagsusuri ng Resume",
      tagline: "Bayad na ang iyong Buong Pagsusuri ng Resume. Tumatakbo ito sa pahinang binubuksan ng button sa ibaba",
      howItWorks: [
        "Tumatakbo ang iyong pagsusuri sa pahinang binalikan mo pagkatapos magbayad",
        "Kung nasara ang pahinang iyon bago natapos ang pagsusuri, bubuksan itong muli ng button sa ibaba",
        "Sa device na walang kopya ng iyong resume, hihilingin ng pahina na i-upload mo ito; hindi ka sisingilin ulit",
        "Kapag handa na ang pagsusuri, ie-email namin sa iyo ang link sa tapos na report",
      ],
      nextSteps: [
        "Buksan ang iyong pagsusuri gamit ang button sa ibaba",
        "I-upload ang iyong resume kung hihingin ito ng pahina",
        "Basahin ang breakdown ng iyong score at ang mga ayos na nakalista",
        "Itago ang email ng report: binubuksan ng link nito ang tapos na pagsusuri sa kahit anong device",
      ],
    },
    freelance_boost: {
      name: "Freelance Boost",
      tagline: "Naka-save sa link sa ibaba ang binili mong Freelance Boost",
      howItWorks: [
        "Buksan ang link sa ibaba at suriin ang iyong mga sagot: para kanino ang bawat proyekto at ano ang iyong naihatid",
        "Gawin ang iyong experience section; hindi ka sisingilin ulit",
        "Kapag nagawa na ang iyong section, ipapakita itong muli ng parehong link sa kahit anong device",
      ],
      nextSteps: [
        "Buksan ang iyong binili gamit ang button sa ibaba",
        "Punan o suriin ang iyong mga sagot",
        "Gawin ang iyong experience section",
        "Kopyahin ito sa iyong resume",
      ],
    },
    freelance_transition_pro: {
      name: "Freelance Boost — Transition Pro",
      tagline: "Naka-save sa link sa ibaba ang binili mong Freelance Boost Transition Pro",
      howItWorks: [
        "Buksan ang link sa ibaba at suriin ang iyong mga sagot: para kanino ang bawat proyekto at ano ang iyong naihatid",
        "Gawin ang iyong experience section, transition cover letter at LinkedIn About; hindi ka sisingilin ulit",
        "Kapag nagawa na ang mga ito, ipapakita itong muli ng parehong link sa kahit anong device",
      ],
      nextSteps: [
        "Buksan ang iyong binili gamit ang button sa ibaba",
        "Punan o suriin ang iyong mga sagot",
        "Gawin ang iyong section, cover letter at LinkedIn About",
        "Kopyahin ang mga ito sa iyong aplikasyon",
      ],
    },
  },
  needs: {
    subject: (name) => `${name}: may kailangan pa kami mula sa iyo`,
    lead: {
      job_posting_required: (name) => `Ginagawa ang ${name} para sa isang partikular na job posting, at walang kasamang posting ang iyong binili, kaya hindi namin ito nagawa nang awtomatiko.`,
      resume_missing: (name) => `Walang kasamang resume ang iyong binili (${name}), kaya hindi namin ito nagawa nang awtomatiko.`,
      resume_expired: (name) => `Hindi na naka-save ang resume para sa iyong binili (${name}) (24 oras lang namin itinatago ang mga resume), kaya hindi namin ito nagawa nang awtomatiko.`,
    },
    action: {
      job: "Sagutin ang email na ito kasama ang job posting (ang link o ang teksto), at gagawin namin ito at ipapadala sa iyo. Hindi ka sisingilin ulit.",
      resume: "Sagutin ang email na ito kasama ang iyong resume (at ang job posting, kung binili mo ito para sa isang partikular na trabaho), at gagawin namin ito at ipapadala sa iyo. Hindi ka sisingilin ulit.",
    },
  },
  failed: {
    subject: (name) => `Hindi natuloy ang bayad mo para sa ${name}`,
    body: "Hindi natapos ng iyong bangko ang bayad, kaya walang siningil at walang naihatid.",
    action: "Maaari mong subukan ulit gamit ang ibang paraan ng pagbabayad.",
    button: "Subukan ulit",
  },
};

export const MAIL_COPY: Readonly<Record<MailLanguage, Lines>> = {
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

export const isKeptProduct = (t: string): t is KeptProduct => (KEPT_PRODUCTS as readonly string[]).includes(t);
export const isNeedsReason = (r: unknown): r is NeedsReason => typeof r === "string" && (NEEDS_REASONS as readonly string[]).includes(r);
