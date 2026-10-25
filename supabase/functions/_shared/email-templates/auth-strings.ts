/**
 * THE AUTH MAILS IN THE READER'S LANGUAGE (register S12-180).
 *
 * The auth server's hook payload names no locale, only the link the page
 * asked for. The sign-in page puts its language in that link's redirect
 * (&lng=de, AuthContext.mailLanguageParam), and auth-email-hook reads it back
 * and hands it to every template. English is the default and the fallback;
 * en-GB reads as English. The nine languages are the site's own (src/i18n).
 *
 * Import-free, so the Node tests import it directly.
 */

export type AuthMailLanguage = "en" | "de" | "es" | "fr" | "hi" | "nl" | "pt" | "tl";
export const AUTH_MAIL_LANGUAGES: readonly AuthMailLanguage[] = ["en", "de", "es", "fr", "hi", "nl", "pt", "tl"];

/** The language a redirect's lng names, as one of ours, else English. */
export function authMailLanguage(raw: string | null | undefined): AuthMailLanguage {
  const base = String(raw ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return (AUTH_MAIL_LANGUAGES as readonly string[]).includes(base) ? (base as AuthMailLanguage) : "en";
}

export interface AuthStrings {
  expires: (minutes: number) => string;
  ignore: string;
  magic: { subject: string; preview: (site: string) => string; heading: string; lead: (site: string) => string; orBrowser: string; noToken: (site: string) => string; button: string };
  signup: { subject: string; preview: (site: string) => string; heading: string; before: string; after: (recipient: string) => string; lead: string; orBrowser: string; noToken: string; button: string };
  recovery: { subject: string; preview: (site: string) => string; heading: string; body: (site: string) => string; lead: string; orBrowser: string; noToken: string; button: string; stays: string };
  invite: { subject: string; preview: (site: string) => string; heading: string; before: string; after: string; lead: string; orBrowser: string; noToken: string; button: string };
  change: { subject: string; preview: (site: string) => string; heading: string; body: (site: string, from: string, to: string) => string; currentAddress: string; newAddress: string; lead: string; orBrowser: string; noToken: string; button: string; worried: string };
  notice: { subject: string; preview: (site: string) => string; heading: string; body: (site: string, from: string, to: string, at: string) => string; itsAddress: string; newAddress: string; ifYou: string; why: string };
  reauth: { subject: string; preview: string; heading: string; lead: string };
}

const EN: AuthStrings = {
  expires: (m) => `It expires in ${m} minutes.`,
  ignore: "If you didn't ask for this, you can ignore it.",
  magic: {
    subject: "Your sign-in code", preview: (s) => `Your sign-in code for ${s}`, heading: "Your sign-in code",
    lead: (s) => `Enter this code on the ${s} sign-in page:`, orBrowser: "Or continue in your browser:",
    noToken: (s) => `Press the button to sign in to ${s}. It expires shortly.`, button: "Continue",
  },
  signup: {
    subject: "Confirm your email", preview: (s) => `Confirm your email for ${s}`, heading: "Confirm your email",
    before: "Thanks for signing up for ", after: (r) => `. This confirms that ${r} is your address.`,
    lead: "Enter this code on the sign-in page:", orBrowser: "Or confirm in your browser:", noToken: "Press the button to confirm it:", button: "Confirm email",
  },
  recovery: {
    subject: "Reset your password", preview: (s) => `Reset your password for ${s}`, heading: "Reset your password",
    body: (s) => `Someone asked to reset the password for your ${s} account.`,
    lead: "Enter this code on the reset page to choose a new password:", orBrowser: "Or continue in your browser:",
    noToken: "Press the button to choose a new password:", button: "Choose a new password", stays: "Your password stays as it is.",
  },
  invite: {
    subject: "You've been invited", preview: (s) => `You've been invited to join ${s}`, heading: "You've been invited",
    before: "You've been invited to join ", after: ".",
    lead: "Enter this code on the sign-in page to accept:", orBrowser: "Or accept in your browser:", noToken: "Press the button to accept the invitation:", button: "Accept invitation",
  },
  change: {
    subject: "Confirm your email change", preview: (s) => `Confirm your email change for ${s}`, heading: "Confirm your email change",
    body: (s, f, t) => `Someone asked to change the email address on your ${s} account from ${f} to ${t}.`,
    currentAddress: "your current address", newAddress: "a new address",
    lead: "Enter this code to confirm the change:", orBrowser: "Or confirm in your browser:", noToken: "Press the button to confirm the change:", button: "Confirm the change",
    worried: "If you think someone else is using your account, reply to this mail so a person can secure it.",
  },
  notice: {
    subject: "An email change was requested on your account", preview: (s) => `An email change was requested on ${s}`, heading: "An email change was requested",
    body: (s, f, t, a) => `Someone asked to change the email address on a ${s} account from ${f} to ${t}. The link that confirms it goes only to ${a}. This mail confirms nothing.`,
    itsAddress: "its current address", newAddress: "a new address",
    ifYou: "If this was you, there is nothing to do here. If it wasn't, reply to this mail straight away so a person can secure the account.",
    why: "You are getting this because this address is the old or the new address on that account.",
  },
  reauth: { subject: "Your verification code", preview: "Your verification code", heading: "Confirm it's you", lead: "Use this code to confirm your identity:" },
};

const DE: AuthStrings = {
  expires: (m) => `Er läuft in ${m} Minuten ab.`,
  ignore: "Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.",
  magic: {
    subject: "Ihr Anmeldecode", preview: (s) => `Ihr Anmeldecode für ${s}`, heading: "Ihr Anmeldecode",
    lead: (s) => `Geben Sie diesen Code auf der Anmeldeseite von ${s} ein:`, orBrowser: "Oder fahren Sie im Browser fort:",
    noToken: (s) => `Klicken Sie auf die Schaltfläche, um sich bei ${s} anzumelden. Sie läuft bald ab.`, button: "Weiter",
  },
  signup: {
    subject: "Bestätigen Sie Ihre E-Mail-Adresse", preview: (s) => `Bestätigen Sie Ihre E-Mail-Adresse für ${s}`, heading: "Bestätigen Sie Ihre E-Mail-Adresse",
    before: "Danke für Ihre Anmeldung bei ", after: (r) => `. Damit bestätigen Sie, dass ${r} Ihre Adresse ist.`,
    lead: "Geben Sie diesen Code auf der Anmeldeseite ein:", orBrowser: "Oder bestätigen Sie im Browser:", noToken: "Klicken Sie zum Bestätigen auf die Schaltfläche:", button: "E-Mail bestätigen",
  },
  recovery: {
    subject: "Passwort zurücksetzen", preview: (s) => `Passwort für ${s} zurücksetzen`, heading: "Passwort zurücksetzen",
    body: (s) => `Jemand hat angefordert, das Passwort Ihres ${s}-Kontos zurückzusetzen.`,
    lead: "Geben Sie diesen Code auf der Seite zum Zurücksetzen ein, um ein neues Passwort zu wählen:", orBrowser: "Oder fahren Sie im Browser fort:",
    noToken: "Klicken Sie auf die Schaltfläche, um ein neues Passwort zu wählen:", button: "Neues Passwort wählen", stays: "Ihr Passwort bleibt unverändert.",
  },
  invite: {
    subject: "Sie wurden eingeladen", preview: (s) => `Sie wurden zu ${s} eingeladen`, heading: "Sie wurden eingeladen",
    before: "Sie wurden eingeladen zu ", after: ".",
    lead: "Geben Sie diesen Code auf der Anmeldeseite ein, um anzunehmen:", orBrowser: "Oder nehmen Sie im Browser an:", noToken: "Klicken Sie auf die Schaltfläche, um die Einladung anzunehmen:", button: "Einladung annehmen",
  },
  change: {
    subject: "Bestätigen Sie die Änderung Ihrer E-Mail-Adresse", preview: (s) => `Bestätigen Sie die Änderung Ihrer E-Mail-Adresse für ${s}`, heading: "Bestätigen Sie die Änderung Ihrer E-Mail-Adresse",
    body: (s, f, t) => `Jemand hat angefordert, die E-Mail-Adresse Ihres ${s}-Kontos von ${f} in ${t} zu ändern.`,
    currentAddress: "Ihrer aktuellen Adresse", newAddress: "eine neue Adresse",
    lead: "Geben Sie diesen Code ein, um die Änderung zu bestätigen:", orBrowser: "Oder bestätigen Sie im Browser:", noToken: "Klicken Sie auf die Schaltfläche, um die Änderung zu bestätigen:", button: "Änderung bestätigen",
    worried: "Wenn Sie glauben, dass jemand anderes Ihr Konto nutzt, antworten Sie auf diese E-Mail, damit ein Mensch es sichern kann.",
  },
  notice: {
    subject: "Für Ihr Konto wurde eine Änderung der E-Mail-Adresse angefordert", preview: (s) => `Für ${s} wurde eine Änderung der E-Mail-Adresse angefordert`, heading: "Eine Änderung der E-Mail-Adresse wurde angefordert",
    body: (s, f, t, a) => `Jemand hat angefordert, die E-Mail-Adresse eines ${s}-Kontos von ${f} in ${t} zu ändern. Der Bestätigungslink geht nur an ${a}. Diese E-Mail bestätigt nichts.`,
    itsAddress: "seiner aktuellen Adresse", newAddress: "eine neue Adresse",
    ifYou: "Wenn Sie das waren, müssen Sie nichts tun. Wenn nicht, antworten Sie sofort auf diese E-Mail, damit ein Mensch das Konto sichern kann.",
    why: "Sie erhalten diese E-Mail, weil diese Adresse die alte oder die neue Adresse dieses Kontos ist.",
  },
  reauth: { subject: "Ihr Bestätigungscode", preview: "Ihr Bestätigungscode", heading: "Bestätigen Sie, dass Sie es sind", lead: "Mit diesem Code bestätigen Sie Ihre Identität:" },
};

const ES: AuthStrings = {
  expires: (m) => `Caduca en ${m} minutos.`,
  ignore: "Si no lo pediste, puedes ignorar este correo.",
  magic: {
    subject: "Tu código de inicio de sesión", preview: (s) => `Tu código de inicio de sesión para ${s}`, heading: "Tu código de inicio de sesión",
    lead: (s) => `Escribe este código en la página de inicio de sesión de ${s}:`, orBrowser: "O continúa en tu navegador:",
    noToken: (s) => `Pulsa el botón para iniciar sesión en ${s}. Caduca pronto.`, button: "Continuar",
  },
  signup: {
    subject: "Confirma tu correo", preview: (s) => `Confirma tu correo para ${s}`, heading: "Confirma tu correo",
    before: "Gracias por registrarte en ", after: (r) => `. Así confirmas que ${r} es tu dirección.`,
    lead: "Escribe este código en la página de inicio de sesión:", orBrowser: "O confírmalo en tu navegador:", noToken: "Pulsa el botón para confirmarlo:", button: "Confirmar correo",
  },
  recovery: {
    subject: "Restablece tu contraseña", preview: (s) => `Restablece tu contraseña de ${s}`, heading: "Restablece tu contraseña",
    body: (s) => `Alguien pidió restablecer la contraseña de tu cuenta de ${s}.`,
    lead: "Escribe este código en la página de restablecimiento para elegir una contraseña nueva:", orBrowser: "O continúa en tu navegador:",
    noToken: "Pulsa el botón para elegir una contraseña nueva:", button: "Elegir una contraseña nueva", stays: "Tu contraseña no cambia.",
  },
  invite: {
    subject: "Te han invitado", preview: (s) => `Te han invitado a unirte a ${s}`, heading: "Te han invitado",
    before: "Te han invitado a unirte a ", after: ".",
    lead: "Escribe este código en la página de inicio de sesión para aceptar:", orBrowser: "O acepta en tu navegador:", noToken: "Pulsa el botón para aceptar la invitación:", button: "Aceptar invitación",
  },
  change: {
    subject: "Confirma el cambio de tu correo", preview: (s) => `Confirma el cambio de tu correo en ${s}`, heading: "Confirma el cambio de tu correo",
    body: (s, f, t) => `Alguien pidió cambiar la dirección de correo de tu cuenta de ${s} de ${f} a ${t}.`,
    currentAddress: "tu dirección actual", newAddress: "una dirección nueva",
    lead: "Escribe este código para confirmar el cambio:", orBrowser: "O confírmalo en tu navegador:", noToken: "Pulsa el botón para confirmar el cambio:", button: "Confirmar el cambio",
    worried: "Si crees que otra persona está usando tu cuenta, responde a este correo para que alguien la proteja.",
  },
  notice: {
    subject: "Se pidió un cambio de correo en tu cuenta", preview: (s) => `Se pidió un cambio de correo en ${s}`, heading: "Se pidió un cambio de correo",
    body: (s, f, t, a) => `Alguien pidió cambiar la dirección de correo de una cuenta de ${s} de ${f} a ${t}. El enlace que lo confirma solo se envía a ${a}. Este correo no confirma nada.`,
    itsAddress: "su dirección actual", newAddress: "una dirección nueva",
    ifYou: "Si fuiste tú, no tienes que hacer nada. Si no, responde a este correo enseguida para que alguien proteja la cuenta.",
    why: "Recibes esto porque esta dirección es la antigua o la nueva de esa cuenta.",
  },
  reauth: { subject: "Tu código de verificación", preview: "Tu código de verificación", heading: "Confirma que eres tú", lead: "Usa este código para confirmar tu identidad:" },
};

const FR: AuthStrings = {
  expires: (m) => `Il expire dans ${m} minutes.`,
  ignore: "Si vous n'avez rien demandé, vous pouvez ignorer ce message.",
  magic: {
    subject: "Votre code de connexion", preview: (s) => `Votre code de connexion pour ${s}`, heading: "Votre code de connexion",
    lead: (s) => `Saisissez ce code sur la page de connexion de ${s} :`, orBrowser: "Ou continuez dans votre navigateur :",
    noToken: (s) => `Appuyez sur le bouton pour vous connecter à ${s}. Il expire bientôt.`, button: "Continuer",
  },
  signup: {
    subject: "Confirmez votre adresse e-mail", preview: (s) => `Confirmez votre adresse e-mail pour ${s}`, heading: "Confirmez votre adresse e-mail",
    before: "Merci de vous être inscrit sur ", after: (r) => `. Cela confirme que ${r} est bien votre adresse.`,
    lead: "Saisissez ce code sur la page de connexion :", orBrowser: "Ou confirmez dans votre navigateur :", noToken: "Appuyez sur le bouton pour la confirmer :", button: "Confirmer l'adresse",
  },
  recovery: {
    subject: "Réinitialisez votre mot de passe", preview: (s) => `Réinitialisez votre mot de passe ${s}`, heading: "Réinitialisez votre mot de passe",
    body: (s) => `Quelqu'un a demandé à réinitialiser le mot de passe de votre compte ${s}.`,
    lead: "Saisissez ce code sur la page de réinitialisation pour choisir un nouveau mot de passe :", orBrowser: "Ou continuez dans votre navigateur :",
    noToken: "Appuyez sur le bouton pour choisir un nouveau mot de passe :", button: "Choisir un nouveau mot de passe", stays: "Votre mot de passe reste inchangé.",
  },
  invite: {
    subject: "Vous êtes invité", preview: (s) => `Vous êtes invité à rejoindre ${s}`, heading: "Vous êtes invité",
    before: "Vous êtes invité à rejoindre ", after: ".",
    lead: "Saisissez ce code sur la page de connexion pour accepter :", orBrowser: "Ou acceptez dans votre navigateur :", noToken: "Appuyez sur le bouton pour accepter l'invitation :", button: "Accepter l'invitation",
  },
  change: {
    subject: "Confirmez le changement de votre adresse e-mail", preview: (s) => `Confirmez le changement de votre adresse e-mail ${s}`, heading: "Confirmez le changement de votre adresse e-mail",
    body: (s, f, t) => `Quelqu'un a demandé à changer l'adresse e-mail de votre compte ${s} de ${f} à ${t}.`,
    currentAddress: "votre adresse actuelle", newAddress: "une nouvelle adresse",
    lead: "Saisissez ce code pour confirmer le changement :", orBrowser: "Ou confirmez dans votre navigateur :", noToken: "Appuyez sur le bouton pour confirmer le changement :", button: "Confirmer le changement",
    worried: "Si vous pensez que quelqu'un d'autre utilise votre compte, répondez à ce message pour qu'une personne le sécurise.",
  },
  notice: {
    subject: "Un changement d'adresse e-mail a été demandé sur votre compte", preview: (s) => `Un changement d'adresse e-mail a été demandé sur ${s}`, heading: "Un changement d'adresse e-mail a été demandé",
    body: (s, f, t, a) => `Quelqu'un a demandé à changer l'adresse e-mail d'un compte ${s} de ${f} à ${t}. Le lien qui le confirme est envoyé uniquement à ${a}. Ce message ne confirme rien.`,
    itsAddress: "son adresse actuelle", newAddress: "une nouvelle adresse",
    ifYou: "Si c'était vous, vous n'avez rien à faire. Sinon, répondez immédiatement à ce message pour qu'une personne sécurise le compte.",
    why: "Vous recevez ce message parce que cette adresse est l'ancienne ou la nouvelle adresse de ce compte.",
  },
  reauth: { subject: "Votre code de vérification", preview: "Votre code de vérification", heading: "Confirmez que c'est bien vous", lead: "Utilisez ce code pour confirmer votre identité :" },
};

const HI: AuthStrings = {
  expires: (m) => `यह ${m} मिनट में समाप्त हो जाएगा।`,
  ignore: "अगर आपने यह नहीं माँगा था, तो इसे अनदेखा कर सकते हैं।",
  magic: {
    subject: "आपका साइन-इन कोड", preview: (s) => `${s} के लिए आपका साइन-इन कोड`, heading: "आपका साइन-इन कोड",
    lead: (s) => `${s} के साइन-इन पेज पर यह कोड डालें:`, orBrowser: "या अपने ब्राउज़र में जारी रखें:",
    noToken: (s) => `${s} में साइन इन करने के लिए बटन दबाएँ। यह जल्द समाप्त हो जाएगा।`, button: "जारी रखें",
  },
  signup: {
    subject: "अपना ईमेल पुष्टि करें", preview: (s) => `${s} के लिए अपना ईमेल पुष्टि करें`, heading: "अपना ईमेल पुष्टि करें",
    before: "साइन अप करने के लिए धन्यवाद: ", after: (r) => `। इससे पुष्टि होती है कि ${r} आपका पता है।`,
    lead: "साइन-इन पेज पर यह कोड डालें:", orBrowser: "या अपने ब्राउज़र में पुष्टि करें:", noToken: "पुष्टि करने के लिए बटन दबाएँ:", button: "ईमेल पुष्टि करें",
  },
  recovery: {
    subject: "अपना पासवर्ड रीसेट करें", preview: (s) => `${s} के लिए अपना पासवर्ड रीसेट करें`, heading: "अपना पासवर्ड रीसेट करें",
    body: (s) => `किसी ने आपके ${s} खाते का पासवर्ड रीसेट करने का अनुरोध किया है।`,
    lead: "नया पासवर्ड चुनने के लिए रीसेट पेज पर यह कोड डालें:", orBrowser: "या अपने ब्राउज़र में जारी रखें:",
    noToken: "नया पासवर्ड चुनने के लिए बटन दबाएँ:", button: "नया पासवर्ड चुनें", stays: "आपका पासवर्ड जैसा है वैसा ही रहेगा।",
  },
  invite: {
    subject: "आपको आमंत्रित किया गया है", preview: (s) => `आपको ${s} से जुड़ने के लिए आमंत्रित किया गया है`, heading: "आपको आमंत्रित किया गया है",
    before: "आपको इससे जुड़ने के लिए आमंत्रित किया गया है: ", after: "।",
    lead: "स्वीकार करने के लिए साइन-इन पेज पर यह कोड डालें:", orBrowser: "या अपने ब्राउज़र में स्वीकार करें:", noToken: "आमंत्रण स्वीकार करने के लिए बटन दबाएँ:", button: "आमंत्रण स्वीकार करें",
  },
  change: {
    subject: "अपने ईमेल बदलाव की पुष्टि करें", preview: (s) => `${s} पर अपने ईमेल बदलाव की पुष्टि करें`, heading: "अपने ईमेल बदलाव की पुष्टि करें",
    body: (s, f, t) => `किसी ने आपके ${s} खाते का ईमेल पता ${f} से बदलकर ${t} करने का अनुरोध किया है।`,
    currentAddress: "आपके मौजूदा पते", newAddress: "एक नया पता",
    lead: "बदलाव की पुष्टि के लिए यह कोड डालें:", orBrowser: "या अपने ब्राउज़र में पुष्टि करें:", noToken: "बदलाव की पुष्टि के लिए बटन दबाएँ:", button: "बदलाव की पुष्टि करें",
    worried: "अगर आपको लगता है कि कोई और आपका खाता इस्तेमाल कर रहा है, तो इस ईमेल का जवाब दें ताकि कोई व्यक्ति उसे सुरक्षित कर सके।",
  },
  notice: {
    subject: "आपके खाते पर ईमेल बदलने का अनुरोध किया गया", preview: (s) => `${s} पर ईमेल बदलने का अनुरोध किया गया`, heading: "ईमेल बदलने का अनुरोध किया गया",
    body: (s, f, t, a) => `किसी ने एक ${s} खाते का ईमेल पता ${f} से बदलकर ${t} करने का अनुरोध किया है। इसकी पुष्टि का लिंक सिर्फ़ ${a} पर जाता है। यह ईमेल किसी चीज़ की पुष्टि नहीं करता।`,
    itsAddress: "उसके मौजूदा पते", newAddress: "एक नया पता",
    ifYou: "अगर यह आप थे, तो कुछ करने की ज़रूरत नहीं है। अगर नहीं, तो तुरंत इस ईमेल का जवाब दें ताकि कोई व्यक्ति खाता सुरक्षित कर सके।",
    why: "आपको यह इसलिए मिल रहा है क्योंकि यह पता उस खाते का पुराना या नया पता है।",
  },
  reauth: { subject: "आपका सत्यापन कोड", preview: "आपका सत्यापन कोड", heading: "पुष्टि करें कि यह आप हैं", lead: "अपनी पहचान की पुष्टि के लिए यह कोड इस्तेमाल करें:" },
};

const NL: AuthStrings = {
  expires: (m) => `Hij verloopt over ${m} minuten.`,
  ignore: "Heb je hier niet om gevraagd? Dan kun je deze mail negeren.",
  magic: {
    subject: "Je inlogcode", preview: (s) => `Je inlogcode voor ${s}`, heading: "Je inlogcode",
    lead: (s) => `Vul deze code in op de inlogpagina van ${s}:`, orBrowser: "Of ga verder in je browser:",
    noToken: (s) => `Druk op de knop om in te loggen bij ${s}. Hij verloopt binnenkort.`, button: "Doorgaan",
  },
  signup: {
    subject: "Bevestig je e-mailadres", preview: (s) => `Bevestig je e-mailadres voor ${s}`, heading: "Bevestig je e-mailadres",
    before: "Bedankt voor je aanmelding bij ", after: (r) => `. Hiermee bevestig je dat ${r} jouw adres is.`,
    lead: "Vul deze code in op de inlogpagina:", orBrowser: "Of bevestig in je browser:", noToken: "Druk op de knop om het te bevestigen:", button: "E-mailadres bevestigen",
  },
  recovery: {
    subject: "Stel je wachtwoord opnieuw in", preview: (s) => `Stel je wachtwoord voor ${s} opnieuw in`, heading: "Stel je wachtwoord opnieuw in",
    body: (s) => `Iemand heeft gevraagd het wachtwoord van je ${s}-account opnieuw in te stellen.`,
    lead: "Vul deze code in op de herstelpagina om een nieuw wachtwoord te kiezen:", orBrowser: "Of ga verder in je browser:",
    noToken: "Druk op de knop om een nieuw wachtwoord te kiezen:", button: "Kies een nieuw wachtwoord", stays: "Je wachtwoord blijft zoals het is.",
  },
  invite: {
    subject: "Je bent uitgenodigd", preview: (s) => `Je bent uitgenodigd voor ${s}`, heading: "Je bent uitgenodigd",
    before: "Je bent uitgenodigd voor ", after: ".",
    lead: "Vul deze code in op de inlogpagina om te accepteren:", orBrowser: "Of accepteer in je browser:", noToken: "Druk op de knop om de uitnodiging te accepteren:", button: "Uitnodiging accepteren",
  },
  change: {
    subject: "Bevestig de wijziging van je e-mailadres", preview: (s) => `Bevestig de wijziging van je e-mailadres voor ${s}`, heading: "Bevestig de wijziging van je e-mailadres",
    body: (s, f, t) => `Iemand heeft gevraagd het e-mailadres van je ${s}-account te wijzigen van ${f} naar ${t}.`,
    currentAddress: "je huidige adres", newAddress: "een nieuw adres",
    lead: "Vul deze code in om de wijziging te bevestigen:", orBrowser: "Of bevestig in je browser:", noToken: "Druk op de knop om de wijziging te bevestigen:", button: "Wijziging bevestigen",
    worried: "Denk je dat iemand anders je account gebruikt? Beantwoord deze mail, dan beveiligt een mens het.",
  },
  notice: {
    subject: "Er is een wijziging van het e-mailadres op je account aangevraagd", preview: (s) => `Er is een wijziging van het e-mailadres aangevraagd bij ${s}`, heading: "Er is een wijziging van het e-mailadres aangevraagd",
    body: (s, f, t, a) => `Iemand heeft gevraagd het e-mailadres van een ${s}-account te wijzigen van ${f} naar ${t}. De link die dit bevestigt gaat alleen naar ${a}. Deze mail bevestigt niets.`,
    itsAddress: "het huidige adres", newAddress: "een nieuw adres",
    ifYou: "Was jij dit? Dan hoef je niets te doen. Zo niet, beantwoord deze mail dan meteen, zodat een mens het account kan beveiligen.",
    why: "Je krijgt dit omdat dit adres het oude of het nieuwe adres van dat account is.",
  },
  reauth: { subject: "Je verificatiecode", preview: "Je verificatiecode", heading: "Bevestig dat jij het bent", lead: "Gebruik deze code om je identiteit te bevestigen:" },
};

const PT: AuthStrings = {
  expires: (m) => `Ele expira em ${m} minutos.`,
  ignore: "Se você não pediu isso, pode ignorar este e-mail.",
  magic: {
    subject: "Seu código de login", preview: (s) => `Seu código de login para ${s}`, heading: "Seu código de login",
    lead: (s) => `Digite este código na página de login do ${s}:`, orBrowser: "Ou continue no seu navegador:",
    noToken: (s) => `Toque no botão para entrar no ${s}. Ele expira em breve.`, button: "Continuar",
  },
  signup: {
    subject: "Confirme seu e-mail", preview: (s) => `Confirme seu e-mail para ${s}`, heading: "Confirme seu e-mail",
    before: "Obrigado por se cadastrar no ", after: (r) => `. Isso confirma que ${r} é o seu endereço.`,
    lead: "Digite este código na página de login:", orBrowser: "Ou confirme no seu navegador:", noToken: "Toque no botão para confirmar:", button: "Confirmar e-mail",
  },
  recovery: {
    subject: "Redefina sua senha", preview: (s) => `Redefina sua senha do ${s}`, heading: "Redefina sua senha",
    body: (s) => `Alguém pediu para redefinir a senha da sua conta do ${s}.`,
    lead: "Digite este código na página de redefinição para escolher uma nova senha:", orBrowser: "Ou continue no seu navegador:",
    noToken: "Toque no botão para escolher uma nova senha:", button: "Escolher uma nova senha", stays: "Sua senha continua a mesma.",
  },
  invite: {
    subject: "Você foi convidado", preview: (s) => `Você foi convidado para participar do ${s}`, heading: "Você foi convidado",
    before: "Você foi convidado para participar do ", after: ".",
    lead: "Digite este código na página de login para aceitar:", orBrowser: "Ou aceite no seu navegador:", noToken: "Toque no botão para aceitar o convite:", button: "Aceitar convite",
  },
  change: {
    subject: "Confirme a troca do seu e-mail", preview: (s) => `Confirme a troca do seu e-mail no ${s}`, heading: "Confirme a troca do seu e-mail",
    body: (s, f, t) => `Alguém pediu para trocar o endereço de e-mail da sua conta do ${s} de ${f} para ${t}.`,
    currentAddress: "seu endereço atual", newAddress: "um novo endereço",
    lead: "Digite este código para confirmar a troca:", orBrowser: "Ou confirme no seu navegador:", noToken: "Toque no botão para confirmar a troca:", button: "Confirmar a troca",
    worried: "Se você acha que outra pessoa está usando sua conta, responda a este e-mail para que alguém a proteja.",
  },
  notice: {
    subject: "Foi pedida uma troca de e-mail na sua conta", preview: (s) => `Foi pedida uma troca de e-mail no ${s}`, heading: "Foi pedida uma troca de e-mail",
    body: (s, f, t, a) => `Alguém pediu para trocar o endereço de e-mail de uma conta do ${s} de ${f} para ${t}. O link que confirma isso vai apenas para ${a}. Este e-mail não confirma nada.`,
    itsAddress: "o endereço atual dela", newAddress: "um novo endereço",
    ifYou: "Se foi você, não precisa fazer nada. Se não foi, responda a este e-mail imediatamente para que alguém proteja a conta.",
    why: "Você está recebendo isto porque este endereço é o antigo ou o novo endereço dessa conta.",
  },
  reauth: { subject: "Seu código de verificação", preview: "Seu código de verificação", heading: "Confirme que é você", lead: "Use este código para confirmar sua identidade:" },
};

const TL: AuthStrings = {
  expires: (m) => `Mag-e-expire ito sa loob ng ${m} minuto.`,
  ignore: "Kung hindi mo ito hiniling, puwede mo itong balewalain.",
  magic: {
    subject: "Ang iyong sign-in code", preview: (s) => `Ang iyong sign-in code para sa ${s}`, heading: "Ang iyong sign-in code",
    lead: (s) => `Ilagay ang code na ito sa sign-in page ng ${s}:`, orBrowser: "O magpatuloy sa iyong browser:",
    noToken: (s) => `Pindutin ang button para mag-sign in sa ${s}. Mag-e-expire ito sa lalong madaling panahon.`, button: "Magpatuloy",
  },
  signup: {
    subject: "Kumpirmahin ang iyong email", preview: (s) => `Kumpirmahin ang iyong email para sa ${s}`, heading: "Kumpirmahin ang iyong email",
    before: "Salamat sa pag-sign up sa ", after: (r) => `. Kinukumpirma nito na ${r} ang iyong address.`,
    lead: "Ilagay ang code na ito sa sign-in page:", orBrowser: "O kumpirmahin sa iyong browser:", noToken: "Pindutin ang button para kumpirmahin ito:", button: "Kumpirmahin ang email",
  },
  recovery: {
    subject: "I-reset ang iyong password", preview: (s) => `I-reset ang iyong password para sa ${s}`, heading: "I-reset ang iyong password",
    body: (s) => `May humiling na i-reset ang password ng iyong ${s} account.`,
    lead: "Ilagay ang code na ito sa reset page para pumili ng bagong password:", orBrowser: "O magpatuloy sa iyong browser:",
    noToken: "Pindutin ang button para pumili ng bagong password:", button: "Pumili ng bagong password", stays: "Mananatili ang iyong password.",
  },
  invite: {
    subject: "Inimbitahan ka", preview: (s) => `Inimbitahan kang sumali sa ${s}`, heading: "Inimbitahan ka",
    before: "Inimbitahan kang sumali sa ", after: ".",
    lead: "Ilagay ang code na ito sa sign-in page para tanggapin:", orBrowser: "O tanggapin sa iyong browser:", noToken: "Pindutin ang button para tanggapin ang imbitasyon:", button: "Tanggapin ang imbitasyon",
  },
  change: {
    subject: "Kumpirmahin ang pagpapalit ng iyong email", preview: (s) => `Kumpirmahin ang pagpapalit ng iyong email sa ${s}`, heading: "Kumpirmahin ang pagpapalit ng iyong email",
    body: (s, f, t) => `May humiling na palitan ang email address ng iyong ${s} account mula ${f} papunta sa ${t}.`,
    currentAddress: "iyong kasalukuyang address", newAddress: "isang bagong address",
    lead: "Ilagay ang code na ito para kumpirmahin ang pagpapalit:", orBrowser: "O kumpirmahin sa iyong browser:", noToken: "Pindutin ang button para kumpirmahin ang pagpapalit:", button: "Kumpirmahin ang pagpapalit",
    worried: "Kung sa tingin mo ay may ibang gumagamit ng iyong account, sumagot sa email na ito para maprotektahan ito ng isang tao.",
  },
  notice: {
    subject: "May humiling na palitan ang email sa iyong account", preview: (s) => `May humiling na palitan ang email sa ${s}`, heading: "May humiling na palitan ang email",
    body: (s, f, t, a) => `May humiling na palitan ang email address ng isang ${s} account mula ${f} papunta sa ${t}. Ang link na nagkukumpirma nito ay ipinapadala lang sa ${a}. Walang kinukumpirma ang email na ito.`,
    itsAddress: "kasalukuyang address nito", newAddress: "isang bagong address",
    ifYou: "Kung ikaw ito, wala kang kailangang gawin. Kung hindi, sumagot agad sa email na ito para maprotektahan ng isang tao ang account.",
    why: "Natatanggap mo ito dahil ang address na ito ang luma o bagong address ng account na iyon.",
  },
  reauth: { subject: "Ang iyong verification code", preview: "Ang iyong verification code", heading: "Kumpirmahin na ikaw ito", lead: "Gamitin ang code na ito para kumpirmahin ang iyong pagkakakilanlan:" },
};

const TABLE: Record<AuthMailLanguage, AuthStrings> = { en: EN, de: DE, es: ES, fr: FR, hi: HI, nl: NL, pt: PT, tl: TL };

/** The strings for a language (English for anything else). */
export function authStrings(lng: string | null | undefined): AuthStrings {
  return TABLE[authMailLanguage(lng)];
}
