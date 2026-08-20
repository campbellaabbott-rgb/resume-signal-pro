import type { Page, Locator } from "playwright";
import { enumerateOn } from "./enumerate-dom.js";
import { classifyConfirmation } from "./confirmed.js";
import type { VendorAdapter, Locatable, PacketFieldKey } from "./types.js";

/**
 * Oracle Recruiting Cloud (Candidate Experience).
 *
 * MEASURED LIVE 2026-08-19 against a real posting, reading only — nothing was
 * typed and nothing was submitted, because entering an email into a live
 * employer's system creates a partial candidate record at a real company.
 *
 * THE BLOCKER WAS NEVER A CREDENTIAL WALL, and the repo said otherwise for
 * three weeks. vendors/index.ts recorded "creates a candidate PROFILE per
 * employer tenant... No guest path offered... Same class of obstacle as
 * workday", which would make this unbuildable without a credential vault.
 * RECON.md said the opposite on the same vendor. The live screen settles it, in
 * Oracle's own words:
 *
 *     "You don't need to have an account. Get started right away by simply
 *      using your email. Your profile will be created and kept up to date
 *      automatically as you enter details for each of your job applications."
 *
 * Measured on that screen: ZERO password inputs, no sign-in requirement, no
 * CAPTCHA. The profile is a CONSEQUENCE of applying, not a gate before it —
 * which is the whole difference from Workday, where the candidate must register
 * with a password per tenant before the form exists.
 *
 * WHAT ACTUALLY GATED IT: the required "I agree with the terms and conditions"
 * checkbox. Ticking that is an act performed in someone's name, so it runs
 * through the SAME consent opt-in the question matcher already enforces
 * (consentToProcessing, default false) rather than a private path — see
 * enumerateQuestions below. The owner authorised this class of act for Oracle
 * on 2026-08-19; the per-candidate opt-in still governs every individual send.
 *
 * THE HONEYPOT IS REAL AND IT IS ON THE FIRST SCREEN: name="honey-pot",
 * aria-label="honeypot", and it reports as VISIBLE to the DOM. Nothing here
 * maps it, and the driver only fills what an adapter maps — which is exactly
 * why that rule exists. A fill-everything driver would announce itself to this
 * employer on the first application.
 *
 * THE SITE ID CHANGES ACROSS THE APPLY BOUNDARY. The posting lives under
 * .../sites/CX_1/job/15499 and the apply screen under
 * .../sites/CX_1001/job/15499/apply/email — a different site number, measured.
 * So the form URL CANNOT be derived by string surgery on the posting URL; the
 * apply control has to be clicked and the resulting URL read.
 *
 * WHAT IS DELIBERATELY UNMEASURED: everything past the email screen. Reaching
 * it requires submitting an email to a real employer. So every step beyond the
 * authentication screen is treated as unknown and fails safe — proceed()
 * returns "stuck" rather than guessing, and a verification-code wall (which
 * this screen does not mention, but which was not disproved either) is detected
 * and refused rather than blundered into.
 */
const wrap = (l: Locator): Locatable => ({
  fill: async (v) => { await l.fill(v, { timeout: 8_000 }); },
  setFile: async (p) => { await l.setInputFiles(p, { timeout: 20_000 }); },
  isVisible: () => l.isVisible({ timeout: 3_000 }).catch(() => false),
});

/**
 * Field names measured on the authentication screen. Only `primary-email` is
 * mapped: it is the one field that screen asks for, and mapping speculative
 * names for later screens would be the "written from imagination" mistake the
 * adapter layer exists to prevent.
 *
 * `honey-pot` is ABSENT ON PURPOSE and must stay absent.
 */
const FIELDS: Partial<Record<PacketFieldKey, string>> = {
  email: 'input[name="primary-email"]',
};

/** The terms checkbox, custom-styled: the real input is hidden behind a label. */
const TERMS_INPUT = "#legal-disclaimer-checkbox";

/** Wording that means "we emailed you a code" — an inbox we cannot read. */
const VERIFICATION_RE = /verification code|verify your email|code we (sent|emailed)|one-?time (code|passcode)|enter the code/i;

async function looksLikeVerificationWall(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  return VERIFICATION_RE.test(text);
}

