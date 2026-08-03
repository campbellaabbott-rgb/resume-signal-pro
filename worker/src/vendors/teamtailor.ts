/**
 * Teamtailor. 10,144 postings, written from live recon on 2026-07-31.
 *
 * THREE THINGS THAT MAKE THIS VENDOR DIFFERENT, each found the hard way:
 *
 * 1. A COOKIE OVERLAY SUPPRESSES THE FORM. Until it is dismissed the apply
 *    control does nothing and the page exposes no fields at all. The first
 *    recon pass reported "0/10 forms have a file input" and nearly recorded
 *    Teamtailor as unable to take a résumé — a fact about the banner, not the
 *    vendor. `declineCookies` runs before anything else and picks the
 *    most privacy-preserving option, which happens to also clear the overlay.
 *
 * 2. THE FORM IS INLINE ON THE POSTING PAGE. There is no separate apply URL,
 *    which is what the old note ("form URL rule unknown") was really recording
 *    — it was hunting for a rule that does not exist. `resolveFormUrl` returns
 *    the posting URL itself once the form is actually showing.
 *
 * 3. THE CV INPUT HAS NO NAME. Every file input on the form is unnamed, and
 *    there are two or three of them — cover letter and portfolio slots sit
 *    beside the résumé. It is located by its `accept` list instead. Taking
 *    "the first file input" would attach the CV to whichever slot happens to
 *    render first, which is how Personio would have put a résumé into
 *    "employment reference" and submitted an application whose CV slot was
 *    empty while looking, to us, like it worked.
 */
import { enumerateOn } from "./enumerate-dom.js";
import { classifyConfirmation } from "./confirmed.js";
import type { VendorAdapter, PacketFieldKey, Locatable } from "./types.js";
import type { Locator, Page } from "playwright";

const wrap = (l: Locator): Locatable => ({
  fill: async (v) => { await l.fill(v, { timeout: 15_000 }); },
  setFile: async (p) => { await l.setInputFiles(p, { timeout: 20_000 }); },
  isVisible: () => l.isVisible({ timeout: 3_000 }).catch(() => false),
});

/**
 * Rails-nested and stable across tenants — 7 of 10 sampled carried this exact
 * set, on English, German, French and Spanish career sites. The names are the
 * vendor's, not the employer's, which is why they can be relied on where the
 * visible labels cannot.
 */
const KEYS: Partial<Record<PacketFieldKey, string>> = {
  firstName: "candidate[first_name]",
  lastName: "candidate[last_name]",
  email: "candidate[email]",
  phone: "candidate[phone]",
  coverNote: "candidate[job_applications_attributes][0][cover_letter]",
};
const f = (k: string) => `[name="${k}"]`;
const FIELDS = Object.fromEntries(
  Object.entries(KEYS).map(([k, v]) => [k, f(v)]),
) as Partial<Record<PacketFieldKey, string>>;

/**
 * The résumé slot, identified by what it accepts rather than what it is called.
 * Both markers are required: the OTHER file inputs on these forms carry an
 * empty accept, so matching on "has an accept" alone would still be ambiguous
 * if a tenant ever set one.
 */
const RESUME_SEL = 'input[type="file"][accept*="pdf"][accept*="docx"]';

/**
 * THE NORDIC GAP, measured 2026-08-03 across 13 live Teamtailor postings.
 *
 * Seven of them failed at `resolveFormUrl` with "no form found", and every
 * single failure was a NON-ENGLISH site: Swedish (attendosverige, vardaga,
 * purplerekrytering, dentalbusinessgroup), Norwegian (compass-group.no),
 * Italian (roccofortehotelsitaly), Spanish (kidsandus). Every English tenant
 * passed. The regex below covered English, German, French and Spanish and
 * nothing else — on a vendor headquartered in Stockholm, whose heartland is
 * exactly the languages it could not read. Six of thirteen postings became
 * unreachable for the sake of one missing alternation.
 *
 * WIDENING THIS IS SAFE, and that is a property of the design rather than
 * luck. `resolveFormUrl` does not trust the button: after clicking it, the
 * check is `candidate[email]` — a field name the VENDOR controls. A looser
 * match can therefore only ever click something harmless and then still return
 * null. Nothing downstream believes a form is present because a button was
 * found. That is why this can be broadened without a new risk.
 *
 * Cookie banners get the same treatment: an overlay that will not dismiss
 * intercepts the apply click, so a Swedish "Avvisa alla" costs exactly as much
 * as a missing apply button.
 */
