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
 * When the first real submission happens the worker records the page's actual
 * wording, agent_confirmation_gaps groups it, and the heartbeat reports it. Add
 * what it saw here — that is how the guess becomes a measurement.
 *
 * WIDENING THIS IS SAFE; NARROWING IT IS NOT. classifyConfirmation returns "yes"
 * only when the form is GONE **and** a phrase matches, and visibility is checked
 * first — so a broad list cannot on its own manufacture a false "submitted".
 * What a NARROW list does is route genuine successes to `uncertain`, where they
 * sit waiting for a human: the safe failure, but at any volume also a product
 * that does nothing useful unattended.
 *
 * LANGUAGES ARE CHOSEN FROM THE VENDORS, not from a general list. Teamtailor is
 * Swedish and Personio German, both localise per tenant, and the Breezy recon
 * sample alone spanned UK, US, South African and German employers. Nordic
 * coverage was missing entirely, so a Teamtailor tenant running in its home
 * language had no chance of being recognised.
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
    "vielen dank",
    // "ist"/"wurde" sit BETWEEN the noun and the verb in natural German —
    // "Ihre Bewerbung ist eingegangen" is the ordinary way to say it, and the
    // adjacent-words-only version could not match it. Caught by the invariant
    // that the strict list must be a subset of this one.
    "bewerbung (?:ist |wurde |wurde soeben )?(?:erhalten|eingegangen|übermittelt|gesendet)",
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

/**
 * THE STRICT LIST — phrases that cannot appear until an application exists.
 *
 * CONFIRMED_RE above is deliberately broad, and it is only safe because the
 * visibility gate runs first: "thank you", "merci", "gracias" are all ordinary
 * job-ad copy, and matching them on a page whose form is still up would report a
 * failed submit as sent.
 *
 * Some adapters cannot check visibility at all. SmartRecruiters renders its form
 * in shadow DOM across multiple steps, so "no form field found" means EITHER
 * submitted OR on step 3 of 4. For those, the broad list plus no gate is the
 * false-positive waiting to happen — and that is exactly what its adapter did.
 *
 * So this list requires the page to name the APPLICATION as a completed thing:
 * a noun for the submission plus a verb of receipt. "Thank you for your interest
 * in this role" cannot match it. "Your application has been received" cannot
 * appear before there is an application to receive.
 */
export const CONFIRMED_STRICT_RE =
  new RegExp([
    "application (?:has been |was |is )?(?:received|submitted|sent|complete)",
    "we(?:'ve| have) received your application",
    "your application (?:to|for) .{0,60} (?:has been|was) (?:received|submitted|sent)",
    "successfully (?:submitted|applied)",
    "submission (?:has been |was )?received",
    "bewerbung (?:ist |wurde )?(?:erhalten|eingegangen|übermittelt|gesendet)",
    "ansökan (?:har )?mottagits", "søknaden (?:er )?mottatt",
    "hakemuksesi on vastaanotettu",
    "candidature (?:a été )?(?:re[çc]ue|envoy[ée]e)",
    "solicitud (?:ha sido )?recibida", "candidatura (?:foi )?recebida",
    "sollicitatie (?:is )?ontvangen", "candidatura (?:è stata )?ricevuta",
  ].join("|"), "i");

/**
 * For adapters that cannot determine whether the form is still on screen.
 *
 * NEVER returns "no". Not finding a confirmation on a multi-step shadow-DOM form
 * could equally mean we are mid-wizard, and "no" would invite a retry — a second
 * application under a real person's name. Unknown parks it for a human, which is
 * the honest answer when we genuinely do not know.
 */
export function classifyWithoutVisibility(bodyText: string): "yes" | "unknown" {
  return CONFIRMED_STRICT_RE.test(bodyText) ? "yes" : "unknown";
}
