/**
 * THE KEY CONFIRMATION MAIL IN THE READER'S LANGUAGE (S13-102).
 *
 * Written in the language of the page that asked (body.language, then the
 * browser's Accept-Language); anything unknown is English. "Resume Booster"
 * and "API" stay as they are.
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

export interface KeyCopy {
  subject: string;
  heading: string;
  ask: string;
  button: string;
  expiry: string;
  full: string;
  ignore: string;
}

const EN: KeyCopy = {
  subject: "Confirm your Resume Booster API key",
  heading: "Confirm your Resume Booster API key",
  ask: "Someone, hopefully you, asked for a free data API key for this address. Open the link below to create it; the key is shown once, on the page the link opens.",
  button: "Create my API key",
  expiry: "The link works once and expires in 24 hours.",
  full: "This address already holds three live keys, the most it can hold. Confirming retires the one used least recently.",
  ignore: "If you did not ask for this, ignore this email. No key exists until the link is opened, and nothing else will be sent.",
};

export const KEY_COPY: Record<MailLanguage, KeyCopy> = {
  en: EN,
  "en-GB": EN,
  de: {
    subject: "Bestätigen Sie Ihren Resume Booster API-Schlüssel",
    heading: "Bestätigen Sie Ihren Resume Booster API-Schlüssel",
    ask: "Jemand, hoffentlich Sie, hat für diese Adresse einen kostenlosen Daten-API-Schlüssel angefordert. Öffnen Sie den Link unten, um ihn zu erstellen; der Schlüssel wird einmal angezeigt, auf der Seite, die der Link öffnet.",
    button: "Meinen API-Schlüssel erstellen",
    expiry: "Der Link funktioniert einmal und läuft nach 24 Stunden ab.",
    full: "Diese Adresse hat bereits drei aktive Schlüssel, die Höchstzahl. Mit der Bestätigung wird der am längsten nicht genutzte zurückgezogen.",
    ignore: "Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail. Ohne Öffnen des Links entsteht kein Schlüssel, und es wird nichts weiter gesendet.",
  },
  es: {
    subject: "Confirma tu clave de API de Resume Booster",
    heading: "Confirma tu clave de API de Resume Booster",
    ask: "Alguien, esperamos que tú, pidió una clave gratuita de la API de datos para esta dirección. Abre el enlace de abajo para crearla; la clave se muestra una sola vez, en la página que abre el enlace.",
    button: "Crear mi clave de API",
    expiry: "El enlace funciona una sola vez y caduca en 24 horas.",
    full: "Esta dirección ya tiene tres claves activas, el máximo permitido. Al confirmar se retira la que menos se ha usado recientemente.",
    ignore: "Si no lo pediste, ignora este correo. No existe ninguna clave hasta que se abre el enlace, y no se enviará nada más.",
  },
  fr: {
    subject: "Confirmez votre clé d'API Resume Booster",
    heading: "Confirmez votre clé d'API Resume Booster",
    ask: "Quelqu'un, vous nous l'espérons, a demandé une clé gratuite d'API de données pour cette adresse. Ouvrez le lien ci-dessous pour la créer ; la clé s'affiche une seule fois, sur la page que le lien ouvre.",
    button: "Créer ma clé d'API",
    expiry: "Le lien fonctionne une seule fois et expire dans 24 heures.",
    full: "Cette adresse détient déjà trois clés actives, le maximum autorisé. La confirmation retire celle utilisée le moins récemment.",
    ignore: "Si vous n'avez rien demandé, ignorez cet e-mail. Aucune clé n'existe tant que le lien n'est pas ouvert, et rien d'autre ne sera envoyé.",
  },
  hi: {
    subject: "अपनी Resume Booster API कुंजी की पुष्टि करें",
    heading: "अपनी Resume Booster API कुंजी की पुष्टि करें",
    ask: "किसी ने, उम्मीद है आपने, इस पते के लिए एक मुफ़्त डेटा API कुंजी माँगी है। इसे बनाने के लिए नीचे दिया लिंक खोलें; कुंजी एक बार दिखाई जाती है, उसी पेज पर जो लिंक खोलता है।",
    button: "मेरी API कुंजी बनाएँ",
    expiry: "यह लिंक एक बार काम करता है और 24 घंटे में समाप्त हो जाता है।",
    full: "इस पते के पास पहले से तीन सक्रिय कुंजियाँ हैं, जो अधिकतम सीमा है। पुष्टि करने पर सबसे कम हाल में इस्तेमाल हुई कुंजी हटा दी जाएगी।",
    ignore: "अगर आपने यह नहीं माँगा, तो इस ईमेल को अनदेखा करें। लिंक खोले बिना कोई कुंजी नहीं बनती, और आगे कुछ नहीं भेजा जाएगा।",
  },
  nl: {
    subject: "Bevestig je Resume Booster API-sleutel",
    heading: "Bevestig je Resume Booster API-sleutel",
    ask: "Iemand, hopelijk jij, heeft voor dit adres een gratis data-API-sleutel aangevraagd. Open de link hieronder om hem aan te maken; de sleutel wordt één keer getoond, op de pagina die de link opent.",
    button: "Mijn API-sleutel aanmaken",
    expiry: "De link werkt één keer en verloopt na 24 uur.",
    full: "Dit adres heeft al drie actieve sleutels, het maximum. Bevestigen trekt de minst recent gebruikte in.",
    ignore: "Heb je dit niet aangevraagd? Negeer deze e-mail dan. Er bestaat geen sleutel tot de link is geopend, en er wordt verder niets verstuurd.",
  },
  pt: {
    subject: "Confirme sua chave de API do Resume Booster",
    heading: "Confirme sua chave de API do Resume Booster",
    ask: "Alguém, esperamos que você, pediu uma chave gratuita da API de dados para este endereço. Abra o link abaixo para criá-la; a chave é mostrada uma vez, na página que o link abre.",
    button: "Criar minha chave de API",
    expiry: "O link funciona uma vez e expira em 24 horas.",
    full: "Este endereço já tem três chaves ativas, o máximo permitido. Ao confirmar, a usada há mais tempo é desativada.",
    ignore: "Se você não pediu isso, ignore este e-mail. Nenhuma chave existe até o link ser aberto, e nada mais será enviado.",
  },
  tl: {
    subject: "Kumpirmahin ang iyong Resume Booster API key",
    heading: "Kumpirmahin ang iyong Resume Booster API key",
    ask: "May humiling, sana ikaw, ng libreng data API key para sa address na ito. Buksan ang link sa ibaba para gawin ito; isang beses lang ipapakita ang key, sa page na bubuksan ng link.",
    button: "Gawin ang aking API key",
    expiry: "Isang beses lang gagana ang link at mag-e-expire ito sa loob ng 24 na oras.",
    full: "May tatlo nang aktibong key ang address na ito, ang pinakamarami. Kapag kinumpirma, aalisin ang key na pinakamatagal nang hindi nagagamit.",
    ignore: "Kung hindi ikaw ang humiling nito, huwag pansinin ang email na ito. Walang key na malilikha hangga't hindi nabubuksan ang link, at wala nang ibang ipapadala.",
  },
};