const DECLINE_RE = /decline all non.?necessary|decline all|reject all|only necessary|nur notwendige|refuser|avvisa alla|endast nödvändiga|neka alla|avvis alle|kun nødvendige|afvis alle|hylkää|vain välttämättömät|rifiuta tutto|solo necessari|alles weigeren|alleen noodzakelijke|rejeitar tudo|odrzuć wszystko/i;
const APPLY_RE = /^(apply for this job|apply now|apply|jetzt bewerben|bewerben|postuler|solicitar|inscribirse|postularme|ansök|sök tjänsten|sök jobbet|søk stillingen|søk nå|søk|ansøg|hae paikkaa|hae|candidati|invia candidatura|solliciteer|solliciteren|candidatar|candidate-se|aplikuj|jelentkezem|přihlásit)/i;
/**
 * The submit control, in the languages this vendor's tenants actually use.
 *
 * SAME BUG AS APPLY_RE, ONE STEP LATER, and it hid behind the first one. With
 * the form finally reachable on six Nordic/Italian tenants (2026-08-03), every
 * one of them located all five fields, attached the résumé, read the questions,
 * found nothing required outstanding — and then reported "stuck", because
 * `^submit application$` cannot see "Skicka ansökan".
 *
 * WIDENED DIFFERENTLY FROM APPLY_RE, ON PURPOSE. A loose apply match is
 * harmless: the check afterwards is a vendor-controlled field name, so a wrong
 * click just fails to find a form. A loose SUBMIT match has no such backstop —
 * it presses the button, and an employer receives an application that cannot be
 * withdrawn. So every alternative here is FULLY ANCHORED (^...$) and is a
 * complete button label, never a fragment. "ansök" appears in APPLY_RE as a
 * prefix and is deliberately absent here: on an application form a bare
 * "Ansök" could be a nav link back to the listing.
 *
 * Verified against the live DOM of the six tenants before being widened.
 */
const SUBMIT_RE = new RegExp(
  "^(" + [
    "submit application", "submit", "send application",
    "skicka ansökan", "skicka in ansökan",            // sv
    "send søknad", "send inn søknaden", "send inn",   // no
    "send ansøgning", "send ansøgningen",             // da
    "lähetä hakemus",                                 // fi
    "invia candidatura", "invia la candidatura",      // it
    "enviar solicitud", "enviar candidatura",         // es / pt
    "envoyer ma candidature", "envoyer la candidature", // fr
    "bewerbung absenden", "bewerbung abschicken",     // de
    "sollicitatie versturen", "verstuur sollicitatie", // nl
    "wyślij aplikację",                               // pl
  ].join("|") + ")$",
  "i",
);

/** Clear the consent overlay, choosing the most privacy-preserving option. */
async function declineCookies(page: Page): Promise<void> {
  const b = page.getByRole("button", { name: DECLINE_RE }).first();
  if ((await b.count().catch(() => 0)) > 0) {
    await b.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
  }
}

