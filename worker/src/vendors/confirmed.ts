/**
 * What a confirmation page says — one list, shared by every adapter.
 *
 * EVERY PHRASE HERE IS A GUESS. Nobody has yet watched a real submission on any
 * of these vendors, so this is written from what application confirmations
 * typically say, not from what one actually said. That is exactly why a miss
 * must resolve to `uncertain` and never to `not-submitted`: uncertain parks the
 * row for a human, not-submitted invites a retry, and a retry is a second
 * application under a real person's name that cannot be withdrawn.
 *
 * Multilingual because these vendors are. The Breezy recon sample alone spanned
 * UK, US, South African and German employers, and Personio renders German
 * labels with English attribute names. An English-only list would route most
 * SUCCESSFUL sends to a human as unresolved.
 *
 * When the first real submission happens, the worker records the page's actual
 * wording in the uncertain reason. Add what it saw here.
 */
/**
 * WIDENING THIS IS SAFE; NARROWING IT IS NOT. `classifyConfirmation` returns
 * "yes" only when the form is GONE **and** a phrase matches, so a broad list
 * cannot on its own manufacture a false "submitted" — the visibility gate is
 * what prevents that, and it is checked first. What a NARROW list does is route
 * genuine successes to `uncertain`, where they sit waiting for a human. That is
 * the safe failure, but at any volume it is also a product that does nothing
 * useful unattended.
 *
 * LANGUAGES ARE CHOSEN FROM THE VENDORS, not from a general list. Teamtailor is
 * Swedish and Personio is German; both localise per tenant, and the Breezy recon
 * sample alone spanned UK, US, South African and German employers. Nordic
 * coverage was missing entirely, which meant a Teamtailor tenant running in its
 * home language had no chance of being recognised.
 */
export const CONFIRMED_RE =
  new RegExp([
    // English — the widest set, because it is the fallback locale for all four.
    "thank you", "thanks for (?:applying|your application)",
    "application (?:has been )?(?:received|submitted|sent|complete)",
    "we(?:'ve| have) received", "successfully (?:submitted|applied|sent)",
    "you(?:'ve| have) applied", "we(?:'ll| will) be in touch",
    "submission (?:has been )?received",
    // German — Personio's home language.
    "vielen dank", "bewerbung (?:erhalten|eingegangen|übermittelt|gesendet)",
    // Swedish / Norwegian / Danish — Teamtailor's home region. `tack` and `takk`
    // are bounded below so they cannot match inside a longer word.
    "tack för din ansökan", "ansökan (?:har )?mottagits", "takk for søknaden",
    "søknaden (?:er )?mottatt", "tak for din ansøgning",
    // Finnish.
    "kiitos hakemuksestasi", "hakemuksesi on vastaanotettu",
    // French.
    "merci", "candidature (?:re[çc]ue|envoy[ée]e)",
    // Spanish / Portuguese.
    "gracias", "solicitud recibida", "hemos recibido",
    "obrigad[oa]", "candidatura recebida",
    // Dutch.
    "bedankt", "sollicitatie ontvangen",
    // Italian.
    "grazie", "candidatura ricevuta",
    // Polish.
    "dziękujemy", "otrzymaliśmy(?: tw[oó]j[ąa])? (?:zgłoszenie|aplikacj)",
  ].join("|"), "i");

/**
 * The shared shape of `confirmed()`, with the ordering that matters.
 *
 * VISIBILITY IS CHECKED FIRST, and the original order was wrong in a way that
 * silently lost applications. All three adapters tested the phrase list before
 * asking whether the form was still on screen — but "thank you for your
 * interest in this role" is ordinary job-ad copy that sits on the form page
 * itself. A submit that failed, leaving the form up, matched it and was
 * recorded as SENT. The candidate is told they applied to a job they did not,
 * and the duplicate guard then blocks them applying properly.
 *
 * A wrong "yes" loses the application quietly. A wrong "no" creates a duplicate.
 * Both are bad; only the first leaves the person believing something false.
 *
 * @param stillOnScreen whether a field unique to the form is genuinely VISIBLE
 *        — not merely present. These forms are JS wizards whose fields survive
 *        a successful submit at zero size, so presence proves nothing.
 */
export function classifyConfirmation(
  stillOnScreen: boolean,
  bodyText: string,
): "yes" | "no" | "unknown" {
  if (stillOnScreen) return "no";
  if (CONFIRMED_RE.test(bodyText)) return "yes";
  return "unknown";
}
