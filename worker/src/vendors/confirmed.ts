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
export const CONFIRMED_RE =
  /thank you|thanks for (?:applying|your application)|application (?:has been )?(?:received|submitted|sent)|we(?:'ve| have) received|successfully (?:submitted|applied)|vielen dank|bewerbung (?:erhalten|eingegangen|übermittelt)|merci|candidature (?:re[çc]ue|envoy[ée]e)|gracias|solicitud recibida|hemos recibido|obrigad[oa]|candidatura recebida|bedankt|sollicitatie ontvangen/i;

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