export const teamtailor: VendorAdapter = {
  key: "teamtailor",

  // Measured: 3 of 78 controls set `required`, while 41 declare it in their
  // LABEL ("Upload resume*", "…*Required", "…*Requis", "…*Erforderlich").
  // Counting the attribute here would return near-zero on a form full of
  // required questions and read as a clean bill of health.
  requiredAttributeIsTrustworthy: false,

  mappedNames: new Set(Object.values(KEYS)),

  enumerateQuestions: (page) => enumerateOn(page),

  async resolveFormUrl(page, postingUrl) {
    const url = postingUrl.replace(/[?#].*$/, "");
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => null);
    if (!resp || resp.status() >= 400) return null;
    await page.waitForTimeout(2_500);
    await declineCookies(page);

    // The employer writes this control's text, so it is matched loosely and in
    // several languages — but the CHECK afterwards is on a field name the
    // vendor controls, never on the button having been found.
    const apply = page.getByRole("button", { name: APPLY_RE })
      .or(page.getByRole("link", { name: APPLY_RE })).first();
    if ((await apply.count().catch(() => 0)) > 0) {
      await apply.click({ timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(4_000);
    }

    const inline = await page.locator(f("candidate[email]")).count().catch(() => 0);
    if (inline > 0) return url;

    /**
     * THE CANONICAL FORM ROUTE, and it is where most of the "no form" tenants
     * were hiding. Measured 2026-08-03 across 13 live postings: 7 failed here,
     * and the note this replaces guessed "probably external apply redirects".
     * It was wrong. Fetching `{posting}/applications/new` on three of the
     * failures returned HTTP 200 with `candidate[email]` present in the raw
     * HTML — the form exists, it is simply not inline and the apply control
     * never resolved to it.
     *
     * That mattered disproportionately because Teamtailor is a Stockholm
     * company and the failures were Swedish, Norwegian and Italian tenants —
     * so the gap fell almost entirely on non-English employers, which is
     * exactly the part of the catalogue nothing else reaches.
     *
     * THE GUARD IS UNCHANGED. This is a second place to look, not a second
     * standard of proof: the return is still conditional on `candidate[email]`
     * being present, a field name the VENDOR controls. A tenant that genuinely
     * redirects to an external ATS still resolves to null and is still refused.
     */
    const canonical = `${url}/applications/new`;
    const r2 = await page.goto(canonical, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => null);
    if (r2 && r2.status() < 400) {
      await page.waitForTimeout(1_500);
      await declineCookies(page);
      const ok2 = await page.locator(f("candidate[email]")).count().catch(() => 0);
      if (ok2 > 0) return canonical;
    }
    return null;
  },

  async locate(page, field) {
    const sel = FIELDS[field];
    if (!sel) return null;
    const l = page.locator(sel).first();
    return (await l.count()) > 0 ? wrap(l) : null;
  },

  async locateResume(page) {
    const l = page.locator(RESUME_SEL).first();
    return (await l.count()) > 0 ? wrap(l) : null;
  },

  async canProceed(page) {
    const submit = page.getByRole("button", { name: SUBMIT_RE }).first();
    if ((await submit.count().catch(() => 0)) > 0 && await submit.isVisible().catch(() => false)) {
      return "would-submit";
    }
    return "stuck";
  },

  async proceed(page) {
    // Delegates, so the dry run and the real run can never disagree about what
    // is about to happen.
    if (await this.canProceed(page) === "would-submit") {
      await page.getByRole("button", { name: SUBMIT_RE }).first().click({ timeout: 10_000 });
      return "submitted";
    }
    return "stuck";
  },

  async unansweredRequired() {
    // NULL, not []. The attribute is set on 3 of 78 controls, so counting empty
    // required fields would answer "nothing missing" on a form full of required
    // questions. A guard that always passes is worse than no guard: the caller
    // counts it as protection. The question matcher covers this properly, using
    // the labels, which is where this vendor states requiredness.
    return null;
  },

  async confirmed(page) {
    const still = await page.locator(f("candidate[email]")).first()
      .isVisible({ timeout: 2_000 }).catch(() => false);
    const body = ((await page.textContent("body").catch(() => "")) ?? "").slice(0, 4_000);
    return classifyConfirmation(still, body);
  },
};