export const oracle: VendorAdapter = {
  key: "oracle",

  /**
   * `required` IS present on the terms checkbox and measured as trustworthy on
   * the authentication screen (1 of 4 controls carried it — RECON.md's table).
   * Kept true so the driver's empty-required check means something here.
   */
  requiredAttributeIsTrustworthy: true,

  mappedNames: new Set(Object.values(FIELDS).map((sel) => /\[name="([^"]+)"\]/.exec(sel)?.[1] ?? sel)),

  async resolveFormUrl(page, postingUrl) {
    if (!/\/hcmUI\/CandidateExperience\//i.test(postingUrl)) return null;
    await page.goto(postingUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(3_000);

    // Structure, not words: the apply control is the one button whose
    // accessible name or text carries "apply", and Oracle renders it as a
    // BUTTON with no href — so there is no link to read the destination from.
    // The URL has to come from where the click lands, because the site id
    // changes across the boundary (CX_1 -> CX_1001, measured).
    const btn = page.locator("button, a").filter({ hasText: /apply/i }).first();
    if (!(await btn.isVisible({ timeout: 8_000 }).catch(() => false))) return null;
    await btn.click({ timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(4_000);

    const url = page.url();
    // Only accept a URL that is actually inside the apply flow. A tenant that
    // bounces the click back to the description would otherwise be reported as
    // "form found" and then fail confusingly further down.
    return /\/apply(\/|$)/i.test(url) ? url : null;
  },

  async locate(page, field) {
    const sel = FIELDS[field];
    if (!sel) return null;
    const l = page.locator(sel).first();
    return (await l.count()) ? wrap(l) : null;
  },

  /**
   * No résumé input exists on the authentication screen, and the screens past
   * it are unmeasured. Returning null is the honest answer — it means "this
   * adapter has no résumé field here", which the driver already handles.
   */
  async locateResume() {
    return null;
  },

  async canProceed(page) {
    // A code wall means an inbox we cannot read. Refuse before anything else.
    if (await looksLikeVerificationWall(page)) return "stuck";

    // The authentication screen advances with Next; it never submits an
    // application. Anything beyond it is unmeasured, so it is not claimed.
    const next = page.locator("button").filter({ hasText: /^\s*next\s*$/i }).first();
    if (await next.isVisible({ timeout: 4_000 }).catch(() => false)) return "would-advance";

    return "stuck";
  },

  async proceed(page) {
    // proceed() MUST agree with canProceed() — the contract requires it, and a
    // dry run that says one thing while the real run does another is worse than
    // either answer alone.
    const verdict = await this.canProceed(page);
    if (verdict === "stuck") return "stuck";

    if (verdict === "would-advance") {
      const next = page.locator("button").filter({ hasText: /^\s*next\s*$/i }).first();
      await next.click({ timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(4_000);
      // If the click produced a code wall, say stuck now rather than letting a
      // later step interpret a half-finished flow as progress.
      return (await looksLikeVerificationWall(page)) ? "stuck" : "advanced";
    }

    // "would-submit" is never returned by canProceed here, because no submit
    // control on this vendor has been measured. Reaching this line means the
    // contract changed and the honest answer is that we do not know.
    return "stuck";
  },

  async unansweredRequired(page) {
    const missing = await page
      .locator("input[required], select[required], textarea[required]")
      .evaluateAll((els) =>
        els
          .filter((e) => {
            const name = (e.getAttribute("name") || e.getAttribute("id") || "");
            // Never count the honeypot as a field needing an answer.
            if (/honey.?pot/i.test(name)) return false;
            const v = (e as HTMLInputElement).value;
            const type = (e.getAttribute("type") || "").toLowerCase();
            if (type === "checkbox") return !(e as HTMLInputElement).checked;
            return !v;
          })
          .map((e) => e.getAttribute("name") || e.getAttribute("id") || "unnamed"),
      )
      .catch(() => null);
    return missing;
  },

  /**
   * The terms checkbox is surfaced as a QUESTION rather than ticked here.
   *
   * That is the whole consent design: the question matcher already refuses
   * "consent-processing" items unless the candidate set consentToProcessing,
   * and routes them to review otherwise. Ticking it inside the adapter would
   * build a second, private path around a gate that exists precisely to stop
   * the agent agreeing to things in someone's name — and it would be invisible
   * to every test written against the matcher.
   *
   * The DOM enumerator is asked for the page's controls; the checkbox is added
   * explicitly because it is custom-styled (the real input reports as not
   * visible) and a visibility-filtered enumeration drops it. Dropping it would
   * be the dangerous outcome: a required consent control that no one answers
   * reads as "nothing to consent to".
   */
  async enumerateQuestions(page) {
    const base = await enumerateOn(page);
    // NULL MEANS "I COULD NOT LOOK", and it must stay null. Appending the terms
    // question to a failed enumeration would turn "the probe broke" into "here
    // is the one control on this form" — a fabricated clean read of exactly the
    // kind the enumerator's own contract warns about.
    if (base === null) return null;

    const hasTerms = (await page.locator(TERMS_INPUT).count()) > 0;
    if (!hasTerms) return base;

    const label =
      (await page
        .locator(`label[for="legal-disclaimer-checkbox"]`)
        .innerText({ timeout: 3_000 })
        .catch(() => "")) || "I agree with the terms and conditions";

    const termsQuestion = {
      name: "legal-disclaimer-checkbox",
      label: label.trim(),
      type: "checkbox" as const,
      required: true,
      options: [] as string[],
    };

    // If the enumerator already found it, do not duplicate it.
    if (base.some((q) => q.name === termsQuestion.name)) return base;
    return [...base, termsQuestion];
  },

  async confirmed(page) {
    // Visibility BEFORE words, the same order pinpoint uses and for the same
    // measured reason: checking the phrase list first records a FAILED submit
    // as sent whenever the page carries ordinary "thank you for your interest"
    // copy — which Oracle posting pages do.
    //
    // The email input is the marker: if it is still visible we have not left
    // the authentication screen, so nothing was submitted.
    const still = await page
      .locator(FIELDS.email ?? 'input[name="primary-email"]')
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    const body = ((await page.textContent("body").catch(() => "")) ?? "").slice(0, 4_000);
    return classifyConfirmation(still, body);
  },
};
