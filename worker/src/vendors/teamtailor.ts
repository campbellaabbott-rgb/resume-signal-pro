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

const DECLINE_RE = /decline all non.?necessary|decline all|reject all|only necessary|nur notwendige|refuser/i;
const APPLY_RE = /^(apply for this job|apply now|apply|jetzt bewerben|bewerben|postuler|solicitar)/i;
const SUBMIT_RE = /^submit application$/i;

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

    // Two of ten sampled tenants exposed no form at all — probably external
    // apply redirects. They must resolve to null so the worker refuses, rather
    // than proceeding to submit whatever is on screen.
    const ok = await page.locator(f("candidate[email]")).count().catch(() => 0);
    return ok > 0 ? url : null;
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
